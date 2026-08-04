import { requireClassManagement } from "@/lib/auth";
import { ownedStudent } from "@/lib/authorization";
import { audit, database } from "@/lib/database";
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
    const current = await ownedStudent(teacherId, studentId);
    const body = await readJson<{ number?: number; name?: string; status?: string }>(request);
    const numberProvided = body.number !== undefined;
    const nameProvided = body.name !== undefined;
    const statusProvided = body.status !== undefined;
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
      bindings.push(Date.now());
      const statements: D1PreparedStatement[] = [
        database().prepare(
          `UPDATE students SET ${assignments.join(", ")} WHERE id = ?`,
        ).bind(...bindings, studentId),
      ];
      if (statusProvided && status !== "active") {
        statements.push(database().prepare(
          `DELETE FROM sessions WHERE student_id = ?`,
        ).bind(studentId));
      }
      await database().batch(statements);
    } catch (error) {
      mapFinanceDepositLifecycleError(error);
    }
    await audit({
      action: "student_updated",
      teacherId,
      classId: String(current.class_id),
      studentId,
      detail: {
        ...(numberProvided ? { studentNumber } : {}),
        ...(nameProvided ? { officialName } : {}),
        ...(statusProvided ? { status } : {}),
      },
    });
    return json({ ok: true });
  } catch (error) {
    return apiFailure(error);
  }
}
