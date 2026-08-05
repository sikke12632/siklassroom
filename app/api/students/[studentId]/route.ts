import { requireClassManagement } from "@/lib/auth";
import { ownedActiveStudent } from "@/lib/authorization";
import { database, isOperationGuardFailure } from "@/lib/database";
import { cleanDisplayText, integerInRange } from "@/lib/identity";
import {
  assertStudentCanBeExcluded,
  mapFinanceDepositLifecycleError,
} from "@/lib/finance-deposit-lifecycle";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";

export async function PATCH(request: Request, context: { params: Promise<{ studentId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { studentId } = await context.params;
    const current = await ownedActiveStudent(teacherId, studentId);
    const body = await readJson<{ number?: number; name?: string; status?: string }>(request);
    const numberProvided = body.number !== undefined;
    const nameProvided = body.name !== undefined;
    const statusProvided = body.status !== undefined;
    if (!numberProvided && !nameProvided && !statusProvided) {
      throw new ApiError(400, "변경할 학생 정보를 입력해 주세요.", "STUDENT_UPDATE_REQUIRED");
    }
    const studentNumber = integerInRange(
      numberProvided ? body.number : current.student_number,
      1,
      99,
    );
    const officialName = cleanDisplayText(
      nameProvided ? body.name : current.official_name,
      30,
    );
    const allowedStatuses = new Set(["pending", "active", "locked", "excluded"]);
    if (statusProvided && !allowedStatuses.has(body.status as string)) {
      throw new ApiError(400, "학생 상태를 다시 확인해 주세요.", "INVALID_STUDENT_STATUS");
    }
    const status = statusProvided ? String(body.status) : String(current.status);
    if (!studentNumber || !officialName) throw new ApiError(400, "번호와 이름을 다시 확인해 주세요.", "INVALID_STUDENT_INFO");
    if (numberProvided) {
      const conflict = await database().prepare(
        `SELECT id FROM students WHERE class_id = ? AND student_number = ? AND id != ?`,
      ).bind(current.class_id, studentNumber, studentId).first();
      if (conflict) {
        throw new ApiError(
          409,
          `${studentNumber}번 학생이 이미 있어요.`,
          "STUDENT_NUMBER_EXISTS",
        );
      }
    }
    if (status === "excluded" && current.status !== "excluded") {
      await assertStudentCanBeExcluded(String(current.class_id), studentId);
    }
    const now = Date.now();
    const guardId = crypto.randomUUID();
    const auditDetail = {
      ...(numberProvided ? { studentNumber } : {}),
      ...(nameProvided ? { officialName } : {}),
      ...(statusProvided ? { status } : {}),
    };
    try {
      const assignments: string[] = [];
      const bindings: Array<string | number> = [];
      if (numberProvided) {
        assignments.push("student_number = ?");
        bindings.push(studentNumber);
      }
      if (nameProvided) {
        assignments.push("official_name = ?");
        bindings.push(officialName);
      }
      if (statusProvided) {
        assignments.push("status = ?");
        bindings.push(status);
      }
      assignments.push("updated_at = ?");
      bindings.push(now);
      const statements: D1PreparedStatement[] = [
        database().prepare(
          `INSERT INTO registration_operation_guards (id, operation, created_at)
           SELECT CASE WHEN EXISTS (
             SELECT 1 FROM students student
             JOIN classes classroom ON classroom.id = student.class_id
             WHERE student.id = ? AND student.class_id = ?
               AND student.student_number = ? AND student.official_name = ?
               AND student.status = ? AND student.qr_generation = ?
               AND student.updated_at = ? AND classroom.status = 'active'
               AND NOT EXISTS (
                 SELECT 1 FROM students conflict
                 WHERE conflict.class_id = student.class_id
                   AND conflict.student_number = ? AND conflict.id != student.id
               )
           ) THEN ? ELSE NULL END, 'student_update', ?`,
        ).bind(
          studentId,
          current.class_id,
          current.student_number,
          current.official_name,
          current.status,
          current.qr_generation,
          current.updated_at,
          studentNumber,
          guardId,
          now,
        ),
        database().prepare(
          `UPDATE students SET ${assignments.join(", ")}
           WHERE id = ? AND class_id = ? AND student_number = ?
             AND official_name = ? AND status = ? AND qr_generation = ? AND updated_at = ?`,
        ).bind(
          ...bindings,
          studentId,
          current.class_id,
          current.student_number,
          current.official_name,
          current.status,
          current.qr_generation,
          current.updated_at,
        ),
      ];
      if (statusProvided && status !== "active") {
        statements.push(database().prepare(
          `DELETE FROM sessions WHERE student_id = ?`,
        ).bind(studentId));
      }
      statements.push(database().prepare(
        `INSERT INTO audit_logs (
           id, teacher_id, class_id, student_id, action, detail, created_at
         ) VALUES (?, ?, ?, ?, 'student_updated', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        teacherId,
        String(current.class_id),
        studentId,
        JSON.stringify(auditDetail),
        now,
      ));
      statements.push(database().prepare(
        `DELETE FROM registration_operation_guards WHERE id = ?`,
      ).bind(guardId));
      await database().batch(statements);
    } catch (error) {
      if (isOperationGuardFailure(error)) {
        throw new ApiError(409, "다른 화면에서 학생 정보가 먼저 바뀌었습니다. 새로고침 후 다시 시도해 주세요.", "STUDENT_STALE");
      }
      mapFinanceDepositLifecycleError(error);
    }
    return json({ ok: true });
  } catch (error) {
    return apiFailure(error);
  }
}
