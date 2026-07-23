CREATE TABLE `class_job_setup` (
	`class_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`setup_mode` text,
	`survey_answers` text,
	`draft_jobs` text,
	`student_count_snapshot` integer DEFAULT 0 NOT NULL,
	`selected_job_count` integer DEFAULT 0 NOT NULL,
	`selected_capacity` integer DEFAULT 0 NOT NULL,
	`last_step` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `class_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`template_id` text,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`member_capacity` integer NOT NULL,
	`category` text NOT NULL,
	`source` text NOT NULL,
	`sort_order` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `job_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `class_jobs_class_idx` ON `class_jobs` (`class_id`);--> statement-breakpoint
CREATE INDEX `class_jobs_template_idx` ON `class_jobs` (`template_id`);--> statement-breakpoint
CREATE TABLE `job_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`short_description` text NOT NULL,
	`detailed_tasks` text NOT NULL,
	`category` text NOT NULL,
	`recommended_min_members` integer NOT NULL,
	`recommended_max_members` integer NOT NULL,
	`icon_key` text NOT NULL,
	`default_priority` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `job_templates_category_idx` ON `job_templates` (`category`);