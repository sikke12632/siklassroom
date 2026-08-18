ALTER TABLE `schools` ADD `student_login_code` text;--> statement-breakpoint
UPDATE `schools`
SET `student_login_code` = '01',
    `updated_at` = CAST(unixepoch('subsec') * 1000 AS integer)
WHERE `id` = 'school:B10:7091394'
  AND `student_login_code` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `schools_student_login_code_uq`
ON `schools` (`student_login_code`);--> statement-breakpoint
CREATE INDEX `classes_student_login_idx`
ON `classes` (`school_id`,`status`,`grade`,`class_number`,`school_year`);
