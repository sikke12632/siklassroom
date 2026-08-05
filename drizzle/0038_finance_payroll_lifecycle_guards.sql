CREATE TRIGGER IF NOT EXISTS `finance_payroll_classes_archive_guard`
BEFORE UPDATE OF `status` ON `classes`
WHEN NEW.`status` = 'archived' AND OLD.`status` <> 'archived'
  AND EXISTS (
    SELECT 1 FROM `finance_payroll_runs` payroll
    WHERE payroll.`class_id` = OLD.`id`
      AND payroll.`status` IN ('prepared', 'posting')
  )
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_PAYROLL_PENDING_CLASS');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_payroll_students_exclude_guard`
BEFORE UPDATE OF `status` ON `students`
WHEN NEW.`status` = 'excluded' AND OLD.`status` <> 'excluded'
  AND EXISTS (
    SELECT 1
    FROM `finance_payroll_items` item
    JOIN `finance_payroll_runs` payroll
      ON payroll.`id` = item.`run_id` AND payroll.`class_id` = item.`class_id`
    WHERE item.`class_id` = OLD.`class_id`
      AND item.`student_id` = OLD.`id`
      AND item.`status` = 'pending'
      AND payroll.`status` IN ('prepared', 'posting')
  )
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_PAYROLL_PENDING_STUDENT');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_salary_settings_pending_payroll_guard`
BEFORE UPDATE ON `finance_salary_settings`
WHEN EXISTS (
  SELECT 1 FROM `finance_payroll_runs` payroll
  WHERE payroll.`class_id` = OLD.`class_id`
    AND payroll.`status` IN ('prepared', 'posting')
)
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_PAYROLL_PENDING_SETTINGS');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_denominations_pending_payroll_guard`
BEFORE UPDATE OF `denominations_json` ON `finance_settings`
WHEN NEW.`denominations_json` <> OLD.`denominations_json`
  AND EXISTS (
    SELECT 1 FROM `finance_payroll_runs` payroll
    WHERE payroll.`class_id` = OLD.`class_id`
      AND payroll.`status` IN ('prepared', 'posting')
  )
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_PAYROLL_PENDING_DENOMINATIONS');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_payroll_runs_prepare_guard`
BEFORE INSERT ON `finance_payroll_runs`
WHEN NOT EXISTS (
  SELECT 1
  FROM `classes` classroom
  JOIN `finance_salary_settings` salary ON salary.`class_id` = classroom.`id`
  JOIN `finance_settings` settings ON settings.`class_id` = classroom.`id`
  WHERE classroom.`id` = NEW.`class_id`
    AND classroom.`status` = 'active'
    AND salary.`revision` = NEW.`salary_settings_revision`
    AND salary.`grade_a_amount` % (
      SELECT MIN(CAST(value AS INTEGER)) FROM json_each(settings.`denominations_json`)
    ) = 0
    AND salary.`grade_b_amount` % (
      SELECT MIN(CAST(value AS INTEGER)) FROM json_each(settings.`denominations_json`)
    ) = 0
    AND salary.`grade_c_amount` % (
      SELECT MIN(CAST(value AS INTEGER)) FROM json_each(settings.`denominations_json`)
    ) = 0
)
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_PAYROLL_PREPARE_STALE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_payroll_items_prepare_guard`
BEFORE INSERT ON `finance_payroll_items`
WHEN NOT EXISTS (
  SELECT 1
  FROM `students` student
  JOIN `finance_accounts` wallet
    ON wallet.`student_id` = student.`id`
   AND wallet.`class_id` = student.`class_id`
   AND wallet.`account_type` = 'student_wallet'
  WHERE student.`id` = NEW.`student_id`
    AND student.`class_id` = NEW.`class_id`
    AND student.`status` = 'active'
    AND wallet.`status` = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_PAYROLL_RECIPIENT_STALE');
END;
