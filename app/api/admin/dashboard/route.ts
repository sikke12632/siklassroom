import { database } from "@/lib/database";
import { apiFailure, json } from "@/lib/responses";
import { requireSystemAdmin } from "@/lib/system-admin-auth";

export async function GET(request: Request) {
  try {
    await requireSystemAdmin(request);
    const now = Date.now();
    const rows = await database().batch([
      database().prepare(`SELECT COUNT(*) AS count FROM teachers WHERE teacher_access_status = 'pending'`),
      database().prepare(`SELECT COUNT(*) AS count FROM teachers WHERE teacher_access_status = 'invite_verified' AND status = 'active'`),
      database().prepare(`SELECT COUNT(*) AS count FROM teachers WHERE teacher_access_status = 'revoked' OR status <> 'active'`),
      database().prepare(`SELECT COUNT(*) AS count FROM school_manual_requests WHERE status = 'pending'`),
      database().prepare(`SELECT COUNT(*) AS count FROM teacher_invite_codes WHERE status = 'active' AND expires_at > ?`).bind(now),
      database().prepare(`SELECT COUNT(*) AS count FROM service_announcements WHERE is_active = 1`),
    ]);
    return json({
      summary: {
        pendingTeachers: Number(rows[0].results?.[0]?.count ?? 0),
        activeTeachers: Number(rows[1].results?.[0]?.count ?? 0),
        revokedTeachers: Number(rows[2].results?.[0]?.count ?? 0),
        pendingSchools: Number(rows[3].results?.[0]?.count ?? 0),
        activeInviteCodes: Number(rows[4].results?.[0]?.count ?? 0),
        activeAnnouncements: Number(rows[5].results?.[0]?.count ?? 0),
      },
    });
  } catch (error) {
    return apiFailure(error);
  }
}
