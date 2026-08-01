export const FINANCE_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS finance_accounts (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL, student_id TEXT,
    account_type TEXT NOT NULL, balance INTEGER NOT NULL DEFAULT 0,
    allow_negative INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    revision INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (student_id) REFERENCES students(id),
    CONSTRAINT finance_accounts_status_ck
      CHECK (status IN ('active', 'frozen', 'closed')),
    CONSTRAINT finance_accounts_type_ck
      CHECK (account_type IN ('student_wallet', 'class_issuance')),
    CONSTRAINT finance_accounts_revision_ck CHECK (revision >= 0),
    CONSTRAINT finance_accounts_allow_negative_ck
      CHECK (allow_negative IN (0, 1)),
    CONSTRAINT finance_accounts_balance_ck
      CHECK (allow_negative = 1 OR balance >= 0),
    CONSTRAINT finance_accounts_student_wallet_ck
      CHECK (account_type <> 'student_wallet'
        OR (student_id IS NOT NULL AND allow_negative = 0)),
    CONSTRAINT finance_accounts_class_issuance_ck
      CHECK (account_type <> 'class_issuance'
        OR (student_id IS NULL AND allow_negative = 1))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_accounts_class_student_type_uq
    ON finance_accounts(class_id, student_id, account_type)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_accounts_class_issuance_uq
    ON finance_accounts(class_id) WHERE account_type = 'class_issuance'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_accounts_id_class_uq
    ON finance_accounts(id, class_id)`,
  `CREATE INDEX IF NOT EXISTS finance_accounts_class_type_idx
    ON finance_accounts(class_id, account_type, status)`,
  `CREATE INDEX IF NOT EXISTS finance_accounts_student_idx
    ON finance_accounts(student_id)`,
  `CREATE TABLE IF NOT EXISTS finance_transactions (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    transaction_type TEXT NOT NULL, description TEXT NOT NULL,
    idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
    source_type TEXT, source_id TEXT, reversal_of_transaction_id TEXT,
    actor_type TEXT NOT NULL, actor_teacher_id TEXT, actor_student_id TEXT,
    actor_job_period_id TEXT, actor_label TEXT NOT NULL, metadata_json TEXT,
    created_at INTEGER NOT NULL, posted_at INTEGER,
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (actor_teacher_id) REFERENCES teachers(id),
    FOREIGN KEY (actor_student_id) REFERENCES students(id),
    FOREIGN KEY (actor_job_period_id) REFERENCES class_job_assignment_periods(id),
    CONSTRAINT finance_transactions_status_ck
      CHECK (status IN ('pending', 'posted')),
    CONSTRAINT finance_transactions_source_ck
      CHECK ((source_type IS NULL) = (source_id IS NULL)),
    CONSTRAINT finance_transactions_reversal_ck
      CHECK ((transaction_type = 'reversal') = (reversal_of_transaction_id IS NOT NULL)),
    CONSTRAINT finance_transactions_actor_ck CHECK (
      (actor_type = 'teacher'
        AND actor_teacher_id IS NOT NULL
        AND actor_student_id IS NULL
        AND actor_job_period_id IS NULL)
      OR
      (actor_type = 'banker'
        AND actor_teacher_id IS NULL
        AND actor_student_id IS NOT NULL
        AND actor_job_period_id IS NOT NULL)
      OR
      (actor_type = 'system'
        AND actor_teacher_id IS NULL
        AND actor_student_id IS NULL
        AND actor_job_period_id IS NULL)
    )
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_transactions_class_idempotency_uq
    ON finance_transactions(class_id, idempotency_key)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_transactions_class_source_uq
    ON finance_transactions(class_id, source_type, source_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_transactions_reversal_uq
    ON finance_transactions(reversal_of_transaction_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_transactions_id_class_uq
    ON finance_transactions(id, class_id)`,
  `CREATE INDEX IF NOT EXISTS finance_transactions_class_posted_idx
    ON finance_transactions(class_id, status, posted_at)`,
  `CREATE INDEX IF NOT EXISTS finance_transactions_actor_student_idx
    ON finance_transactions(actor_student_id, posted_at)`,
  `CREATE TABLE IF NOT EXISTS finance_ledger_entries (
    id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, class_id TEXT NOT NULL,
    account_id TEXT NOT NULL, amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL, account_revision_after INTEGER NOT NULL,
    memo TEXT, created_at INTEGER NOT NULL,
    FOREIGN KEY (transaction_id, class_id)
      REFERENCES finance_transactions(id, class_id),
    FOREIGN KEY (account_id, class_id)
      REFERENCES finance_accounts(id, class_id),
    CONSTRAINT finance_ledger_entries_amount_ck CHECK (amount <> 0),
    CONSTRAINT finance_ledger_entries_revision_ck CHECK (account_revision_after > 0)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_ledger_entries_transaction_account_uq
    ON finance_ledger_entries(transaction_id, account_id)`,
  `CREATE INDEX IF NOT EXISTS finance_ledger_entries_account_idx
    ON finance_ledger_entries(account_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS finance_ledger_entries_class_idx
    ON finance_ledger_entries(class_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS finance_cash_requests (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL, requester_student_id TEXT NOT NULL,
    wallet_account_id TEXT NOT NULL, request_type TEXT NOT NULL, amount INTEGER NOT NULL,
    memo TEXT, idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
    student_number_snapshot INTEGER NOT NULL, student_name_snapshot TEXT NOT NULL,
    wallet_balance_snapshot INTEGER NOT NULL, wallet_revision_snapshot INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (requester_student_id) REFERENCES students(id),
    FOREIGN KEY (wallet_account_id, class_id) REFERENCES finance_accounts(id, class_id),
    CONSTRAINT finance_cash_requests_type_ck
      CHECK (request_type IN ('deposit', 'withdrawal')),
    CONSTRAINT finance_cash_requests_amount_ck
      CHECK (amount > 0 AND amount <= 1000000000),
    CONSTRAINT finance_cash_requests_wallet_snapshot_ck
      CHECK (wallet_balance_snapshot >= 0 AND wallet_revision_snapshot >= 0),
    CONSTRAINT finance_cash_requests_revision_ck CHECK (revision >= 0)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_cash_requests_class_student_idempotency_uq
    ON finance_cash_requests(class_id, requester_student_id, idempotency_key)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_cash_requests_id_class_uq
    ON finance_cash_requests(id, class_id)`,
  `CREATE INDEX IF NOT EXISTS finance_cash_requests_class_created_idx
    ON finance_cash_requests(class_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS finance_cash_requests_student_created_idx
    ON finance_cash_requests(requester_student_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS finance_request_resolutions (
    id TEXT PRIMARY KEY, request_id TEXT NOT NULL, class_id TEXT NOT NULL,
    decision TEXT NOT NULL, idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
    expected_request_revision INTEGER NOT NULL,
    actor_type TEXT NOT NULL, actor_teacher_id TEXT, actor_student_id TEXT,
    actor_job_period_id TEXT, actor_label TEXT NOT NULL,
    reason_code TEXT, reason_note TEXT, intervention_reason TEXT,
    is_emergency INTEGER NOT NULL DEFAULT 0,
    posted_transaction_id TEXT, transaction_payload_hash TEXT,
    resolved_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
    FOREIGN KEY (request_id, class_id) REFERENCES finance_cash_requests(id, class_id),
    FOREIGN KEY (posted_transaction_id, class_id)
      REFERENCES finance_transactions(id, class_id),
    FOREIGN KEY (actor_teacher_id) REFERENCES teachers(id),
    FOREIGN KEY (actor_student_id) REFERENCES students(id),
    FOREIGN KEY (actor_job_period_id) REFERENCES class_job_assignment_periods(id),
    CONSTRAINT finance_request_resolutions_decision_ck
      CHECK (decision IN ('approved', 'rejected', 'cancelled')),
    CONSTRAINT finance_request_resolutions_actor_ck CHECK (
      (actor_type = 'banker' AND actor_teacher_id IS NULL
        AND actor_student_id IS NOT NULL AND actor_job_period_id IS NOT NULL
        AND is_emergency = 0)
      OR
      (actor_type = 'teacher' AND actor_teacher_id IS NOT NULL
        AND actor_student_id IS NULL AND actor_job_period_id IS NULL
        AND is_emergency = 1)
      OR
      (actor_type = 'student' AND actor_teacher_id IS NULL
        AND actor_student_id IS NOT NULL AND actor_job_period_id IS NULL
        AND is_emergency = 0)
    ),
    CONSTRAINT finance_request_resolutions_transaction_ck CHECK (
      (decision = 'approved' AND posted_transaction_id IS NOT NULL
        AND transaction_payload_hash IS NOT NULL)
      OR
      (decision IN ('rejected', 'cancelled') AND posted_transaction_id IS NULL
        AND transaction_payload_hash IS NULL)
    ),
    CONSTRAINT finance_request_resolutions_note_ck CHECK (
      (decision <> 'rejected'
        OR LENGTH(TRIM(COALESCE(reason_code, ''))) > 0
        OR LENGTH(TRIM(COALESCE(reason_note, ''))) > 0)
      AND
      (actor_type <> 'teacher'
        OR LENGTH(TRIM(COALESCE(intervention_reason, ''))) > 0)
    ),
    CONSTRAINT finance_request_resolutions_expected_revision_ck
      CHECK (expected_request_revision >= 0)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_request_resolutions_request_uq
    ON finance_request_resolutions(request_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_request_resolutions_class_idempotency_uq
    ON finance_request_resolutions(class_id, idempotency_key)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_request_resolutions_posted_transaction_uq
    ON finance_request_resolutions(posted_transaction_id)
    WHERE posted_transaction_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS finance_request_resolutions_class_resolved_idx
    ON finance_request_resolutions(class_id, resolved_at)`,
  `CREATE INDEX IF NOT EXISTS finance_request_resolutions_actor_student_idx
    ON finance_request_resolutions(actor_student_id, resolved_at)`,
  `CREATE TRIGGER IF NOT EXISTS finance_cash_requests_insert_guard
    BEFORE INSERT ON finance_cash_requests
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
            AND existing_request.requester_student_id =
                NEW.requester_student_id
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
              - COALESCE((
                  SELECT SUM(existing_request.amount)
                  FROM finance_cash_requests existing_request
                  WHERE existing_request.wallet_account_id = account.id
                    AND existing_request.class_id = account.class_id
                    AND existing_request.request_type = 'withdrawal'
                    AND NOT EXISTS (
                      SELECT 1
                      FROM finance_request_resolutions existing_resolution
                      WHERE existing_resolution.request_id = existing_request.id
                    )
                ), 0)
            FROM finance_accounts account
            WHERE account.id = NEW.wallet_account_id
              AND account.class_id = NEW.class_id
          )
        THEN RAISE(ABORT, 'FINANCE_WITHDRAWAL_AVAILABLE_BALANCE')
      END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_cash_requests_update_guard
    BEFORE UPDATE ON finance_cash_requests
    BEGIN
      SELECT RAISE(ABORT, 'FINANCE_REQUEST_IMMUTABLE');
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_cash_requests_delete_guard
    BEFORE DELETE ON finance_cash_requests
    BEGIN
      SELECT RAISE(ABORT, 'FINANCE_REQUEST_IMMUTABLE');
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_request_resolutions_insert_guard
    BEFORE INSERT ON finance_request_resolutions
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
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_request_resolutions_update_guard
    BEFORE UPDATE ON finance_request_resolutions
    BEGIN
      SELECT RAISE(ABORT, 'FINANCE_REQUEST_RESOLUTION_IMMUTABLE');
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_request_resolutions_delete_guard
    BEFORE DELETE ON finance_request_resolutions
    BEGIN
      SELECT RAISE(ABORT, 'FINANCE_REQUEST_RESOLUTION_IMMUTABLE');
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_transactions_cash_request_scope_guard
    BEFORE INSERT ON finance_transactions
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
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_transactions_cash_request_posting_guard
    BEFORE UPDATE OF status ON finance_transactions
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
              SELECT COUNT(*) FROM finance_ledger_entries entry
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
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_request_resolutions_apply_approval
    AFTER INSERT ON finance_request_resolutions
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
        END,
        CASE request_row.request_type
          WHEN 'deposit' THEN '입금 신청 승인'
          ELSE '출금 신청 승인'
        END,
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
        END,
        wallet.balance + CASE request_row.request_type
          WHEN 'deposit' THEN request_row.amount
          ELSE -request_row.amount
        END,
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
        END,
        issuance.balance + CASE request_row.request_type
          WHEN 'deposit' THEN -request_row.amount
          ELSE request_row.amount
        END,
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
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_accounts_student_class_guard
    BEFORE INSERT ON finance_accounts
    WHEN NEW.account_type = 'student_wallet'
      AND NOT EXISTS (
        SELECT 1 FROM students
        WHERE students.id = NEW.student_id
          AND students.class_id = NEW.class_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'FINANCE_ACCOUNT_STUDENT_CLASS_MISMATCH');
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_transactions_insert_pending_only
    BEFORE INSERT ON finance_transactions
    WHEN NEW.status <> 'pending' OR NEW.posted_at IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'FINANCE_TRANSACTION_MUST_START_PENDING');
    END`,
  `DROP TRIGGER IF EXISTS finance_transactions_actor_guard`,
  `CREATE TRIGGER IF NOT EXISTS finance_transactions_actor_guard
    BEFORE INSERT ON finance_transactions
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
                period.assignment_year
                  < CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER)
                OR (
                  period.assignment_year
                    = CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER)
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
                    newer.assignment_year
                      < CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER)
                    OR (
                      newer.assignment_year
                        = CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER)
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
                      AND COALESCE(newer.confirmed_at, 0)
                        > COALESCE(period.confirmed_at, 0)
                    )
                    OR (
                      newer.assignment_year = period.assignment_year
                      AND newer.assignment_month = period.assignment_month
                      AND COALESCE(newer.confirmed_at, 0)
                        = COALESCE(period.confirmed_at, 0)
                      AND newer.updated_at > period.updated_at
                    )
                    OR (
                      newer.assignment_year = period.assignment_year
                      AND newer.assignment_month = period.assignment_month
                      AND COALESCE(newer.confirmed_at, 0)
                        = COALESCE(period.confirmed_at, 0)
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
          AND COALESCE(NEW.source_type, '') <> 'cash_request'
        THEN RAISE(ABORT, 'FINANCE_BANKER_WRITES_NOT_ENABLED')
      END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_transactions_identity_immutable
    BEFORE UPDATE OF
      id, class_id, transaction_type, description, idempotency_key, payload_hash,
      source_type, source_id, reversal_of_transaction_id, actor_type,
      actor_teacher_id, actor_student_id, actor_job_period_id, actor_label,
      metadata_json, created_at
    ON finance_transactions
    BEGIN
      SELECT RAISE(ABORT, 'FINANCE_TRANSACTION_IMMUTABLE');
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_transactions_status_transition_guard
    BEFORE UPDATE OF status, posted_at ON finance_transactions
    WHEN OLD.status <> 'pending' OR NEW.status <> 'posted' OR NEW.posted_at IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'FINANCE_TRANSACTION_INVALID_TRANSITION');
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_transactions_posting_guard
    BEFORE UPDATE OF status ON finance_transactions
    WHEN OLD.status = 'pending' AND NEW.status = 'posted'
    BEGIN
      SELECT CASE
        WHEN (SELECT COUNT(*) FROM finance_ledger_entries
              WHERE transaction_id = NEW.id) < 2
        THEN RAISE(ABORT, 'FINANCE_TRANSACTION_NEEDS_TWO_ENTRIES')
      END;
      SELECT CASE
        WHEN COALESCE((
          SELECT SUM(amount) FROM finance_ledger_entries
          WHERE transaction_id = NEW.id
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
            (SELECT COUNT(*) FROM finance_ledger_entries
             WHERE transaction_id = NEW.id)
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
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_transactions_posted_delete_guard
    BEFORE DELETE ON finance_transactions
    WHEN OLD.status = 'posted'
    BEGIN
      SELECT RAISE(ABORT, 'FINANCE_TRANSACTION_IMMUTABLE');
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_ledger_entries_insert_guard
    BEFORE INSERT ON finance_ledger_entries
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
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_transactions_apply_posted_balances
    AFTER UPDATE OF status ON finance_transactions
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
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_ledger_entries_update_guard
    BEFORE UPDATE ON finance_ledger_entries
    BEGIN
      SELECT RAISE(ABORT, 'FINANCE_LEDGER_IMMUTABLE');
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_ledger_entries_delete_guard
    BEFORE DELETE ON finance_ledger_entries
    BEGIN
      SELECT RAISE(ABORT, 'FINANCE_LEDGER_IMMUTABLE');
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_accounts_identity_guard
    BEFORE UPDATE OF id, class_id, student_id, account_type, allow_negative, created_at
    ON finance_accounts
    BEGIN
      SELECT RAISE(ABORT, 'FINANCE_ACCOUNT_IDENTITY_IMMUTABLE');
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_accounts_projection_guard
    BEFORE UPDATE OF balance, revision ON finance_accounts
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
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_classes_create_issuance_account
    AFTER INSERT ON classes
    BEGIN
      INSERT OR IGNORE INTO finance_accounts (
        id, class_id, student_id, account_type, balance, allow_negative,
        status, revision, created_at, updated_at
      ) VALUES (
        'finance:class:' || NEW.id || ':issuance',
        NEW.id, NULL, 'class_issuance', 0, 1,
        CASE WHEN NEW.status = 'active' THEN 'active' ELSE 'closed' END,
        0, NEW.created_at, NEW.updated_at
      );
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_students_create_wallet_account
    AFTER INSERT ON students
    BEGIN
      INSERT OR IGNORE INTO finance_accounts (
        id, class_id, student_id, account_type, balance, allow_negative,
        status, revision, created_at, updated_at
      ) VALUES (
        'finance:student:' || NEW.id || ':wallet',
        NEW.class_id, NEW.id, 'student_wallet', 0, 0,
        CASE
          WHEN NEW.status <> 'excluded'
            AND EXISTS (
              SELECT 1 FROM classes WHERE id = NEW.class_id AND status = 'active'
            )
          THEN 'active'
          WHEN NEW.status = 'excluded'
            AND EXISTS (
              SELECT 1 FROM classes WHERE id = NEW.class_id AND status = 'active'
            )
          THEN 'frozen'
          ELSE 'closed'
        END,
        0, NEW.created_at, NEW.updated_at
      );
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_students_sync_wallet_status
    AFTER UPDATE OF status ON students
    BEGIN
      UPDATE finance_accounts
      SET status = CASE
          WHEN NEW.status <> 'excluded'
            AND EXISTS (
              SELECT 1 FROM classes WHERE id = NEW.class_id AND status = 'active'
            )
          THEN 'active'
          WHEN NEW.status = 'excluded'
            AND EXISTS (
              SELECT 1 FROM classes WHERE id = NEW.class_id AND status = 'active'
            )
          THEN 'frozen'
          ELSE 'closed'
        END,
        updated_at = NEW.updated_at
      WHERE student_id = NEW.id AND account_type = 'student_wallet';
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_classes_sync_account_status
    AFTER UPDATE OF status ON classes
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
        END,
        updated_at = NEW.updated_at
      WHERE class_id = NEW.id;
    END`,
  `INSERT OR IGNORE INTO finance_accounts (
    id, class_id, student_id, account_type, balance, allow_negative,
    status, revision, created_at, updated_at
  )
  SELECT
    'finance:class:' || class_row.id || ':issuance',
    class_row.id, NULL, 'class_issuance', 0, 1,
    CASE WHEN class_row.status = 'active' THEN 'active' ELSE 'closed' END,
    0, class_row.created_at, class_row.updated_at
  FROM classes class_row`,
  `INSERT OR IGNORE INTO finance_accounts (
    id, class_id, student_id, account_type, balance, allow_negative,
    status, revision, created_at, updated_at
  )
  SELECT
    'finance:student:' || student.id || ':wallet',
    student.class_id, student.id, 'student_wallet', 0, 0,
    CASE
      WHEN student.status <> 'excluded' AND class_row.status = 'active' THEN 'active'
      WHEN student.status = 'excluded' AND class_row.status = 'active' THEN 'frozen'
      ELSE 'closed'
    END,
    0, student.created_at, student.updated_at
  FROM students student
  JOIN classes class_row ON class_row.id = student.class_id`,
  `CREATE TABLE IF NOT EXISTS finance_settings (
    class_id TEXT PRIMARY KEY,
    currency_name TEXT NOT NULL DEFAULT '우리 반 화폐',
    currency_unit TEXT NOT NULL DEFAULT '학급화폐',
    denominations_json TEXT NOT NULL DEFAULT '[100,500,1000,5000]',
    bank_open INTEGER NOT NULL DEFAULT 1,
    deposit_enabled INTEGER NOT NULL DEFAULT 1,
    withdrawal_enabled INTEGER NOT NULL DEFAULT 1,
    banker_processing_enabled INTEGER NOT NULL DEFAULT 1,
    max_request_amount INTEGER NOT NULL DEFAULT 100000,
    revision INTEGER NOT NULL DEFAULT 0,
    updated_by_teacher_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (updated_by_teacher_id) REFERENCES teachers(id),
    CONSTRAINT finance_settings_text_ck CHECK (
      LENGTH(TRIM(currency_name)) BETWEEN 1 AND 30
      AND LENGTH(TRIM(currency_unit)) BETWEEN 1 AND 10
    ),
    CONSTRAINT finance_settings_boolean_ck CHECK (
      bank_open IN (0, 1)
      AND deposit_enabled IN (0, 1)
      AND withdrawal_enabled IN (0, 1)
      AND banker_processing_enabled IN (0, 1)
    ),
    CONSTRAINT finance_settings_amount_ck
      CHECK (max_request_amount BETWEEN 1 AND 1000000000),
    CONSTRAINT finance_settings_revision_ck CHECK (revision >= 0),
    CONSTRAINT finance_settings_actor_ck CHECK (
      (revision = 0 AND updated_by_teacher_id IS NULL)
      OR (revision > 0 AND updated_by_teacher_id IS NOT NULL)
    )
  )`,
  `CREATE INDEX IF NOT EXISTS finance_settings_updated_by_idx
    ON finance_settings(updated_by_teacher_id)`,
  `CREATE TABLE IF NOT EXISTS finance_setting_revisions (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    previous_settings_json TEXT NOT NULL,
    settings_json TEXT NOT NULL,
    change_reason TEXT NOT NULL,
    actor_teacher_id TEXT NOT NULL,
    actor_label TEXT NOT NULL DEFAULT '교사',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (actor_teacher_id) REFERENCES teachers(id),
    CONSTRAINT finance_setting_revisions_revision_ck CHECK (revision > 0),
    CONSTRAINT finance_setting_revisions_reason_ck
      CHECK (LENGTH(TRIM(change_reason)) BETWEEN 2 AND 300)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_setting_revisions_class_revision_uq
    ON finance_setting_revisions(class_id, revision)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_setting_revisions_class_idempotency_uq
    ON finance_setting_revisions(class_id, idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS finance_setting_revisions_class_created_idx
    ON finance_setting_revisions(class_id, created_at)`,
  `CREATE TRIGGER IF NOT EXISTS finance_classes_create_settings
    AFTER INSERT ON classes
    BEGIN
      INSERT OR IGNORE INTO finance_settings (
        class_id, currency_name, currency_unit, denominations_json,
        bank_open, deposit_enabled, withdrawal_enabled,
        banker_processing_enabled, max_request_amount, revision,
        updated_by_teacher_id, created_at, updated_at
      ) VALUES (
        NEW.id, '우리 반 화폐', '학급화폐', '[100,500,1000,5000]',
        1, 1, 1, 1, 100000, 0, NULL, NEW.created_at, NEW.updated_at
      );
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_settings_update_guard
    BEFORE UPDATE ON finance_settings
    BEGIN
      SELECT CASE
        WHEN NEW.class_id <> OLD.class_id OR NEW.created_at <> OLD.created_at
        THEN RAISE(ABORT, 'FINANCE_SETTINGS_IDENTITY_IMMUTABLE')
      END;
      SELECT CASE
        WHEN NEW.revision <> OLD.revision + 1
        THEN RAISE(ABORT, 'FINANCE_SETTINGS_STALE')
      END;
      SELECT CASE
        WHEN NEW.updated_by_teacher_id IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM classes class_row
            WHERE class_row.id = NEW.class_id
              AND class_row.teacher_id = NEW.updated_by_teacher_id
              AND class_row.status = 'active'
          )
        THEN RAISE(ABORT, 'FINANCE_SETTINGS_ACCESS_DENIED')
      END;
      SELECT CASE
        WHEN json_valid(NEW.denominations_json) <> 1
          OR json_type(NEW.denominations_json) <> 'array'
          OR json_array_length(NEW.denominations_json) NOT BETWEEN 1 AND 8
          OR EXISTS (
            SELECT 1
            FROM json_each(NEW.denominations_json)
            WHERE type <> 'integer'
              OR value <= 0
              OR value > 1000000000
          )
          OR (
            SELECT COUNT(DISTINCT value)
            FROM json_each(NEW.denominations_json)
          ) <> json_array_length(NEW.denominations_json)
          OR EXISTS (
            SELECT 1
            FROM json_each(NEW.denominations_json)
            WHERE value % (
              SELECT MIN(CAST(value AS INTEGER))
              FROM json_each(NEW.denominations_json)
            ) <> 0
          )
        THEN RAISE(ABORT, 'FINANCE_SETTINGS_INVALID_DENOMINATIONS')
      END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_settings_delete_guard
    BEFORE DELETE ON finance_settings
    BEGIN
      SELECT RAISE(ABORT, 'FINANCE_SETTINGS_IMMUTABLE');
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_setting_revisions_insert_guard
    BEFORE INSERT ON finance_setting_revisions
    BEGIN
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1
          FROM finance_settings setting
          JOIN classes class_row ON class_row.id = setting.class_id
          WHERE setting.class_id = NEW.class_id
            AND setting.revision = NEW.revision
            AND setting.updated_by_teacher_id = NEW.actor_teacher_id
            AND class_row.teacher_id = NEW.actor_teacher_id
            AND class_row.status = 'active'
        )
        THEN RAISE(ABORT, 'FINANCE_SETTINGS_STALE')
      END;
      SELECT CASE
        WHEN json_valid(NEW.previous_settings_json) <> 1
          OR json_valid(NEW.settings_json) <> 1
        THEN RAISE(ABORT, 'FINANCE_SETTINGS_INVALID_AUDIT')
      END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_setting_revisions_update_guard
    BEFORE UPDATE ON finance_setting_revisions
    BEGIN
      SELECT RAISE(ABORT, 'FINANCE_SETTINGS_REVISION_IMMUTABLE');
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_setting_revisions_delete_guard
    BEFORE DELETE ON finance_setting_revisions
    BEGIN
      SELECT RAISE(ABORT, 'FINANCE_SETTINGS_REVISION_IMMUTABLE');
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_cash_requests_settings_guard
    BEFORE INSERT ON finance_cash_requests
    BEGIN
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1
          FROM finance_settings setting
          WHERE setting.class_id = NEW.class_id
            AND setting.bank_open = 1
        )
        THEN RAISE(ABORT, 'FINANCE_BANK_CLOSED')
      END;
      SELECT CASE
        WHEN NEW.request_type = 'deposit'
          AND NOT EXISTS (
            SELECT 1 FROM finance_settings
            WHERE class_id = NEW.class_id AND deposit_enabled = 1
          )
        THEN RAISE(ABORT, 'FINANCE_DEPOSIT_DISABLED')
      END;
      SELECT CASE
        WHEN NEW.request_type = 'withdrawal'
          AND NOT EXISTS (
            SELECT 1 FROM finance_settings
            WHERE class_id = NEW.class_id AND withdrawal_enabled = 1
          )
        THEN RAISE(ABORT, 'FINANCE_WITHDRAWAL_DISABLED')
      END;
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM finance_settings
          WHERE class_id = NEW.class_id
            AND NEW.amount <= max_request_amount
        )
        THEN RAISE(ABORT, 'FINANCE_REQUEST_AMOUNT_LIMIT')
      END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_request_resolutions_settings_guard
    BEFORE INSERT ON finance_request_resolutions
    WHEN NEW.actor_type = 'banker'
    BEGIN
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM finance_settings setting
          WHERE setting.class_id = NEW.class_id
            AND setting.bank_open = 1
        )
        THEN RAISE(ABORT, 'FINANCE_BANK_CLOSED')
      END;
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM finance_settings setting
          WHERE setting.class_id = NEW.class_id
            AND setting.banker_processing_enabled = 1
        )
        THEN RAISE(ABORT, 'FINANCE_BANKER_PROCESSING_DISABLED')
      END;
      SELECT CASE
        WHEN EXISTS (
          SELECT 1
          FROM finance_cash_requests request_row
          JOIN finance_settings setting
            ON setting.class_id = request_row.class_id
          WHERE request_row.id = NEW.request_id
            AND request_row.class_id = NEW.class_id
            AND NEW.decision = 'approved'
            AND request_row.request_type = 'deposit'
            AND setting.deposit_enabled = 0
        )
        THEN RAISE(ABORT, 'FINANCE_DEPOSIT_DISABLED')
      END;
      SELECT CASE
        WHEN EXISTS (
          SELECT 1
          FROM finance_cash_requests request_row
          JOIN finance_settings setting
            ON setting.class_id = request_row.class_id
          WHERE request_row.id = NEW.request_id
            AND request_row.class_id = NEW.class_id
            AND NEW.decision = 'approved'
            AND request_row.request_type = 'withdrawal'
            AND setting.withdrawal_enabled = 0
        )
        THEN RAISE(ABORT, 'FINANCE_WITHDRAWAL_DISABLED')
      END;
      SELECT CASE
        WHEN EXISTS (
          SELECT 1
          FROM finance_cash_requests request_row
          JOIN finance_settings setting
            ON setting.class_id = request_row.class_id
          WHERE request_row.id = NEW.request_id
            AND request_row.class_id = NEW.class_id
            AND NEW.decision = 'approved'
            AND request_row.amount > setting.max_request_amount
        )
        THEN RAISE(ABORT, 'FINANCE_REQUEST_AMOUNT_LIMIT')
      END;
    END`,
  `CREATE TABLE IF NOT EXISTS finance_deposit_products (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL,
    name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    term_weeks INTEGER NOT NULL, maturity_interest_bps INTEGER NOT NULL,
    early_interest_bps INTEGER NOT NULL DEFAULT 0,
    min_amount INTEGER NOT NULL, max_amount INTEGER NOT NULL,
    is_open INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 0,
    created_by_teacher_id TEXT NOT NULL, updated_by_teacher_id TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (created_by_teacher_id) REFERENCES teachers(id),
    FOREIGN KEY (updated_by_teacher_id) REFERENCES teachers(id),
    CONSTRAINT finance_deposit_products_text_ck CHECK (
      LENGTH(TRIM(name)) BETWEEN 1 AND 40 AND LENGTH(description) <= 200
    ),
    CONSTRAINT finance_deposit_products_term_ck CHECK (term_weeks BETWEEN 1 AND 52),
    CONSTRAINT finance_deposit_products_rate_ck CHECK (
      maturity_interest_bps BETWEEN 0 AND 10000
      AND early_interest_bps BETWEEN 0 AND 10000
    ),
    CONSTRAINT finance_deposit_products_amount_ck CHECK (
      min_amount BETWEEN 1 AND 1000000000
      AND max_amount BETWEEN min_amount AND 1000000000
    ),
    CONSTRAINT finance_deposit_products_open_ck CHECK (is_open IN (0, 1)),
    CONSTRAINT finance_deposit_products_revision_ck CHECK (revision >= 0)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_deposit_products_id_class_uq
    ON finance_deposit_products(id, class_id)`,
  `CREATE INDEX IF NOT EXISTS finance_deposit_products_class_open_idx
    ON finance_deposit_products(class_id, is_open, created_at)`,
  `CREATE TABLE IF NOT EXISTS finance_deposit_product_events (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL, product_id TEXT NOT NULL,
    revision INTEGER NOT NULL, action TEXT NOT NULL,
    idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
    product_snapshot_json TEXT NOT NULL, actor_teacher_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (actor_teacher_id) REFERENCES teachers(id),
    FOREIGN KEY (product_id, class_id)
      REFERENCES finance_deposit_products(id, class_id),
    CONSTRAINT finance_deposit_product_events_action_ck
      CHECK (action IN ('issued', 'opened', 'paused')),
    CONSTRAINT finance_deposit_product_events_revision_ck CHECK (revision >= 0)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_deposit_product_events_product_revision_uq
    ON finance_deposit_product_events(product_id, revision)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_deposit_product_events_class_idempotency_uq
    ON finance_deposit_product_events(class_id, idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS finance_deposit_product_events_class_created_idx
    ON finance_deposit_product_events(class_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS finance_deposit_contracts (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL, product_id TEXT NOT NULL,
    product_revision INTEGER NOT NULL, student_id TEXT NOT NULL,
    wallet_account_id TEXT NOT NULL, principal INTEGER NOT NULL,
    product_name_snapshot TEXT NOT NULL, term_weeks_snapshot INTEGER NOT NULL,
    maturity_interest_bps_snapshot INTEGER NOT NULL,
    early_interest_bps_snapshot INTEGER NOT NULL,
    maturity_interest INTEGER NOT NULL, early_interest INTEGER NOT NULL,
    maturity_payout INTEGER NOT NULL, early_payout INTEGER NOT NULL,
    opened_at INTEGER NOT NULL, matures_at INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
    posted_transaction_id TEXT NOT NULL, transaction_payload_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (product_id, class_id)
      REFERENCES finance_deposit_products(id, class_id),
    FOREIGN KEY (wallet_account_id, class_id)
      REFERENCES finance_accounts(id, class_id),
    FOREIGN KEY (posted_transaction_id, class_id)
      REFERENCES finance_transactions(id, class_id),
    CONSTRAINT finance_deposit_contracts_amount_ck CHECK (
      principal BETWEEN 1 AND 1000000000
      AND maturity_interest BETWEEN 0 AND 1000000000
      AND early_interest BETWEEN 0 AND maturity_interest
      AND maturity_payout = principal + maturity_interest
      AND early_payout = principal + early_interest
      AND maturity_payout <= 1000000000
    ),
    CONSTRAINT finance_deposit_contracts_terms_ck CHECK (
      product_revision >= 0 AND term_weeks_snapshot BETWEEN 1 AND 52
      AND maturity_interest_bps_snapshot BETWEEN 0 AND 10000
      AND early_interest_bps_snapshot BETWEEN 0 AND 10000
      AND matures_at > opened_at
    )
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_deposit_contracts_id_class_uq
    ON finance_deposit_contracts(id, class_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_deposit_contracts_class_student_idempotency_uq
    ON finance_deposit_contracts(class_id, student_id, idempotency_key)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_deposit_contracts_posted_transaction_uq
    ON finance_deposit_contracts(posted_transaction_id)`,
  `CREATE INDEX IF NOT EXISTS finance_deposit_contracts_student_created_idx
    ON finance_deposit_contracts(student_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS finance_deposit_contracts_class_maturity_idx
    ON finance_deposit_contracts(class_id, matures_at)`,
  `CREATE TABLE IF NOT EXISTS finance_deposit_settlements (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL, contract_id TEXT NOT NULL,
    student_id TEXT NOT NULL, settlement_type TEXT NOT NULL,
    principal INTEGER NOT NULL, interest INTEGER NOT NULL, payout INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
    posted_transaction_id TEXT NOT NULL, transaction_payload_hash TEXT NOT NULL,
    settled_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (contract_id, class_id)
      REFERENCES finance_deposit_contracts(id, class_id),
    FOREIGN KEY (posted_transaction_id, class_id)
      REFERENCES finance_transactions(id, class_id),
    CONSTRAINT finance_deposit_settlements_type_ck
      CHECK (settlement_type IN ('early_termination', 'maturity')),
    CONSTRAINT finance_deposit_settlements_amount_ck CHECK (
      principal BETWEEN 1 AND 1000000000
      AND interest BETWEEN 0 AND 1000000000
      AND payout = principal + interest AND payout <= 1000000000
    )
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_deposit_settlements_contract_uq
    ON finance_deposit_settlements(contract_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_deposit_settlements_class_student_idempotency_uq
    ON finance_deposit_settlements(class_id, student_id, idempotency_key)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_deposit_settlements_posted_transaction_uq
    ON finance_deposit_settlements(posted_transaction_id)`,
  `CREATE INDEX IF NOT EXISTS finance_deposit_settlements_class_created_idx
    ON finance_deposit_settlements(class_id, created_at)`,
  `CREATE TRIGGER IF NOT EXISTS finance_deposit_products_insert_guard
    BEFORE INSERT ON finance_deposit_products
    BEGIN
      SELECT CASE WHEN NEW.revision <> 0 OR NEW.is_open <> 1
        THEN RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_INVALID_INITIAL_STATE') END;
      SELECT CASE WHEN NEW.created_by_teacher_id <> NEW.updated_by_teacher_id
        OR NOT EXISTS (
          SELECT 1 FROM classes classroom
          WHERE classroom.id = NEW.class_id
            AND classroom.teacher_id = NEW.created_by_teacher_id
            AND classroom.status = 'active'
        )
        THEN RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_ACCESS_DENIED') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_deposit_products_update_guard
    BEFORE UPDATE ON finance_deposit_products
    BEGIN
      SELECT CASE WHEN NEW.id <> OLD.id OR NEW.class_id <> OLD.class_id
        OR NEW.name <> OLD.name OR NEW.description <> OLD.description
        OR NEW.term_weeks <> OLD.term_weeks
        OR NEW.maturity_interest_bps <> OLD.maturity_interest_bps
        OR NEW.early_interest_bps <> OLD.early_interest_bps
        OR NEW.min_amount <> OLD.min_amount OR NEW.max_amount <> OLD.max_amount
        OR NEW.created_by_teacher_id <> OLD.created_by_teacher_id
        OR NEW.created_at <> OLD.created_at
        THEN RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_TERMS_IMMUTABLE') END;
      SELECT CASE WHEN NEW.revision <> OLD.revision + 1
        THEN RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_STALE') END;
      SELECT CASE WHEN NEW.is_open = OLD.is_open
        THEN RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_STATE_UNCHANGED') END;
      SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM classes classroom
          WHERE classroom.id = NEW.class_id
            AND classroom.teacher_id = NEW.updated_by_teacher_id
            AND classroom.status = 'active'
        )
        THEN RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_ACCESS_DENIED') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_deposit_products_delete_guard
    BEFORE DELETE ON finance_deposit_products
    BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_deposit_product_events_insert_guard
    BEFORE INSERT ON finance_deposit_product_events
    BEGIN
      SELECT CASE WHEN json_valid(NEW.product_snapshot_json) <> 1
        OR NOT EXISTS (
          SELECT 1 FROM finance_deposit_products product
          JOIN classes classroom ON classroom.id = product.class_id
          WHERE product.id = NEW.product_id AND product.class_id = NEW.class_id
            AND product.revision = NEW.revision
            AND product.updated_by_teacher_id = NEW.actor_teacher_id
            AND classroom.teacher_id = NEW.actor_teacher_id
            AND ((NEW.action = 'issued' AND NEW.revision = 0)
              OR (NEW.action = 'opened' AND NEW.revision > 0 AND product.is_open = 1)
              OR (NEW.action = 'paused' AND NEW.revision > 0 AND product.is_open = 0))
        )
        THEN RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_EVENT_INVALID') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_deposit_product_events_update_guard
    BEFORE UPDATE ON finance_deposit_product_events
    BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_EVENT_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_deposit_product_events_delete_guard
    BEFORE DELETE ON finance_deposit_product_events
    BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_EVENT_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_deposit_contracts_insert_guard
    BEFORE INSERT ON finance_deposit_contracts
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_deposit_products product
        JOIN students student ON student.id = NEW.student_id
          AND student.class_id = product.class_id AND student.status = 'active'
        JOIN finance_accounts wallet ON wallet.id = NEW.wallet_account_id
          AND wallet.class_id = product.class_id
          AND wallet.student_id = student.id
          AND wallet.account_type = 'student_wallet' AND wallet.status = 'active'
        WHERE product.id = NEW.product_id AND product.class_id = NEW.class_id
          AND product.is_open = 1 AND product.revision = NEW.product_revision
          AND product.name = NEW.product_name_snapshot
          AND product.term_weeks = NEW.term_weeks_snapshot
          AND product.maturity_interest_bps = NEW.maturity_interest_bps_snapshot
          AND product.early_interest_bps = NEW.early_interest_bps_snapshot
          AND NEW.principal BETWEEN product.min_amount AND product.max_amount
      ) THEN RAISE(ABORT, 'FINANCE_DEPOSIT_SUBSCRIPTION_STALE') END;
      SELECT CASE WHEN NEW.matures_at <> NEW.opened_at
          + (NEW.term_weeks_snapshot * 604800000)
        OR NEW.maturity_interest <> CAST(
          (NEW.principal * NEW.maturity_interest_bps_snapshot) / 10000 AS INTEGER)
        OR NEW.early_interest <> CAST(
          (NEW.maturity_interest * NEW.early_interest_bps_snapshot) / 10000 AS INTEGER)
        THEN RAISE(ABORT, 'FINANCE_DEPOSIT_CALCULATION_MISMATCH') END;
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM finance_deposit_contracts prior
        WHERE prior.class_id = NEW.class_id AND prior.student_id = NEW.student_id
          AND prior.product_id = NEW.product_id
          AND NOT EXISTS (
            SELECT 1 FROM finance_deposit_settlements settlement
            WHERE settlement.contract_id = prior.id
          )
      ) THEN RAISE(ABORT, 'FINANCE_DEPOSIT_ACTIVE_EXISTS') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_transactions transaction_row
        WHERE transaction_row.id = NEW.posted_transaction_id
          AND transaction_row.class_id = NEW.class_id
          AND transaction_row.status = 'posted'
          AND transaction_row.transaction_type = 'deposit_open'
          AND transaction_row.source_type = 'deposit_contract'
          AND transaction_row.source_id = NEW.id
          AND transaction_row.actor_type = 'system'
          AND transaction_row.payload_hash = NEW.transaction_payload_hash
          AND (SELECT COUNT(*) FROM finance_ledger_entries entry
               WHERE entry.transaction_id = transaction_row.id) = 2
          AND EXISTS (
            SELECT 1 FROM finance_ledger_entries entry
            WHERE entry.transaction_id = transaction_row.id
              AND entry.account_id = NEW.wallet_account_id
              AND entry.amount = -NEW.principal
          )
          AND EXISTS (
            SELECT 1 FROM finance_ledger_entries entry
            JOIN finance_accounts issuance ON issuance.id = entry.account_id
              AND issuance.class_id = entry.class_id
              AND issuance.account_type = 'class_issuance'
            WHERE entry.transaction_id = transaction_row.id
              AND entry.amount = NEW.principal
          )
      ) THEN RAISE(ABORT, 'FINANCE_DEPOSIT_LEDGER_MISMATCH') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_deposit_contracts_update_guard
    BEFORE UPDATE ON finance_deposit_contracts
    BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_CONTRACT_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_deposit_contracts_delete_guard
    BEFORE DELETE ON finance_deposit_contracts
    BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_CONTRACT_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_deposit_settlements_insert_guard
    BEFORE INSERT ON finance_deposit_settlements
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_deposit_contracts contract
        WHERE contract.id = NEW.contract_id AND contract.class_id = NEW.class_id
          AND contract.student_id = NEW.student_id
          AND NOT EXISTS (
            SELECT 1 FROM finance_deposit_settlements prior
            WHERE prior.contract_id = contract.id
          )
          AND ((NEW.settlement_type = 'maturity'
                AND NEW.settled_at >= contract.matures_at
                AND NEW.principal = contract.principal
                AND NEW.interest = contract.maturity_interest
                AND NEW.payout = contract.maturity_payout)
            OR (NEW.settlement_type = 'early_termination'
                AND NEW.settled_at < contract.matures_at
                AND NEW.principal = contract.principal
                AND NEW.interest = contract.early_interest
                AND NEW.payout = contract.early_payout))
      ) THEN RAISE(ABORT, 'FINANCE_DEPOSIT_SETTLEMENT_STALE') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_transactions transaction_row
        JOIN finance_deposit_contracts contract
          ON contract.id = NEW.contract_id AND contract.class_id = NEW.class_id
        WHERE transaction_row.id = NEW.posted_transaction_id
          AND transaction_row.class_id = NEW.class_id
          AND transaction_row.status = 'posted'
          AND transaction_row.transaction_type = CASE NEW.settlement_type
            WHEN 'maturity' THEN 'deposit_maturity'
            ELSE 'deposit_early_termination' END
          AND transaction_row.source_type = 'deposit_settlement'
          AND transaction_row.source_id = NEW.contract_id
          AND transaction_row.actor_type = 'system'
          AND transaction_row.payload_hash = NEW.transaction_payload_hash
          AND (SELECT COUNT(*) FROM finance_ledger_entries entry
               WHERE entry.transaction_id = transaction_row.id) = 2
          AND EXISTS (
            SELECT 1 FROM finance_ledger_entries entry
            WHERE entry.transaction_id = transaction_row.id
              AND entry.account_id = contract.wallet_account_id
              AND entry.amount = NEW.payout
          )
          AND EXISTS (
            SELECT 1 FROM finance_ledger_entries entry
            JOIN finance_accounts issuance ON issuance.id = entry.account_id
              AND issuance.class_id = entry.class_id
              AND issuance.account_type = 'class_issuance'
            WHERE entry.transaction_id = transaction_row.id
              AND entry.amount = -NEW.payout
          )
      ) THEN RAISE(ABORT, 'FINANCE_DEPOSIT_LEDGER_MISMATCH') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_deposit_settlements_update_guard
    BEFORE UPDATE ON finance_deposit_settlements
    BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_SETTLEMENT_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_deposit_settlements_delete_guard
    BEFORE DELETE ON finance_deposit_settlements
    BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_SETTLEMENT_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_deposit_transactions_reversal_guard
    BEFORE INSERT ON finance_transactions
    WHEN NEW.transaction_type = 'reversal' AND EXISTS (
      SELECT 1 FROM finance_transactions original
      WHERE original.id = NEW.reversal_of_transaction_id
        AND original.source_type IN ('deposit_contract', 'deposit_settlement')
    )
    BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_REVERSAL_REQUIRES_CONTRACT'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_deposit_classes_archive_guard
    BEFORE UPDATE OF status ON classes
    WHEN NEW.status = 'archived' AND OLD.status <> 'archived'
      AND EXISTS (
        SELECT 1 FROM finance_deposit_contracts contract
        WHERE contract.class_id = NEW.id
          AND NOT EXISTS (
            SELECT 1 FROM finance_deposit_settlements settlement
            WHERE settlement.contract_id = contract.id
          )
      )
    BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_ACTIVE_CLASS'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_deposit_students_exclude_guard
    BEFORE UPDATE OF status ON students
    WHEN NEW.status = 'excluded' AND OLD.status <> 'excluded'
      AND EXISTS (
        SELECT 1 FROM finance_deposit_contracts contract
        WHERE contract.student_id = NEW.id AND contract.class_id = NEW.class_id
          AND NOT EXISTS (
            SELECT 1 FROM finance_deposit_settlements settlement
            WHERE settlement.contract_id = contract.id
          )
      )
    BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_ACTIVE_STUDENT'); END`,
  `INSERT OR IGNORE INTO finance_settings (
    class_id, currency_name, currency_unit, denominations_json,
    bank_open, deposit_enabled, withdrawal_enabled,
    banker_processing_enabled, max_request_amount, revision,
    updated_by_teacher_id, created_at, updated_at
  )
  SELECT
    class_row.id, '우리 반 화폐', '학급화폐', '[100,500,1000,5000]',
    1, 1, 1, 1, 1000000000, 0, NULL,
    class_row.created_at, class_row.updated_at
  FROM classes class_row`,
] as const;
