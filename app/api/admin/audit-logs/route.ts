import { database } from "@/lib/database";
import { apiFailure, json } from "@/lib/responses";
import { requireSystemAdmin } from "@/lib/system-admin-auth";

export async function GET(request: Request) {
  try {
    await requireSystemAdmin(request);
    const result = await database().prepare(
      `SELECT id, admin_key, action, target_type, target_id, before_json,
              after_json, success, created_at
       FROM system_admin_audit_logs ORDER BY created_at DESC LIMIT 300`,
    ).all();
    return json({ logs: result.results });
  } catch (error) {
    return apiFailure(error);
  }
}
