CREATE TABLE `finance_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`student_id` text,
	`account_type` text NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`allow_negative` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_accounts_status_ck" CHECK("finance_accounts"."status" IN ('active', 'frozen', 'closed')),
	CONSTRAINT "finance_accounts_type_ck" CHECK("finance_accounts"."account_type" IN ('student_wallet', 'class_issuance')),
	CONSTRAINT "finance_accounts_revision_ck" CHECK("finance_accounts"."revision" >= 0),
	CONSTRAINT "finance_accounts_allow_negative_ck" CHECK("finance_accounts"."allow_negative" IN (0, 1)),
	CONSTRAINT "finance_accounts_balance_ck" CHECK("finance_accounts"."allow_negative" = 1 OR "finance_accounts"."balance" >= 0),
	CONSTRAINT "finance_accounts_student_wallet_ck" CHECK("finance_accounts"."account_type" <> 'student_wallet'
      OR ("finance_accounts"."student_id" IS NOT NULL AND "finance_accounts"."allow_negative" = 0)),
	CONSTRAINT "finance_accounts_class_issuance_ck" CHECK("finance_accounts"."account_type" <> 'class_issuance'
      OR ("finance_accounts"."student_id" IS NULL AND "finance_accounts"."allow_negative" = 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_accounts_class_student_type_uq` ON `finance_accounts` (`class_id`,`student_id`,`account_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_accounts_class_issuance_uq` ON `finance_accounts` (`class_id`) WHERE `account_type` = 'class_issuance';--> statement-breakpoint
CREATE UNIQUE INDEX `finance_accounts_id_class_uq` ON `finance_accounts` (`id`,`class_id`);--> statement-breakpoint
CREATE INDEX `finance_accounts_class_type_idx` ON `finance_accounts` (`class_id`,`account_type`,`status`);--> statement-breakpoint
CREATE INDEX `finance_accounts_student_idx` ON `finance_accounts` (`student_id`);--> statement-breakpoint
CREATE TABLE `finance_ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`class_id` text NOT NULL,
	`account_id` text NOT NULL,
	`amount` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`account_revision_after` integer NOT NULL,
	`memo` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`transaction_id`,`class_id`) REFERENCES `finance_transactions`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`,`class_id`) REFERENCES `finance_accounts`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_ledger_entries_amount_ck" CHECK("finance_ledger_entries"."amount" <> 0),
	CONSTRAINT "finance_ledger_entries_revision_ck" CHECK("finance_ledger_entries"."account_revision_after" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_ledger_entries_transaction_account_uq` ON `finance_ledger_entries` (`transaction_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `finance_ledger_entries_account_idx` ON `finance_ledger_entries` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `finance_ledger_entries_class_idx` ON `finance_ledger_entries` (`class_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `finance_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`transaction_type` text NOT NULL,
	`description` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`source_type` text,
	`source_id` text,
	`reversal_of_transaction_id` text,
	`actor_type` text NOT NULL,
	`actor_teacher_id` text,
	`actor_student_id` text,
	`actor_job_period_id` text,
	`actor_label` text NOT NULL,
	`metadata_json` text,
	`created_at` integer NOT NULL,
	`posted_at` integer,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_job_period_id`) REFERENCES `class_job_assignment_periods`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_transactions_status_ck" CHECK("finance_transactions"."status" IN ('pending', 'posted')),
	CONSTRAINT "finance_transactions_source_ck" CHECK(("finance_transactions"."source_type" IS NULL) = ("finance_transactions"."source_id" IS NULL)),
	CONSTRAINT "finance_transactions_reversal_ck" CHECK(("finance_transactions"."transaction_type" = 'reversal') = ("finance_transactions"."reversal_of_transaction_id" IS NOT NULL)),
	CONSTRAINT "finance_transactions_actor_ck" CHECK((
      ("finance_transactions"."actor_type" = 'teacher'
        AND "finance_transactions"."actor_teacher_id" IS NOT NULL
        AND "finance_transactions"."actor_student_id" IS NULL
        AND "finance_transactions"."actor_job_period_id" IS NULL)
      OR
      ("finance_transactions"."actor_type" = 'banker'
        AND "finance_transactions"."actor_teacher_id" IS NULL
        AND "finance_transactions"."actor_student_id" IS NOT NULL
        AND "finance_transactions"."actor_job_period_id" IS NOT NULL)
      OR
      ("finance_transactions"."actor_type" = 'system'
        AND "finance_transactions"."actor_teacher_id" IS NULL
        AND "finance_transactions"."actor_student_id" IS NULL
        AND "finance_transactions"."actor_job_period_id" IS NULL)
    ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_transactions_class_idempotency_uq` ON `finance_transactions` (`class_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_transactions_class_source_uq` ON `finance_transactions` (`class_id`,`source_type`,`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_transactions_reversal_uq` ON `finance_transactions` (`reversal_of_transaction_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_transactions_id_class_uq` ON `finance_transactions` (`id`,`class_id`);--> statement-breakpoint
CREATE INDEX `finance_transactions_class_posted_idx` ON `finance_transactions` (`class_id`,`status`,`posted_at`);--> statement-breakpoint
CREATE INDEX `finance_transactions_actor_student_idx` ON `finance_transactions` (`actor_student_id`,`posted_at`);--> statement-breakpoint
CREATE TRIGGER `finance_accounts_student_class_guard`
BEFORE INSERT ON `finance_accounts`
WHEN NEW.account_type = 'student_wallet'
  AND NOT EXISTS (
    SELECT 1 FROM students
    WHERE students.id = NEW.student_id
      AND students.class_id = NEW.class_id
  )
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_ACCOUNT_STUDENT_CLASS_MISMATCH');
END;--> statement-breakpoint
CREATE TRIGGER `finance_transactions_insert_pending_only`
BEFORE INSERT ON `finance_transactions`
WHEN NEW.status <> 'pending' OR NEW.posted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_TRANSACTION_MUST_START_PENDING');
END;--> statement-breakpoint
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
        FROM class_job_assignment_periods period
        JOIN student_job_assignments assignment
          ON assignment.period_id = period.id
         AND assignment.class_id = period.class_id
         AND assignment.student_id = NEW.actor_student_id
        JOIN class_jobs job
          ON job.id = assignment.class_job_id
         AND job.class_id = assignment.class_id
         AND job.template_id = 'banker'
         AND job.is_active = 1
        JOIN students student
          ON student.id = assignment.student_id
         AND student.class_id = assignment.class_id
         AND student.status = 'active'
        WHERE period.id = NEW.actor_job_period_id
          AND period.class_id = NEW.class_id
          AND period.status = 'confirmed'
          AND period.assignment_type IN ('initial', 'monthly')
          AND (
            period.assignment_year < CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER)
            OR (
              period.assignment_year = CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER)
              AND period.assignment_month
                <= CAST(strftime('%m', 'now', '+9 hours') AS INTEGER)
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
                  AND newer.assignment_month
                    <= CAST(strftime('%m', 'now', '+9 hours') AS INTEGER)
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
          )
      )
    THEN RAISE(ABORT, 'FINANCE_BANKER_ACCESS_DENIED')
  END;
  SELECT CASE
    WHEN NEW.actor_type = 'banker'
    THEN RAISE(ABORT, 'FINANCE_BANKER_WRITES_NOT_ENABLED')
  END;
END;--> statement-breakpoint
CREATE TRIGGER `finance_transactions_identity_immutable`
BEFORE UPDATE OF
  id, class_id, transaction_type, description, idempotency_key, payload_hash,
  source_type, source_id, reversal_of_transaction_id, actor_type,
  actor_teacher_id, actor_student_id, actor_job_period_id, actor_label,
  metadata_json, created_at
ON `finance_transactions`
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_TRANSACTION_IMMUTABLE');
END;--> statement-breakpoint
CREATE TRIGGER `finance_transactions_status_transition_guard`
BEFORE UPDATE OF status, posted_at ON `finance_transactions`
WHEN OLD.status <> 'pending' OR NEW.status <> 'posted' OR NEW.posted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_TRANSACTION_INVALID_TRANSITION');
END;--> statement-breakpoint
CREATE TRIGGER `finance_transactions_posting_guard`
BEFORE UPDATE OF status ON `finance_transactions`
WHEN OLD.status = 'pending' AND NEW.status = 'posted'
BEGIN
  SELECT CASE
    WHEN (SELECT COUNT(*) FROM finance_ledger_entries WHERE transaction_id = NEW.id) < 2
    THEN RAISE(ABORT, 'FINANCE_TRANSACTION_NEEDS_TWO_ENTRIES')
  END;
  SELECT CASE
    WHEN COALESCE((
      SELECT SUM(amount) FROM finance_ledger_entries WHERE transaction_id = NEW.id
    ), 0) <> 0
    THEN RAISE(ABORT, 'FINANCE_TRANSACTION_UNBALANCED')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM finance_ledger_entries entry
      JOIN finance_accounts account
        ON account.id = entry.account_id
       AND account.class_id = entry.class_id
      WHERE entry.transaction_id = NEW.id
        AND account.status <> 'active'
    )
    THEN RAISE(ABORT, 'FINANCE_ACCOUNT_NOT_ACTIVE')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM finance_ledger_entries entry
      JOIN finance_accounts account
        ON account.id = entry.account_id
       AND account.class_id = entry.class_id
      WHERE entry.transaction_id = NEW.id
        AND (
          entry.balance_after <> account.balance + entry.amount
          OR entry.account_revision_after <> account.revision + 1
        )
    )
    THEN RAISE(ABORT, 'FINANCE_ACCOUNT_STALE')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM finance_ledger_entries entry
      JOIN finance_accounts account
        ON account.id = entry.account_id
       AND account.class_id = entry.class_id
      WHERE entry.transaction_id = NEW.id
        AND account.allow_negative = 0
        AND entry.balance_after < 0
    )
    THEN RAISE(ABORT, 'FINANCE_INSUFFICIENT_FUNDS')
  END;
  SELECT CASE
    WHEN NEW.reversal_of_transaction_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM finance_transactions original
        WHERE original.id = NEW.reversal_of_transaction_id
          AND original.class_id = NEW.class_id
          AND original.status = 'posted'
      )
    THEN RAISE(ABORT, 'FINANCE_REVERSAL_ORIGINAL_NOT_FOUND')
  END;
  SELECT CASE
    WHEN NEW.reversal_of_transaction_id IS NOT NULL
      AND (
        (SELECT COUNT(*) FROM finance_ledger_entries WHERE transaction_id = NEW.id)
          <> (SELECT COUNT(*) FROM finance_ledger_entries
              WHERE transaction_id = NEW.reversal_of_transaction_id)
        OR EXISTS (
          SELECT 1
          FROM finance_ledger_entries original_entry
          WHERE original_entry.transaction_id = NEW.reversal_of_transaction_id
            AND NOT EXISTS (
              SELECT 1
              FROM finance_ledger_entries reversal_entry
              WHERE reversal_entry.transaction_id = NEW.id
                AND reversal_entry.account_id = original_entry.account_id
                AND reversal_entry.amount = -original_entry.amount
            )
        )
      )
    THEN RAISE(ABORT, 'FINANCE_REVERSAL_MISMATCH')
  END;
END;--> statement-breakpoint
CREATE TRIGGER `finance_transactions_posted_delete_guard`
BEFORE DELETE ON `finance_transactions`
WHEN OLD.status = 'posted'
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_TRANSACTION_IMMUTABLE');
END;--> statement-breakpoint
CREATE TRIGGER `finance_ledger_entries_insert_guard`
BEFORE INSERT ON `finance_ledger_entries`
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM finance_transactions transaction_row
      WHERE transaction_row.id = NEW.transaction_id
        AND transaction_row.class_id = NEW.class_id
        AND transaction_row.status = 'pending'
    )
    THEN RAISE(ABORT, 'FINANCE_TRANSACTION_NOT_PENDING')
  END;
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM finance_accounts account
      WHERE account.id = NEW.account_id AND account.class_id = NEW.class_id
    )
    THEN RAISE(ABORT, 'FINANCE_ACCOUNT_NOT_FOUND')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM finance_accounts account
      WHERE account.id = NEW.account_id
        AND account.class_id = NEW.class_id
        AND account.status <> 'active'
    )
    THEN RAISE(ABORT, 'FINANCE_ACCOUNT_NOT_ACTIVE')
  END;
  SELECT CASE
    WHEN NEW.balance_after <> (
      SELECT account.balance + NEW.amount
      FROM finance_accounts account
      WHERE account.id = NEW.account_id AND account.class_id = NEW.class_id
    )
    THEN RAISE(ABORT, 'FINANCE_ACCOUNT_STALE')
  END;
  SELECT CASE
    WHEN NEW.account_revision_after <> (
      SELECT account.revision + 1
      FROM finance_accounts account
      WHERE account.id = NEW.account_id AND account.class_id = NEW.class_id
    )
    THEN RAISE(ABORT, 'FINANCE_ACCOUNT_STALE')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM finance_accounts account
      WHERE account.id = NEW.account_id
        AND account.class_id = NEW.class_id
        AND account.allow_negative = 0
        AND NEW.balance_after < 0
    )
    THEN RAISE(ABORT, 'FINANCE_INSUFFICIENT_FUNDS')
  END;
END;--> statement-breakpoint
CREATE TRIGGER `finance_transactions_apply_posted_balances`
AFTER UPDATE OF status ON `finance_transactions`
WHEN OLD.status = 'pending' AND NEW.status = 'posted'
BEGIN
  UPDATE finance_accounts
  SET balance = (
        SELECT entry.balance_after
        FROM finance_ledger_entries entry
        WHERE entry.transaction_id = NEW.id
          AND entry.account_id = finance_accounts.id
      ),
      revision = (
        SELECT entry.account_revision_after
        FROM finance_ledger_entries entry
        WHERE entry.transaction_id = NEW.id
          AND entry.account_id = finance_accounts.id
      ),
      updated_at = NEW.posted_at
  WHERE class_id = NEW.class_id
    AND id IN (
      SELECT account_id
      FROM finance_ledger_entries
      WHERE transaction_id = NEW.id
    );
END;--> statement-breakpoint
CREATE TRIGGER `finance_ledger_entries_update_guard`
BEFORE UPDATE ON `finance_ledger_entries`
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_LEDGER_IMMUTABLE');
END;--> statement-breakpoint
CREATE TRIGGER `finance_ledger_entries_delete_guard`
BEFORE DELETE ON `finance_ledger_entries`
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_LEDGER_IMMUTABLE');
END;--> statement-breakpoint
CREATE TRIGGER `finance_accounts_identity_guard`
BEFORE UPDATE OF id, class_id, student_id, account_type, allow_negative, created_at
ON `finance_accounts`
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_ACCOUNT_IDENTITY_IMMUTABLE');
END;--> statement-breakpoint
CREATE TRIGGER `finance_accounts_projection_guard`
BEFORE UPDATE OF balance, revision ON `finance_accounts`
WHEN NEW.balance <> COALESCE((
    SELECT SUM(entry.amount)
    FROM finance_ledger_entries entry
    JOIN finance_transactions transaction_row
      ON transaction_row.id = entry.transaction_id
     AND transaction_row.status = 'posted'
    WHERE entry.account_id = NEW.id
  ), 0)
  OR NEW.revision <> (
    SELECT COUNT(*)
    FROM finance_ledger_entries entry
    JOIN finance_transactions transaction_row
      ON transaction_row.id = entry.transaction_id
     AND transaction_row.status = 'posted'
    WHERE entry.account_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_ACCOUNT_LEDGER_MISMATCH');
END;--> statement-breakpoint
CREATE TRIGGER `finance_classes_create_issuance_account`
AFTER INSERT ON `classes`
BEGIN
  INSERT OR IGNORE INTO finance_accounts (
    id, class_id, student_id, account_type, balance, allow_negative,
    status, revision, created_at, updated_at
  ) VALUES (
    'finance:class:' || NEW.id || ':issuance',
    NEW.id,
    NULL,
    'class_issuance',
    0,
    1,
    CASE WHEN NEW.status = 'active' THEN 'active' ELSE 'closed' END
    ,
    0,
    NEW.created_at,
    NEW.updated_at
  );
END;--> statement-breakpoint
CREATE TRIGGER `finance_students_create_wallet_account`
AFTER INSERT ON `students`
BEGIN
  INSERT OR IGNORE INTO finance_accounts (
    id, class_id, student_id, account_type, balance, allow_negative,
    status, revision, created_at, updated_at
  ) VALUES (
    'finance:student:' || NEW.id || ':wallet',
    NEW.class_id,
    NEW.id,
    'student_wallet',
    0,
    0,
    CASE
      WHEN NEW.status <> 'excluded'
        AND EXISTS (SELECT 1 FROM classes WHERE id = NEW.class_id AND status = 'active')
      THEN 'active'
      WHEN NEW.status = 'excluded'
        AND EXISTS (SELECT 1 FROM classes WHERE id = NEW.class_id AND status = 'active')
      THEN 'frozen'
      ELSE 'closed'
    END
    ,
    0,
    NEW.created_at,
    NEW.updated_at
  );
END;--> statement-breakpoint
CREATE TRIGGER `finance_students_sync_wallet_status`
AFTER UPDATE OF status ON `students`
BEGIN
  UPDATE finance_accounts
  SET status = CASE
      WHEN NEW.status <> 'excluded'
        AND EXISTS (SELECT 1 FROM classes WHERE id = NEW.class_id AND status = 'active')
      THEN 'active'
      WHEN NEW.status = 'excluded'
        AND EXISTS (SELECT 1 FROM classes WHERE id = NEW.class_id AND status = 'active')
      THEN 'frozen'
      ELSE 'closed'
    END
    ,
    updated_at = NEW.updated_at
  WHERE student_id = NEW.id AND account_type = 'student_wallet';
END;--> statement-breakpoint
CREATE TRIGGER `finance_classes_sync_account_status`
AFTER UPDATE OF status ON `classes`
BEGIN
  UPDATE finance_accounts
  SET status = CASE
      WHEN NEW.status = 'active'
        AND student_id IS NULL
      THEN 'active'
      WHEN NEW.status = 'active'
        AND EXISTS (
          SELECT 1 FROM students
          WHERE students.id = finance_accounts.student_id
            AND students.status <> 'excluded'
        )
      THEN 'active'
      WHEN NEW.status = 'active'
        AND EXISTS (
          SELECT 1 FROM students
          WHERE students.id = finance_accounts.student_id
            AND students.status = 'excluded'
        )
      THEN 'frozen'
      ELSE 'closed'
    END
    ,
    updated_at = NEW.updated_at
  WHERE class_id = NEW.id;
END;--> statement-breakpoint
INSERT OR IGNORE INTO finance_accounts (
  id, class_id, student_id, account_type, balance, allow_negative,
  status, revision, created_at, updated_at
)
SELECT
  'finance:class:' || class_row.id || ':issuance',
  class_row.id,
  NULL,
  'class_issuance',
  0,
  1,
  CASE WHEN class_row.status = 'active' THEN 'active' ELSE 'closed' END
  ,
  0,
  class_row.created_at,
  class_row.updated_at
FROM classes class_row;--> statement-breakpoint
INSERT OR IGNORE INTO finance_accounts (
  id, class_id, student_id, account_type, balance, allow_negative,
  status, revision, created_at, updated_at
)
SELECT
  'finance:student:' || student.id || ':wallet',
  student.class_id,
  student.id,
  'student_wallet',
  0,
  0,
  CASE
    WHEN student.status <> 'excluded' AND class_row.status = 'active' THEN 'active'
    WHEN student.status = 'excluded' AND class_row.status = 'active' THEN 'frozen'
    ELSE 'closed'
  END
  ,
  0,
  student.created_at,
  student.updated_at
FROM students student
JOIN classes class_row ON class_row.id = student.class_id;
