CREATE TABLE `class_job_assignment_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`assignment_year` integer NOT NULL,
	`assignment_month` integer NOT NULL,
	`assignment_type` text DEFAULT 'initial' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `class_job_assignment_periods_period_uq` ON `class_job_assignment_periods` (`class_id`,`assignment_year`,`assignment_month`,`assignment_type`);--> statement-breakpoint
CREATE INDEX `class_job_assignment_periods_class_idx` ON `class_job_assignment_periods` (`class_id`);--> statement-breakpoint
CREATE TABLE `student_job_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`period_id` text NOT NULL,
	`class_id` text NOT NULL,
	`class_job_id` text NOT NULL,
	`student_id` text NOT NULL,
	`assignment_method` text NOT NULL,
	`assigned_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`period_id`) REFERENCES `class_job_assignment_periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_job_id`) REFERENCES `class_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `student_job_assignments_period_student_uq` ON `student_job_assignments` (`period_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `student_job_assignments_period_job_idx` ON `student_job_assignments` (`period_id`,`class_job_id`);--> statement-breakpoint
CREATE INDEX `student_job_assignments_class_idx` ON `student_job_assignments` (`class_id`);--> statement-breakpoint
INSERT INTO `schools` (
	`id`, `office_code`, `school_code`, `official_name`, `normalized_name`, `search_name`,
	`school_level`, `province_name`, `district_name`, `road_address`, `status`, `source`,
	`source_updated_at`, `created_at`, `updated_at`
) VALUES (
	'school:B10:7091394', 'B10', '7091394', '서울서이초등학교', '서울서이초등학교', '서울서이초',
	'초등학교', '서울특별시', '서울특별시강남서초교육지원청', '서울특별시 서초구 서운로 35',
	'active', 'neis', 1784975371761, 1784975371761, 1784975371761
) ON CONFLICT(`id`) DO UPDATE SET
	`official_name` = excluded.`official_name`,
	`normalized_name` = excluded.`normalized_name`,
	`search_name` = excluded.`search_name`,
	`school_level` = excluded.`school_level`,
	`province_name` = excluded.`province_name`,
	`district_name` = excluded.`district_name`,
	`road_address` = excluded.`road_address`,
	`status` = 'active',
	`source` = 'neis',
	`source_updated_at` = excluded.`source_updated_at`,
	`updated_at` = excluded.`updated_at`;--> statement-breakpoint
INSERT OR IGNORE INTO `school_aliases`
	(`id`, `school_id`, `alias`, `normalized_alias`, `alias_type`)
VALUES
	('school-alias:B10:7091394:seoi', 'school:B10:7091394', '서이초', '서이초', 'common'),
	('school-alias:B10:7091394:seoul-seoi', 'school:B10:7091394', '서울서이초', '서울서이초', 'short');
