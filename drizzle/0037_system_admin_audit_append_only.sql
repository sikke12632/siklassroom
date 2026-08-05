CREATE TRIGGER IF NOT EXISTS `system_admin_audit_logs_update_guard`
BEFORE UPDATE ON `system_admin_audit_logs`
BEGIN
  SELECT RAISE(ABORT, 'SYSTEM_ADMIN_AUDIT_LOG_IMMUTABLE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `system_admin_audit_logs_delete_guard`
BEFORE DELETE ON `system_admin_audit_logs`
BEGIN
  SELECT RAISE(ABORT, 'SYSTEM_ADMIN_AUDIT_LOG_IMMUTABLE');
END;
