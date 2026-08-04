UPDATE `finance_accounts`
SET `status` = CASE
  WHEN `account_type` = 'class_issuance'
    AND EXISTS (
      SELECT 1 FROM `classes` classroom
      WHERE classroom.`id` = `finance_accounts`.`class_id`
        AND classroom.`status` = 'active'
    )
  THEN 'active'
  WHEN `account_type` = 'student_wallet'
    AND EXISTS (
      SELECT 1 FROM `classes` classroom
      WHERE classroom.`id` = `finance_accounts`.`class_id`
        AND classroom.`status` = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM `students` student
      WHERE student.`id` = `finance_accounts`.`student_id`
        AND student.`class_id` = `finance_accounts`.`class_id`
        AND student.`status` <> 'excluded'
    )
  THEN 'active'
  WHEN `account_type` = 'student_wallet'
    AND EXISTS (
      SELECT 1 FROM `classes` classroom
      WHERE classroom.`id` = `finance_accounts`.`class_id`
        AND classroom.`status` = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM `students` student
      WHERE student.`id` = `finance_accounts`.`student_id`
        AND student.`class_id` = `finance_accounts`.`class_id`
        AND student.`status` = 'excluded'
    )
  THEN 'frozen'
  ELSE 'closed'
END;--> statement-breakpoint
CREATE TRIGGER `finance_accounts_insert_status_guard`
BEFORE INSERT ON `finance_accounts`
WHEN NEW.`status` <> CASE
  WHEN NEW.`account_type` = 'class_issuance'
    AND EXISTS (
      SELECT 1 FROM `classes` classroom
      WHERE classroom.`id` = NEW.`class_id`
        AND classroom.`status` = 'active'
    )
  THEN 'active'
  WHEN NEW.`account_type` = 'student_wallet'
    AND EXISTS (
      SELECT 1 FROM `classes` classroom
      WHERE classroom.`id` = NEW.`class_id`
        AND classroom.`status` = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM `students` student
      WHERE student.`id` = NEW.`student_id`
        AND student.`class_id` = NEW.`class_id`
        AND student.`status` <> 'excluded'
    )
  THEN 'active'
  WHEN NEW.`account_type` = 'student_wallet'
    AND EXISTS (
      SELECT 1 FROM `classes` classroom
      WHERE classroom.`id` = NEW.`class_id`
        AND classroom.`status` = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM `students` student
      WHERE student.`id` = NEW.`student_id`
        AND student.`class_id` = NEW.`class_id`
        AND student.`status` = 'excluded'
    )
  THEN 'frozen'
  ELSE 'closed'
END
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_ACCOUNT_STATUS_MISMATCH');
END;--> statement-breakpoint
CREATE TRIGGER `finance_accounts_status_guard`
BEFORE UPDATE OF `status` ON `finance_accounts`
WHEN NEW.`status` <> CASE
  WHEN NEW.`account_type` = 'class_issuance'
    AND EXISTS (
      SELECT 1 FROM `classes` classroom
      WHERE classroom.`id` = NEW.`class_id`
        AND classroom.`status` = 'active'
    )
  THEN 'active'
  WHEN NEW.`account_type` = 'student_wallet'
    AND EXISTS (
      SELECT 1 FROM `classes` classroom
      WHERE classroom.`id` = NEW.`class_id`
        AND classroom.`status` = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM `students` student
      WHERE student.`id` = NEW.`student_id`
        AND student.`class_id` = NEW.`class_id`
        AND student.`status` <> 'excluded'
    )
  THEN 'active'
  WHEN NEW.`account_type` = 'student_wallet'
    AND EXISTS (
      SELECT 1 FROM `classes` classroom
      WHERE classroom.`id` = NEW.`class_id`
        AND classroom.`status` = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM `students` student
      WHERE student.`id` = NEW.`student_id`
        AND student.`class_id` = NEW.`class_id`
        AND student.`status` = 'excluded'
    )
  THEN 'frozen'
  ELSE 'closed'
END
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_ACCOUNT_STATUS_MISMATCH');
END;
