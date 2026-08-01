import { clearSessionCookie } from "@/lib/auth";
import { database, ensureSchema, isOperationGuardFailure } from "@/lib/database";
import { hashPassword, sha256 } from "@/lib/crypto";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ token?: string; password?: string }>(request);
    const token = String(body.token ?? "");
    const password = String(body.password ?? "");
    if (password.length < 8 || password.length > 72) throw new ApiError(400, "비밀번호는 8~72자로 만들어 주세요.", "WEAK_PASSWORD");
    await ensureSchema();
    const row = await database().prepare(
      `SELECT id, teacher_id, expires_at, used_at FROM teacher_password_resets WHERE token_hash = ?`,
    ).bind(await sha256(token)).first<{ id: string; teacher_id: string; expires_at: number; used_at: number | null }>();
    if (!row || row.used_at || row.expires_at <= Date.now()) throw new ApiError(410, "이 링크는 이미 사용했거나 시간이 지났어요. 다시 요청해 주세요.", "RESET_LINK_EXPIRED");
    const now = Date.now();
    const nextPasswordHash = await hashPassword(password);
    const guardId = crypto.randomUUID();
    try {
      await database().batch([
        database().prepare(
          `INSERT INTO registration_operation_guards (id, operation, created_at)
           SELECT CASE WHEN EXISTS (
             SELECT 1 FROM teacher_password_resets r
             JOIN teachers t ON t.id = r.teacher_id
             WHERE r.id = ? AND r.teacher_id = ? AND r.used_at IS NULL
               AND r.expires_at > ? AND t.status = 'active'
           ) THEN ? ELSE NULL END, 'teacher_password_reset', ?`,
        ).bind(row.id, row.teacher_id, now, guardId, now),
        database().prepare(
          `UPDATE teacher_password_resets SET used_at = ? WHERE id = ?`,
        ).bind(now, row.id),
        database().prepare(
          `UPDATE teachers
           SET password_hash = ?, credential_revision = credential_revision + 1, updated_at = ?
           WHERE id = ?`,
        ).bind(nextPasswordHash, now, row.teacher_id),
        database().prepare(`DELETE FROM sessions WHERE teacher_id = ?`).bind(row.teacher_id),
        database().prepare(
          `INSERT INTO audit_logs (id, teacher_id, action, detail, created_at)
           VALUES (?, ?, 'teacher_password_reset_completed', NULL, ?)`,
        ).bind(crypto.randomUUID(), row.teacher_id, now),
        database().prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
      ]);
    } catch (error) {
      if (isOperationGuardFailure(error)) {
        throw new ApiError(410, "이 링크는 이미 사용되었어요. 다시 요청해 주세요.", "RESET_LINK_EXPIRED");
      }
      throw error;
    }
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(request) });
  } catch (error) {
    return apiFailure(error);
  }
}
