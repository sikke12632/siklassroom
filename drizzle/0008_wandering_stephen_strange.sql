CREATE TABLE `class_job_evaluation_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`class_id` text NOT NULL,
	`student_id` text NOT NULL,
	`student_number` integer NOT NULL,
	`student_name` text NOT NULL,
	`scores_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`request_id` text NOT NULL,
	`write_nonce` text NOT NULL,
	`submitted_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `class_job_evaluation_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `class_job_evaluation_responses_student_uq` ON `class_job_evaluation_responses` (`session_id`,`student_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `class_job_evaluation_responses_request_uq` ON `class_job_evaluation_responses` (`session_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `class_job_evaluation_responses_session_idx` ON `class_job_evaluation_responses` (`session_id`,`submitted_at`);--> statement-breakpoint
CREATE INDEX `class_job_evaluation_responses_class_idx` ON `class_job_evaluation_responses` (`class_id`);--> statement-breakpoint
CREATE TABLE `class_job_evaluation_results` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`class_id` text NOT NULL,
	`class_job_id` text NOT NULL,
	`job_name` text NOT NULL,
	`hard_average` real NOT NULL,
	`responsibility_average` real NOT NULL,
	`consistency_average` real NOT NULL,
	`burden_average` real NOT NULL,
	`total_average` real NOT NULL,
	`response_count` integer NOT NULL,
	`rank` integer NOT NULL,
	`recommended_grade` text NOT NULL,
	`cutoff_tie` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `class_job_evaluation_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `class_job_evaluation_results_job_uq` ON `class_job_evaluation_results` (`session_id`,`class_job_id`);--> statement-breakpoint
CREATE INDEX `class_job_evaluation_results_session_idx` ON `class_job_evaluation_results` (`session_id`,`rank`);--> statement-breakpoint
CREATE INDEX `class_job_evaluation_results_class_idx` ON `class_job_evaluation_results` (`class_id`);--> statement-breakpoint
CREATE TABLE `class_job_evaluation_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`source_period_id` text NOT NULL,
	`source_year` integer NOT NULL,
	`source_month` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`jobs_json` text NOT NULL,
	`student_ids_json` text NOT NULL,
	`student_count_snapshot` integer NOT NULL,
	`job_count_snapshot` integer NOT NULL,
	`source_period_revision` integer NOT NULL,
	`job_setup_revision` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`response_revision` integer DEFAULT 0 NOT NULL,
	`calculated_response_revision` integer,
	`algorithm_version` text DEFAULT 'legacy-rank-v1' NOT NULL,
	`final_grades_json` text,
	`opened_by_teacher_id` text NOT NULL,
	`opened_at` integer NOT NULL,
	`closed_by_teacher_id` text,
	`closed_at` integer,
	`finalized_by_teacher_id` text,
	`finalized_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_period_id`) REFERENCES `class_job_assignment_periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opened_by_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`finalized_by_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `class_job_evaluation_sessions_source_uq` ON `class_job_evaluation_sessions` (`source_period_id`);--> statement-breakpoint
CREATE INDEX `class_job_evaluation_sessions_class_idx` ON `class_job_evaluation_sessions` (`class_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `class_job_month_closures` ADD `evaluation_session_id` text REFERENCES class_job_evaluation_sessions(id);--> statement-breakpoint
ALTER TABLE `class_job_month_closures` ADD `evaluation_revision` integer;