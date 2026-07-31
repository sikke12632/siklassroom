CREATE TABLE IF NOT EXISTS `finance_cash_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`requester_student_id` text NOT NULL,
	`wallet_account_id` text NOT NULL,
	`request_type` text NOT NULL,
	`amount` integer NOT NULL,
	`memo` text,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`student_number_snapshot` integer NOT NULL,
	`student_name_snapshot` text NOT NULL,
	`wallet_balance_snapshot` integer NOT NULL,
	`wallet_revision_snapshot` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requester_student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`wallet_account_id`,`class_id`) REFERENCES `finance_accounts`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_cash_requests_type_ck" CHECK("finance_cash_requests"."request_type" IN ('deposit', 'withdrawal')),
	CONSTRAINT "finance_cash_requests_amount_ck" CHECK("finance_cash_requests"."amount" > 0 AND "finance_cash_requests"."amount" <= 1000000000),
	CONSTRAINT "finance_cash_requests_wallet_snapshot_ck" CHECK("finance_cash_requests"."wallet_balance_snapshot" >= 0 AND "finance_cash_requests"."wallet_revision_snapshot" >= 0),
	CONSTRAINT "finance_cash_requests_revision_ck" CHECK("finance_cash_requests"."revision" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `finance_cash_requests_class_student_idempotency_uq` ON `finance_cash_requests` (`class_id`,`requester_student_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `finance_cash_requests_id_class_uq` ON `finance_cash_requests` (`id`,`class_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_cash_requests_class_created_idx` ON `finance_cash_requests` (`class_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_cash_requests_student_created_idx` ON `finance_cash_requests` (`requester_student_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `finance_request_resolutions` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`class_id` text NOT NULL,
	`decision` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`expected_request_revision` integer NOT NULL,
	`actor_type` text NOT NULL,
	`actor_teacher_id` text,
	`actor_student_id` text,
	`actor_job_period_id` text,
	`actor_label` text NOT NULL,
	`reason_code` text,
	`reason_note` text,
	`intervention_reason` text,
	`is_emergency` integer DEFAULT false NOT NULL,
	`posted_transaction_id` text,
	`transaction_payload_hash` text,
	`resolved_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_job_period_id`) REFERENCES `class_job_assignment_periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`request_id`,`class_id`) REFERENCES `finance_cash_requests`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`posted_transaction_id`,`class_id`) REFERENCES `finance_transactions`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_request_resolutions_decision_ck" CHECK("finance_request_resolutions"."decision" IN ('approved', 'rejected', 'cancelled')),
	CONSTRAINT "finance_request_resolutions_actor_ck" CHECK((
      ("finance_request_resolutions"."actor_type" = 'banker'
        AND "finance_request_resolutions"."actor_teacher_id" IS NULL
        AND "finance_request_resolutions"."actor_student_id" IS NOT NULL
        AND "finance_request_resolutions"."actor_job_period_id" IS NOT NULL
        AND "finance_request_resolutions"."is_emergency" = 0)
      OR
      ("finance_request_resolutions"."actor_type" = 'teacher'
        AND "finance_request_resolutions"."actor_teacher_id" IS NOT NULL
        AND "finance_request_resolutions"."actor_student_id" IS NULL
        AND "finance_request_resolutions"."actor_job_period_id" IS NULL
        AND "finance_request_resolutions"."is_emergency" = 1)
      OR
      ("finance_request_resolutions"."actor_type" = 'student'
        AND "finance_request_resolutions"."actor_teacher_id" IS NULL
        AND "finance_request_resolutions"."actor_student_id" IS NOT NULL
        AND "finance_request_resolutions"."actor_job_period_id" IS NULL
        AND "finance_request_resolutions"."is_emergency" = 0)
    )),
	CONSTRAINT "finance_request_resolutions_transaction_ck" CHECK((
      ("finance_request_resolutions"."decision" = 'approved'
        AND "finance_request_resolutions"."posted_transaction_id" IS NOT NULL
        AND "finance_request_resolutions"."transaction_payload_hash" IS NOT NULL)
      OR
      ("finance_request_resolutions"."decision" IN ('rejected', 'cancelled')
        AND "finance_request_resolutions"."posted_transaction_id" IS NULL
        AND "finance_request_resolutions"."transaction_payload_hash" IS NULL)
    )),
	CONSTRAINT "finance_request_resolutions_note_ck" CHECK(("finance_request_resolutions"."decision" <> 'rejected'
        OR LENGTH(TRIM(COALESCE("finance_request_resolutions"."reason_code", ''))) > 0
        OR LENGTH(TRIM(COALESCE("finance_request_resolutions"."reason_note", ''))) > 0)
      AND ("finance_request_resolutions"."actor_type" <> 'teacher'
        OR LENGTH(TRIM(COALESCE("finance_request_resolutions"."intervention_reason", ''))) > 0)),
	CONSTRAINT "finance_request_resolutions_expected_revision_ck" CHECK("finance_request_resolutions"."expected_request_revision" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `finance_request_resolutions_request_uq` ON `finance_request_resolutions` (`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `finance_request_resolutions_class_idempotency_uq` ON `finance_request_resolutions` (`class_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `finance_request_resolutions_posted_transaction_uq` ON `finance_request_resolutions` (`posted_transaction_id`) WHERE "finance_request_resolutions"."posted_transaction_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_request_resolutions_class_resolved_idx` ON `finance_request_resolutions` (`class_id`,`resolved_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_request_resolutions_actor_student_idx` ON `finance_request_resolutions` (`actor_student_id`,`resolved_at`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_cash_requests_insert_guard`
BEFORE INSERT ON `finance_cash_requests`
BEGIN
  SELECT CASE
    WHEN NEW.revision <> 0
    THEN RAISE(ABORT, 'FINANCE_REQUEST_INVALID_REVISION')
  END;
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM classes classroom
      JOIN students student
        ON student.class_id = classroom.id
       AND student.id = NEW.requester_student_id
      JOIN finance_accounts account
        ON account.id = NEW.wallet_account_id
       AND account.class_id = classroom.id
       AND account.student_id = student.id
       AND account.account_type = 'student_wallet'
      WHERE classroom.id = NEW.class_id
        AND classroom.status = 'active'
        AND student.status = 'active'
        AND account.status = 'active'
        AND student.student_number = NEW.student_number_snapshot
        AND student.official_name = NEW.student_name_snapshot
        AND account.balance = NEW.wallet_balance_snapshot
        AND account.revision = NEW.wallet_revision_snapshot
    )
    THEN RAISE(ABORT, 'FINANCE_REQUEST_CONTEXT_STALE')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM finance_cash_requests existing_request
      WHERE existing_request.class_id = NEW.class_id
        AND existing_request.requester_student_id = NEW.requester_student_id
        AND NOT EXISTS (
          SELECT 1
          FROM finance_request_resolutions existing_resolution
          WHERE existing_resolution.request_id = existing_request.id
        )
    )
    THEN RAISE(ABORT, 'FINANCE_REQUEST_PENDING_EXISTS')
  END;
  SELECT CASE
    WHEN NEW.request_type = 'withdrawal'
      AND NEW.amount > (
        SELECT account.balance
        FROM finance_accounts account
        WHERE account.id = NEW.wallet_account_id
          AND account.class_id = NEW.class_id
      )
    THEN RAISE(ABORT, 'FINANCE_WITHDRAWAL_AVAILABLE_BALANCE')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_cash_requests_update_guard`
BEFORE UPDATE ON `finance_cash_requests`
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_REQUEST_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_cash_requests_delete_guard`
BEFORE DELETE ON `finance_cash_requests`
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_REQUEST_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_request_resolutions_insert_guard`
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
          SELECT 1
          FROM finance_request_resolutions prior
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
          SELECT 1
          FROM finance_cash_requests request_row
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
        SELECT 1
        FROM classes classroom
        WHERE classroom.id = NEW.class_id
          AND classroom.teacher_id = NEW.actor_teacher_id
          AND classroom.status = 'active'
      )
    THEN RAISE(ABORT, 'FINANCE_CLASS_ACCESS_DENIED')
  END;
  SELECT CASE
    WHEN NEW.actor_type = 'banker'
      AND EXISTS (
        SELECT 1
        FROM finance_cash_requests request_row
        WHERE request_row.id = NEW.request_id
          AND request_row.requester_student_id = NEW.actor_student_id
      )
    THEN RAISE(ABORT, 'FINANCE_REQUEST_SELF_APPROVAL_DENIED')
  END;
  SELECT CASE
    WHEN NEW.actor_type = 'banker'
      AND NOT (
        NEW.actor_job_period_id = (
          SELECT period.id
          FROM class_job_assignment_periods period
          WHERE period.class_id = NEW.class_id
            AND period.status = 'confirmed'
            AND period.assignment_type IN ('initial', 'monthly')
            AND (
              period.assignment_year
                < CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER)
              OR (
                period.assignment_year
                  = CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER)
                AND period.assignment_month
                  <= CAST(strftime('%m', 'now', '+9 hours') AS INTEGER)
              )
            )
          ORDER BY period.assignment_year DESC, period.assignment_month DESC,
                   COALESCE(period.confirmed_at, 0) DESC,
                   period.updated_at DESC, period.id DESC
          LIMIT 1
        )
        AND EXISTS (
          SELECT 1
          FROM student_job_assignments assignment
          JOIN class_jobs job
            ON job.id = assignment.class_job_id
           AND job.class_id = assignment.class_id
           AND job.template_id = 'banker'
           AND job.is_active = 1
          JOIN students student
            ON student.id = assignment.student_id
           AND student.class_id = assignment.class_id
           AND student.status = 'active'
          WHERE assignment.period_id = NEW.actor_job_period_id
            AND assignment.class_id = NEW.class_id
            AND assignment.student_id = NEW.actor_student_id
        )
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
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_request_resolutions_update_guard`
BEFORE UPDATE ON `finance_request_resolutions`
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_REQUEST_RESOLUTION_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_request_resolutions_delete_guard`
BEFORE DELETE ON `finance_request_resolutions`
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_REQUEST_RESOLUTION_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_transactions_cash_request_scope_guard`
BEFORE INSERT ON `finance_transactions`
WHEN NEW.actor_type = 'banker' OR NEW.source_type = 'cash_request'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM finance_request_resolutions resolution
      JOIN finance_cash_requests request_row
        ON request_row.id = resolution.request_id
       AND request_row.class_id = resolution.class_id
      WHERE resolution.decision = 'approved'
        AND resolution.posted_transaction_id = NEW.id
        AND resolution.class_id = NEW.class_id
        AND NEW.source_type = 'cash_request'
        AND NEW.source_id = request_row.id
        AND NEW.idempotency_key =
            'cash-request:' || request_row.id || ':approved'
        AND NEW.transaction_type = CASE request_row.request_type
          WHEN 'deposit' THEN 'cash_deposit'
          ELSE 'cash_withdrawal'
        END
        AND NEW.payload_hash = resolution.transaction_payload_hash
        AND NEW.actor_type = resolution.actor_type
        AND NEW.actor_teacher_id IS resolution.actor_teacher_id
        AND NEW.actor_student_id IS resolution.actor_student_id
        AND NEW.actor_job_period_id IS resolution.actor_job_period_id
    )
    THEN RAISE(ABORT, 'FINANCE_BANKER_SCOPE_DENIED')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_transactions_cash_request_posting_guard`
BEFORE UPDATE OF status ON `finance_transactions`
WHEN OLD.status = 'pending' AND NEW.status = 'posted'
  AND NEW.source_type = 'cash_request'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM finance_request_resolutions resolution
      JOIN finance_cash_requests request_row
        ON request_row.id = resolution.request_id
       AND request_row.class_id = resolution.class_id
      WHERE resolution.posted_transaction_id = NEW.id
        AND resolution.decision = 'approved'
        AND resolution.class_id = NEW.class_id
        AND NEW.source_id = request_row.id
        AND (
          SELECT COUNT(*)
          FROM finance_ledger_entries entry
          WHERE entry.transaction_id = NEW.id
        ) = 2
        AND EXISTS (
          SELECT 1
          FROM finance_ledger_entries wallet_entry
          WHERE wallet_entry.transaction_id = NEW.id
            AND wallet_entry.class_id = NEW.class_id
            AND wallet_entry.account_id = request_row.wallet_account_id
            AND wallet_entry.amount = CASE request_row.request_type
              WHEN 'deposit' THEN request_row.amount
              ELSE -request_row.amount
            END
        )
        AND EXISTS (
          SELECT 1
          FROM finance_ledger_entries issuance_entry
          JOIN finance_accounts issuance
            ON issuance.id = issuance_entry.account_id
           AND issuance.class_id = issuance_entry.class_id
           AND issuance.account_type = 'class_issuance'
          WHERE issuance_entry.transaction_id = NEW.id
            AND issuance_entry.class_id = NEW.class_id
            AND issuance_entry.amount = CASE request_row.request_type
              WHEN 'deposit' THEN -request_row.amount
              ELSE request_row.amount
            END
        )
    )
    THEN RAISE(ABORT, 'FINANCE_REQUEST_LEDGER_MISMATCH')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_request_resolutions_apply_approval`
AFTER INSERT ON `finance_request_resolutions`
WHEN NEW.decision = 'approved'
BEGIN
  INSERT INTO finance_transactions (
    id, class_id, status, transaction_type, description,
    idempotency_key, payload_hash, source_type, source_id,
    reversal_of_transaction_id, actor_type, actor_teacher_id,
    actor_student_id, actor_job_period_id, actor_label, metadata_json,
    created_at, posted_at
  )
  SELECT
    NEW.posted_transaction_id, request_row.class_id, 'pending',
    CASE request_row.request_type
      WHEN 'deposit' THEN 'cash_deposit'
      ELSE 'cash_withdrawal'
    END
    ,
    CASE request_row.request_type
      WHEN 'deposit' THEN '입금 신청 승인'
      ELSE '출금 신청 승인'
    END
    ,
    'cash-request:' || request_row.id || ':approved',
    NEW.transaction_payload_hash, 'cash_request', request_row.id,
    NULL, NEW.actor_type, NEW.actor_teacher_id, NEW.actor_student_id,
    NEW.actor_job_period_id, NEW.actor_label, NULL,
    NEW.resolved_at, NULL
  FROM finance_cash_requests request_row
  WHERE request_row.id = NEW.request_id
    AND request_row.class_id = NEW.class_id;

  INSERT INTO finance_ledger_entries (
    id, transaction_id, class_id, account_id, amount,
    balance_after, account_revision_after, memo, created_at
  )
  SELECT
    'finance:resolution:' || NEW.id || ':wallet',
    NEW.posted_transaction_id, request_row.class_id, wallet.id,
    CASE request_row.request_type
      WHEN 'deposit' THEN request_row.amount
      ELSE -request_row.amount
    END
    ,
    wallet.balance + CASE request_row.request_type
      WHEN 'deposit' THEN request_row.amount
      ELSE -request_row.amount
    END
    ,
    wallet.revision + 1, NULL, NEW.resolved_at
  FROM finance_cash_requests request_row
  JOIN finance_accounts wallet
    ON wallet.id = request_row.wallet_account_id
   AND wallet.class_id = request_row.class_id
  WHERE request_row.id = NEW.request_id
    AND request_row.class_id = NEW.class_id;

  INSERT INTO finance_ledger_entries (
    id, transaction_id, class_id, account_id, amount,
    balance_after, account_revision_after, memo, created_at
  )
  SELECT
    'finance:resolution:' || NEW.id || ':issuance',
    NEW.posted_transaction_id, request_row.class_id, issuance.id,
    CASE request_row.request_type
      WHEN 'deposit' THEN -request_row.amount
      ELSE request_row.amount
    END
    ,
    issuance.balance + CASE request_row.request_type
      WHEN 'deposit' THEN -request_row.amount
      ELSE request_row.amount
    END
    ,
    issuance.revision + 1, NULL, NEW.resolved_at
  FROM finance_cash_requests request_row
  JOIN finance_accounts issuance
    ON issuance.class_id = request_row.class_id
   AND issuance.account_type = 'class_issuance'
  WHERE request_row.id = NEW.request_id
    AND request_row.class_id = NEW.class_id;

  UPDATE finance_transactions
  SET status = 'posted', posted_at = NEW.resolved_at
  WHERE id = NEW.posted_transaction_id
    AND class_id = NEW.class_id
    AND status = 'pending';
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `finance_transactions_actor_guard`;
--> statement-breakpoint
CREATE TRIGGER `finance_transactions_actor_guard`
BEFORE INSERT ON `finance_transactions`
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM classes
      WHERE classes.id = NEW.class_id
        AND classes.status = 'active'
    )
    THEN RAISE(ABORT, 'FINANCE_CLASS_NOT_ACTIVE')
  END;
  SELECT CASE
    WHEN NEW.actor_type = 'teacher'
      AND NOT EXISTS (
        SELECT 1
        FROM classes
        WHERE classes.id = NEW.class_id
          AND classes.teacher_id = NEW.actor_teacher_id
          AND classes.status = 'active'
      )
    THEN RAISE(ABORT, 'FINANCE_CLASS_ACCESS_DENIED')
  END;
  SELECT CASE
    WHEN NEW.actor_type = 'banker'
      AND COALESCE(NEW.source_type, '') <> 'cash_request'
    THEN RAISE(ABORT, 'FINANCE_BANKER_WRITES_NOT_ENABLED')
  END;
END;
