import { getSession, requireClassManagement, requireStudent } from "./auth";
import { ownedClass } from "./authorization";
import { database, ensureSchema } from "./database";
import {
  BANKER_JOB_TEMPLATE_ID,
  type FinancePermissions,
  type FinanceRole,
  permissionsForFinanceRole,
  resolveFinanceRole,
  selectEffectiveFinancePeriod,
} from "./finance-access-rules";
import { ApiError } from "./responses";
import { seoulServerTime } from "./seoul-time";

export type FinanceContext = {
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
  financeRole: FinanceRole;
  permissions: FinancePermissions;
  activeJob: null | {
    id: string;
    name: string;
    templateId: string | null;
    assignmentYear: number;
    assignmentMonth: number;
    periodId: string;
  };
  phase: "foundation";
};

type StudentContextRow = {
  id: string;
  official_name: string;
  class_id: string;
  school_name: string;
  school_year: number;
  grade: number;
  class_number: number;
  display_name: string | null;
  status: string;
};

type PeriodRow = {
  id: string;
  class_id: string;
  status: string;
  assignment_type: string;
  assignment_year: number;
  assignment_month: number;
  confirmed_at: number | null;
  updated_at: number;
};

type AssignmentRow = {
  id: string;
  name: string;
  template_id: string | null;
};

function classroomDisplayName(input: {
  displayName: unknown;
  grade: unknown;
  classNumber: unknown;
}) {
  const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
  return displayName || `${Number(input.grade)}학년 ${Number(input.classNumber)}반`;
}

function serializeClassroom(row: Record<string, string | number | null>) {
  return {
    id: String(row.id),
    displayName: classroomDisplayName({
      displayName: row.display_name,
      grade: row.grade,
      classNumber: row.class_number,
    }),
    schoolName: String(row.school_name),
    schoolYear: Number(row.school_year),
    grade: Number(row.grade),
    classNumber: Number(row.class_number),
    status: row.status === "active" ? "active" as const : "archived" as const,
  };
}

async function effectivePeriod(classId: string, epochMs = Date.now()) {
  const current = seoulServerTime(epochMs);
  const rows = await database().prepare(
    `SELECT id, class_id, status, assignment_type, assignment_year,
            assignment_month, confirmed_at, updated_at
     FROM class_job_assignment_periods
     WHERE class_id = ?
       AND status = 'confirmed'
       AND assignment_type IN ('initial', 'monthly')
       AND (
         assignment_year < ?
         OR (assignment_year = ? AND assignment_month <= ?)
       )`,
  ).bind(classId, current.year, current.year, current.month).all<PeriodRow>();

  return selectEffectiveFinancePeriod(
    rows.results.map((row) => ({
      id: row.id,
      classId: row.class_id,
      status: row.status,
      assignmentType: row.assignment_type,
      assignmentYear: Number(row.assignment_year),
      assignmentMonth: Number(row.assignment_month),
      confirmedAt: row.confirmed_at === null ? null : Number(row.confirmed_at),
      updatedAt: Number(row.updated_at),
    })),
    { classId, year: current.year, month: current.month },
  );
}

async function currentStudentJob(classId: string, studentId: string) {
  const period = await effectivePeriod(classId);
  if (!period) return null;

  const job = await database().prepare(
    `SELECT j.id, j.name, j.template_id
     FROM student_job_assignments assignment
     JOIN class_jobs j
       ON j.id = assignment.class_job_id
      AND j.class_id = assignment.class_id
     JOIN students student
       ON student.id = assignment.student_id
      AND student.class_id = assignment.class_id
     WHERE assignment.period_id = ?
       AND assignment.class_id = ?
       AND assignment.student_id = ?
       AND student.status = 'active'
       AND j.is_active = 1
     LIMIT 1`,
  ).bind(period.id, classId, studentId).first<AssignmentRow>();
  if (!job) return null;

  return {
    id: job.id,
    name: job.name,
    templateId: job.template_id,
    assignmentYear: period.assignmentYear,
    assignmentMonth: period.assignmentMonth,
    periodId: period.id,
  };
}

export async function teacherFinanceContext(
  request: Request,
  classId: string,
): Promise<FinanceContext> {
  const { teacherId } = await requireClassManagement(request);
  const classroom = await ownedClass(teacherId, classId);
  const financeRole = resolveFinanceRole("teacher", false);
  const classIsActive = classroom.status === "active";
  return {
    actor: {
      type: "teacher",
      id: teacherId,
      name: "교사",
    },
    classroom: serializeClassroom(classroom),
    financeRole,
    permissions: permissionsForFinanceRole(financeRole, classIsActive),
    activeJob: null,
    phase: "foundation",
  };
}

export async function studentFinanceContext(
  request: Request,
  requestedClassId?: string | null,
): Promise<FinanceContext> {
  const { studentId } = await requireStudent(request);
  const student = await database().prepare(
    `SELECT student.id, student.official_name, student.class_id,
            classroom.school_name, classroom.school_year, classroom.grade,
            classroom.class_number, classroom.display_name, classroom.status
     FROM students student
     JOIN classes classroom ON classroom.id = student.class_id
     WHERE student.id = ? AND student.status = 'active'
       AND classroom.status = 'active'`,
  ).bind(studentId).first<StudentContextRow>();
  if (!student) {
    throw new ApiError(403, "사용할 수 없는 학생 계정입니다.", "ACCOUNT_DISABLED");
  }
  if (requestedClassId && requestedClassId !== student.class_id) {
    throw new ApiError(
      403,
      "다른 학급의 금융센터에는 들어갈 수 없어요.",
      "FINANCE_CLASS_ACCESS_DENIED",
    );
  }

  const activeJob = await currentStudentJob(student.class_id, studentId);
  const financeRole = resolveFinanceRole(
    "student",
    activeJob?.templateId === BANKER_JOB_TEMPLATE_ID,
  );
  return {
    actor: {
      type: "student",
      id: student.id,
      name: student.official_name,
    },
    classroom: {
      id: student.class_id,
      displayName: classroomDisplayName({
        displayName: student.display_name,
        grade: student.grade,
        classNumber: student.class_number,
      }),
      schoolName: student.school_name,
      schoolYear: Number(student.school_year),
      grade: Number(student.grade),
      classNumber: Number(student.class_number),
      status: "active",
    },
    financeRole,
    permissions: permissionsForFinanceRole(financeRole),
    activeJob,
    phase: "foundation",
  };
}

export async function financeContextForRequest(request: Request): Promise<FinanceContext> {
  await ensureSchema();
  const classId = new URL(request.url).searchParams.get("classId")?.trim() || null;
  const session = await getSession(request);
  if (!session) {
    throw new ApiError(401, "로그인이 필요합니다.", "LOGIN_REQUIRED");
  }
  if (session.actorType === "teacher") {
    if (!classId) {
      throw new ApiError(
        400,
        "금융센터를 열 학급을 선택해 주세요.",
        "FINANCE_CLASS_REQUIRED",
      );
    }
    return teacherFinanceContext(request, classId);
  }
  return studentFinanceContext(request, classId);
}
