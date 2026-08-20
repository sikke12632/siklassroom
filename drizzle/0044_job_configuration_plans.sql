CREATE TABLE IF NOT EXISTS `class_job_change_plans` (
  `id` text PRIMARY KEY NOT NULL,
  `class_id` text NOT NULL,
  `target_year` integer NOT NULL,
  `target_month` integer NOT NULL,
  `jobs_json` text NOT NULL,
  `previous_jobs_json` text,
  `applied_jobs_json` text,
  `status` text DEFAULT 'draft' NOT NULL,
  `base_setup_revision` integer NOT NULL,
  `revision` integer DEFAULT 1 NOT NULL,
  `created_by_teacher_id` text NOT NULL,
  `applied_by_teacher_id` text,
  `applied_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`),
  FOREIGN KEY (`created_by_teacher_id`) REFERENCES `teachers`(`id`),
  FOREIGN KEY (`applied_by_teacher_id`) REFERENCES `teachers`(`id`),
  CONSTRAINT `class_job_change_plans_year_ck` CHECK (`target_year` BETWEEN 2020 AND 2100),
  CONSTRAINT `class_job_change_plans_month_ck` CHECK (`target_month` BETWEEN 1 AND 12),
  CONSTRAINT `class_job_change_plans_status_ck` CHECK (`status` IN ('draft', 'applied')),
  CONSTRAINT `class_job_change_plans_base_revision_ck` CHECK (`base_setup_revision` >= 0),
  CONSTRAINT `class_job_change_plans_revision_ck` CHECK (`revision` >= 1)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `class_job_change_plans_target_uq`
ON `class_job_change_plans` (`class_id`, `target_year`, `target_month`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `class_job_change_plans_class_status_idx`
ON `class_job_change_plans` (`class_id`, `status`, `updated_at`);--> statement-breakpoint
DROP VIEW IF EXISTS `student_effective_permissions`;--> statement-breakpoint
CREATE VIEW `student_effective_permissions` AS
SELECT manual.class_id,
       manual.student_id,
       manual.permission_key,
       COALESCE((
         SELECT period.id
         FROM class_job_assignment_periods period
         WHERE period.class_id = manual.class_id
           AND period.status = 'confirmed'
           AND period.assignment_type IN ('initial', 'monthly')
           AND (
             period.assignment_year < CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER)
             OR (
               period.assignment_year = CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER)
               AND period.assignment_month <= CAST(strftime('%m', 'now', '+9 hours') AS INTEGER)
             )
           )
         ORDER BY period.assignment_year DESC, period.assignment_month DESC,
                  COALESCE(period.confirmed_at, 0) DESC,
                  period.updated_at DESC, period.id DESC
         LIMIT 1
       ), (
         SELECT period.id
         FROM class_job_assignment_periods period
         WHERE period.class_id = manual.class_id
           AND period.assignment_type = 'permission'
         ORDER BY period.created_at, period.id
         LIMIT 1
       )) AS period_id,
       'manual' AS permission_source
FROM student_manual_permissions manual
JOIN students student
  ON student.id = manual.student_id
 AND student.class_id = manual.class_id
JOIN classes classroom ON classroom.id = manual.class_id
WHERE manual.is_active = 1
  AND student.status = 'active'
  AND classroom.status = 'active'
UNION ALL
SELECT assignment.class_id,
       assignment.student_id,
       CASE job.template_id
         WHEN 'banker' THEN 'finance_banker'
         WHEN 'market-clerk' THEN 'mart_operator'
         WHEN 'routine-checker' THEN 'life_check_tooth'
         WHEN 'milk-manager' THEN 'life_check_milk'
         WHEN 'meal-checker' THEN 'life_check_lunch'
       END AS permission_key,
       period.id AS period_id,
       'automatic' AS permission_source
FROM student_job_assignments assignment
JOIN class_job_assignment_periods period
  ON period.id = assignment.period_id
 AND period.class_id = assignment.class_id
JOIN class_jobs job
  ON job.id = assignment.class_job_id
 AND job.class_id = assignment.class_id
JOIN students student
  ON student.id = assignment.student_id
 AND student.class_id = assignment.class_id
JOIN classes classroom ON classroom.id = assignment.class_id
WHERE period.status = 'confirmed'
  AND period.assignment_type IN ('initial', 'monthly')
  AND job.template_id IN (
    'banker', 'market-clerk', 'routine-checker', 'milk-manager', 'meal-checker'
  )
  AND student.status = 'active'
  AND classroom.status = 'active'
  AND (
    period.assignment_year < CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER)
    OR (
      period.assignment_year = CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER)
      AND period.assignment_month <= CAST(strftime('%m', 'now', '+9 hours') AS INTEGER)
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM class_job_assignment_periods newer
    WHERE newer.class_id = period.class_id
      AND newer.status = 'confirmed'
      AND newer.assignment_type IN ('initial', 'monthly')
      AND (
        newer.assignment_year < CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER)
        OR (
          newer.assignment_year = CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER)
          AND newer.assignment_month <= CAST(strftime('%m', 'now', '+9 hours') AS INTEGER)
        )
      )
      AND (
        newer.assignment_year > period.assignment_year
        OR (
          newer.assignment_year = period.assignment_year
          AND newer.assignment_month > period.assignment_month
        )
        OR (
          newer.assignment_year = period.assignment_year
          AND newer.assignment_month = period.assignment_month
          AND COALESCE(newer.confirmed_at, 0) > COALESCE(period.confirmed_at, 0)
        )
        OR (
          newer.assignment_year = period.assignment_year
          AND newer.assignment_month = period.assignment_month
          AND COALESCE(newer.confirmed_at, 0) = COALESCE(period.confirmed_at, 0)
          AND newer.updated_at > period.updated_at
        )
        OR (
          newer.assignment_year = period.assignment_year
          AND newer.assignment_month = period.assignment_month
          AND COALESCE(newer.confirmed_at, 0) = COALESCE(period.confirmed_at, 0)
          AND newer.updated_at = period.updated_at
          AND newer.id > period.id
        )
      )
  );
