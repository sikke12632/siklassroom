import { audit, database, ensureSchema } from "@/lib/database";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";
import { createInviteCode, requireAdmin } from "@/lib/teacher-verification";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    await ensureSchema();
    const now = Date.now();
    await database().prepare(
      `UPDATE teacher_invite_codes SET status = 'expired'
       WHERE status = 'active' AND expires_at <= ?`,
    ).bind(now).run();
    const result = await database().prepare(
      `SELECT id, status, issued_by, expires_at, used_at, used_by_teacher_id, revoked_at, created_at
       FROM teacher_invite_codes ORDER BY created_at DESC LIMIT 100`,
    ).all();
    return json({ codes: result.results });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    await ensureSchema();
    const body = await readJson<{ expiresAt?: number }>(request);
    const code = await createInviteCode({ expiresAt: Number(body.expiresAt) });
    await audit({ action: "teacher_invite_code_created" });
    return json({ code }, 201);
  } catch (error) {
    return apiFailure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin(request);
    await ensureSchema();
    const body = await readJson<{ id?: string }>(request);
    const id = String(body.id ?? "");
    if (!id) throw new ApiError(400, "폐기할 코드를 선택해 주세요.", "INVITE_CODE_REQUIRED");
    const now = Date.now();
    const result = await database().prepare(
      `UPDATE teacher_invite_codes
       SET status = 'revoked', revoked_at = ?
       WHERE id = ? AND status = 'active' AND used_at IS NULL`,
    ).bind(now, id).run();
    if (!result.meta.changes) throw new ApiError(409, "이미 사용되었거나 폐기된 코드입니다.", "INVITE_CODE_NOT_ACTIVE");
    await audit({ action: "teacher_invite_code_revoked", detail: { inviteCodeId: id } });
    return json({ ok: true });
  } catch (error) {
    return apiFailure(error);
  }
}
