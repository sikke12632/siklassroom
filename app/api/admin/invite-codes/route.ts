import { database, ensureSchema } from "@/lib/database";
import { cleanDisplayText } from "@/lib/identity";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";
import { auditSystemAdmin } from "@/lib/system-admin-audit";
import { requireSystemAdmin } from "@/lib/system-admin-auth";
import { createInviteCode } from "@/lib/teacher-verification";

export async function GET(request: Request) {
  try {
    await requireSystemAdmin(request);
    await ensureSchema();
    const now = Date.now();
    await database().prepare(
      `UPDATE teacher_invite_codes SET status = 'expired'
       WHERE status = 'active' AND expires_at <= ?`,
    ).bind(now).run();
    const result = await database().prepare(
      `SELECT c.id, c.status, c.issued_by, c.expires_at, c.used_at, c.used_by_teacher_id,
              c.revoked_at, c.created_at, c.memo, t.email AS used_by_email
       FROM teacher_invite_codes c
       LEFT JOIN teachers t ON t.id = c.used_by_teacher_id
       ORDER BY c.created_at DESC LIMIT 100`,
    ).all();
    return json({ codes: result.results });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireSystemAdmin(request, { csrf: true });
    await ensureSchema();
    const body = await readJson<{ expiresAt?: number; memo?: string }>(request);
    const memo = cleanDisplayText(body.memo, 120) || null;
    const code = await createInviteCode({ expiresAt: Number(body.expiresAt), issuedBy: admin.adminKey, memo });
    await auditSystemAdmin({
      adminKey: admin.adminKey,
      action: "invite_code_created",
      targetType: "teacher_invite_code",
      after: { expiresAt: Number(body.expiresAt), memo },
    });
    return json({ code }, 201);
  } catch (error) {
    return apiFailure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await requireSystemAdmin(request, { csrf: true });
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
    await auditSystemAdmin({
      adminKey: admin.adminKey,
      action: "invite_code_revoked",
      targetType: "teacher_invite_code",
      targetId: id,
      before: { status: "active" },
      after: { status: "revoked" },
    });
    return json({ ok: true });
  } catch (error) {
    return apiFailure(error);
  }
}
