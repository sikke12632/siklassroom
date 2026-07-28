CREATE TABLE `class_job_choice_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`closure_id` text NOT NULL,
	`target_year` integer NOT NULL,
	`target_month` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`order_mode` text DEFAULT 'roster' NOT NULL,
	`order_json` text NOT NULL,
	`student_count_snapshot` integer NOT NULL,
	`job_setup_revision` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`confirmed_period_id` text,
	`confirmed_by_teacher_id` text,
	`confirmed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closure_id`) REFERENCES `class_job_month_closures`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmed_period_id`) REFERENCES `class_job_assignment_periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmed_by_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `class_job_choice_sessions_closure_uq` ON `class_job_choice_sessions` (`closure_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `class_job_choice_sessions_target_uq` ON `class_job_choice_sessions` (`class_id`,`target_year`,`target_month`);--> statement-breakpoint
CREATE INDEX `class_job_choice_sessions_class_idx` ON `class_job_choice_sessions` (`class_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `class_job_month_closures` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`source_period_id` text NOT NULL,
	`source_year` integer NOT NULL,
	`source_month` integer NOT NULL,
	`status` text DEFAULT 'closed' NOT NULL,
	`closed_by_teacher_id` text NOT NULL,
	`closed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_period_id`) REFERENCES `class_job_assignment_periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `class_job_month_closures_source_uq` ON `class_job_month_closures` (`source_period_id`);--> statement-breakpoint
CREATE INDEX `class_job_month_closures_class_idx` ON `class_job_month_closures` (`class_id`,`closed_at`);--> statement-breakpoint
CREATE TABLE `class_job_month_results` (
	`id` text PRIMARY KEY NOT NULL,
	`closure_id` text NOT NULL,
	`class_id` text NOT NULL,
	`student_id` text NOT NULL,
	`student_number` integer NOT NULL,
	`student_name` text NOT NULL,
	`class_job_id` text NOT NULL,
	`job_name` text NOT NULL,
	`job_grade` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`closure_id`) REFERENCES `class_job_month_closures`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `class_job_month_results_student_uq` ON `class_job_month_results` (`closure_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `class_job_month_results_closure_idx` ON `class_job_month_results` (`closure_id`,`student_number`);--> statement-breakpoint
CREATE INDEX `class_job_month_results_class_idx` ON `class_job_month_results` (`class_id`);