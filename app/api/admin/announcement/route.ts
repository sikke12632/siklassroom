import { database } from "@/lib/database";
import { cleanDisplayText } from "@/lib/identity";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";
import { auditSystemAdmin } from "@/lib/system-admin-audit";
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
      `SELECT title, body, audience, is_active FROM service_announcements WHERE id = 'global'`,
    ).first();
    const now = Date.now();
    await database().prepare(
      `INSERT INTO service_announcements
       (id, title, body, audience, is_active, created_at, updated_at)
       VALUES ('global', ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body,
         audience = excluded.audience, is_active = excluded.is_active, updated_at = excluded.updated_at`,
    ).bind(title, text, audience, body.isActive ? 1 : 0, now, now).run();
    const after = { title, body: text, audience, is_active: body.isActive ? 1 : 0 };
    await auditSystemAdmin({
      adminKey: admin.adminKey,
      action: "announcement_changed",
      targetType: "service_announcement",
      targetId: "global",
      before,
      after,
    });
    return json({ ok: true, announcement: { id: "global", ...after, updated_at: now } });
  } catch (error) {
    return apiFailure(error);
  }
}
