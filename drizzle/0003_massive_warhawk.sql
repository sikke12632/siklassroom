CREATE TABLE `service_announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`audience` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `service_announcements_active_idx` ON `service_announcements` (`is_active`,`audience`);--> statement-breakpoint
CREATE TABLE `system_admin_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_key` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`before_json` text,
	`after_json` text,
	`success` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `system_admin_audit_created_idx` ON `system_admin_audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `system_admin_audit_target_idx` ON `system_admin_audit_logs` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `system_admin_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`csrf_hash` text NOT NULL,
	`admin_key` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `system_admin_sessions_token_uq` ON `system_admin_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `system_admin_sessions_admin_idx` ON `system_admin_sessions` (`admin_key`);--> statement-breakpoint
ALTER TABLE `school_manual_requests` ADD `reviewed_by` text;--> statement-breakpoint
ALTER TABLE `school_manual_requests` ADD `review_note` text;--> statement-breakpoint
ALTER TABLE `teacher_invite_codes` ADD `memo` text;--> statement-breakpoint
ALTER TABLE `teachers` ADD `teacher_access_note` text;--> statement-breakpoint
ALTER TABLE `teachers` ADD `teacher_access_updated_at` integer;