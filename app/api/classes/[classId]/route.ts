import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { database, isOperationGuardFailure } from "@/lib/database";
import { cleanDisplayText, integerInRange } from "@/lib/identity";
import {
  assertClassCanBeArchived,
  mapFinanceDepositLifecycleError,
} from "@/lib/finance-deposit-lifecycle";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";

export async function GET(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    const classRoom = await ownedClass(teacherId, classId);
    return json({ class: classRoom });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    const current = await ownedClass(teacherId, classId);
    const body = await readJson<{ schoolYear?: number; grade?: number; classNumber?: number; displayName?: string; status?: string }>(request);
    const hasChanges = body.schoolYear !== undefined
      || body.grade !== undefined
      || body.classNumber !== undefined
      || body.displayName !== undefined
      || body.status !== undefined;
    if (!hasChanges) {
      throw new ApiError(400, "변경할 학급 정보를 입력해 주세요.", "CLASS_UPDATE_REQUIRED");
    }
    const schoolName = String(current.school_name);
    const schoolNormalized = String(current.school_normalized);
    const schoolYear = integerInRange(body.schoolYear ?? current.school_year, 2020, 2100);
    const grade = integerInRange(body.grade ?? current.grade, 1, 6);
    const classNumber = integerInRange(body.classNumber ?? current.class_number, 1, 30);
    const displayName = cleanDisplayText(body.displayName ?? current.display_name, 40) || null;
    if (body.status !== undefined && body.status !== "active" && body.status !== "archived") {
      throw new ApiError(400, "학급 상태를 다시 확인해 주세요.", "INVALID_CLASS_STATUS");
    }
    const status = body.status ?? String(current.status);
    if (current.status !== "active" && status !== "active") {
      throw new ApiError(409, "보관된 학급은 먼저 다시 활성화해 주세요.", "CLASS_ARCHIVED");
    }
    if (!schoolName || !schoolYear || !grade || !classNumber) throw new ApiError(400, "학급 정보를 다시 확인해 주세요.", "INVALID_CLASS_INFO");
    const duplicate = await database().prepare(
      `SELECT id FROM classes WHERE school_normalized = ? AND school_year = ? AND grade = ? AND class_number = ? AND id != ?`,
    ).bind(schoolNormalized, schoolYear, grade, classNumber, classId).first();
    if (duplicate) throw new ApiError(409, "같은 학교의 같은 학년도·학년·반이 이미 있어요.", "CLASS_EXISTS");
    if (status === "archived" && current.status !== "archived") {
      await assertClassCanBeArchived(classId);
    }
    const now = Date.now();
    const guardId = crypto.randomUUID();
    const auditDetail = {
      schoolYear,
      grade,
      classNumber,
      displayName,
      ...(body.status === undefined ? {} : { status }),
    };
    try {
      const statements: D1PreparedStatement[] = [
        database().prepare(
          `INSERT INTO registration_operation_guards (id, operation, created_at)
           SELECT CASE WHEN EXISTS (
             SELECT 1 FROM classes current
             WHERE current.id = ? AND current.teacher_id = ?
               AND current.school_name = ? AND current.school_normalized = ?
               AND current.school_year = ? AND current.grade = ?
               AND current.class_number = ? AND current.display_name IS ?
               AND current.status = ? AND current.updated_at = ?
               AND NOT EXISTS (
                 SELECT 1 FROM classes conflict
                 WHERE conflict.school_normalized = ? AND conflict.school_year = ?
                   AND conflict.grade = ? AND conflict.class_number = ?
                   AND conflict.id != current.id
               )
           ) THEN ? ELSE NULL END, 'class_update', ?`,
        ).bind(
          classId,
          teacherId,
          current.school_name,
          current.school_normalized,
          current.school_year,
          current.grade,
          current.class_number,
          current.display_name,
          current.status,
          current.updated_at,
          schoolNormalized,
          schoolYear,
          grade,
          classNumber,
          guardId,
          now,
        ),
        database().prepare(
          `UPDATE classes
           SET school_name = ?, school_normalized = ?, school_year = ?,
               grade = ?, class_number = ?, display_name = ?, status = ?, updated_at = ?
           WHERE id = ? AND teacher_id = ? AND school_name = ? AND school_normalized = ?
             AND school_year = ? AND grade = ? AND class_number = ?
             AND display_name IS ? AND status = ? AND updated_at = ?`,
        ).bind(
          schoolName,
          schoolNormalized,
          schoolYear,
          grade,
          classNumber,
          displayName,
          status,
          now,
          classId,
          teacherId,
          current.school_name,
          current.school_normalized,
          current.school_year,
          current.grade,
          current.class_number,
          current.display_name,
          current.status,
          current.updated_at,
        ),
      ];
      if (
        body.status !== undefined
        && (status === "archived" || current.status !== status)
      ) {
        statements.push(database().prepare(
          `DELETE FROM sessions
           WHERE student_id IN (SELECT id FROM students WHERE class_id = ?)`,
        ).bind(classId));
      }
      statements.push(database().prepare(
        `INSERT INTO audit_logs (
           id, teacher_id, class_id, student_id, action, detail, created_at
         ) VALUES (?, ?, ?, NULL, 'class_updated', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        teacherId,
        classId,
        JSON.stringify(auditDetail),
        now,
      ));
      statements.push(database().prepare(
        `DELETE FROM registration_operation_guards WHERE id = ?`,
      ).bind(guardId));
      await database().batch(statements);
    } catch (error) {
      if (isOperationGuardFailure(error)) {
        throw new ApiError(409, "다른 화면에서 학급 정보가 먼저 바뀌었습니다. 새로고침 후 다시 시도해 주세요.", "CLASS_STALE");
      }
      mapFinanceDepositLifecycleError(error);
    }
    return json({ ok: true });
  } catch (error) {
    return apiFailure(error);
  }
}
