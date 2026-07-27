import { createSession, revokeActorSessions } from "@/lib/auth";
import { audit, database } from "@/lib/database";
import { hashPassword } from "@/lib/crypto";
import { assertUsableRegistration, registrationRecord } from "@/lib/registration";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ token?: string; password?: string }>(request);
    const token = String(body.token ?? "");
    const password = String(body.password ?? "");
    if (!/^\d{4,12}$/.test(password)) throw new ApiError(400, "비밀번호는 기억하기 쉬운 숫자 4~12자리로 정해 주세요.", "INVALID_STUDENT_PASSWORD");
    const record = await registrationRecord(token);
    assertUsableRegistration(record);
    const now = Date.now();
    const studentId = String(record!.student_id);
    const claimed = await database().prepare(
      `UPDATE registration_tokens SET used_at = ?
       WHERE id = ? AND revoked_at IS NULL AND expires_at > ?`,
    ).bind(now, record!.token_id, now).run();
    if (claimed.meta.changes !== 1) {
      throw new ApiError(410, "이 QR은 만료되었거나 새 QR로 바뀌었어요. 선생님께 현재 QR을 확인해 주세요.", "QR_NOT_USABLE");
    }
    await database().prepare(
      `UPDATE students SET password_hash = ?, status = 'active', activated_at = COALESCE(activated_at, ?), updated_at = ?
       WHERE id = ? AND qr_generation = ?`,
    ).bind(await hashPassword(password), now, now, studentId, record!.generation).run();
    await revokeActorSessions("student", studentId);
    await audit({
      action: record!.status === "active" || record!.status === "reset_required"
        ? "student_password_reset_completed"
        : "student_activated",
      classId: String(record!.class_id),
      studentId,
    });
    const session = await createSession({ actorType: "student", studentId }, request);
    return json({ ok: true }, 200, { "Set-Cookie": session.cookie });
  } catch (error) {
    return apiFailure(error);
  }
}
