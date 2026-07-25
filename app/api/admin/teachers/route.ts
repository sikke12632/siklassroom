import { revokeActorSessions } from "@/lib/auth";
import { database } from "@/lib/database";
import { cleanDisplayText } from "@/lib/identity";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";
import { auditSystemAdmin } from "@/lib/system-admin-audit";
import { requireSystemAdmin } from "@/lib/system-admin-auth";

const allowedStatuses = new Set(["all", "pending", "invite_verified", "revoked"]);

export async function GET(request: Request) {
  try {
    await requireSystemAdmin(request);
    const url = new URL(request.url);
    const query = String(url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 100);
    const status = String(url.searchParams.get("status") ?? "all");
    if (!allowedStatuses.has(status)) throw new ApiError(400, "상태 필터를 확인해 주세요.", "INVALID_STATUS");
    const result = await database().prepare(
      `SELECT t.id, t.email, t.status, t.email_verified_at, t.teacher_access_status,
              t.teacher_access_verified_at, t.teacher_access_note, t.teacher_access_updated_at,
              t.created_at, COALESCE(s.official_name, r.entered_name) AS school_name,
              CASE WHEN EXISTS (
                SELECT 1 FROM teacher_invite_codes c WHERE c.used_by_teacher_id = t.id
              ) THEN 1 ELSE 0 END AS joined_with_invite
       FROM teachers t
       LEFT JOIN schools s ON s.id = t.school_id
       LEFT JOIN school_manual_requests r ON r.id = t.manual_school_request_id
       WHERE (? = '' OR lower(t.email) LIKE '%' || ? || '%')
         AND (? = 'all' OR t.teacher_access_status = ?)
       ORDER BY t.created_at DESC LIMIT 200`,
    ).bind(query, query, status, status).all();
    return json({ teachers: result.results });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireSystemAdmin(request, { csrf: true });
    const body = await readJson<{ id?: string; action?: string; note?: string }>(request);
    const id = String(body.id ?? "");
    const action = String(body.action ?? "");
    const note = cleanDisplayText(body.note, 240) || null;
    if (!id || !["approve", "revoke", "reapprove"].includes(action)) {
      throw new ApiError(400, "교사와 처리 내용을 확인해 주세요.", "INVALID_TEACHER_ACTION");
    }
    const before = await database().prepare(
      `SELECT id, status, teacher_access_status, teacher_access_note FROM teachers WHERE id = ?`,
    ).bind(id).first<{ id: string; status: string; teacher_access_status: string; teacher_access_note: string | null }>();
    if (!before) throw new ApiError(404, "교사 계정을 찾을 수 없습니다.", "TEACHER_NOT_FOUND");
    const nextStatus = action === "revoke" ? "revoked" : "invite_verified";
    const now = Date.now();
    await database().prepare(
      `UPDATE teachers
       SET teacher_access_status = ?, teacher_access_verified_at = ?, teacher_access_note = ?,
           teacher_access_updated_at = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(nextStatus, nextStatus === "invite_verified" ? now : null, note, now, now, id).run();
    if (action === "revoke") await revokeActorSessions("teacher", id);
    await auditSystemAdmin({
      adminKey: admin.adminKey,
      action: action === "revoke" ? "teacher_access_revoked" : action === "reapprove" ? "teacher_access_reapproved" : "teacher_access_approved",
      targetType: "teacher",
      targetId: id,
      before: { accessStatus: before.teacher_access_status, note: before.teacher_access_note },
      after: { accessStatus: nextStatus, note },
    });
    return json({ ok: true, teacher: { id, teacher_access_status: nextStatus, teacher_access_note: note } });
  } catch (error) {
    return apiFailure(error);
  }
}
