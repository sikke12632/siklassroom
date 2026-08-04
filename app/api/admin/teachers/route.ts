import { database, isOperationGuardFailure } from "@/lib/database";
import { cleanDisplayText } from "@/lib/identity";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";
import { systemAdminAuditStatement } from "@/lib/system-admin-audit";
import { requireSystemAdmin } from "@/lib/system-admin-auth";

const allowedStatuses = new Set(["all", "pending", "invite_verified", "revoked"]);

export async function GET(request: Request) {
  try {
    await requireSystemAdmin(request);
    const url = new URL(request.url);
    // D1/SQLite counts the two surrounding wildcards toward its 50-character
    // LIKE pattern limit. Truncate the search term instead of turning a long
    // teacher email into a server error.
    const query = String(url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 48);
    const status = String(url.searchParams.get("status") ?? "all");
    if (!allowedStatuses.has(status)) throw new ApiError(400, "상태 필터를 확인해 주세요.", "INVALID_STATUS");
    const result = await database().prepare(
      `SELECT t.id, t.email, t.status, t.email_verified_at, t.teacher_access_status,
              t.teacher_access_verified_at, t.teacher_access_note, t.teacher_access_updated_at,
              t.credential_revision, t.created_at, COALESCE(s.official_name, r.entered_name) AS school_name,
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
    const body = await readJson<{ id?: string; action?: string; note?: string; expectedRevision?: number }>(request);
    const id = String(body.id ?? "");
    const action = String(body.action ?? "");
    const note = cleanDisplayText(body.note, 240) || null;
    if (!id || !["approve", "revoke", "reapprove"].includes(action)) {
      throw new ApiError(400, "교사와 처리 내용을 확인해 주세요.", "INVALID_TEACHER_ACTION");
    }
    if (
      typeof body.expectedRevision !== "number"
      || !Number.isSafeInteger(body.expectedRevision)
      || body.expectedRevision < 0
    ) {
      throw new ApiError(400, "교사 권한 화면을 새로고침해 주세요.", "INVALID_TEACHER_REVISION");
    }
    const expectedRevision = body.expectedRevision;
    const before = await database().prepare(
      `SELECT id, status, teacher_access_status, teacher_access_note, credential_revision
       FROM teachers WHERE id = ?`,
    ).bind(id).first<{
      id: string;
      status: string;
      teacher_access_status: string;
      teacher_access_note: string | null;
      credential_revision: number;
    }>();
    if (!before) throw new ApiError(404, "교사 계정을 찾을 수 없습니다.", "TEACHER_NOT_FOUND");
    const currentRevision = Number(before.credential_revision);
    const actionMatchesState = action === "approve"
      ? before.teacher_access_status === "pending"
      : action === "reapprove"
        ? before.teacher_access_status === "revoked"
        : before.teacher_access_status !== "revoked";
    if (currentRevision !== expectedRevision || !actionMatchesState) {
      throw new ApiError(409, "다른 관리자 화면에서 교사 권한이 먼저 바뀌었습니다.", "TEACHER_ACCESS_STALE");
    }
    const nextStatus = action === "revoke" ? "revoked" : "invite_verified";
    const now = Date.now();
    const guardId = crypto.randomUUID();
    const auditAction = action === "revoke"
      ? "teacher_access_revoked"
      : action === "reapprove"
        ? "teacher_access_reapproved"
        : "teacher_access_approved";
    const statements: D1PreparedStatement[] = [
      database().prepare(
        `INSERT INTO registration_operation_guards (id, operation, created_at)
         SELECT CASE WHEN EXISTS (
           SELECT 1 FROM teachers
           WHERE id = ? AND status = ? AND teacher_access_status = ? AND credential_revision = ?
         ) THEN ? ELSE NULL END, 'admin_teacher_access', ?`,
      ).bind(
        id, before.status, before.teacher_access_status, expectedRevision,
        guardId, now,
      ),
      database().prepare(
        `UPDATE teachers
         SET teacher_access_status = ?, teacher_access_verified_at = ?, teacher_access_note = ?,
             teacher_access_updated_at = ?, credential_revision = credential_revision + 1,
             updated_at = ?
         WHERE id = ? AND status = ? AND teacher_access_status = ? AND credential_revision = ?`,
      ).bind(
        nextStatus, nextStatus === "invite_verified" ? now : null, note, now, now,
        id, before.status, before.teacher_access_status, expectedRevision,
      ),
      database().prepare(`DELETE FROM sessions WHERE teacher_id = ?`).bind(id),
      database().prepare(
        `UPDATE teacher_password_resets SET used_at = ?
         WHERE teacher_id = ? AND used_at IS NULL`,
      ).bind(now, id),
      database().prepare(
        `UPDATE teacher_email_verifications SET invalidated_at = ?
         WHERE teacher_id = ? AND used_at IS NULL AND invalidated_at IS NULL`,
      ).bind(now, id),
      systemAdminAuditStatement({
        adminKey: admin.adminKey,
        action: auditAction,
        targetType: "teacher",
        targetId: id,
        before: { accessStatus: before.teacher_access_status, note: before.teacher_access_note, credentialRevision: currentRevision },
        after: { accessStatus: nextStatus, note, credentialRevision: currentRevision + 1 },
      }, now),
      database().prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
    ];
    try {
      await database().batch(statements);
    } catch (error) {
      if (isOperationGuardFailure(error)) {
        throw new ApiError(409, "다른 관리자 화면에서 교사 권한이 먼저 바뀌었습니다.", "TEACHER_ACCESS_STALE");
      }
      throw error;
    }
    return json({
      ok: true,
      teacher: {
        id,
        teacher_access_status: nextStatus,
        teacher_access_note: note,
        credential_revision: currentRevision + 1,
      },
    });
  } catch (error) {
    return apiFailure(error);
  }
}
