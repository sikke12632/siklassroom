import { requireClassManagement, revokeActorSessions } from "@/lib/auth";
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
    const studentNumber = integerInRange(body.number ?? current.student_number, 1, 99);
    const officialName = cleanDisplayText(body.name ?? current.official_name, 30);
    const allowedStatuses = new Set(["pending", "active", "reset_required", "locked", "excluded"]);
    const status = body.status && allowedStatuses.has(body.status) ? body.status : String(current.status);
    if (!studentNumber || !officialName) throw new ApiError(400, "번호와 이름을 다시 확인해 주세요.", "INVALID_STUDENT_INFO");
    const conflict = await database().prepare(
      `SELECT id FROM students WHERE class_id = ? AND student_number = ? AND id != ?`,
    ).bind(current.class_id, studentNumber, studentId).first();
    if (conflict) throw new ApiError(409, `${studentNumber}번 학생이 이미 있어요.`, "STUDENT_NUMBER_EXISTS");
    if (status === "excluded" && current.status !== "excluded") {
      await assertStudentCanBeExcluded(String(current.class_id), studentId);
    }
    try {
      await database().prepare(
        `UPDATE students SET student_number = ?, official_name = ?, status = ?, updated_at = ? WHERE id = ?`,
      ).bind(studentNumber, officialName, status, Date.now(), studentId).run();
    } catch (error) {
      mapFinanceDepositLifecycleError(error);
    }
    if (status === "locked" || status === "excluded") await revokeActorSessions("student", studentId);
    await audit({ action: "student_updated", teacherId, classId: String(current.class_id), studentId, detail: { studentNumber, status } });
    return json({ ok: true });
  } catch (error) {
    return apiFailure(error);
  }
}
