CREATE TRIGGER `audit_logs_update_guard`
BEFORE UPDATE ON `audit_logs`
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_LOG_IMMUTABLE');
END;--> statement-breakpoint
CREATE TRIGGER `audit_logs_delete_guard`
BEFORE DELETE ON `audit_logs`
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_LOG_IMMUTABLE');
END;
