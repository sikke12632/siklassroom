CREATE TABLE `student_manual_permissions` (
  `id` text PRIMARY KEY NOT NULL,
  `class_id` text NOT NULL,
  `student_id` text NOT NULL,
  `permission_key` text NOT NULL,
  `is_active` integer DEFAULT 1 NOT NULL,
  `granted_by_teacher_id` text NOT NULL,
  `revision` integer DEFAULT 1 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`),
  FOREIGN KEY (`student_id`) REFERENCES `students`(`id`),
  FOREIGN KEY (`granted_by_teacher_id`) REFERENCES `teachers`(`id`),
  CONSTRAINT `student_manual_permissions_key_ck` CHECK (
    `permission_key` IN (
      'finance_banker', 'mart_operator',
      'life_check_tooth', 'life_check_milk', 'life_check_lunch'
    )
  ),
  CONSTRAINT `student_manual_permissions_active_ck` CHECK (`is_active` IN (0, 1)),
  CONSTRAINT `student_manual_permissions_revision_ck` CHECK (`revision` >= 1)
);--> statement-breakpoint
CREATE UNIQUE INDEX `student_manual_permissions_scope_uq`
ON `student_manual_permissions` (`class_id`, `student_id`, `permission_key`);--> statement-breakpoint
CREATE INDEX `student_manual_permissions_student_idx`
ON `student_manual_permissions` (`student_id`, `is_active`);--> statement-breakpoint
CREATE INDEX `student_manual_permissions_class_active_idx`
ON `student_manual_permissions` (`class_id`, `permission_key`, `is_active`);--> statement-breakpoint
CREATE TRIGGER `student_manual_permissions_insert_guard`
BEFORE INSERT ON `student_manual_permissions`
WHEN NEW.is_active <> 1
  OR NEW.revision <> 1
  OR NOT EXISTS (
    SELECT 1
    FROM students student
    JOIN classes classroom ON classroom.id = student.class_id
    WHERE student.id = NEW.student_id
      AND student.class_id = NEW.class_id
      AND student.status = 'active'
      AND classroom.status = 'active'
      AND classroom.teacher_id = NEW.granted_by_teacher_id
  )
BEGIN SELECT RAISE(ABORT, 'STUDENT_PERMISSION_CONTEXT_INVALID'); END;--> statement-breakpoint
CREATE TRIGGER `student_manual_permissions_update_guard`
BEFORE UPDATE ON `student_manual_permissions`
WHEN NEW.id <> OLD.id
  OR NEW.class_id <> OLD.class_id
  OR NEW.student_id <> OLD.student_id
  OR NEW.permission_key <> OLD.permission_key
  OR NEW.created_at <> OLD.created_at
  OR NEW.revision <> OLD.revision + 1
  OR NEW.updated_at < OLD.updated_at
  OR NEW.is_active = OLD.is_active
  OR NOT EXISTS (
    SELECT 1
    FROM students student
    JOIN classes classroom ON classroom.id = student.class_id
    WHERE student.id = NEW.student_id
      AND student.class_id = NEW.class_id
      AND classroom.status = 'active'
      AND classroom.teacher_id = NEW.granted_by_teacher_id
      AND (NEW.is_active = 0 OR student.status = 'active')
  )
BEGIN SELECT RAISE(ABORT, 'STUDENT_PERMISSION_STALE_OR_DENIED'); END;--> statement-breakpoint
CREATE TRIGGER `student_manual_permissions_delete_guard`
BEFORE DELETE ON `student_manual_permissions`
BEGIN SELECT RAISE(ABORT, 'STUDENT_PERMISSION_DELETE_FORBIDDEN'); END;--> statement-breakpoint
CREATE TRIGGER `class_permission_period_update_guard`
BEFORE UPDATE ON `class_job_assignment_periods`
WHEN OLD.assignment_type = 'permission'
BEGIN SELECT RAISE(ABORT, 'STUDENT_PERMISSION_PERIOD_IMMUTABLE'); END;--> statement-breakpoint
CREATE TRIGGER `class_permission_period_delete_guard`
BEFORE DELETE ON `class_job_assignment_periods`
WHEN OLD.assignment_type = 'permission'
BEGIN SELECT RAISE(ABORT, 'STUDENT_PERMISSION_PERIOD_IMMUTABLE'); END;--> statement-breakpoint
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
  AND job.is_active = 1
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
  );--> statement-breakpoint
DROP VIEW `mart_effective_market_clerks`;--> statement-breakpoint
CREATE VIEW `mart_effective_market_clerks` AS
SELECT DISTINCT permission.class_id,
       permission.student_id,
       permission.period_id
FROM student_effective_permissions permission
WHERE permission.permission_key = 'mart_operator'
  AND permission.period_id IS NOT NULL;--> statement-breakpoint
DROP TRIGGER `finance_request_resolutions_insert_guard`;--> statement-breakpoint
CREATE TRIGGER `finance_request_resolutions_insert_guard`
BEFORE INSERT ON `finance_request_resolutions`
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM finance_cash_requests request_row
      JOIN classes classroom ON classroom.id = request_row.class_id
      WHERE request_row.id = NEW.request_id
        AND request_row.class_id = NEW.class_id
        AND request_row.revision = NEW.expected_request_revision
        AND classroom.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM finance_request_resolutions prior
          WHERE prior.request_id = request_row.id
        )
    )
    THEN RAISE(ABORT, 'FINANCE_REQUEST_STALE')
  END;
  SELECT CASE
    WHEN NEW.decision = 'cancelled'
      AND NOT (
        NEW.actor_type = 'student'
        AND EXISTS (
          SELECT 1 FROM finance_cash_requests request_row
          JOIN students student
            ON student.id = request_row.requester_student_id
           AND student.class_id = request_row.class_id
          WHERE request_row.id = NEW.request_id
            AND request_row.class_id = NEW.class_id
            AND student.id = NEW.actor_student_id
            AND student.status = 'active'
        )
      )
    THEN RAISE(ABORT, 'FINANCE_REQUEST_CANCEL_DENIED')
  END;
  SELECT CASE
    WHEN NEW.decision IN ('approved', 'rejected')
      AND NEW.actor_type = 'student'
    THEN RAISE(ABORT, 'FINANCE_REQUEST_DECISION_DENIED')
  END;
  SELECT CASE
    WHEN NEW.actor_type = 'teacher'
      AND NOT EXISTS (
        SELECT 1 FROM classes classroom
        WHERE classroom.id = NEW.class_id
          AND classroom.teacher_id = NEW.actor_teacher_id
          AND classroom.status = 'active'
      )
    THEN RAISE(ABORT, 'FINANCE_CLASS_ACCESS_DENIED')
  END;
  SELECT CASE
    WHEN NEW.actor_type = 'banker'
      AND EXISTS (
        SELECT 1 FROM finance_cash_requests request_row
        WHERE request_row.id = NEW.request_id
          AND request_row.requester_student_id = NEW.actor_student_id
      )
    THEN RAISE(ABORT, 'FINANCE_REQUEST_SELF_APPROVAL_DENIED')
  END;
  SELECT CASE
    WHEN NEW.actor_type = 'banker'
      AND NOT EXISTS (
        SELECT 1
        FROM student_effective_permissions permission
        WHERE permission.period_id = NEW.actor_job_period_id
          AND permission.class_id = NEW.class_id
          AND permission.student_id = NEW.actor_student_id
          AND permission.permission_key = 'finance_banker'
      )
    THEN RAISE(ABORT, 'FINANCE_BANKER_ACCESS_DENIED')
  END;
  SELECT CASE
    WHEN NEW.decision = 'approved'
      AND NOT EXISTS (
        SELECT 1
        FROM finance_cash_requests request_row
        JOIN finance_accounts wallet
          ON wallet.id = request_row.wallet_account_id
         AND wallet.class_id = request_row.class_id
         AND wallet.account_type = 'student_wallet'
         AND wallet.status = 'active'
        JOIN finance_accounts issuance
          ON issuance.class_id = request_row.class_id
         AND issuance.account_type = 'class_issuance'
         AND issuance.status = 'active'
        WHERE request_row.id = NEW.request_id
          AND request_row.class_id = NEW.class_id
      )
    THEN RAISE(ABORT, 'FINANCE_ACCOUNT_NOT_ACTIVE')
  END;
END;--> statement-breakpoint
DROP TRIGGER `finance_transactions_actor_guard`;--> statement-breakpoint
CREATE TRIGGER `finance_transactions_actor_guard`
BEFORE INSERT ON `finance_transactions`
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM classes
      WHERE classes.id = NEW.class_id AND classes.status = 'active'
    )
    THEN RAISE(ABORT, 'FINANCE_CLASS_NOT_ACTIVE')
  END;
  SELECT CASE
    WHEN NEW.actor_type = 'teacher'
      AND NOT EXISTS (
        SELECT 1 FROM classes
        WHERE classes.id = NEW.class_id
          AND classes.teacher_id = NEW.actor_teacher_id
          AND classes.status = 'active'
      )
    THEN RAISE(ABORT, 'FINANCE_CLASS_ACCESS_DENIED')
  END;
  SELECT CASE
    WHEN NEW.actor_type = 'banker'
      AND NOT EXISTS (
        SELECT 1
        FROM student_effective_permissions permission
        WHERE permission.period_id = NEW.actor_job_period_id
          AND permission.class_id = NEW.class_id
          AND permission.student_id = NEW.actor_student_id
          AND permission.permission_key = 'finance_banker'
      )
    THEN RAISE(ABORT, 'FINANCE_BANKER_ACCESS_DENIED')
  END;
  SELECT CASE
    WHEN NEW.actor_type = 'banker'
      AND COALESCE(NEW.source_type, '') <> 'cash_request'
    THEN RAISE(ABORT, 'FINANCE_BANKER_WRITES_NOT_ENABLED')
  END;
END;--> statement-breakpoint
DROP TRIGGER `life_check_records_insert_guard`;--> statement-breakpoint
CREATE TRIGGER `life_check_records_insert_guard`
BEFORE INSERT ON `life_check_records`
WHEN NOT EXISTS (
  SELECT 1
  FROM students target
  JOIN classes classroom ON classroom.id = target.class_id
  WHERE target.id = NEW.student_id
    AND target.class_id = NEW.class_id
    AND target.status <> 'excluded'
    AND classroom.status = 'active'
    AND (
      (NEW.last_actor_type = 'teacher'
        AND classroom.teacher_id = NEW.last_actor_teacher_id)
      OR (NEW.last_actor_type = 'checker' AND EXISTS (
        SELECT 1
        FROM student_effective_permissions permission
        WHERE permission.student_id = NEW.last_actor_student_id
          AND permission.class_id = NEW.class_id
          AND permission.permission_key = CASE NEW.check_type
            WHEN 'tooth' THEN 'life_check_tooth'
            WHEN 'milk' THEN 'life_check_milk'
            WHEN 'lunch' THEN 'life_check_lunch'
          END
      ))
    )
)
BEGIN SELECT RAISE(ABORT, 'LIFE_CHECK_RECORD_SCOPE_DENIED'); END;--> statement-breakpoint
DROP TRIGGER `life_check_records_update_guard`;--> statement-breakpoint
CREATE TRIGGER `life_check_records_update_guard`
BEFORE UPDATE ON `life_check_records`
WHEN NEW.id <> OLD.id
  OR NEW.class_id <> OLD.class_id
  OR NEW.check_type <> OLD.check_type
  OR NEW.check_date <> OLD.check_date
  OR NEW.student_id <> OLD.student_id
  OR NEW.created_at <> OLD.created_at
  OR NEW.revision <> OLD.revision + 1
  OR NEW.updated_at < OLD.updated_at
  OR NOT EXISTS (
    SELECT 1
    FROM students target
    JOIN classes classroom ON classroom.id = target.class_id
    WHERE target.id = NEW.student_id
      AND target.class_id = NEW.class_id
      AND target.status <> 'excluded'
      AND classroom.status = 'active'
      AND (
        (NEW.last_actor_type = 'teacher'
          AND classroom.teacher_id = NEW.last_actor_teacher_id)
        OR (NEW.last_actor_type = 'checker' AND EXISTS (
          SELECT 1
          FROM student_effective_permissions permission
          WHERE permission.student_id = NEW.last_actor_student_id
            AND permission.class_id = NEW.class_id
            AND permission.permission_key = CASE NEW.check_type
              WHEN 'tooth' THEN 'life_check_tooth'
              WHEN 'milk' THEN 'life_check_milk'
              WHEN 'lunch' THEN 'life_check_lunch'
            END
        ))
      )
  )
BEGIN SELECT RAISE(ABORT, 'LIFE_CHECK_RECORD_STALE_OR_DENIED'); END;--> statement-breakpoint
DROP TRIGGER `life_check_payouts_insert_guard`;--> statement-breakpoint
CREATE TRIGGER `life_check_payouts_insert_guard`
BEFORE INSERT ON `life_check_payouts`
WHEN json_array_length(NEW.items_json) <> NEW.recipient_count
  OR COALESCE((
    SELECT SUM(CAST(json_extract(item.value, '$.amount') AS INTEGER))
    FROM json_each(NEW.items_json) item
  ), 0) <> NEW.total_amount
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.items_json) item
    WHERE json_type(item.value) <> 'object'
      OR json_type(item.value, '$.studentId') <> 'text'
      OR json_type(item.value, '$.amount') <> 'integer'
      OR CAST(json_extract(item.value, '$.amount') AS INTEGER) <= 0
      OR NOT EXISTS (
        SELECT 1 FROM students student
        WHERE student.id = json_extract(item.value, '$.studentId')
          AND student.class_id = NEW.class_id
          AND student.status <> 'excluded'
      )
  )
  OR NOT EXISTS (
    SELECT 1 FROM classes classroom
    JOIN life_check_series series ON series.class_id = classroom.id
    WHERE classroom.id = NEW.class_id
      AND classroom.status = 'active'
      AND series.check_type = NEW.check_type
      AND series.revision = NEW.source_series_revision
      AND COALESCE((
        SELECT revision FROM class_calendars
        WHERE class_id = NEW.class_id
      ), 0) = NEW.source_calendar_revision
      AND (
        (NEW.created_by_actor_type = 'teacher'
          AND classroom.teacher_id = NEW.created_by_teacher_id)
        OR (NEW.created_by_actor_type = 'checker' AND EXISTS (
          SELECT 1
          FROM student_effective_permissions permission
          WHERE permission.student_id = NEW.created_by_student_id
            AND permission.class_id = NEW.class_id
            AND permission.permission_key = CASE NEW.check_type
              WHEN 'tooth' THEN 'life_check_tooth'
              WHEN 'milk' THEN 'life_check_milk'
              WHEN 'lunch' THEN 'life_check_lunch'
            END
        ))
      )
  )
  OR NEW.last_actor_type <> NEW.created_by_actor_type
  OR NEW.last_actor_teacher_id IS NOT NEW.created_by_teacher_id
  OR NEW.last_actor_student_id IS NOT NEW.created_by_student_id
BEGIN SELECT RAISE(ABORT, 'LIFE_CHECK_PAYOUT_STATE_INVALID'); END;--> statement-breakpoint
DROP TRIGGER `life_check_payouts_update_guard`;--> statement-breakpoint
CREATE TRIGGER `life_check_payouts_update_guard`
BEFORE UPDATE ON `life_check_payouts`
WHEN NEW.id <> OLD.id
  OR NEW.class_id <> OLD.class_id
  OR NEW.check_type <> OLD.check_type
  OR NEW.payout_year <> OLD.payout_year
  OR NEW.payout_month <> OLD.payout_month
  OR NEW.payout_period <> OLD.payout_period
  OR NEW.created_by_actor_type <> OLD.created_by_actor_type
  OR NEW.created_by_teacher_id IS NOT OLD.created_by_teacher_id
  OR NEW.created_by_student_id IS NOT OLD.created_by_student_id
  OR NEW.created_at <> OLD.created_at
  OR NEW.revision <> OLD.revision + 1
  OR NEW.updated_at < OLD.updated_at
  OR NOT (
    (OLD.status = 'prepared' AND NEW.status IN ('prepared', 'completed', 'cancelled'))
    OR (OLD.status IN ('completed', 'cancelled') AND NEW.status = 'prepared')
  )
  OR (OLD.status IN ('completed', 'cancelled')
    AND NEW.status = 'prepared'
    AND NEW.last_actor_type <> 'teacher')
  OR NOT EXISTS (
    SELECT 1 FROM classes classroom
    WHERE classroom.id = NEW.class_id
      AND classroom.status = 'active'
      AND (
        (NEW.last_actor_type = 'teacher'
          AND classroom.teacher_id = NEW.last_actor_teacher_id)
        OR (NEW.last_actor_type = 'checker' AND EXISTS (
          SELECT 1
          FROM student_effective_permissions permission
          WHERE permission.student_id = NEW.last_actor_student_id
            AND permission.class_id = NEW.class_id
            AND permission.permission_key = CASE NEW.check_type
              WHEN 'tooth' THEN 'life_check_tooth'
              WHEN 'milk' THEN 'life_check_milk'
              WHEN 'lunch' THEN 'life_check_lunch'
            END
        ))
      )
  )
  OR (NOT (OLD.status = 'prepared' AND NEW.status = 'prepared') AND (
    NEW.items_json <> OLD.items_json
    OR NEW.recipient_count <> OLD.recipient_count
    OR NEW.total_amount <> OLD.total_amount
    OR NEW.source_series_revision <> OLD.source_series_revision
    OR NEW.source_calendar_revision <> OLD.source_calendar_revision
  ))
  OR json_array_length(NEW.items_json) <> NEW.recipient_count
  OR COALESCE((
    SELECT SUM(CAST(json_extract(item.value, '$.amount') AS INTEGER))
    FROM json_each(NEW.items_json) item
  ), 0) <> NEW.total_amount
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.items_json) item
    WHERE json_type(item.value) <> 'object'
      OR json_type(item.value, '$.studentId') <> 'text'
      OR json_type(item.value, '$.amount') <> 'integer'
      OR CAST(json_extract(item.value, '$.amount') AS INTEGER) <= 0
      OR ((NEW.status = 'completed'
        OR NEW.items_json <> OLD.items_json
        OR NEW.source_series_revision <> OLD.source_series_revision
        OR NEW.source_calendar_revision <> OLD.source_calendar_revision)
        AND NOT EXISTS (
        SELECT 1 FROM students student
        WHERE student.id = json_extract(item.value, '$.studentId')
          AND student.class_id = NEW.class_id
          AND student.status <> 'excluded'
      ))
  )
  OR ((NEW.status = 'completed'
    OR NEW.items_json <> OLD.items_json
    OR NEW.source_series_revision <> OLD.source_series_revision
    OR NEW.source_calendar_revision <> OLD.source_calendar_revision)
    AND NOT EXISTS (
    SELECT 1 FROM life_check_series series
    WHERE series.class_id = NEW.class_id
      AND series.check_type = NEW.check_type
      AND series.revision = NEW.source_series_revision
  ))
  OR ((NEW.status = 'completed'
    OR NEW.items_json <> OLD.items_json
    OR NEW.source_calendar_revision <> OLD.source_calendar_revision)
    AND COALESCE((
      SELECT revision FROM class_calendars
      WHERE class_id = NEW.class_id
    ), 0) <> NEW.source_calendar_revision)
  OR (NEW.status = 'completed' AND (
    NEW.completed_by_actor_type <> NEW.last_actor_type
    OR NEW.completed_by_teacher_id IS NOT NEW.last_actor_teacher_id
    OR NEW.completed_by_student_id IS NOT NEW.last_actor_student_id
  ))
BEGIN SELECT RAISE(ABORT, 'LIFE_CHECK_PAYOUT_STALE_OR_INVALID'); END;--> statement-breakpoint
DROP TRIGGER `life_check_payout_events_insert_guard`;--> statement-breakpoint
CREATE TRIGGER `life_check_payout_events_insert_guard`
BEFORE INSERT ON `life_check_payout_events`
WHEN NOT EXISTS (
  SELECT 1
  FROM life_check_payouts payout
  JOIN classes classroom ON classroom.id = payout.class_id
  WHERE payout.id = NEW.payout_id
    AND payout.class_id = NEW.class_id
    AND classroom.status = 'active'
    AND NEW.created_at = payout.updated_at
    AND payout.last_actor_type = NEW.actor_type
    AND payout.last_actor_teacher_id IS NEW.actor_teacher_id
    AND payout.last_actor_student_id IS NEW.actor_student_id
    AND CAST(json_extract(NEW.detail, '$.revision') AS INTEGER) = payout.revision
    AND json(json_extract(NEW.detail, '$.items')) = json(payout.items_json)
    AND (
      (NEW.action IN ('prepared', 'refreshed', 'reopened') AND payout.status = 'prepared')
      OR (NEW.action = 'completed' AND payout.status = 'completed')
      OR (NEW.action = 'cancelled' AND payout.status = 'cancelled')
    )
    AND (NEW.action <> 'reopened' OR NEW.actor_type = 'teacher')
    AND (
      (NEW.actor_type = 'teacher' AND classroom.teacher_id = NEW.actor_teacher_id)
      OR (NEW.actor_type = 'checker' AND EXISTS (
        SELECT 1
        FROM student_effective_permissions permission
        WHERE permission.student_id = NEW.actor_student_id
          AND permission.class_id = NEW.class_id
          AND permission.permission_key = CASE payout.check_type
            WHEN 'tooth' THEN 'life_check_tooth'
            WHEN 'milk' THEN 'life_check_milk'
            WHEN 'lunch' THEN 'life_check_lunch'
          END
      ))
    )
)
BEGIN SELECT RAISE(ABORT, 'LIFE_CHECK_PAYOUT_EVENT_STATE_INVALID'); END;
