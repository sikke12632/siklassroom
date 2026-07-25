import { apiFailure, json } from "@/lib/responses";
import { auditSystemAdmin } from "@/lib/system-admin-audit";
import {
  clearSystemAdminCookie,
  endSystemAdminSession,
  requireSystemAdmin,
  rotateAdminCsrf,
} from "@/lib/system-admin-auth";

export async function GET(request: Request) {
  try {
    const admin = await requireSystemAdmin(request);
    const csrfToken = await rotateAdminCsrf(admin.sessionId);
    return json({ admin: { key: admin.adminKey }, csrfToken }, 200, { "Cache-Control": "no-store" });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await requireSystemAdmin(request, { csrf: true });
    await endSystemAdminSession(request);
    await auditSystemAdmin({ adminKey: admin.adminKey, action: "admin_session_revoked" });
    return json({ ok: true }, 200, { "Set-Cookie": clearSystemAdminCookie(request) });
  } catch (error) {
    return apiFailure(error);
  }
}
