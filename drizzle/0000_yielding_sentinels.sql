CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text,
	`class_id` text,
	`student_id` text,
	`action` text NOT NULL,
	`detail` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_teacher_idx` ON `audit_logs` (`teacher_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_class_idx` ON `audit_logs` (`class_id`);--> statement-breakpoint
CREATE TABLE `classes` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`school_name` text NOT NULL,
	`school_normalized` text NOT NULL,
	`school_year` integer NOT NULL,
	`grade` integer NOT NULL,
	`class_number` integer NOT NULL,
	`display_name` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `classes_identity_uq` ON `classes` (`school_normalized`,`school_year`,`grade`,`class_number`);--> statement-breakpoint
CREATE INDEX `classes_teacher_idx` ON `classes` (`teacher_id`);--> statement-breakpoint
CREATE TABLE `login_throttles` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`window_started_at` integer NOT NULL,
	`blocked_until` integer
);
--> statement-breakpoint
CREATE TABLE `registration_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`purpose` text NOT NULL,
	`generation` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registration_tokens_hash_uq` ON `registration_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `registration_tokens_student_idx` ON `registration_tokens` (`student_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`actor_type` text NOT NULL,
	`teacher_id` text,
	`student_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_hash_uq` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_teacher_idx` ON `sessions` (`teacher_id`);--> statement-breakpoint
CREATE INDEX `sessions_student_idx` ON `sessions` (`student_id`);--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`student_number` integer NOT NULL,
	`official_name` text NOT NULL,
	`password_hash` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`qr_generation` integer DEFAULT 0 NOT NULL,
	`activated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_class_number_uq` ON `students` (`class_id`,`student_number`);--> statement-breakpoint
CREATE INDEX `students_class_idx` ON `students` (`class_id`);--> statement-breakpoint
CREATE TABLE `teacher_password_resets` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_password_resets_hash_uq` ON `teacher_password_resets` (`token_hash`);--> statement-breakpoint
CREATE INDEX `teacher_password_resets_teacher_idx` ON `teacher_password_resets` (`teacher_id`);--> statement-breakpoint
CREATE TABLE `teachers` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teachers_email_uq` ON `teachers` (`email`);