CREATE TABLE `class_timetables` (
	`class_id` text PRIMARY KEY NOT NULL,
	`period_count` integer DEFAULT 6 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "class_timetables_period_count_ck" CHECK (`period_count` BETWEEN 1 AND 10),
	CONSTRAINT "class_timetables_revision_ck" CHECK (`revision` >= 1)
);
--> statement-breakpoint
CREATE TABLE `class_timetable_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`period_number` integer NOT NULL,
	`subject_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `class_timetables`(`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "class_timetable_slots_weekday_ck" CHECK (`weekday` BETWEEN 1 AND 5),
	CONSTRAINT "class_timetable_slots_period_ck" CHECK (`period_number` BETWEEN 1 AND 10),
	CONSTRAINT "class_timetable_slots_subject_ck" CHECK (length(trim(`subject_name`)) BETWEEN 1 AND 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `class_timetable_slots_class_weekday_period_uq` ON `class_timetable_slots` (`class_id`,`weekday`,`period_number`);--> statement-breakpoint
CREATE INDEX `class_timetable_slots_class_idx` ON `class_timetable_slots` (`class_id`);
