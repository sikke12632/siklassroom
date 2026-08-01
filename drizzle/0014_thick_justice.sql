CREATE TABLE `registration_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`registration_token_id` text NOT NULL,
	`student_id` text NOT NULL,
	`qr_generation` integer NOT NULL,
	`credential_revision_snapshot` integer NOT NULL,
	`challenge_hash` text NOT NULL,
	`mode` text NOT NULL,
	`reset_grant_id` text,
	`expires_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`used_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`registration_token_id`) REFERENCES `registration_tokens`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reset_grant_id`) REFERENCES `student_qr_reset_grants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registration_challenges_hash_uq` ON `registration_challenges` (`challenge_hash`);--> statement-breakpoint
CREATE INDEX `registration_challenges_student_idx` ON `registration_challenges` (`student_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `registration_operation_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`operation` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `student_qr_reset_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`qr_generation` integer NOT NULL,
	`issued_by_teacher_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issued_by_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `student_qr_reset_grants_student_idx` ON `student_qr_reset_grants` (`student_id`,`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `student_qr_reset_grants_open_uq` ON `student_qr_reset_grants` (`student_id`) WHERE "student_qr_reset_grants"."used_at" IS NULL AND "student_qr_reset_grants"."revoked_at" IS NULL;--> statement-breakpoint
ALTER TABLE `students` ADD `credential_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `registration_tokens_student_generation_uq` ON `registration_tokens` (`student_id`,`generation`) WHERE "registration_tokens"."revoked_at" IS NULL;--> statement-breakpoint
UPDATE `registration_tokens`
SET `purpose` = 'activate'
WHERE `student_id` IN (
	SELECT `id` FROM `students` WHERE `status` = 'reset_required' AND `password_hash` IS NULL
)
AND `generation` = (
	SELECT `qr_generation` FROM `students` WHERE `students`.`id` = `registration_tokens`.`student_id`
);--> statement-breakpoint
UPDATE `students`
SET `status` = 'pending',
	`updated_at` = CAST(unixepoch('subsec') * 1000 AS integer)
WHERE `status` = 'reset_required' AND `password_hash` IS NULL;
