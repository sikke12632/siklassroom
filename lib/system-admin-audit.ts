import { database } from "./database";

export type AdminAuditInput = {
  adminKey?: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  success?: boolean;
};

function safeJson(value: unknown) {
  if (value === undefined) return null;
  return JSON.stringify(value, (key, item) => {
    if (["password", "token", "code", "cookie", "csrfToken"].includes(key)) return "[REDACTED]";
    return item;
  }).slice(0, 4000);
}

export async function auditSystemAdmin(input: AdminAuditInput) {
  await database().prepare(
    `INSERT INTO system_admin_audit_logs
     (id, admin_key, action, target_type, target_id, before_json, after_json, success, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    input.adminKey ?? "primary",
    input.action,
    input.targetType ?? null,
    input.targetId ?? null,
    safeJson(input.before),
    safeJson(input.after),
    input.success === false ? 0 : 1,
    Date.now(),
  ).run();
}
