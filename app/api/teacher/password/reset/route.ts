import { clearSessionCookie, revokeActorSessions } from "@/lib/auth";
import { audit, database, ensureSchema } from "@/lib/database";
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
    const claimed = await database().prepare(
      `UPDATE teacher_password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?`,
    ).bind(now, row.id, now).run();
    if (claimed.meta.changes !== 1) {
      throw new ApiError(410, "이 링크는 이미 사용되었어요. 다시 요청해 주세요.", "RESET_LINK_EXPIRED");
    }
    await database().prepare(`UPDATE teachers SET password_hash = ?, updated_at = ? WHERE id = ?`)
      .bind(await hashPassword(password), now, row.teacher_id).run();
    await revokeActorSessions("teacher", row.teacher_id);
    await audit({ action: "teacher_password_reset_completed", teacherId: row.teacher_id });
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(request) });
  } catch (error) {
    return apiFailure(error);
  }
}
