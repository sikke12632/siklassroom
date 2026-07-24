CREATE TABLE `school_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`alias` text NOT NULL,
	`normalized_alias` text NOT NULL,
	`alias_type` text NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `school_aliases_school_normalized_uq` ON `school_aliases` (`school_id`,`normalized_alias`);--> statement-breakpoint
CREATE INDEX `school_aliases_normalized_idx` ON `school_aliases` (`normalized_alias`);--> statement-breakpoint
CREATE TABLE `school_manual_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`submitted_by_teacher_id` text NOT NULL,
	`entered_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`province_name` text NOT NULL,
	`school_level` text NOT NULL,
	`district_or_address` text,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`linked_school_id` text,
	`created_at` integer NOT NULL,
	`reviewed_at` integer,
	FOREIGN KEY (`submitted_by_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`linked_school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `school_manual_requests_teacher_idx` ON `school_manual_requests` (`submitted_by_teacher_id`);--> statement-breakpoint
CREATE INDEX `school_manual_requests_lookup_idx` ON `school_manual_requests` (`normalized_name`,`province_name`,`status`);--> statement-breakpoint
CREATE TABLE `schools` (
	`id` text PRIMARY KEY NOT NULL,
	`office_code` text NOT NULL,
	`school_code` text NOT NULL,
	`official_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`search_name` text NOT NULL,
	`school_level` text NOT NULL,
	`province_name` text NOT NULL,
	`district_name` text,
	`road_address` text,
	`status` text DEFAULT 'active' NOT NULL,
	`source` text DEFAULT 'neis' NOT NULL,
	`source_updated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schools_office_school_uq` ON `schools` (`office_code`,`school_code`);--> statement-breakpoint
CREATE INDEX `schools_normalized_idx` ON `schools` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `schools_search_idx` ON `schools` (`search_name`);--> statement-breakpoint
CREATE INDEX `schools_filters_idx` ON `schools` (`province_name`,`school_level`,`status`);--> statement-breakpoint
CREATE TABLE `teacher_email_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`invalidated_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_email_verifications_hash_uq` ON `teacher_email_verifications` (`token_hash`);--> statement-breakpoint
CREATE INDEX `teacher_email_verifications_teacher_idx` ON `teacher_email_verifications` (`teacher_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `teacher_invite_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`issued_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`used_by_teacher_id` text,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`used_by_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_invite_codes_hash_uq` ON `teacher_invite_codes` (`code_hash`);--> statement-breakpoint
CREATE INDEX `teacher_invite_codes_status_idx` ON `teacher_invite_codes` (`status`,`expires_at`);--> statement-breakpoint
ALTER TABLE `classes` ADD `school_id` text;--> statement-breakpoint
ALTER TABLE `classes` ADD `manual_school_request_id` text;--> statement-breakpoint
ALTER TABLE `teachers` ADD `email_verified_at` integer;--> statement-breakpoint
ALTER TABLE `teachers` ADD `teacher_access_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `teachers` ADD `teacher_access_verified_at` integer;--> statement-breakpoint
ALTER TABLE `teachers` ADD `school_id` text;--> statement-breakpoint
ALTER TABLE `teachers` ADD `manual_school_request_id` text;--> statement-breakpoint
CREATE TABLE `system_migrations` (
	`key` text PRIMARY KEY NOT NULL,
	`applied_at` integer NOT NULL
);--> statement-breakpoint
UPDATE `teachers`
SET `email_verified_at` = COALESCE(`email_verified_at`, `updated_at`, `created_at`),
	`teacher_access_status` = 'invite_verified',
	`teacher_access_verified_at` = COALESCE(`teacher_access_verified_at`, `updated_at`, `created_at`)
WHERE `email_verified_at` IS NULL OR `teacher_access_status` = 'pending';--> statement-breakpoint
INSERT OR IGNORE INTO `school_manual_requests` (
	`id`, `submitted_by_teacher_id`, `entered_name`, `normalized_name`, `province_name`,
	`school_level`, `district_or_address`, `note`, `status`, `created_at`
)
SELECT
	'legacy-' || t.`id`, t.`id`, c.`school_name`, c.`school_normalized`, '미지정',
	'초등학교', NULL, '기존 학급에서 안전하게 이관한 학교', 'pending', t.`created_at`
FROM `teachers` t
JOIN `classes` c ON c.`id` = (
	SELECT c2.`id` FROM `classes` c2
	WHERE c2.`teacher_id` = t.`id`
	ORDER BY c2.`created_at` ASC LIMIT 1
)
WHERE t.`school_id` IS NULL AND t.`manual_school_request_id` IS NULL;--> statement-breakpoint
UPDATE `teachers`
SET `manual_school_request_id` = 'legacy-' || `id`
WHERE `school_id` IS NULL
  AND `manual_school_request_id` IS NULL
  AND EXISTS (SELECT 1 FROM `school_manual_requests` r WHERE r.`id` = 'legacy-' || `teachers`.`id`);--> statement-breakpoint
UPDATE `classes`
SET `manual_school_request_id` = (
	SELECT t.`manual_school_request_id` FROM `teachers` t WHERE t.`id` = `classes`.`teacher_id`
)
WHERE `school_id` IS NULL AND `manual_school_request_id` IS NULL;--> statement-breakpoint
CREATE TRIGGER `teacher_email_verified_after_token_use`
AFTER UPDATE OF `used_at` ON `teacher_email_verifications`
WHEN NEW.`used_at` IS NOT NULL AND OLD.`used_at` IS NULL
BEGIN
	UPDATE `teachers`
	SET `email_verified_at` = COALESCE(`email_verified_at`, NEW.`used_at`),
		`updated_at` = NEW.`used_at`
	WHERE `id` = NEW.`teacher_id`;
END;--> statement-breakpoint
CREATE TRIGGER `teacher_access_after_invite_use`
AFTER UPDATE OF `status` ON `teacher_invite_codes`
WHEN NEW.`status` = 'used' AND OLD.`status` = 'active' AND NEW.`used_by_teacher_id` IS NOT NULL
BEGIN
	UPDATE `teachers`
	SET `teacher_access_status` = 'invite_verified',
		`teacher_access_verified_at` = NEW.`used_at`,
		`updated_at` = NEW.`used_at`
	WHERE `id` = NEW.`used_by_teacher_id`;
END;--> statement-breakpoint
INSERT OR IGNORE INTO `system_migrations` (`key`, `applied_at`)
VALUES ('2026-07-teacher-access-bootstrap', unixepoch() * 1000);
