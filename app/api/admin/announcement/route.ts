import { database, isOperationGuardFailure } from "@/lib/database";
import { cleanDisplayText } from "@/lib/identity";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";
import { systemAdminAuditStatement } from "@/lib/system-admin-audit";
import { requireSystemAdmin } from "@/lib/system-admin-auth";

export async function GET(request: Request) {
  try {
    await requireSystemAdmin(request);
    const announcement = await database().prepare(
      `SELECT id, title, body, audience, is_active, created_at, updated_at
       FROM service_announcements WHERE id = 'global'`,
    ).first();
    return json({ announcement: announcement ?? null });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireSystemAdmin(request, { csrf: true });
    const body = await readJson<{ title?: string; body?: string; audience?: string; isActive?: boolean }>(request);
    const title = cleanDisplayText(body.title, 80);
    const text = cleanDisplayText(body.body, 500);
    const audience = String(body.audience ?? "");
    if (!title || !text || !["all", "teacher", "student"].includes(audience) || typeof body.isActive !== "boolean") {
      throw new ApiError(400, "공지 제목, 내용, 대상을 확인해 주세요.", "INVALID_ANNOUNCEMENT");
    }
    const before = await database().prepare(
      `SELECT title, body, audience, is_active, updated_at
       FROM service_announcements WHERE id = 'global'`,
    ).first<{
      title: string;
      body: string;
      audience: string;
      is_active: number;
      updated_at: number;
    }>();
    const now = Date.now();
    const after = { title, body: text, audience, is_active: body.isActive ? 1 : 0 };
    const guardId = crypto.randomUUID();
    const hadAnnouncement = before ? 1 : 0;
    try {
      await database().batch([
        database().prepare(
          `INSERT INTO registration_operation_guards (id, operation, created_at)
           SELECT CASE WHEN (
             (? = 1 AND EXISTS (
               SELECT 1 FROM service_announcements
               WHERE id = 'global' AND title = ? AND body = ? AND audience = ?
                 AND is_active = ? AND updated_at = ?
             )) OR (? = 0 AND NOT EXISTS (
               SELECT 1 FROM service_announcements WHERE id = 'global'
             ))
           ) THEN ? ELSE NULL END, 'admin_announcement_update', ?`,
        ).bind(
          hadAnnouncement,
          before?.title ?? "",
          before?.body ?? "",
          before?.audience ?? "",
          before?.is_active ?? 0,
          before?.updated_at ?? 0,
          hadAnnouncement,
          guardId,
          now,
        ),
        database().prepare(
          `INSERT INTO service_announcements
           (id, title, body, audience, is_active, created_at, updated_at)
           VALUES ('global', ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body,
             audience = excluded.audience, is_active = excluded.is_active, updated_at = excluded.updated_at`,
        ).bind(title, text, audience, body.isActive ? 1 : 0, now, now),
        systemAdminAuditStatement({
          adminKey: admin.adminKey,
          action: "announcement_changed",
          targetType: "service_announcement",
          targetId: "global",
          before,
          after,
        }, now),
        database().prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
      ]);
    } catch (error) {
      if (isOperationGuardFailure(error)) {
        throw new ApiError(409, "다른 관리자 화면에서 공지가 먼저 바뀌었습니다.", "ANNOUNCEMENT_STALE");
      }
      throw error;
    }
    return json({ ok: true, announcement: { id: "global", ...after, updated_at: now } });
  } catch (error) {
    return apiFailure(error);
  }
}
