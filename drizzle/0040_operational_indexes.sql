CREATE INDEX IF NOT EXISTS `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `teacher_password_resets_expires_idx` ON `teacher_password_resets` (`expires_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `registration_tokens_expires_idx` ON `registration_tokens` (`expires_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_logs_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `system_admin_sessions_expires_idx` ON `system_admin_sessions` (`expires_at`);
