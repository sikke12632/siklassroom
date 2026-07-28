CREATE TABLE `class_calendar_days` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`calendar_date` text NOT NULL,
	`day_type` text DEFAULT 'class' NOT NULL,
	`memo` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `class_calendar_days_class_date_uq` ON `class_calendar_days` (`class_id`,`calendar_date`);--> statement-breakpoint
CREATE INDEX `class_calendar_days_class_idx` ON `class_calendar_days` (`class_id`);--> statement-breakpoint
CREATE TABLE `class_calendars` (
	`class_id` text PRIMARY KEY NOT NULL,
	`school_year` integer NOT NULL,
	`time_zone` text DEFAULT 'Asia/Seoul' NOT NULL,
	`class_start_date` text NOT NULL,
	`first_job_start_date` text NOT NULL,
	`first_job_end_date` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`saved_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `job_assignment_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`period_id` text NOT NULL,
	`class_job_id` text NOT NULL,
	`student_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`period_id`) REFERENCES `class_job_assignment_periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_job_id`) REFERENCES `class_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_assignment_candidates_period_job_student_uq` ON `job_assignment_candidates` (`period_id`,`class_job_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `job_assignment_candidates_period_idx` ON `job_assignment_candidates` (`period_id`);--> statement-breakpoint
ALTER TABLE `class_job_assignment_periods` ADD `mode` text;--> statement-breakpoint
ALTER TABLE `class_job_assignment_periods` ADD `status` text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `class_job_assignment_periods` ADD `calendar_revision` integer;--> statement-breakpoint
ALTER TABLE `class_job_assignment_periods` ADD `first_job_start_date` text;--> statement-breakpoint
ALTER TABLE `class_job_assignment_periods` ADD `first_job_end_date` text;--> statement-breakpoint
ALTER TABLE `class_job_assignment_periods` ADD `confirmed_at` integer;--> statement-breakpoint
ALTER TABLE `class_job_assignment_periods` ADD `confirmed_by_teacher_id` text REFERENCES teachers(id);--> statement-breakpoint
ALTER TABLE `class_job_assignment_periods` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `classes` ADD `time_zone` text DEFAULT 'Asia/Seoul' NOT NULL;--> statement-breakpoint
ALTER TABLE `classes` ADD `setup_stage` text DEFAULT 'roster' NOT NULL;--> statement-breakpoint
ALTER TABLE `student_job_assignments` ADD `request_id` text;--> statement-breakpoint
ALTER TABLE `student_job_assignments` ADD `assignment_sequence` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `student_job_assignments_period_request_uq` ON `student_job_assignments` (`period_id`,`request_id`);