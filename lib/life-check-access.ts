import { getSession, requireClassManagement, requireStudent } from "./auth";
import { ownedClass } from "./authorization";
import { database, ensureSchema, runtimeSchemaProvidedByMigrations } from "./database";
import { currentStudentJob } from "./finance-access";
import {
  LIFE_CHECK_INFO,
  LIFE_CHECK_TYPES,
  type LifeCheckType,
} from "./life-check-rules";
import { LIFE_CHECK_SCHEMA_STATEMENTS } from "./life-check-schema";
import { ApiError } from "./responses";
import {
  activeManualPermissionKeys,
  permissionSource,
  type StudentPermissionSource,
} from "./student-permissions";

export type LifeCheckRole = "teacher" | "checker" | "student";

export type LifeCheckContext = {
  actor: {
    type: "teacher" | "student";
    id: string;
    name: string;
  };
  classroom: {
    id: string;
    displayName: string;
    schoolName: string;
    schoolYear: number;
    grade: number;
    classNumber: number;
    status: "active" | "archived";
  };
  role: LifeCheckRole;
  allowedWriteTypes: LifeCheckType[];
  permissionSources: Partial<Record<LifeCheckType, StudentPermissionSource>>;
  permissions: {
    canViewClass: boolean;
    canRecord: boolean;
    canManagePayouts: boolean;
    canOverride: boolean;
  };
  activeJob: null | {
    id: string;
    name: string;
    templateId: string | null;
    assignmentYear: number;
    assignmentMonth: number;
    periodId: string;
  };
};

let lifeSchemaReady: Promise<void> | null = null;

export async function ensureLifeCheckSchema() {
  await ensureSchema();
  if (runtimeSchemaProvidedByMigrations()) return;
  if (!lifeSchemaReady) {
    lifeSchemaReady = database().batch(
      LIFE_CHECK_SCHEMA_STATEMENTS.map((statement) => database().prepare(statement)),
    ).then(() => undefined).catch((error) => {
      lifeSchemaReady = null;
      throw error;
    });
  }
  await lifeSchemaReady;
}

function displayName(row: {
  display_name: string | null;
  grade: number;
  class_number: number;
}) {
  return row.display_name?.trim() || `${Number(row.grade)}학년 ${Number(row.class_number)}반`;
}

function allowedTypeForJob(templateId: string | null | undefined): LifeCheckType[] {
  if (!templateId) return [];
  return LIFE_CHECK_TYPES.filter((type) => LIFE_CHECK_INFO[type].jobTemplateId === templateId);
}

export async function lifeCheckContextForRequest(request: Request): Promise<LifeCheckContext> {
  await ensureLifeCheckSchema();
  const requestedClassId = new URL(request.url).searchParams.get("classId")?.trim() || null;
  const session = await getSession(request);
  if (!session) throw new ApiError(401, "로그인이 필요합니다.", "LOGIN_REQUIRED");

  if (session.actorType === "teacher") {
    if (!requestedClassId) {
      throw new ApiError(400, "생활확인을 운영할 학급을 선택해 주세요.", "LIFE_CHECK_CLASS_REQUIRED");
    }
    const { teacherId } = await requireClassManagement(request);
    const classroom = await ownedClass(teacherId, requestedClassId);
    const active = classroom.status === "active";
    return {
      actor: { type: "teacher", id: teacherId, name: "교사" },
      classroom: {
        id: String(classroom.id),
        displayName: displayName({
          display_name: classroom.display_name as string | null,
          grade: Number(classroom.grade),
          class_number: Number(classroom.class_number),
        }),
        schoolName: String(classroom.school_name),
        schoolYear: Number(classroom.school_year),
        grade: Number(classroom.grade),
        classNumber: Number(classroom.class_number),
        status: active ? "active" : "archived",
      },
      role: "teacher",
      allowedWriteTypes: [...LIFE_CHECK_TYPES],
      permissionSources: {},
      permissions: {
        canViewClass: true,
        canRecord: active,
        canManagePayouts: active,
        canOverride: active,
      },
      activeJob: null,
    };
  }

  const { studentId } = await requireStudent(request);
  const student = await database().prepare(
    `SELECT student.id, student.official_name, student.class_id,
            classroom.school_name, classroom.school_year, classroom.grade,
            classroom.class_number, classroom.display_name
     FROM students student
     JOIN classes classroom ON classroom.id = student.class_id
     WHERE student.id = ? AND student.status = 'active' AND classroom.status = 'active'`,
  ).bind(studentId).first<{
    id: string;
    official_name: string;
    class_id: string;
    school_name: string;
    school_year: number;
    grade: number;
    class_number: number;
    display_name: string | null;
  }>();
  if (!student) throw new ApiError(403, "사용할 수 없는 학생 계정입니다.", "ACCOUNT_DISABLED");
  if (requestedClassId && requestedClassId !== student.class_id) {
    throw new ApiError(403, "다른 학급의 생활확인 기록은 볼 수 없어요.", "LIFE_CHECK_CLASS_ACCESS_DENIED");
  }
  const [activeJob, manualPermissions] = await Promise.all([
    currentStudentJob(student.class_id, studentId),
    activeManualPermissionKeys(student.class_id, studentId),
  ]);
  const automaticTypes = allowedTypeForJob(activeJob?.templateId);
  const manualKeyForType: Record<LifeCheckType, "life_check_tooth" | "life_check_milk" | "life_check_lunch"> = {
    tooth: "life_check_tooth",
    milk: "life_check_milk",
    lunch: "life_check_lunch",
  };
  const allowedWriteTypes = LIFE_CHECK_TYPES.filter((type) => (
    automaticTypes.includes(type) || manualPermissions.has(manualKeyForType[type])
  ));
  const permissionSources = Object.fromEntries(allowedWriteTypes.map((type) => [
    type,
    permissionSource({
      automatic: automaticTypes.includes(type),
      manual: manualPermissions.has(manualKeyForType[type]),
    }),
  ])) as Partial<Record<LifeCheckType, StudentPermissionSource>>;
  const role: LifeCheckRole = allowedWriteTypes.length ? "checker" : "student";
  return {
    actor: { type: "student", id: student.id, name: student.official_name },
    classroom: {
      id: student.class_id,
      displayName: displayName(student),
      schoolName: student.school_name,
      schoolYear: Number(student.school_year),
      grade: Number(student.grade),
      classNumber: Number(student.class_number),
      status: "active",
    },
    role,
    allowedWriteTypes,
    permissionSources,
    permissions: {
      canViewClass: role === "checker",
      canRecord: role === "checker",
      canManagePayouts: role === "checker",
      canOverride: false,
    },
    activeJob,
  };
}

export function requireLifeCheckWrite(context: LifeCheckContext, type: LifeCheckType) {
  if (!context.permissions.canRecord || !context.allowedWriteTypes.includes(type)) {
    throw new ApiError(403, "이 확인 항목을 기록할 권한이 없어요.", "LIFE_CHECK_WRITE_FORBIDDEN");
  }
  if (context.classroom.status !== "active") {
    throw new ApiError(409, "보관된 학급에서는 기록을 변경할 수 없어요.", "CLASS_ARCHIVED");
  }
}

export function lifeCheckActorColumns(context: LifeCheckContext) {
  if (context.actor.type === "teacher") {
    return {
      actorType: "teacher" as const,
      teacherId: context.actor.id,
      studentId: null,
    };
  }
  return {
    actorType: "checker" as const,
    teacherId: null,
    studentId: context.actor.id,
  };
}
