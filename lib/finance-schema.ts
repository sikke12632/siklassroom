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
  `CREATE INDEX IF NOT EXISTS finance_cash_requests_wallet_pending_idx
    ON finance_cash_requests(class_id, wallet_account_id, request_type, created_at)`,
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
  `CREATE TRIGGER IF NOT EXISTS finance_transactions_pending_withdrawal_guard
    BEFORE UPDATE OF status ON finance_transactions
    WHEN OLD.status = 'pending' AND NEW.status = 'posted'
    BEGIN
      SELECT CASE
        WHEN EXISTS (
          SELECT 1
          FROM finance_ledger_entries entry
          JOIN finance_accounts account
            ON account.id = entry.account_id
           AND account.class_id = entry.class_id
          WHERE entry.transaction_id = NEW.id
            AND entry.amount < 0
            AND entry.balance_after >= 0
            AND account.account_type = 'student_wallet'
            AND entry.balance_after < COALESCE((
              SELECT SUM(request_row.amount)
              FROM finance_cash_requests request_row
              WHERE request_row.class_id = entry.class_id
                AND request_row.wallet_account_id = entry.account_id
                AND request_row.request_type = 'withdrawal'
                AND NOT EXISTS (
                  SELECT 1
                  FROM finance_request_resolutions resolution
                  WHERE resolution.request_id = request_row.id
                    AND resolution.class_id = request_row.class_id
                )
            ), 0)
        )
        THEN RAISE(ABORT, 'FINANCE_INSUFFICIENT_AVAILABLE_BALANCE')
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
  `CREATE TRIGGER IF NOT EXISTS finance_ledger_entries_issuance_floor_guard
    BEFORE INSERT ON finance_ledger_entries
    WHEN NEW.amount < 0 AND NEW.balance_after < -1000000000
      AND EXISTS (
        SELECT 1 FROM finance_accounts account
        WHERE account.id = NEW.account_id
          AND account.class_id = NEW.class_id
          AND account.account_type = 'class_issuance'
      )
    BEGIN
      SELECT RAISE(ABORT, 'FINANCE_ISSUANCE_BALANCE_LIMIT');
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_ledger_entries_pending_withdrawal_guard
    BEFORE INSERT ON finance_ledger_entries
    WHEN NEW.amount < 0
    BEGIN
      SELECT CASE
        WHEN EXISTS (
          SELECT 1
          FROM finance_accounts account
          WHERE account.id = NEW.account_id
            AND account.class_id = NEW.class_id
            AND account.account_type = 'student_wallet'
            AND NEW.balance_after >= 0
            AND NEW.balance_after < COALESCE((
              SELECT SUM(request_row.amount)
              FROM finance_cash_requests request_row
              WHERE request_row.class_id = NEW.class_id
                AND request_row.wallet_account_id = NEW.account_id
                AND request_row.request_type = 'withdrawal'
                AND NOT EXISTS (
                  SELECT 1
                  FROM finance_request_resolutions resolution
                  WHERE resolution.request_id = request_row.id
                    AND resolution.class_id = request_row.class_id
                )
            ), 0)
        )
        THEN RAISE(ABORT, 'FINANCE_INSUFFICIENT_AVAILABLE_BALANCE')
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
  `DROP TRIGGER IF EXISTS finance_deposit_settlements_insert_guard`,
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
          AND (
            transaction_row.actor_type = 'system'
            OR (
              transaction_row.actor_type = 'teacher'
              AND transaction_row.actor_teacher_id IS NOT NULL
              AND transaction_row.actor_student_id IS NULL
              AND transaction_row.actor_job_period_id IS NULL
              AND EXISTS (
                SELECT 1 FROM classes classroom
                WHERE classroom.id = NEW.class_id
                  AND classroom.teacher_id = transaction_row.actor_teacher_id
                  AND classroom.status = 'active'
              )
              AND json_valid(transaction_row.metadata_json) = 1
              AND json_extract(transaction_row.metadata_json, '$.isEmergency') = 1
              AND json_extract(transaction_row.metadata_json, '$.contractId') = NEW.contract_id
              AND json_extract(transaction_row.metadata_json, '$.studentId') = NEW.student_id
              AND json_extract(transaction_row.metadata_json, '$.settlementType') = NEW.settlement_type
              AND CAST(json_extract(transaction_row.metadata_json, '$.principal') AS INTEGER) = NEW.principal
              AND CAST(json_extract(transaction_row.metadata_json, '$.interest') AS INTEGER) = NEW.interest
              AND CAST(json_extract(transaction_row.metadata_json, '$.payout') AS INTEGER) = NEW.payout
              AND CAST(json_extract(transaction_row.metadata_json, '$.expectedSettlementRevision') AS INTEGER) = 0
              AND json_extract(transaction_row.metadata_json, '$.settlementPolicy') = 'contract_terms_at_settlement'
              AND json_extract(transaction_row.metadata_json, '$.origin') IN (
                'finance_center', 'student_exclusion', 'class_archive'
              )
              AND json_type(transaction_row.metadata_json, '$.interventionReason') = 'text'
              AND LENGTH(TRIM(CAST(json_extract(
                transaction_row.metadata_json, '$.interventionReason'
              ) AS TEXT))) BETWEEN 2 AND 300
            )
          )
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
  `CREATE TABLE IF NOT EXISTS finance_stock_markets (
    class_id TEXT PRIMARY KEY, is_open INTEGER NOT NULL DEFAULT 0,
    buy_fee_bps INTEGER NOT NULL DEFAULT 0,
    sell_fee_bps INTEGER NOT NULL DEFAULT 0,
    buy_spread INTEGER NOT NULL DEFAULT 0,
    sell_spread INTEGER NOT NULL DEFAULT 0,
    market_mood TEXT NOT NULL DEFAULT 'mixed',
    tick_interval_minutes INTEGER NOT NULL DEFAULT 15,
    next_tick_at INTEGER, revision INTEGER NOT NULL DEFAULT 0,
    updated_by_teacher_id TEXT, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (updated_by_teacher_id) REFERENCES teachers(id),
    CONSTRAINT finance_stock_markets_open_ck CHECK (is_open IN (0, 1)),
    CONSTRAINT finance_stock_markets_fee_ck CHECK (
      buy_fee_bps BETWEEN 0 AND 1000 AND sell_fee_bps BETWEEN 0 AND 1000
    ),
    CONSTRAINT finance_stock_markets_spread_ck CHECK (
      buy_spread BETWEEN 0 AND 1000000000
      AND sell_spread BETWEEN 0 AND 1000000000
    ),
    CONSTRAINT finance_stock_markets_mood_ck CHECK (
      market_mood IN ('surge', 'bull', 'mixed', 'bear', 'crash')
    ),
    CONSTRAINT finance_stock_markets_tick_ck CHECK (
      tick_interval_minutes BETWEEN 1 AND 1440
      AND (next_tick_at IS NULL OR next_tick_at >= 0)
      AND (is_open = 0 OR next_tick_at IS NOT NULL)
    ),
    CONSTRAINT finance_stock_markets_revision_ck CHECK (revision >= 0)
  )`,
  `CREATE TABLE IF NOT EXISTS finance_stock_market_events (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL, revision INTEGER NOT NULL,
    action TEXT NOT NULL, idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL, previous_snapshot_json TEXT,
    market_snapshot_json TEXT NOT NULL, actor_teacher_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (class_id) REFERENCES finance_stock_markets(class_id),
    FOREIGN KEY (actor_teacher_id) REFERENCES teachers(id),
    CONSTRAINT finance_stock_market_events_action_ck CHECK (
      action IN ('configured', 'opened', 'closed', 'updated')
    ),
    CONSTRAINT finance_stock_market_events_revision_ck CHECK (revision > 0)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_stock_market_events_class_revision_uq
    ON finance_stock_market_events(class_id, revision)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_stock_market_events_class_idempotency_uq
    ON finance_stock_market_events(class_id, idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS finance_stock_market_events_class_created_idx
    ON finance_stock_market_events(class_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS finance_stocks (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL,
    name TEXT NOT NULL, symbol TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    initial_price INTEGER NOT NULL, current_price INTEGER NOT NULL,
    previous_price INTEGER NOT NULL, total_shares INTEGER NOT NULL,
    available_shares INTEGER NOT NULL, max_shares_per_student INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', revision INTEGER NOT NULL DEFAULT 0,
    inventory_revision INTEGER NOT NULL DEFAULT 0, last_trade_id TEXT,
    created_by_teacher_id TEXT NOT NULL,
    updated_by_actor_type TEXT NOT NULL DEFAULT 'teacher',
    updated_by_teacher_id TEXT, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (created_by_teacher_id) REFERENCES teachers(id),
    FOREIGN KEY (updated_by_teacher_id) REFERENCES teachers(id),
    CONSTRAINT finance_stocks_text_ck CHECK (
      LENGTH(TRIM(name)) BETWEEN 1 AND 40
      AND LENGTH(TRIM(symbol)) BETWEEN 1 AND 12
      AND LENGTH(description) <= 300
    ),
    CONSTRAINT finance_stocks_price_ck CHECK (
      initial_price BETWEEN 1 AND 1000000000
      AND current_price BETWEEN 1 AND 1000000000
      AND previous_price BETWEEN 1 AND 1000000000
    ),
    CONSTRAINT finance_stocks_supply_ck CHECK (
      total_shares BETWEEN 1 AND 1000000000
      AND available_shares BETWEEN 0 AND total_shares
      AND max_shares_per_student BETWEEN 1 AND total_shares
    ),
    CONSTRAINT finance_stocks_status_ck CHECK (
      status IN ('active', 'sell_only', 'halted', 'archived')
    ),
    CONSTRAINT finance_stocks_revision_ck CHECK (
      revision >= 0 AND inventory_revision >= 0
    ),
    CONSTRAINT finance_stocks_actor_ck CHECK (
      (updated_by_actor_type = 'teacher' AND updated_by_teacher_id IS NOT NULL)
      OR (updated_by_actor_type = 'system' AND updated_by_teacher_id IS NULL)
    )
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_stocks_class_uq
    ON finance_stocks(class_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_stocks_id_class_uq
    ON finance_stocks(id, class_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_stocks_class_symbol_uq
    ON finance_stocks(class_id, symbol)`,
  `CREATE INDEX IF NOT EXISTS finance_stocks_class_status_idx
    ON finance_stocks(class_id, status)`,
  `CREATE TABLE IF NOT EXISTS finance_stock_events (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL, stock_id TEXT NOT NULL,
    revision INTEGER NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL,
    idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
    previous_snapshot_json TEXT, stock_snapshot_json TEXT NOT NULL,
    actor_type TEXT NOT NULL, actor_teacher_id TEXT, created_at INTEGER NOT NULL,
    FOREIGN KEY (actor_teacher_id) REFERENCES teachers(id),
    FOREIGN KEY (stock_id, class_id) REFERENCES finance_stocks(id, class_id),
    CONSTRAINT finance_stock_events_action_ck CHECK (
      action IN (
        'issued', 'price_changed', 'status_changed', 'automatic_tick', 'news_tick'
      )
    ),
    CONSTRAINT finance_stock_events_actor_ck CHECK (
      (actor_type = 'teacher' AND actor_teacher_id IS NOT NULL)
      OR (actor_type = 'system' AND actor_teacher_id IS NULL)
    ),
    CONSTRAINT finance_stock_events_revision_ck CHECK (revision >= 0),
    CONSTRAINT finance_stock_events_reason_ck CHECK (
      LENGTH(TRIM(reason)) BETWEEN 1 AND 300
    )
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_stock_events_stock_revision_uq
    ON finance_stock_events(stock_id, revision)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_stock_events_class_idempotency_uq
    ON finance_stock_events(class_id, idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS finance_stock_events_class_created_idx
    ON finance_stock_events(class_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS finance_stock_news (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL,
    title TEXT NOT NULL, content TEXT NOT NULL, impact_bps INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', revision INTEGER NOT NULL DEFAULT 0,
    idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
    cancellation_idempotency_key TEXT, cancellation_payload_hash TEXT,
    created_by_teacher_id TEXT NOT NULL,
    updated_by_actor_type TEXT NOT NULL DEFAULT 'teacher',
    updated_by_teacher_id TEXT, cancellation_reason TEXT,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    cancelled_at INTEGER, updated_at INTEGER NOT NULL,
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (created_by_teacher_id) REFERENCES teachers(id),
    FOREIGN KEY (updated_by_teacher_id) REFERENCES teachers(id),
    CONSTRAINT finance_stock_news_text_ck CHECK (
      LENGTH(TRIM(title)) BETWEEN 1 AND 80
      AND LENGTH(TRIM(content)) BETWEEN 1 AND 500
    ),
    CONSTRAINT finance_stock_news_impact_ck CHECK (
      impact_bps BETWEEN -10000 AND 10000
    ),
    CONSTRAINT finance_stock_news_status_ck CHECK (
      status IN ('active', 'cancelled', 'expired')
    ),
    CONSTRAINT finance_stock_news_state_ck CHECK (
      revision >= 0 AND expires_at > created_at
      AND (
        (status = 'active' AND cancelled_at IS NULL AND cancellation_reason IS NULL
          AND cancellation_idempotency_key IS NULL
          AND cancellation_payload_hash IS NULL)
        OR (status = 'cancelled' AND cancelled_at IS NOT NULL
          AND LENGTH(TRIM(COALESCE(cancellation_reason, ''))) > 0
          AND cancellation_idempotency_key IS NOT NULL
          AND cancellation_payload_hash IS NOT NULL)
        OR (status = 'expired' AND cancelled_at IS NULL
          AND cancellation_reason IS NULL
          AND cancellation_idempotency_key IS NULL
          AND cancellation_payload_hash IS NULL)
      )
    ),
    CONSTRAINT finance_stock_news_actor_ck CHECK (
      (updated_by_actor_type = 'teacher' AND updated_by_teacher_id IS NOT NULL)
      OR (updated_by_actor_type = 'system' AND updated_by_teacher_id IS NULL)
    )
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_stock_news_class_idempotency_uq
    ON finance_stock_news(class_id, idempotency_key)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_stock_news_class_cancellation_idempotency_uq
    ON finance_stock_news(class_id, cancellation_idempotency_key)
    WHERE cancellation_idempotency_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS finance_stock_news_class_status_idx
    ON finance_stock_news(class_id, status, created_at)`,
  `CREATE TABLE IF NOT EXISTS finance_stock_holdings (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL, stock_id TEXT NOT NULL,
    student_id TEXT NOT NULL, wallet_account_id TEXT NOT NULL,
    quantity INTEGER NOT NULL, cost_basis INTEGER NOT NULL,
    revision INTEGER NOT NULL, last_trade_id TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (stock_id, class_id) REFERENCES finance_stocks(id, class_id),
    FOREIGN KEY (wallet_account_id, class_id)
      REFERENCES finance_accounts(id, class_id),
    CONSTRAINT finance_stock_holdings_projection_ck CHECK (
      quantity BETWEEN 0 AND 1000000000
      AND cost_basis BETWEEN 0 AND 1000000000
      AND ((quantity = 0 AND cost_basis = 0)
        OR (quantity > 0 AND cost_basis > 0))
      AND revision > 0
    )
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_stock_holdings_stock_student_uq
    ON finance_stock_holdings(stock_id, student_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_stock_holdings_id_class_uq
    ON finance_stock_holdings(id, class_id)`,
  `CREATE INDEX IF NOT EXISTS finance_stock_holdings_class_student_idx
    ON finance_stock_holdings(class_id, student_id)`,
  `CREATE TABLE IF NOT EXISTS finance_stock_trades (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL, stock_id TEXT NOT NULL,
    stock_revision INTEGER NOT NULL,
    inventory_revision_before INTEGER NOT NULL,
    inventory_revision_after INTEGER NOT NULL,
    market_revision INTEGER NOT NULL,
    finance_settings_revision INTEGER NOT NULL,
    student_id TEXT NOT NULL, wallet_account_id TEXT NOT NULL,
    wallet_revision_before INTEGER NOT NULL,
    wallet_revision_after INTEGER NOT NULL,
    side TEXT NOT NULL, quantity INTEGER NOT NULL,
    reference_price INTEGER NOT NULL, spread_snapshot INTEGER NOT NULL,
    unit_price INTEGER NOT NULL, gross_amount INTEGER NOT NULL,
    fee_bps_snapshot INTEGER NOT NULL, fee_amount INTEGER NOT NULL,
    wallet_delta INTEGER NOT NULL,
    available_shares_before INTEGER NOT NULL,
    available_shares_after INTEGER NOT NULL,
    holding_quantity_before INTEGER NOT NULL,
    holding_quantity_after INTEGER NOT NULL,
    holding_cost_basis_before INTEGER NOT NULL,
    holding_cost_basis_after INTEGER NOT NULL,
    holding_revision_before INTEGER NOT NULL,
    holding_revision_after INTEGER NOT NULL,
    cost_basis_removed INTEGER NOT NULL, realized_gain INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL, posted_transaction_id TEXT,
    transaction_payload_hash TEXT, created_at INTEGER NOT NULL, posted_at INTEGER,
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (stock_id, class_id) REFERENCES finance_stocks(id, class_id),
    FOREIGN KEY (wallet_account_id, class_id)
      REFERENCES finance_accounts(id, class_id),
    FOREIGN KEY (posted_transaction_id, class_id)
      REFERENCES finance_transactions(id, class_id),
    CONSTRAINT finance_stock_trades_side_ck CHECK (side IN ('buy', 'sell')),
    CONSTRAINT finance_stock_trades_revision_ck CHECK (
      stock_revision >= 0 AND market_revision >= 0
      AND finance_settings_revision >= 0
      AND inventory_revision_after = inventory_revision_before + 1
      AND holding_revision_after = holding_revision_before + 1
      AND wallet_revision_after = wallet_revision_before + 1
    ),
    CONSTRAINT finance_stock_trades_amount_ck CHECK (
      quantity BETWEEN 1 AND 1000000000
      AND reference_price BETWEEN 1 AND 1000000000
      AND spread_snapshot BETWEEN 0 AND 1000000000
      AND unit_price BETWEEN 1 AND 1000000000
      AND unit_price = CASE side
        WHEN 'buy' THEN reference_price + spread_snapshot
        ELSE reference_price - spread_snapshot END
      AND gross_amount = unit_price * quantity
      AND gross_amount BETWEEN 1 AND 1000000000
      AND fee_bps_snapshot BETWEEN 0 AND 1000
      AND fee_amount BETWEEN 0 AND gross_amount
      AND wallet_delta = CASE side
        WHEN 'buy' THEN -(gross_amount + fee_amount)
        ELSE gross_amount - fee_amount END
      AND wallet_delta <> 0 AND ABS(wallet_delta) <= 1000000000
    ),
    CONSTRAINT finance_stock_trades_inventory_ck CHECK (
      available_shares_before BETWEEN 0 AND 1000000000
      AND available_shares_after BETWEEN 0 AND 1000000000
      AND available_shares_after = CASE side
        WHEN 'buy' THEN available_shares_before - quantity
        ELSE available_shares_before + quantity END
    ),
    CONSTRAINT finance_stock_trades_holding_ck CHECK (
      holding_quantity_before BETWEEN 0 AND 1000000000
      AND holding_quantity_after BETWEEN 0 AND 1000000000
      AND holding_cost_basis_before BETWEEN 0 AND 1000000000
      AND holding_cost_basis_after BETWEEN 0 AND 1000000000
      AND cost_basis_removed BETWEEN 0 AND 1000000000
      AND holding_quantity_after = CASE side
        WHEN 'buy' THEN holding_quantity_before + quantity
        ELSE holding_quantity_before - quantity END
      AND (
        (side = 'buy' AND cost_basis_removed = 0 AND realized_gain = 0
          AND holding_cost_basis_after = holding_cost_basis_before
            + gross_amount + fee_amount)
        OR (side = 'sell' AND holding_quantity_before > 0
          AND quantity <= holding_quantity_before
          AND cost_basis_removed = CAST(
            (holding_cost_basis_before * quantity) / holding_quantity_before
            AS INTEGER)
          AND holding_cost_basis_after = holding_cost_basis_before
            - cost_basis_removed
          AND realized_gain = wallet_delta - cost_basis_removed)
      )
      AND ((holding_quantity_after = 0 AND holding_cost_basis_after = 0)
        OR (holding_quantity_after > 0 AND holding_cost_basis_after > 0))
    ),
    CONSTRAINT finance_stock_trades_status_ck CHECK (
      (status = 'pending' AND posted_transaction_id IS NULL
        AND transaction_payload_hash IS NULL AND posted_at IS NULL)
      OR (status = 'posted' AND posted_transaction_id IS NOT NULL
        AND transaction_payload_hash IS NOT NULL AND posted_at IS NOT NULL)
    )
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_stock_trades_id_class_uq
    ON finance_stock_trades(id, class_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_stock_trades_class_student_idempotency_uq
    ON finance_stock_trades(class_id, student_id, idempotency_key)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_stock_trades_posted_transaction_uq
    ON finance_stock_trades(posted_transaction_id)
    WHERE posted_transaction_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS finance_stock_trades_student_created_idx
    ON finance_stock_trades(student_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS finance_stock_trades_class_created_idx
    ON finance_stock_trades(class_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS finance_stock_liquidation_operations (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL, stock_id TEXT NOT NULL,
    student_id TEXT NOT NULL, teacher_id TEXT NOT NULL,
    root_idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
    origin TEXT NOT NULL, intervention_reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    snapshot_reference_price INTEGER NOT NULL,
    snapshot_spread INTEGER NOT NULL, snapshot_unit_price INTEGER NOT NULL,
    snapshot_fee_bps INTEGER NOT NULL,
    snapshot_denomination_step INTEGER NOT NULL,
    snapshot_stock_revision INTEGER NOT NULL,
    snapshot_market_revision INTEGER NOT NULL,
    snapshot_finance_settings_revision INTEGER NOT NULL,
    snapshot_holding_revision INTEGER NOT NULL,
    snapshot_wallet_revision INTEGER NOT NULL,
    snapshot_wallet_balance INTEGER NOT NULL,
    snapshot_student_status TEXT NOT NULL,
    snapshot_stock_status TEXT NOT NULL,
    snapshot_market_was_open INTEGER NOT NULL,
    initial_quantity INTEGER NOT NULL, remaining_quantity INTEGER NOT NULL,
    sold_quantity INTEGER NOT NULL, initial_cost_basis INTEGER NOT NULL,
    remaining_cost_basis INTEGER NOT NULL,
    expected_gross_amount INTEGER NOT NULL,
    expected_fee_amount INTEGER NOT NULL,
    expected_wallet_delta INTEGER NOT NULL,
    completed_chunk_count INTEGER NOT NULL DEFAULT 0,
    total_gross_amount INTEGER NOT NULL DEFAULT 0,
    total_fee_amount INTEGER NOT NULL DEFAULT 0,
    total_wallet_delta INTEGER NOT NULL DEFAULT 0,
    total_cost_basis_removed INTEGER NOT NULL DEFAULT 0,
    total_realized_gain INTEGER NOT NULL DEFAULT 0,
    next_chunk_index INTEGER NOT NULL DEFAULT 0,
    last_trade_id TEXT, revision INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    completed_at INTEGER, cancelled_at INTEGER,
    cancellation_reason TEXT, cancellation_idempotency_key TEXT,
    cancellation_payload_hash TEXT,
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (teacher_id) REFERENCES teachers(id),
    FOREIGN KEY (stock_id, class_id) REFERENCES finance_stocks(id, class_id),
    FOREIGN KEY (last_trade_id, class_id)
      REFERENCES finance_stock_trades(id, class_id),
    CONSTRAINT finance_stock_liquidation_operations_text_ck CHECK (
      LENGTH(TRIM(root_idempotency_key)) BETWEEN 8 AND 200
      AND LENGTH(TRIM(payload_hash)) BETWEEN 8 AND 500
      AND origin IN (
        'finance_center', 'student_exclusion', 'class_archive', 'account_recovery'
      )
      AND LENGTH(TRIM(intervention_reason)) BETWEEN 2 AND 300
    ),
    CONSTRAINT finance_stock_liquidation_operations_snapshot_ck CHECK (
      snapshot_reference_price BETWEEN 1 AND 1000000000
      AND snapshot_spread BETWEEN 0 AND 1000000000
      AND snapshot_unit_price = snapshot_reference_price - snapshot_spread
      AND snapshot_unit_price BETWEEN 1 AND 1000000000
      AND snapshot_fee_bps BETWEEN 0 AND 1000
      AND snapshot_denomination_step BETWEEN 1 AND 1000000000
      AND snapshot_reference_price % snapshot_denomination_step = 0
      AND snapshot_spread % snapshot_denomination_step = 0
      AND snapshot_stock_revision >= 0 AND snapshot_market_revision >= 0
      AND snapshot_finance_settings_revision >= 0
      AND snapshot_holding_revision > 0 AND snapshot_wallet_revision >= 0
      AND snapshot_wallet_balance BETWEEN 0 AND 1000000000
      AND snapshot_market_was_open IN (0, 1)
    ),
    CONSTRAINT finance_stock_liquidation_operations_progress_ck CHECK (
      initial_quantity BETWEEN 1 AND 1000000000
      AND remaining_quantity BETWEEN 0 AND initial_quantity
      AND sold_quantity = initial_quantity - remaining_quantity
      AND initial_cost_basis BETWEEN 1 AND 1000000000
      AND remaining_cost_basis BETWEEN 0 AND initial_cost_basis
      AND ((remaining_quantity = 0 AND remaining_cost_basis = 0)
        OR (remaining_quantity > 0 AND remaining_cost_basis > 0))
      AND expected_gross_amount = snapshot_unit_price * initial_quantity
      AND expected_gross_amount BETWEEN 1 AND 1111111111
      AND expected_fee_amount BETWEEN 0 AND expected_gross_amount
      AND expected_fee_amount <= CAST(
        expected_gross_amount * snapshot_fee_bps / 10000 AS INTEGER)
      AND expected_wallet_delta = expected_gross_amount - expected_fee_amount
      AND expected_wallet_delta > 0
      AND expected_wallet_delta <= 1000000000 - snapshot_wallet_balance
      AND completed_chunk_count BETWEEN 0 AND 2
      AND next_chunk_index = completed_chunk_count
      AND revision = completed_chunk_count
        + CASE status WHEN 'cancelled' THEN 1 ELSE 0 END
      AND total_gross_amount = snapshot_unit_price * sold_quantity
      AND total_fee_amount BETWEEN 0 AND total_gross_amount
      AND total_wallet_delta = total_gross_amount - total_fee_amount
      AND total_cost_basis_removed = initial_cost_basis - remaining_cost_basis
      AND total_realized_gain = total_wallet_delta - total_cost_basis_removed
    ),
    CONSTRAINT finance_stock_liquidation_operations_state_ck CHECK (
      (
        (status = 'running' AND remaining_quantity > 0
          AND completed_chunk_count < 2 AND completed_at IS NULL
          AND cancelled_at IS NULL AND cancellation_reason IS NULL
          AND cancellation_idempotency_key IS NULL
          AND cancellation_payload_hash IS NULL)
        OR (status = 'completed' AND remaining_quantity = 0
          AND remaining_cost_basis = 0 AND sold_quantity = initial_quantity
          AND total_gross_amount = expected_gross_amount
          AND total_fee_amount = expected_fee_amount
          AND total_wallet_delta = expected_wallet_delta
          AND total_cost_basis_removed = initial_cost_basis
          AND completed_at IS NOT NULL AND cancelled_at IS NULL
          AND cancellation_reason IS NULL
          AND cancellation_idempotency_key IS NULL
          AND cancellation_payload_hash IS NULL)
        OR (status = 'cancelled' AND remaining_quantity > 0
          AND completed_at IS NULL AND cancelled_at IS NOT NULL
          AND LENGTH(TRIM(COALESCE(cancellation_reason, ''))) BETWEEN 2 AND 300
          AND LENGTH(TRIM(COALESCE(cancellation_idempotency_key, '')))
            BETWEEN 8 AND 200
          AND LENGTH(TRIM(COALESCE(cancellation_payload_hash, '')))
            BETWEEN 8 AND 500)
      )
      AND ((completed_chunk_count = 0 AND last_trade_id IS NULL)
        OR (completed_chunk_count > 0 AND last_trade_id IS NOT NULL))
      AND updated_at >= created_at
      AND (completed_at IS NULL OR completed_at = updated_at)
      AND (cancelled_at IS NULL OR cancelled_at = updated_at)
    )
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS
      finance_stock_liquidation_operations_id_class_uq
    ON finance_stock_liquidation_operations(id, class_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS
      finance_stock_liquidation_operations_root_uq
    ON finance_stock_liquidation_operations(root_idempotency_key)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS
      finance_stock_liquidation_operations_running_uq
    ON finance_stock_liquidation_operations(class_id, stock_id, student_id)
    WHERE status = 'running'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS
      finance_stock_liquidation_operations_cancellation_uq
    ON finance_stock_liquidation_operations(cancellation_idempotency_key)
    WHERE cancellation_idempotency_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS
      finance_stock_liquidation_operations_class_status_idx
    ON finance_stock_liquidation_operations(class_id, status, updated_at)`,
  `CREATE TABLE IF NOT EXISTS finance_stock_liquidation_chunks (
    id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, class_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL, trade_id TEXT NOT NULL,
    quantity INTEGER NOT NULL, gross_amount INTEGER NOT NULL,
    fee_amount INTEGER NOT NULL, wallet_delta INTEGER NOT NULL,
    cost_basis_removed INTEGER NOT NULL, realized_gain INTEGER NOT NULL,
    holding_quantity_before INTEGER NOT NULL,
    holding_quantity_after INTEGER NOT NULL,
    holding_cost_basis_before INTEGER NOT NULL,
    holding_cost_basis_after INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (operation_id, class_id)
      REFERENCES finance_stock_liquidation_operations(id, class_id),
    FOREIGN KEY (trade_id, class_id)
      REFERENCES finance_stock_trades(id, class_id),
    CONSTRAINT finance_stock_liquidation_chunks_amount_ck CHECK (
      chunk_index BETWEEN 0 AND 1 AND quantity BETWEEN 1 AND 1000000000
      AND gross_amount BETWEEN 1 AND 1000000000
      AND fee_amount BETWEEN 0 AND gross_amount
      AND wallet_delta = gross_amount - fee_amount AND wallet_delta > 0
      AND cost_basis_removed BETWEEN 0 AND 1000000000
      AND realized_gain = wallet_delta - cost_basis_removed
    ),
    CONSTRAINT finance_stock_liquidation_chunks_holding_ck CHECK (
      holding_quantity_before BETWEEN 1 AND 1000000000
      AND holding_quantity_after = holding_quantity_before - quantity
      AND holding_quantity_after BETWEEN 0 AND 1000000000
      AND holding_cost_basis_before BETWEEN 1 AND 1000000000
      AND holding_cost_basis_after
        = holding_cost_basis_before - cost_basis_removed
      AND holding_cost_basis_after BETWEEN 0 AND 1000000000
      AND ((holding_quantity_after = 0 AND holding_cost_basis_after = 0)
        OR (holding_quantity_after > 0 AND holding_cost_basis_after > 0))
    )
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS
      finance_stock_liquidation_chunks_operation_index_uq
    ON finance_stock_liquidation_chunks(operation_id, chunk_index)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_stock_liquidation_chunks_trade_uq
    ON finance_stock_liquidation_chunks(trade_id)`,
  `CREATE INDEX IF NOT EXISTS finance_stock_liquidation_chunks_class_created_idx
    ON finance_stock_liquidation_chunks(class_id, created_at)`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_markets_insert_guard
    BEFORE INSERT ON finance_stock_markets
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM classes classroom WHERE classroom.id = NEW.class_id
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_MARKET_ACCESS_DENIED') END;
      SELECT CASE WHEN NEW.updated_by_teacher_id IS NULL AND (
        NEW.is_open <> 0 OR NEW.buy_fee_bps <> 0 OR NEW.sell_fee_bps <> 0
        OR NEW.buy_spread <> 0 OR NEW.sell_spread <> 0
        OR NEW.market_mood <> 'mixed' OR NEW.tick_interval_minutes <> 15
        OR NEW.next_tick_at IS NOT NULL OR NEW.revision <> 0
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_MARKET_INVALID_INITIAL_STATE') END;
      SELECT CASE WHEN NEW.updated_by_teacher_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM classes classroom
        WHERE classroom.id = NEW.class_id
          AND classroom.teacher_id = NEW.updated_by_teacher_id
          AND classroom.status = 'active'
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_MARKET_ACCESS_DENIED') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_markets_update_guard
    BEFORE UPDATE ON finance_stock_markets
    BEGIN
      SELECT CASE WHEN NEW.class_id <> OLD.class_id
        OR NEW.created_at <> OLD.created_at
        OR NEW.updated_at < OLD.updated_at
        THEN RAISE(ABORT, 'FINANCE_STOCK_MARKET_IMMUTABLE') END;
      SELECT CASE WHEN NOT (
        (
          NEW.updated_by_teacher_id IS NOT NULL
          AND NEW.revision = OLD.revision + 1
          AND (
            NEW.is_open <> OLD.is_open
            OR NEW.buy_fee_bps <> OLD.buy_fee_bps
            OR NEW.sell_fee_bps <> OLD.sell_fee_bps
            OR NEW.buy_spread <> OLD.buy_spread
            OR NEW.sell_spread <> OLD.sell_spread
            OR NEW.market_mood <> OLD.market_mood
            OR NEW.tick_interval_minutes <> OLD.tick_interval_minutes
            OR NEW.next_tick_at IS NOT OLD.next_tick_at
          )
          AND EXISTS (
            SELECT 1 FROM classes classroom
            WHERE classroom.id = NEW.class_id
              AND classroom.teacher_id = NEW.updated_by_teacher_id
              AND classroom.status = 'active'
          )
        )
        OR (
          NEW.updated_by_teacher_id IS OLD.updated_by_teacher_id
          AND NEW.revision = OLD.revision
          AND NEW.is_open = OLD.is_open
          AND NEW.buy_fee_bps = OLD.buy_fee_bps
          AND NEW.sell_fee_bps = OLD.sell_fee_bps
          AND NEW.buy_spread = OLD.buy_spread
          AND NEW.sell_spread = OLD.sell_spread
          AND NEW.market_mood = OLD.market_mood
          AND NEW.tick_interval_minutes = OLD.tick_interval_minutes
          AND NEW.next_tick_at IS NOT OLD.next_tick_at
          AND NEW.next_tick_at IS NOT NULL
          AND (OLD.next_tick_at IS NULL OR NEW.next_tick_at > OLD.next_tick_at)
        )
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_MARKET_STALE') END;
      SELECT CASE WHEN NEW.is_open = 1 AND NOT EXISTS (
        SELECT 1
        FROM finance_stocks stock
        JOIN finance_settings setting ON setting.class_id = stock.class_id
        WHERE stock.class_id = NEW.class_id
          AND stock.status <> 'archived'
          AND stock.current_price > NEW.sell_spread
          AND stock.current_price + NEW.buy_spread <= 1000000000
          AND stock.current_price % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
          AND NEW.buy_spread % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
          AND NEW.sell_spread % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_DENOMINATION_MISMATCH') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_markets_delete_guard
    BEFORE DELETE ON finance_stock_markets
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_MARKET_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_market_events_insert_guard
    BEFORE INSERT ON finance_stock_market_events
    BEGIN
      SELECT CASE WHEN json_valid(NEW.market_snapshot_json) <> 1
        OR (NEW.previous_snapshot_json IS NOT NULL
          AND json_valid(NEW.previous_snapshot_json) <> 1)
        OR NOT EXISTS (
          SELECT 1
          FROM finance_stock_markets market
          JOIN classes classroom ON classroom.id = market.class_id
          WHERE market.class_id = NEW.class_id
            AND market.revision = NEW.revision
            AND market.updated_by_teacher_id = NEW.actor_teacher_id
            AND classroom.teacher_id = NEW.actor_teacher_id
            AND classroom.status = 'active'
            AND (
              (NEW.action = 'opened' AND market.is_open = 1)
              OR (NEW.action = 'closed' AND market.is_open = 0)
              OR NEW.action IN ('configured', 'updated')
            )
        )
        THEN RAISE(ABORT, 'FINANCE_STOCK_MARKET_EVENT_INVALID') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_market_events_update_guard
    BEFORE UPDATE ON finance_stock_market_events
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_MARKET_EVENT_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_market_events_delete_guard
    BEFORE DELETE ON finance_stock_market_events
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_MARKET_EVENT_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_settings_stock_denomination_guard
    BEFORE UPDATE OF denominations_json ON finance_settings
    WHEN NEW.denominations_json <> OLD.denominations_json
      AND json_valid(NEW.denominations_json) = 1
      AND EXISTS (
        SELECT 1
        FROM finance_stock_markets market
        JOIN finance_stocks stock ON stock.class_id = market.class_id
        WHERE market.class_id = NEW.class_id
          AND market.is_open = 1
          AND stock.status <> 'archived'
          AND (
            stock.current_price % (
              SELECT MIN(CAST(value AS INTEGER))
              FROM json_each(NEW.denominations_json)
            ) <> 0
            OR market.buy_spread % (
              SELECT MIN(CAST(value AS INTEGER))
              FROM json_each(NEW.denominations_json)
            ) <> 0
            OR market.sell_spread % (
              SELECT MIN(CAST(value AS INTEGER))
              FROM json_each(NEW.denominations_json)
            ) <> 0
          )
      )
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_DENOMINATION_MISMATCH'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stocks_insert_guard
    BEFORE INSERT ON finance_stocks
    BEGIN
      SELECT CASE WHEN NEW.revision <> 0 OR NEW.inventory_revision <> 0
        OR NEW.initial_price <> NEW.current_price
        OR NEW.previous_price <> NEW.current_price
        OR NEW.available_shares <> NEW.total_shares
        OR NEW.last_trade_id IS NOT NULL
        OR NEW.status <> 'active'
        OR NEW.updated_by_actor_type <> 'teacher'
        OR NEW.updated_by_teacher_id <> NEW.created_by_teacher_id
        THEN RAISE(ABORT, 'FINANCE_STOCK_INVALID_INITIAL_STATE') END;
      SELECT CASE WHEN NEW.symbol <> UPPER(NEW.symbol)
        OR NEW.symbol GLOB '*[^A-Z0-9_-]*'
        THEN RAISE(ABORT, 'FINANCE_STOCK_INVALID_SYMBOL') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM classes classroom
        JOIN finance_stock_markets market ON market.class_id = classroom.id
        JOIN finance_settings setting ON setting.class_id = classroom.id
        WHERE classroom.id = NEW.class_id
          AND classroom.teacher_id = NEW.created_by_teacher_id
          AND classroom.status = 'active'
          AND NEW.current_price > market.sell_spread
          AND NEW.current_price + market.buy_spread <= 1000000000
          AND NEW.current_price % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
          AND market.buy_spread % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
          AND market.sell_spread % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_ACCESS_OR_DENOMINATION_DENIED') END;
    END`,
  `DROP TRIGGER IF EXISTS finance_stocks_management_update_guard`,
  `CREATE TRIGGER IF NOT EXISTS finance_stocks_management_update_guard
    BEFORE UPDATE ON finance_stocks
    WHEN NEW.last_trade_id IS OLD.last_trade_id
    BEGIN
      SELECT CASE WHEN NEW.id <> OLD.id OR NEW.class_id <> OLD.class_id
        OR NEW.name <> OLD.name OR NEW.symbol <> OLD.symbol
        OR NEW.description <> OLD.description
        OR NEW.initial_price <> OLD.initial_price
        OR NEW.total_shares <> OLD.total_shares
        OR NEW.max_shares_per_student <> OLD.max_shares_per_student
        OR NEW.available_shares <> OLD.available_shares
        OR NEW.inventory_revision <> OLD.inventory_revision
        OR NEW.created_by_teacher_id <> OLD.created_by_teacher_id
        OR NEW.created_at <> OLD.created_at OR NEW.updated_at < OLD.updated_at
        OR NEW.revision <> OLD.revision + 1
        OR NEW.previous_price <> CASE
          WHEN NEW.current_price <> OLD.current_price THEN OLD.current_price
          ELSE OLD.previous_price END
        THEN RAISE(ABORT, 'FINANCE_STOCK_STALE') END;
      SELECT CASE WHEN NEW.updated_by_actor_type = 'teacher' AND NOT EXISTS (
        SELECT 1 FROM classes classroom
        WHERE classroom.id = NEW.class_id
          AND classroom.teacher_id = NEW.updated_by_teacher_id
          AND classroom.status = 'active'
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_ACCESS_DENIED') END;
      SELECT CASE WHEN NEW.updated_by_actor_type = 'system' AND (
        NEW.updated_by_teacher_id IS NOT NULL
        OR NEW.status <> OLD.status
        OR OLD.status NOT IN ('active', 'sell_only')
        OR NOT EXISTS (
          SELECT 1 FROM finance_stock_markets market
          WHERE market.class_id = NEW.class_id AND market.is_open = 1
        )
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_SYSTEM_UPDATE_DENIED') END;
      SELECT CASE WHEN OLD.status = 'archived' AND NEW.status <> 'archived'
        THEN RAISE(ABORT, 'FINANCE_STOCK_IMMUTABLE') END;
      SELECT CASE WHEN NEW.status = 'archived'
        AND NEW.available_shares <> NEW.total_shares
        THEN RAISE(ABORT, 'FINANCE_STOCK_ACTIVE_HOLDINGS') END;
      SELECT CASE WHEN NEW.current_price > OLD.current_price AND EXISTS (
        SELECT 1 FROM finance_stock_holdings holding
        WHERE holding.class_id = NEW.class_id
          AND holding.stock_id = NEW.id
          AND holding.quantity > CAST(1000000000 / NEW.current_price AS INTEGER)
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_POSITION_VALUE_LIMIT') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_markets market
        JOIN finance_settings setting ON setting.class_id = market.class_id
        WHERE market.class_id = NEW.class_id
          AND NEW.current_price > market.sell_spread
          AND NEW.current_price + market.buy_spread <= 1000000000
          AND NEW.current_price % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
          AND market.buy_spread % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
          AND market.sell_spread % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_DENOMINATION_MISMATCH') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_events_insert_guard
    BEFORE INSERT ON finance_stock_events
    BEGIN
      SELECT CASE WHEN json_valid(NEW.stock_snapshot_json) <> 1
        OR (NEW.previous_snapshot_json IS NOT NULL
          AND json_valid(NEW.previous_snapshot_json) <> 1)
        OR NOT EXISTS (
          SELECT 1
          FROM finance_stocks stock
          JOIN classes classroom ON classroom.id = stock.class_id
          WHERE stock.id = NEW.stock_id AND stock.class_id = NEW.class_id
            AND stock.revision = NEW.revision
            AND (
              (NEW.action = 'issued' AND NEW.revision = 0
                AND NEW.actor_type = 'teacher'
                AND NEW.actor_teacher_id = stock.created_by_teacher_id
                AND NEW.previous_snapshot_json IS NULL)
              OR (NEW.action <> 'issued' AND NEW.revision > 0
                AND NEW.actor_type = stock.updated_by_actor_type
                AND NEW.actor_teacher_id IS stock.updated_by_teacher_id)
            )
            AND (
              NEW.actor_type = 'system'
              OR (classroom.teacher_id = NEW.actor_teacher_id
                AND classroom.status = 'active')
            )
            AND (
              NEW.action NOT IN ('price_changed', 'automatic_tick', 'news_tick')
              OR EXISTS (
                SELECT 1 FROM finance_stock_markets market
                WHERE market.class_id = NEW.class_id
                  AND market.revision = CAST(
                    json_extract(NEW.stock_snapshot_json, '$.marketRevision')
                    AS INTEGER
                  )
              )
            )
        )
        THEN RAISE(ABORT, 'FINANCE_STOCK_EVENT_INVALID') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_events_update_guard
    BEFORE UPDATE ON finance_stock_events
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_EVENT_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_events_delete_guard
    BEFORE DELETE ON finance_stock_events
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_EVENT_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_news_insert_guard
    BEFORE INSERT ON finance_stock_news
    BEGIN
      SELECT CASE WHEN NEW.status <> 'active' OR NEW.revision <> 0
        OR NEW.updated_by_actor_type <> 'teacher'
        OR NEW.updated_by_teacher_id <> NEW.created_by_teacher_id
        OR NEW.cancelled_at IS NOT NULL OR NEW.cancellation_reason IS NOT NULL
        OR NEW.cancellation_idempotency_key IS NOT NULL
        OR NEW.cancellation_payload_hash IS NOT NULL
        OR NOT EXISTS (
          SELECT 1 FROM classes classroom
          WHERE classroom.id = NEW.class_id
            AND classroom.teacher_id = NEW.created_by_teacher_id
            AND classroom.status = 'active'
        )
        THEN RAISE(ABORT, 'FINANCE_STOCK_NEWS_ACCESS_DENIED') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_news_update_guard
    BEFORE UPDATE ON finance_stock_news
    BEGIN
      SELECT CASE WHEN NEW.id <> OLD.id OR NEW.class_id <> OLD.class_id
        OR NEW.title <> OLD.title OR NEW.content <> OLD.content
        OR NEW.impact_bps <> OLD.impact_bps
        OR NEW.idempotency_key <> OLD.idempotency_key
        OR NEW.payload_hash <> OLD.payload_hash
        OR NEW.created_by_teacher_id <> OLD.created_by_teacher_id
        OR NEW.created_at <> OLD.created_at OR NEW.expires_at <> OLD.expires_at
        OR NEW.revision <> OLD.revision + 1 OR OLD.status <> 'active'
        OR NEW.updated_at < OLD.updated_at
        THEN RAISE(ABORT, 'FINANCE_STOCK_NEWS_IMMUTABLE') END;
      SELECT CASE WHEN NEW.status = 'cancelled' AND NOT (
        NEW.updated_by_actor_type = 'teacher'
        AND NEW.updated_by_teacher_id IS NOT NULL
        AND NEW.cancelled_at IS NOT NULL
        AND NEW.cancelled_at = NEW.updated_at
        AND NEW.cancellation_idempotency_key IS NOT NULL
        AND NEW.cancellation_payload_hash IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM classes classroom
          WHERE classroom.id = NEW.class_id
            AND classroom.teacher_id = NEW.updated_by_teacher_id
            AND classroom.status = 'active'
        )
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_NEWS_ACCESS_DENIED') END;
      SELECT CASE WHEN NEW.status = 'expired' AND NOT (
        NEW.updated_by_actor_type = 'system'
        AND NEW.updated_by_teacher_id IS NULL
        AND NEW.cancelled_at IS NULL
        AND NEW.cancellation_reason IS NULL
        AND NEW.cancellation_idempotency_key IS NULL
        AND NEW.cancellation_payload_hash IS NULL
        AND NEW.updated_at >= NEW.expires_at
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_NEWS_INVALID_EXPIRY') END;
      SELECT CASE WHEN NEW.status NOT IN ('cancelled', 'expired')
        THEN RAISE(ABORT, 'FINANCE_STOCK_NEWS_INVALID_TRANSITION') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_news_delete_guard
    BEFORE DELETE ON finance_stock_news
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_NEWS_IMMUTABLE'); END`,
  `DROP TRIGGER IF EXISTS finance_stock_trades_insert_guard`,
  `DROP TRIGGER IF EXISTS finance_stock_trades_initial_guard`,
  `DROP TRIGGER IF EXISTS finance_stock_trades_liquidation_live_guard`,
  `DROP TRIGGER IF EXISTS finance_stock_trades_liquidation_economics_guard`,
  `DROP TRIGGER IF EXISTS finance_stock_trades_liquidation_metadata_guard`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_trades_initial_guard
    BEFORE INSERT ON finance_stock_trades
    BEGIN
      SELECT CASE WHEN NEW.status <> 'pending'
        OR NEW.posted_transaction_id IS NOT NULL
        OR NEW.transaction_payload_hash IS NOT NULL
        OR NEW.posted_at IS NOT NULL
        THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_INVALID_INITIAL_STATE') END;
      SELECT CASE WHEN NEW.side = 'buy' AND EXISTS (
        SELECT 1 FROM finance_stocks stock
        WHERE stock.id = NEW.stock_id AND stock.class_id = NEW.class_id
          AND NEW.holding_quantity_after
            > CAST(1000000000 / stock.current_price AS INTEGER)
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_POSITION_VALUE_LIMIT') END;
      SELECT CASE WHEN COALESCE((
          SELECT holding.quantity FROM finance_stock_holdings holding
          WHERE holding.class_id = NEW.class_id
            AND holding.stock_id = NEW.stock_id
            AND holding.student_id = NEW.student_id
        ), 0) <> NEW.holding_quantity_before
        THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
      SELECT CASE WHEN COALESCE((
          SELECT holding.cost_basis FROM finance_stock_holdings holding
          WHERE holding.class_id = NEW.class_id
            AND holding.stock_id = NEW.stock_id
            AND holding.student_id = NEW.student_id
        ), 0) <> NEW.holding_cost_basis_before
        THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
      SELECT CASE WHEN COALESCE((
          SELECT holding.revision FROM finance_stock_holdings holding
          WHERE holding.class_id = NEW.class_id
            AND holding.stock_id = NEW.stock_id
            AND holding.student_id = NEW.student_id
        ), 0) <> NEW.holding_revision_before
        THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_trades_insert_guard
    BEFORE INSERT ON finance_stock_trades
    WHEN NOT EXISTS (
      SELECT 1 FROM finance_stock_liquidation_operations operation
      WHERE operation.class_id = NEW.class_id
        AND operation.stock_id = NEW.stock_id
        AND operation.student_id = NEW.student_id
        AND operation.status = 'running'
    )
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stocks stock
        JOIN finance_stock_markets market ON market.class_id = stock.class_id
        JOIN finance_settings setting ON setting.class_id = stock.class_id
        JOIN students student ON student.id = NEW.student_id
          AND student.class_id = stock.class_id
        JOIN finance_accounts wallet ON wallet.id = NEW.wallet_account_id
          AND wallet.class_id = stock.class_id
          AND wallet.student_id = student.id
          AND wallet.account_type = 'student_wallet'
          AND wallet.status = 'active'
        WHERE stock.id = NEW.stock_id AND stock.class_id = NEW.class_id
          AND stock.revision = NEW.stock_revision
          AND stock.inventory_revision = NEW.inventory_revision_before
          AND stock.available_shares = NEW.available_shares_before
          AND setting.revision = NEW.finance_settings_revision
          AND market.revision = NEW.market_revision
          AND wallet.revision = NEW.wallet_revision_before
          AND NEW.reference_price = stock.current_price
          AND NEW.spread_snapshot = CASE NEW.side
            WHEN 'buy' THEN market.buy_spread ELSE market.sell_spread END
          AND NEW.fee_bps_snapshot = CASE NEW.side
            WHEN 'buy' THEN market.buy_fee_bps ELSE market.sell_fee_bps END
          AND NEW.reference_price > market.sell_spread
          AND NEW.reference_price + market.buy_spread <= 1000000000
          AND NEW.reference_price % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
          AND NEW.spread_snapshot % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
          AND NEW.fee_amount = CAST(
            CAST((NEW.gross_amount * NEW.fee_bps_snapshot) / 10000 AS INTEGER)
              / (
                SELECT MIN(CAST(value AS INTEGER))
                FROM json_each(setting.denominations_json)
              ) AS INTEGER
          ) * (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          )
          AND NEW.available_shares_after BETWEEN 0 AND stock.total_shares
          AND NEW.holding_quantity_after <= stock.max_shares_per_student
          AND (
            (
              student.status = 'active'
              AND market.is_open = 1
              AND stock.status IN ('active', 'sell_only')
              AND (NEW.side = 'sell' OR stock.status = 'active')
            )
            OR (
              NEW.side = 'sell'
              AND student.status IN ('active', 'locked', 'reset_required', 'pending')
              AND stock.status IN ('active', 'sell_only', 'halted')
              AND EXISTS (
                SELECT 1
                FROM finance_transactions transaction_row
                JOIN classes classroom ON classroom.id = transaction_row.class_id
                WHERE transaction_row.class_id = NEW.class_id
                  AND transaction_row.status = 'pending'
                  AND transaction_row.transaction_type = 'stock_sell'
                  AND transaction_row.source_type = 'stock_trade'
                  AND transaction_row.source_id = NEW.id
                  AND transaction_row.idempotency_key = 'stock-trade:' || NEW.id || ':ledger'
                  AND transaction_row.actor_type = 'teacher'
                  AND transaction_row.actor_teacher_id = classroom.teacher_id
                  AND transaction_row.actor_student_id IS NULL
                  AND transaction_row.actor_job_period_id IS NULL
                  AND classroom.status = 'active'
              )
            )
          )
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_trades_liquidation_live_guard
    BEFORE INSERT ON finance_stock_trades
    WHEN EXISTS (
      SELECT 1 FROM finance_stock_liquidation_operations operation
      WHERE operation.class_id = NEW.class_id
        AND operation.stock_id = NEW.stock_id
        AND operation.student_id = NEW.student_id
        AND operation.status = 'running'
    )
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_liquidation_operations operation
        JOIN finance_stocks stock ON stock.id = operation.stock_id
          AND stock.class_id = operation.class_id
        JOIN finance_stock_markets market ON market.class_id = operation.class_id
        JOIN finance_settings setting ON setting.class_id = operation.class_id
        JOIN students student ON student.id = operation.student_id
          AND student.class_id = operation.class_id
        JOIN finance_stock_holdings holding
          ON holding.class_id = operation.class_id
          AND holding.stock_id = operation.stock_id
          AND holding.student_id = operation.student_id
        JOIN finance_accounts wallet ON wallet.id = holding.wallet_account_id
          AND wallet.class_id = operation.class_id
          AND wallet.student_id = operation.student_id
          AND wallet.account_type = 'student_wallet' AND wallet.status = 'active'
        WHERE operation.class_id = NEW.class_id
          AND operation.stock_id = NEW.stock_id
          AND operation.student_id = NEW.student_id
          AND operation.status = 'running' AND NEW.side = 'sell'
          AND stock.inventory_revision = NEW.inventory_revision_before
          AND stock.available_shares = NEW.available_shares_before
          AND wallet.revision = NEW.wallet_revision_before
          AND NEW.stock_revision = stock.revision
          AND NEW.market_revision = market.revision
          AND NEW.finance_settings_revision = setting.revision
          AND student.status IN ('active', 'locked', 'reset_required', 'pending')
          AND stock.status IN ('active', 'sell_only', 'halted')
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_trades_liquidation_economics_guard
    BEFORE INSERT ON finance_stock_trades
    WHEN EXISTS (
      SELECT 1 FROM finance_stock_liquidation_operations operation
      WHERE operation.class_id = NEW.class_id
        AND operation.stock_id = NEW.stock_id
        AND operation.student_id = NEW.student_id
        AND operation.status = 'running'
    )
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_liquidation_operations operation
        JOIN finance_stocks stock ON stock.id = operation.stock_id
          AND stock.class_id = operation.class_id
        WHERE operation.class_id = NEW.class_id
          AND operation.stock_id = NEW.stock_id
          AND operation.student_id = NEW.student_id
          AND operation.status = 'running'
          AND NEW.reference_price = operation.snapshot_reference_price
          AND NEW.spread_snapshot = operation.snapshot_spread
          AND NEW.unit_price = operation.snapshot_unit_price
          AND NEW.fee_bps_snapshot = operation.snapshot_fee_bps
          AND NEW.fee_amount = CAST(
            CAST((NEW.gross_amount * NEW.fee_bps_snapshot) / 10000 AS INTEGER)
              / operation.snapshot_denomination_step AS INTEGER
          ) * operation.snapshot_denomination_step
          AND NEW.quantity = CASE
            WHEN operation.remaining_quantity * operation.snapshot_unit_price
              <= 1000000000 THEN operation.remaining_quantity
            ELSE CAST(1000000000 / operation.snapshot_unit_price AS INTEGER)
          END
          AND NEW.available_shares_after BETWEEN 0 AND stock.total_shares
          AND NEW.holding_quantity_before = operation.remaining_quantity
          AND NEW.holding_cost_basis_before = operation.remaining_cost_basis
          AND NEW.holding_revision_before
            = operation.snapshot_holding_revision + operation.completed_chunk_count
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_trades_liquidation_metadata_guard
    BEFORE INSERT ON finance_stock_trades
    WHEN EXISTS (
      SELECT 1 FROM finance_stock_liquidation_operations operation
      WHERE operation.class_id = NEW.class_id
        AND operation.stock_id = NEW.stock_id
        AND operation.student_id = NEW.student_id
        AND operation.status = 'running'
    )
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_liquidation_operations operation
        JOIN finance_transactions transaction_row
          ON transaction_row.class_id = operation.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND transaction_row.status = 'pending'
        WHERE operation.class_id = NEW.class_id
          AND operation.stock_id = NEW.stock_id
          AND operation.student_id = NEW.student_id
          AND operation.status = 'running'
          AND transaction_row.actor_type = 'teacher'
          AND transaction_row.actor_teacher_id = operation.teacher_id
          AND transaction_row.actor_student_id IS NULL
          AND transaction_row.actor_job_period_id IS NULL
          AND json_valid(transaction_row.metadata_json) = 1
          AND json_extract(transaction_row.metadata_json, '$.operationId')
            = operation.id
          AND json_extract(transaction_row.metadata_json, '$.rootIdempotencyKey')
            = operation.root_idempotency_key
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.chunkIndex'
          ) AS INTEGER) = operation.next_chunk_index
          AND json_extract(transaction_row.metadata_json, '$.liquidationPolicy')
            = 'frozen_quote_resumable'
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.frozenStockRevision'
          ) AS INTEGER) = operation.snapshot_stock_revision
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.frozenMarketRevision'
          ) AS INTEGER) = operation.snapshot_market_revision
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.frozenFinanceSettingsRevision'
          ) AS INTEGER) = operation.snapshot_finance_settings_revision
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.frozenDenominationStep'
          ) AS INTEGER) = operation.snapshot_denomination_step
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
    END`,
  `DROP TRIGGER IF EXISTS finance_stock_trades_teacher_insert_guard`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_trades_teacher_insert_guard
    BEFORE INSERT ON finance_stock_trades
    WHEN EXISTS (
      SELECT 1 FROM finance_transactions transaction_row
      WHERE transaction_row.class_id = NEW.class_id
        AND transaction_row.source_type = 'stock_trade'
        AND transaction_row.source_id = NEW.id
        AND transaction_row.status = 'pending'
        AND transaction_row.actor_type = 'teacher'
    ) AND NOT EXISTS (
      SELECT 1
      FROM finance_transactions transaction_row
      JOIN finance_stock_liquidation_operations operation
        ON operation.class_id = transaction_row.class_id
        AND operation.id = json_extract(
          transaction_row.metadata_json, '$.operationId'
        )
      WHERE transaction_row.class_id = NEW.class_id
        AND transaction_row.source_type = 'stock_trade'
        AND transaction_row.source_id = NEW.id
        AND transaction_row.status = 'pending'
        AND transaction_row.actor_type = 'teacher'
        AND operation.status = 'running'
        AND operation.stock_id = NEW.stock_id
        AND operation.student_id = NEW.student_id
        AND json_extract(transaction_row.metadata_json, '$.rootIdempotencyKey')
          = operation.root_idempotency_key
        AND CAST(json_extract(
          transaction_row.metadata_json, '$.chunkIndex'
        ) AS INTEGER) = operation.next_chunk_index
    )
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_transactions transaction_row
        WHERE transaction_row.class_id = NEW.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND json_valid(transaction_row.metadata_json) = 1
          AND json_extract(transaction_row.metadata_json, '$.isEmergency') = 1
          AND json_extract(transaction_row.metadata_json, '$.liquidationPolicy')
            = 'current_market_terms_at_liquidation'
          AND json_extract(transaction_row.metadata_json, '$.origin') IN (
            'finance_center', 'student_exclusion', 'class_archive', 'account_recovery'
          )
          AND json_type(transaction_row.metadata_json, '$.operationId') = 'text'
          AND LENGTH(TRIM(CAST(json_extract(
            transaction_row.metadata_json, '$.operationId'
          ) AS TEXT))) BETWEEN 8 AND 160
          AND json_type(transaction_row.metadata_json, '$.interventionReason') = 'text'
          AND LENGTH(TRIM(CAST(json_extract(
            transaction_row.metadata_json, '$.interventionReason'
          ) AS TEXT))) BETWEEN 2 AND 300
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_transactions transaction_row
        WHERE transaction_row.class_id = NEW.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND json_extract(transaction_row.metadata_json, '$.studentId') = NEW.student_id
          AND json_extract(transaction_row.metadata_json, '$.stockId') = NEW.stock_id
          AND json_extract(transaction_row.metadata_json, '$.side') = NEW.side
          AND CAST(json_extract(transaction_row.metadata_json, '$.quantity') AS INTEGER) = NEW.quantity
          AND CAST(json_extract(transaction_row.metadata_json, '$.referencePrice') AS INTEGER) = NEW.reference_price
          AND CAST(json_extract(transaction_row.metadata_json, '$.spreadSnapshot') AS INTEGER) = NEW.spread_snapshot
          AND CAST(json_extract(transaction_row.metadata_json, '$.unitPrice') AS INTEGER) = NEW.unit_price
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_transactions transaction_row
        WHERE transaction_row.class_id = NEW.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND CAST(json_extract(transaction_row.metadata_json, '$.grossAmount') AS INTEGER) = NEW.gross_amount
          AND CAST(json_extract(transaction_row.metadata_json, '$.feeBpsSnapshot') AS INTEGER) = NEW.fee_bps_snapshot
          AND CAST(json_extract(transaction_row.metadata_json, '$.feeAmount') AS INTEGER) = NEW.fee_amount
          AND CAST(json_extract(transaction_row.metadata_json, '$.walletDelta') AS INTEGER) = NEW.wallet_delta
          AND CAST(json_extract(transaction_row.metadata_json, '$.costBasisRemoved') AS INTEGER) = NEW.cost_basis_removed
          AND CAST(json_extract(transaction_row.metadata_json, '$.realizedGain') AS INTEGER) = NEW.realized_gain
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_transactions transaction_row
        WHERE transaction_row.class_id = NEW.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND CAST(json_extract(transaction_row.metadata_json, '$.stockRevision') AS INTEGER) = NEW.stock_revision
          AND CAST(json_extract(transaction_row.metadata_json, '$.inventoryRevisionBefore') AS INTEGER) = NEW.inventory_revision_before
          AND CAST(json_extract(transaction_row.metadata_json, '$.marketRevision') AS INTEGER) = NEW.market_revision
          AND CAST(json_extract(transaction_row.metadata_json, '$.financeSettingsRevision') AS INTEGER) = NEW.finance_settings_revision
          AND CAST(json_extract(transaction_row.metadata_json, '$.walletRevisionBefore') AS INTEGER) = NEW.wallet_revision_before
          AND CAST(json_extract(transaction_row.metadata_json, '$.holdingRevisionBefore') AS INTEGER) = NEW.holding_revision_before
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_transactions transaction_row
        WHERE transaction_row.class_id = NEW.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND CAST(json_extract(transaction_row.metadata_json, '$.availableSharesBefore') AS INTEGER) = NEW.available_shares_before
          AND CAST(json_extract(transaction_row.metadata_json, '$.availableSharesAfter') AS INTEGER) = NEW.available_shares_after
          AND CAST(json_extract(transaction_row.metadata_json, '$.holdingQuantityBefore') AS INTEGER) = NEW.holding_quantity_before
          AND CAST(json_extract(transaction_row.metadata_json, '$.holdingQuantityAfter') AS INTEGER) = NEW.holding_quantity_after
          AND CAST(json_extract(transaction_row.metadata_json, '$.holdingCostBasisBefore') AS INTEGER) = NEW.holding_cost_basis_before
          AND CAST(json_extract(transaction_row.metadata_json, '$.holdingCostBasisAfter') AS INTEGER) = NEW.holding_cost_basis_after
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_transactions transaction_row
        JOIN students student ON student.id = NEW.student_id
          AND student.class_id = NEW.class_id
        JOIN finance_stocks stock ON stock.id = NEW.stock_id
          AND stock.class_id = NEW.class_id
        JOIN finance_stock_markets market ON market.class_id = NEW.class_id
        WHERE transaction_row.class_id = NEW.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND json_extract(transaction_row.metadata_json, '$.studentStatusSnapshot') = student.status
          AND CAST(json_extract(transaction_row.metadata_json, '$.marketWasOpen') AS INTEGER) = market.is_open
          AND json_extract(transaction_row.metadata_json, '$.stockStatusSnapshot') = stock.status
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_holdings_insert_guard
    BEFORE INSERT ON finance_stock_holdings
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_trades trade
        JOIN students student ON student.id = trade.student_id
          AND student.class_id = trade.class_id AND student.status = 'active'
        JOIN finance_accounts wallet ON wallet.id = trade.wallet_account_id
          AND wallet.class_id = trade.class_id
          AND wallet.student_id = trade.student_id
          AND wallet.account_type = 'student_wallet'
        WHERE trade.id = NEW.last_trade_id AND trade.status = 'pending'
          AND trade.side = 'buy'
          AND trade.class_id = NEW.class_id AND trade.stock_id = NEW.stock_id
          AND trade.student_id = NEW.student_id
          AND trade.wallet_account_id = NEW.wallet_account_id
          AND trade.holding_quantity_before = 0
          AND trade.holding_cost_basis_before = 0
          AND trade.holding_revision_before = 0
          AND trade.holding_quantity_after = NEW.quantity
          AND trade.holding_cost_basis_after = NEW.cost_basis
          AND trade.holding_revision_after = NEW.revision
          AND NEW.created_at = trade.created_at
          AND NEW.updated_at = trade.created_at
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_PROJECTION_MISMATCH') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_holdings_update_guard
    BEFORE UPDATE ON finance_stock_holdings
    BEGIN
      SELECT CASE WHEN NEW.id <> OLD.id OR NEW.class_id <> OLD.class_id
        OR NEW.stock_id <> OLD.stock_id OR NEW.student_id <> OLD.student_id
        OR NEW.wallet_account_id <> OLD.wallet_account_id
        OR NEW.created_at <> OLD.created_at
        OR NEW.revision <> OLD.revision + 1
        OR NEW.last_trade_id = OLD.last_trade_id
        OR NOT EXISTS (
          SELECT 1 FROM finance_stock_trades trade
          WHERE trade.id = NEW.last_trade_id AND trade.status = 'pending'
            AND trade.class_id = NEW.class_id AND trade.stock_id = NEW.stock_id
            AND trade.student_id = NEW.student_id
            AND trade.wallet_account_id = NEW.wallet_account_id
            AND trade.holding_quantity_before = OLD.quantity
            AND trade.holding_quantity_after = NEW.quantity
            AND trade.holding_cost_basis_before = OLD.cost_basis
            AND trade.holding_cost_basis_after = NEW.cost_basis
            AND trade.holding_revision_before = OLD.revision
            AND trade.holding_revision_after = NEW.revision
            AND NEW.updated_at = trade.created_at
        )
        THEN RAISE(ABORT, 'FINANCE_STOCK_PROJECTION_MISMATCH') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_holdings_delete_guard
    BEFORE DELETE ON finance_stock_holdings
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_HOLDING_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stocks_inventory_update_guard
    BEFORE UPDATE ON finance_stocks
    WHEN NEW.last_trade_id IS NOT OLD.last_trade_id
    BEGIN
      SELECT CASE WHEN NEW.id <> OLD.id OR NEW.class_id <> OLD.class_id
        OR NEW.name <> OLD.name OR NEW.symbol <> OLD.symbol
        OR NEW.description <> OLD.description
        OR NEW.initial_price <> OLD.initial_price
        OR NEW.current_price <> OLD.current_price
        OR NEW.previous_price <> OLD.previous_price
        OR NEW.total_shares <> OLD.total_shares
        OR NEW.max_shares_per_student <> OLD.max_shares_per_student
        OR NEW.status <> OLD.status OR NEW.revision <> OLD.revision
        OR NEW.created_by_teacher_id <> OLD.created_by_teacher_id
        OR NEW.updated_by_actor_type <> OLD.updated_by_actor_type
        OR NEW.updated_by_teacher_id IS NOT OLD.updated_by_teacher_id
        OR NEW.created_at <> OLD.created_at
        OR NEW.inventory_revision <> OLD.inventory_revision + 1
        OR NOT EXISTS (
          SELECT 1 FROM finance_stock_trades trade
          WHERE trade.id = NEW.last_trade_id AND trade.status = 'pending'
            AND trade.class_id = NEW.class_id AND trade.stock_id = NEW.id
            AND trade.stock_revision = OLD.revision
            AND trade.inventory_revision_before = OLD.inventory_revision
            AND trade.inventory_revision_after = NEW.inventory_revision
            AND trade.available_shares_before = OLD.available_shares
            AND trade.available_shares_after = NEW.available_shares
            AND NEW.updated_at = trade.created_at
        )
        THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stocks_delete_guard
    BEFORE DELETE ON finance_stocks
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_trades_identity_update_guard
    BEFORE UPDATE OF
      id, class_id, stock_id, stock_revision,
      inventory_revision_before, inventory_revision_after,
      market_revision, finance_settings_revision, student_id,
      wallet_account_id, wallet_revision_before, wallet_revision_after,
      side, quantity, reference_price, spread_snapshot, unit_price,
      gross_amount, fee_bps_snapshot, fee_amount, wallet_delta,
      available_shares_before, available_shares_after,
      holding_quantity_before, holding_quantity_after,
      holding_cost_basis_before, holding_cost_basis_after,
      holding_revision_before, holding_revision_after,
      cost_basis_removed, realized_gain, idempotency_key,
      payload_hash, created_at
    ON finance_stock_trades
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_TRADE_IMMUTABLE'); END`,
  `DROP TRIGGER IF EXISTS finance_stock_trades_finalize_guard`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_trades_finalize_guard
    BEFORE UPDATE OF status, posted_transaction_id,
      transaction_payload_hash, posted_at ON finance_stock_trades
    BEGIN
      SELECT CASE WHEN OLD.status <> 'pending' OR NEW.status <> 'posted'
        OR OLD.posted_transaction_id IS NOT NULL
        OR OLD.transaction_payload_hash IS NOT NULL OR OLD.posted_at IS NOT NULL
        OR NEW.posted_transaction_id IS NULL
        OR NEW.transaction_payload_hash IS NULL OR NEW.posted_at IS NULL
        OR NEW.posted_at < NEW.created_at
        THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_INVALID_TRANSITION') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_transactions transaction_row
        WHERE transaction_row.id = NEW.posted_transaction_id
          AND transaction_row.class_id = NEW.class_id
          AND transaction_row.status = 'posted'
          AND transaction_row.transaction_type = CASE NEW.side
            WHEN 'buy' THEN 'stock_buy' ELSE 'stock_sell' END
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND (
            (
              transaction_row.actor_type = 'system'
              AND COALESCE(json_extract(
                transaction_row.metadata_json, '$.isEmergency'
              ), 0) <> 1
            )
            OR (
              NEW.side = 'sell'
              AND transaction_row.actor_type = 'teacher'
              AND transaction_row.actor_student_id IS NULL
              AND transaction_row.actor_job_period_id IS NULL
              AND json_valid(transaction_row.metadata_json) = 1
              AND json_extract(transaction_row.metadata_json, '$.isEmergency') = 1
              AND (
                json_extract(transaction_row.metadata_json, '$.liquidationPolicy')
                  = 'current_market_terms_at_liquidation'
                OR (
                  json_extract(
                    transaction_row.metadata_json, '$.liquidationPolicy'
                  ) = 'frozen_quote_resumable'
                  AND EXISTS (
                    SELECT 1
                    FROM finance_stock_liquidation_operations operation
                    WHERE operation.class_id = NEW.class_id
                      AND operation.stock_id = NEW.stock_id
                      AND operation.student_id = NEW.student_id
                      AND operation.teacher_id
                        = transaction_row.actor_teacher_id
                      AND operation.status = 'running'
                      AND json_extract(
                        transaction_row.metadata_json, '$.operationId'
                      ) = operation.id
                      AND json_extract(
                        transaction_row.metadata_json, '$.rootIdempotencyKey'
                      ) = operation.root_idempotency_key
                      AND CAST(json_extract(
                        transaction_row.metadata_json, '$.chunkIndex'
                      ) AS INTEGER) = operation.next_chunk_index
                  )
                )
              )
              AND json_type(transaction_row.metadata_json, '$.interventionReason') = 'text'
              AND LENGTH(TRIM(CAST(json_extract(
                transaction_row.metadata_json, '$.interventionReason'
              ) AS TEXT))) BETWEEN 2 AND 300
              AND json_extract(transaction_row.metadata_json, '$.studentId') = NEW.student_id
              AND json_extract(transaction_row.metadata_json, '$.stockId') = NEW.stock_id
              AND EXISTS (
                SELECT 1 FROM classes classroom
                WHERE classroom.id = NEW.class_id
                  AND classroom.teacher_id = transaction_row.actor_teacher_id
                  AND classroom.status = 'active'
              )
            )
          )
          AND transaction_row.payload_hash = NEW.transaction_payload_hash
          AND (SELECT COUNT(*) FROM finance_ledger_entries entry
               WHERE entry.transaction_id = transaction_row.id) = 2
          AND EXISTS (
            SELECT 1 FROM finance_ledger_entries entry
            WHERE entry.transaction_id = transaction_row.id
              AND entry.account_id = NEW.wallet_account_id
              AND entry.amount = NEW.wallet_delta
              AND entry.account_revision_after = NEW.wallet_revision_after
          )
          AND EXISTS (
            SELECT 1
            FROM finance_ledger_entries entry
            JOIN finance_accounts issuance ON issuance.id = entry.account_id
              AND issuance.class_id = entry.class_id
              AND issuance.account_type = 'class_issuance'
            WHERE entry.transaction_id = transaction_row.id
              AND entry.amount = -NEW.wallet_delta
          )
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LEDGER_MISMATCH') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_accounts wallet
        WHERE wallet.id = NEW.wallet_account_id
          AND wallet.class_id = NEW.class_id
          AND wallet.revision = NEW.wallet_revision_after
      ) THEN RAISE(ABORT, 'FINANCE_ACCOUNT_STALE') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_stock_holdings holding
        WHERE holding.class_id = NEW.class_id
          AND holding.stock_id = NEW.stock_id
          AND holding.student_id = NEW.student_id
          AND holding.wallet_account_id = NEW.wallet_account_id
          AND holding.quantity = NEW.holding_quantity_after
          AND holding.cost_basis = NEW.holding_cost_basis_after
          AND holding.revision = NEW.holding_revision_after
          AND holding.last_trade_id = NEW.id
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_PROJECTION_MISMATCH') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_stocks stock
        WHERE stock.id = NEW.stock_id AND stock.class_id = NEW.class_id
          AND stock.available_shares = NEW.available_shares_after
          AND stock.inventory_revision = NEW.inventory_revision_after
          AND stock.last_trade_id = NEW.id
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_trades_delete_guard
    BEFORE DELETE ON finance_stock_trades
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_TRADE_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_operations_insert_guard
    BEFORE INSERT ON finance_stock_liquidation_operations
    BEGIN
      SELECT CASE WHEN NEW.status <> 'running'
        OR NEW.remaining_quantity <> NEW.initial_quantity
        OR NEW.sold_quantity <> 0
        OR NEW.remaining_cost_basis <> NEW.initial_cost_basis
        OR NEW.completed_chunk_count <> 0
        OR NEW.total_gross_amount <> 0 OR NEW.total_fee_amount <> 0
        OR NEW.total_wallet_delta <> 0 OR NEW.total_cost_basis_removed <> 0
        OR NEW.total_realized_gain <> 0 OR NEW.next_chunk_index <> 0
        OR NEW.last_trade_id IS NOT NULL OR NEW.revision <> 0
        OR NEW.updated_at <> NEW.created_at OR NEW.completed_at IS NOT NULL
        OR NEW.cancelled_at IS NOT NULL OR NEW.cancellation_reason IS NOT NULL
        OR NEW.cancellation_idempotency_key IS NOT NULL
        OR NEW.cancellation_payload_hash IS NOT NULL
        THEN RAISE(ABORT,
          'FINANCE_STOCK_LIQUIDATION_OPERATION_INVALID_INITIAL_STATE') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM classes classroom
        JOIN students student ON student.id = NEW.student_id
          AND student.class_id = classroom.id
        JOIN finance_stocks stock ON stock.id = NEW.stock_id
          AND stock.class_id = classroom.id
        JOIN finance_stock_markets market ON market.class_id = classroom.id
        JOIN finance_settings setting ON setting.class_id = classroom.id
        JOIN finance_stock_holdings holding
          ON holding.class_id = classroom.id AND holding.stock_id = stock.id
          AND holding.student_id = student.id
        JOIN finance_accounts wallet ON wallet.id = holding.wallet_account_id
          AND wallet.class_id = classroom.id AND wallet.student_id = student.id
          AND wallet.account_type = 'student_wallet' AND wallet.status = 'active'
        JOIN finance_accounts issuance ON issuance.class_id = classroom.id
          AND issuance.student_id IS NULL
          AND issuance.account_type = 'class_issuance'
          AND issuance.status = 'active'
        WHERE classroom.id = NEW.class_id
          AND classroom.teacher_id = NEW.teacher_id
          AND classroom.status = 'active'
          AND student.status = NEW.snapshot_student_status
          AND student.status IN ('active', 'locked', 'reset_required', 'pending')
          AND stock.status = NEW.snapshot_stock_status
          AND stock.status IN ('active', 'sell_only', 'halted')
          AND market.is_open = NEW.snapshot_market_was_open
          AND stock.current_price = NEW.snapshot_reference_price
          AND market.sell_spread = NEW.snapshot_spread
          AND NEW.snapshot_unit_price = stock.current_price - market.sell_spread
          AND market.sell_fee_bps = NEW.snapshot_fee_bps
          AND stock.revision = NEW.snapshot_stock_revision
          AND market.revision = NEW.snapshot_market_revision
          AND setting.revision = NEW.snapshot_finance_settings_revision
          AND NEW.snapshot_denomination_step = (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          )
          AND holding.revision = NEW.snapshot_holding_revision
          AND holding.quantity = NEW.initial_quantity
          AND holding.cost_basis = NEW.initial_cost_basis
          AND wallet.revision = NEW.snapshot_wallet_revision
          AND wallet.balance = NEW.snapshot_wallet_balance
          AND NEW.snapshot_wallet_balance + NEW.expected_wallet_delta
            <= 1000000000
          AND issuance.balance - NEW.expected_wallet_delta >= -1000000000
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_STALE') END;
    END`,
  `DROP TRIGGER IF EXISTS finance_stock_liquidation_operations_update_guard`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_operations_update_guard
    BEFORE UPDATE ON finance_stock_liquidation_operations
    BEGIN
      SELECT CASE WHEN OLD.status IN ('completed', 'cancelled')
        THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_IMMUTABLE') END;
      SELECT CASE WHEN NEW.status NOT IN ('running', 'completed', 'cancelled')
        THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_STALE') END;
      SELECT CASE WHEN NEW.id <> OLD.id OR NEW.class_id <> OLD.class_id
        OR NEW.stock_id <> OLD.stock_id OR NEW.student_id <> OLD.student_id
        OR NEW.teacher_id <> OLD.teacher_id
        OR NEW.root_idempotency_key <> OLD.root_idempotency_key
        OR NEW.payload_hash <> OLD.payload_hash OR NEW.origin <> OLD.origin
        OR NEW.intervention_reason <> OLD.intervention_reason
        THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_IMMUTABLE') END;
      SELECT CASE WHEN
        NEW.snapshot_reference_price <> OLD.snapshot_reference_price
        OR NEW.snapshot_spread <> OLD.snapshot_spread
        OR NEW.snapshot_unit_price <> OLD.snapshot_unit_price
        OR NEW.snapshot_fee_bps <> OLD.snapshot_fee_bps
        OR NEW.snapshot_denomination_step <> OLD.snapshot_denomination_step
        OR NEW.snapshot_stock_revision <> OLD.snapshot_stock_revision
        OR NEW.snapshot_market_revision <> OLD.snapshot_market_revision
        OR NEW.snapshot_finance_settings_revision
          <> OLD.snapshot_finance_settings_revision
        OR NEW.snapshot_holding_revision <> OLD.snapshot_holding_revision
        OR NEW.snapshot_wallet_revision <> OLD.snapshot_wallet_revision
        OR NEW.snapshot_wallet_balance <> OLD.snapshot_wallet_balance
        OR NEW.snapshot_student_status <> OLD.snapshot_student_status
        OR NEW.snapshot_stock_status <> OLD.snapshot_stock_status
        OR NEW.snapshot_market_was_open <> OLD.snapshot_market_was_open
        THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_IMMUTABLE') END;
      SELECT CASE WHEN
        NEW.initial_quantity <> OLD.initial_quantity
        OR NEW.initial_cost_basis <> OLD.initial_cost_basis
        OR NEW.expected_gross_amount <> OLD.expected_gross_amount
        OR NEW.expected_fee_amount <> OLD.expected_fee_amount
        OR NEW.expected_wallet_delta <> OLD.expected_wallet_delta
        OR NEW.created_at <> OLD.created_at OR NEW.updated_at < OLD.updated_at
        THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_IMMUTABLE') END;
      SELECT CASE WHEN NEW.status IN ('running', 'completed') AND (
        NEW.revision <> OLD.revision + 1
        OR NEW.cancelled_at IS NOT NULL OR NEW.cancellation_reason IS NOT NULL
        OR NEW.cancellation_idempotency_key IS NOT NULL
        OR NEW.cancellation_payload_hash IS NOT NULL
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_STALE') END;
      SELECT CASE WHEN NEW.status IN ('running', 'completed') AND NOT EXISTS (
        SELECT 1 FROM finance_stock_liquidation_chunks chunk
        WHERE chunk.operation_id = OLD.id AND chunk.class_id = OLD.class_id
          AND chunk.chunk_index = OLD.next_chunk_index
          AND chunk.trade_id = NEW.last_trade_id
          AND chunk.holding_quantity_before = OLD.remaining_quantity
          AND chunk.holding_quantity_after = NEW.remaining_quantity
          AND chunk.holding_cost_basis_before = OLD.remaining_cost_basis
          AND chunk.holding_cost_basis_after = NEW.remaining_cost_basis
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_STALE') END;
      SELECT CASE WHEN NEW.status IN ('running', 'completed') AND NOT EXISTS (
        SELECT 1 FROM finance_stock_liquidation_chunks chunk
        WHERE chunk.operation_id = OLD.id AND chunk.class_id = OLD.class_id
          AND chunk.chunk_index = OLD.next_chunk_index
          AND NEW.sold_quantity = OLD.sold_quantity + chunk.quantity
          AND NEW.completed_chunk_count = OLD.completed_chunk_count + 1
          AND NEW.next_chunk_index = OLD.next_chunk_index + 1
          AND NEW.status = CASE WHEN chunk.holding_quantity_after = 0
            THEN 'completed' ELSE 'running' END
          AND NEW.completed_at IS CASE
            WHEN chunk.holding_quantity_after = 0 THEN chunk.created_at
            ELSE NULL END
          AND NEW.updated_at = chunk.created_at
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_STALE') END;
      SELECT CASE WHEN NEW.status IN ('running', 'completed') AND NOT EXISTS (
        SELECT 1 FROM finance_stock_liquidation_chunks chunk
        WHERE chunk.operation_id = OLD.id AND chunk.class_id = OLD.class_id
          AND chunk.chunk_index = OLD.next_chunk_index
          AND NEW.total_gross_amount = OLD.total_gross_amount + chunk.gross_amount
          AND NEW.total_fee_amount = OLD.total_fee_amount + chunk.fee_amount
          AND NEW.total_wallet_delta = OLD.total_wallet_delta + chunk.wallet_delta
          AND NEW.total_cost_basis_removed
            = OLD.total_cost_basis_removed + chunk.cost_basis_removed
          AND NEW.total_realized_gain
            = OLD.total_realized_gain + chunk.realized_gain
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_STALE') END;
      SELECT CASE WHEN NEW.status = 'cancelled' AND (
        NEW.revision <> OLD.revision + 1
        OR NEW.remaining_quantity <> OLD.remaining_quantity
        OR NEW.sold_quantity <> OLD.sold_quantity
        OR NEW.remaining_cost_basis <> OLD.remaining_cost_basis
        OR NEW.completed_chunk_count <> OLD.completed_chunk_count
        OR NEW.next_chunk_index <> OLD.next_chunk_index
        OR NEW.last_trade_id IS NOT OLD.last_trade_id
        OR NEW.completed_at IS NOT NULL OR NEW.cancelled_at <> NEW.updated_at
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_STALE') END;
      SELECT CASE WHEN NEW.status = 'cancelled' AND (
        NEW.total_gross_amount <> OLD.total_gross_amount
        OR NEW.total_fee_amount <> OLD.total_fee_amount
        OR NEW.total_wallet_delta <> OLD.total_wallet_delta
        OR NEW.total_cost_basis_removed <> OLD.total_cost_basis_removed
        OR NEW.total_realized_gain <> OLD.total_realized_gain
        OR LENGTH(TRIM(COALESCE(NEW.cancellation_reason, '')))
          NOT BETWEEN 2 AND 300
        OR LENGTH(TRIM(COALESCE(NEW.cancellation_idempotency_key, '')))
          NOT BETWEEN 8 AND 200
        OR LENGTH(TRIM(COALESCE(NEW.cancellation_payload_hash, '')))
          NOT BETWEEN 8 AND 500
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_STALE') END;
      SELECT CASE WHEN NEW.status = 'cancelled' AND NOT EXISTS (
        SELECT 1 FROM classes classroom
        WHERE classroom.id = OLD.class_id
          AND classroom.teacher_id = OLD.teacher_id
          AND classroom.status = 'active'
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_STALE') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_operations_delete_guard
    BEFORE DELETE ON finance_stock_liquidation_operations
    BEGIN
      SELECT RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_IMMUTABLE');
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_target_trade_guard
    BEFORE INSERT ON finance_stock_trades
    WHEN EXISTS (
      SELECT 1 FROM finance_stock_liquidation_operations operation
      WHERE operation.class_id = NEW.class_id
        AND operation.stock_id = NEW.stock_id
        AND operation.student_id = NEW.student_id
        AND operation.status = 'running'
    )
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_liquidation_operations operation
        JOIN finance_transactions transaction_row
          ON transaction_row.class_id = operation.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND transaction_row.status = 'pending'
          AND transaction_row.actor_type = 'teacher'
          AND transaction_row.actor_teacher_id = operation.teacher_id
        WHERE operation.class_id = NEW.class_id
          AND operation.stock_id = NEW.stock_id
          AND operation.student_id = NEW.student_id
          AND operation.status = 'running'
          AND json_valid(transaction_row.metadata_json) = 1
          AND json_extract(transaction_row.metadata_json, '$.operationId')
            = operation.id
          AND json_extract(transaction_row.metadata_json, '$.rootIdempotencyKey')
            = operation.root_idempotency_key
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.chunkIndex'
          ) AS INTEGER) = operation.next_chunk_index
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_IN_PROGRESS') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_wallet_guard
    BEFORE INSERT ON finance_ledger_entries
    WHEN EXISTS (
      SELECT 1
      FROM finance_stock_liquidation_operations operation
      JOIN finance_accounts wallet ON wallet.class_id = operation.class_id
        AND wallet.student_id = operation.student_id
        AND wallet.account_type = 'student_wallet'
      WHERE operation.class_id = NEW.class_id
        AND operation.status = 'running' AND wallet.id = NEW.account_id
    )
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_liquidation_operations operation
        JOIN finance_accounts wallet ON wallet.class_id = operation.class_id
          AND wallet.student_id = operation.student_id
          AND wallet.account_type = 'student_wallet'
        JOIN finance_transactions transaction_row
          ON transaction_row.id = NEW.transaction_id
          AND transaction_row.class_id = operation.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.status = 'pending'
          AND transaction_row.actor_type = 'teacher'
          AND transaction_row.actor_teacher_id = operation.teacher_id
        WHERE operation.class_id = NEW.class_id
          AND operation.status = 'running' AND wallet.id = NEW.account_id
          AND json_valid(transaction_row.metadata_json) = 1
          AND json_extract(transaction_row.metadata_json, '$.operationId')
            = operation.id
          AND json_extract(transaction_row.metadata_json, '$.rootIdempotencyKey')
            = operation.root_idempotency_key
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.chunkIndex'
          ) AS INTEGER) = operation.next_chunk_index
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_IN_PROGRESS') END;
    END`,
  `DROP TRIGGER IF EXISTS finance_stock_liquidation_chunks_insert_guard`,
  `DROP TRIGGER IF EXISTS finance_stock_liquidation_chunks_trade_guard`,
  `DROP TRIGGER IF EXISTS finance_stock_liquidation_chunks_transaction_guard`,
  `DROP TRIGGER IF EXISTS finance_stock_liquidation_chunks_metadata_guard`,
  `DROP TRIGGER IF EXISTS finance_stock_liquidation_chunks_projection_guard`,
  `DROP TRIGGER IF EXISTS finance_stock_liquidation_chunks_totals_guard`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_chunks_insert_guard
    BEFORE INSERT ON finance_stock_liquidation_chunks
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_liquidation_operations operation
        JOIN finance_stock_trades trade ON trade.id = NEW.trade_id
          AND trade.class_id = operation.class_id
        WHERE operation.id = NEW.operation_id
          AND operation.class_id = NEW.class_id
          AND operation.status = 'running'
          AND NEW.chunk_index = operation.next_chunk_index
          AND NEW.chunk_index = operation.completed_chunk_count
          AND NEW.quantity = CASE
            WHEN operation.remaining_quantity * operation.snapshot_unit_price
              <= 1000000000 THEN operation.remaining_quantity
            ELSE CAST(1000000000 / operation.snapshot_unit_price AS INTEGER)
          END
          AND NEW.holding_quantity_before = operation.remaining_quantity
          AND NEW.holding_cost_basis_before = operation.remaining_cost_basis
          AND trade.status = 'posted' AND trade.side = 'sell'
          AND trade.stock_id = operation.stock_id
          AND trade.student_id = operation.student_id
          AND trade.quantity = NEW.quantity
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_CHUNK_STALE') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_chunks_trade_guard
    BEFORE INSERT ON finance_stock_liquidation_chunks
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_liquidation_operations operation
        JOIN finance_stock_trades trade ON trade.id = NEW.trade_id
          AND trade.class_id = operation.class_id
        WHERE operation.id = NEW.operation_id
          AND operation.class_id = NEW.class_id
          AND operation.status = 'running'
          AND trade.reference_price = operation.snapshot_reference_price
          AND trade.spread_snapshot = operation.snapshot_spread
          AND trade.unit_price = operation.snapshot_unit_price
          AND trade.fee_bps_snapshot = operation.snapshot_fee_bps
          AND trade.gross_amount = NEW.gross_amount
          AND trade.fee_amount = NEW.fee_amount
          AND trade.wallet_delta = NEW.wallet_delta
          AND trade.cost_basis_removed = NEW.cost_basis_removed
          AND trade.realized_gain = NEW.realized_gain
          AND trade.holding_quantity_before = NEW.holding_quantity_before
          AND trade.holding_quantity_after = NEW.holding_quantity_after
          AND trade.holding_cost_basis_before = NEW.holding_cost_basis_before
          AND trade.holding_cost_basis_after = NEW.holding_cost_basis_after
          AND trade.holding_revision_before
            = operation.snapshot_holding_revision + operation.completed_chunk_count
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_CHUNK_STALE') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_chunks_transaction_guard
    BEFORE INSERT ON finance_stock_liquidation_chunks
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_liquidation_operations operation
        JOIN finance_stock_trades trade ON trade.id = NEW.trade_id
          AND trade.class_id = operation.class_id
        JOIN finance_transactions transaction_row
          ON transaction_row.id = trade.posted_transaction_id
          AND transaction_row.class_id = operation.class_id
        WHERE operation.id = NEW.operation_id
          AND operation.class_id = NEW.class_id
          AND operation.status = 'running'
          AND transaction_row.status = 'posted'
          AND transaction_row.actor_type = 'teacher'
          AND transaction_row.actor_teacher_id = operation.teacher_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = trade.id
          AND json_valid(transaction_row.metadata_json) = 1
          AND json_extract(transaction_row.metadata_json, '$.operationId')
            = operation.id
          AND json_extract(transaction_row.metadata_json, '$.rootIdempotencyKey')
            = operation.root_idempotency_key
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.chunkIndex'
          ) AS INTEGER) = NEW.chunk_index
          AND json_extract(transaction_row.metadata_json, '$.origin')
            = operation.origin
          AND json_extract(transaction_row.metadata_json, '$.interventionReason')
            = operation.intervention_reason
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_CHUNK_STALE') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_chunks_metadata_guard
    BEFORE INSERT ON finance_stock_liquidation_chunks
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_liquidation_operations operation
        JOIN finance_stock_trades trade ON trade.id = NEW.trade_id
          AND trade.class_id = operation.class_id
        JOIN finance_transactions transaction_row
          ON transaction_row.id = trade.posted_transaction_id
          AND transaction_row.class_id = operation.class_id
        WHERE operation.id = NEW.operation_id
          AND operation.class_id = NEW.class_id
          AND operation.status = 'running'
          AND json_valid(transaction_row.metadata_json) = 1
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.referencePrice'
          ) AS INTEGER) = operation.snapshot_reference_price
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.spreadSnapshot'
          ) AS INTEGER) = operation.snapshot_spread
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.unitPrice'
          ) AS INTEGER) = operation.snapshot_unit_price
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.feeBpsSnapshot'
          ) AS INTEGER) = operation.snapshot_fee_bps
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.frozenStockRevision'
          ) AS INTEGER) = operation.snapshot_stock_revision
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.frozenMarketRevision'
          ) AS INTEGER) = operation.snapshot_market_revision
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.frozenFinanceSettingsRevision'
          ) AS INTEGER) = operation.snapshot_finance_settings_revision
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.frozenDenominationStep'
          ) AS INTEGER) = operation.snapshot_denomination_step
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_CHUNK_STALE') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_chunks_projection_guard
    BEFORE INSERT ON finance_stock_liquidation_chunks
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_liquidation_operations operation
        JOIN finance_stock_trades trade ON trade.id = NEW.trade_id
          AND trade.class_id = operation.class_id
        JOIN finance_stock_holdings holding
          ON holding.class_id = operation.class_id
          AND holding.stock_id = operation.stock_id
          AND holding.student_id = operation.student_id
        JOIN finance_stocks stock ON stock.id = operation.stock_id
          AND stock.class_id = operation.class_id
        JOIN finance_accounts wallet ON wallet.id = trade.wallet_account_id
          AND wallet.class_id = operation.class_id
          AND wallet.student_id = operation.student_id
          AND wallet.account_type = 'student_wallet' AND wallet.status = 'active'
        WHERE operation.id = NEW.operation_id
          AND operation.class_id = NEW.class_id
          AND operation.status = 'running'
          AND holding.quantity = NEW.holding_quantity_after
          AND holding.cost_basis = NEW.holding_cost_basis_after
          AND holding.revision = trade.holding_revision_after
          AND holding.last_trade_id = trade.id
          AND stock.available_shares = trade.available_shares_after
          AND stock.inventory_revision = trade.inventory_revision_after
          AND stock.last_trade_id = trade.id
          AND wallet.revision = trade.wallet_revision_after
          AND wallet.balance = operation.snapshot_wallet_balance
            + operation.total_wallet_delta + NEW.wallet_delta
          AND NEW.created_at = trade.posted_at
          AND NEW.created_at >= operation.updated_at
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_CHUNK_STALE') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_chunks_totals_guard
    BEFORE INSERT ON finance_stock_liquidation_chunks
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_liquidation_operations operation
        WHERE operation.id = NEW.operation_id
          AND operation.class_id = NEW.class_id
          AND operation.status = 'running'
          AND operation.total_gross_amount + NEW.gross_amount
            <= operation.expected_gross_amount
          AND operation.total_fee_amount + NEW.fee_amount
            <= operation.expected_fee_amount
          AND operation.total_wallet_delta + NEW.wallet_delta
            <= operation.expected_wallet_delta
          AND operation.total_cost_basis_removed + NEW.cost_basis_removed
            <= operation.initial_cost_basis
          AND (
            NEW.holding_quantity_after > 0
            OR (
              operation.total_gross_amount + NEW.gross_amount
                = operation.expected_gross_amount
              AND operation.total_fee_amount + NEW.fee_amount
                = operation.expected_fee_amount
              AND operation.total_wallet_delta + NEW.wallet_delta
                = operation.expected_wallet_delta
              AND operation.total_cost_basis_removed + NEW.cost_basis_removed
                = operation.initial_cost_basis
            )
          )
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_CHUNK_STALE') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_chunks_progress
    AFTER INSERT ON finance_stock_liquidation_chunks
    BEGIN
      UPDATE finance_stock_liquidation_operations
      SET remaining_quantity = NEW.holding_quantity_after,
          sold_quantity = sold_quantity + NEW.quantity,
          remaining_cost_basis = NEW.holding_cost_basis_after,
          completed_chunk_count = completed_chunk_count + 1,
          total_gross_amount = total_gross_amount + NEW.gross_amount,
          total_fee_amount = total_fee_amount + NEW.fee_amount,
          total_wallet_delta = total_wallet_delta + NEW.wallet_delta,
          total_cost_basis_removed
            = total_cost_basis_removed + NEW.cost_basis_removed,
          total_realized_gain = total_realized_gain + NEW.realized_gain,
          next_chunk_index = next_chunk_index + 1,
          last_trade_id = NEW.trade_id, revision = revision + 1,
          status = CASE WHEN NEW.holding_quantity_after = 0
            THEN 'completed' ELSE 'running' END,
          completed_at = CASE WHEN NEW.holding_quantity_after = 0
            THEN NEW.created_at ELSE NULL END,
          updated_at = NEW.created_at
      WHERE id = NEW.operation_id AND class_id = NEW.class_id
        AND status = 'running' AND next_chunk_index = NEW.chunk_index;
      SELECT CASE WHEN changes() <> 1
        THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_STALE') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_chunks_update_guard
    BEFORE UPDATE ON finance_stock_liquidation_chunks
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_CHUNK_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_chunks_delete_guard
    BEFORE DELETE ON finance_stock_liquidation_chunks
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_CHUNK_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_transactions_reversal_guard
    BEFORE INSERT ON finance_transactions
    WHEN NEW.transaction_type = 'reversal' AND EXISTS (
      SELECT 1 FROM finance_transactions original
      WHERE original.id = NEW.reversal_of_transaction_id
        AND original.source_type = 'stock_trade'
    )
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_REVERSAL_REQUIRES_TRADE'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_classes_archive_guard
    BEFORE UPDATE OF status ON classes
    WHEN NEW.status = 'archived' AND OLD.status <> 'archived'
      AND EXISTS (
        SELECT 1 FROM finance_stock_holdings holding
        WHERE holding.class_id = NEW.id AND holding.quantity > 0
      )
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_ACTIVE_CLASS'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_stock_students_exclude_guard
    BEFORE UPDATE OF status ON students
    WHEN NEW.status = 'excluded' AND OLD.status <> 'excluded'
      AND EXISTS (
        SELECT 1 FROM finance_stock_holdings holding
        WHERE holding.class_id = NEW.class_id
          AND holding.student_id = NEW.id AND holding.quantity > 0
      )
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_ACTIVE_STUDENT'); END`,
  `CREATE TRIGGER IF NOT EXISTS finance_classes_create_stock_market
    AFTER INSERT ON classes
    BEGIN
      INSERT OR IGNORE INTO finance_stock_markets (
        class_id, is_open, buy_fee_bps, sell_fee_bps,
        buy_spread, sell_spread, market_mood,
        tick_interval_minutes, next_tick_at, revision,
        updated_by_teacher_id, created_at, updated_at
      ) VALUES (
        NEW.id, 0, 0, 0, 0, 0, 'mixed', 15, NULL, 0,
        NULL, NEW.created_at, NEW.updated_at
      );
    END`,
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
  `INSERT OR IGNORE INTO finance_stock_markets (
    class_id, is_open, buy_fee_bps, sell_fee_bps,
    buy_spread, sell_spread, market_mood,
    tick_interval_minutes, next_tick_at, revision,
    updated_by_teacher_id, created_at, updated_at
  )
  SELECT
    class_row.id, 0, 0, 0, 0, 0, 'mixed', 15, NULL, 0,
    NULL, class_row.created_at, class_row.updated_at
  FROM classes class_row`,
] as const;
