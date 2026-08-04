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
  const serialized = JSON.stringify(value, (key, item) => {
    if (["password", "token", "code", "cookie", "csrfToken"].includes(key)) return "[REDACTED]";
    return item;
  });
  return typeof serialized === "string" ? serialized.slice(0, 4000) : null;
}

export function systemAdminAuditStatement(input: AdminAuditInput, createdAt = Date.now()) {
  return database().prepare(
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
    createdAt,
  );
}

export async function auditSystemAdmin(input: AdminAuditInput) {
  await systemAdminAuditStatement(input).run();
}
