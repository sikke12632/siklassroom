import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const wranglerPath = path.join(
  projectRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);
const cashLifecycleWorkerPath =
  "tests/fixtures/finance-cash-lifecycle-worker.ts";
const cashLifecycleConfigPath = path.join(
  projectRoot,
  "tests",
  "fixtures",
  "wrangler.finance-cash-lifecycle.jsonc",
);

function runWrangler(args, { expectSuccess = true } = {}) {
  const result = spawnSync(process.execPath, [wranglerPath, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (expectSuccess) {
    assert.equal(
      result.status,
      0,
      `wrangler 명령이 실패했습니다.\n${output.slice(-5000)}`,
    );
  } else {
    assert.notEqual(result.status, 0, "실패해야 하는 D1 명령이 성공했습니다.");
  }
  return { ...result, output };
}

function executeSql(persistPath, sql, options) {
  const result = runWrangler([
    "d1",
    "execute",
    "DB",
    "--local",
    `--persist-to=${persistPath}`,
    "--json",
    "--command",
    sql,
  ], options);
  if (result.status !== 0) return result;
  return {
    ...result,
    data: JSON.parse(result.stdout),
  };
}

function lastResults(execution) {
  const last = execution.data.at(-1);
  assert.equal(last?.success, true);
  return last.results;
}

test("입출금 신청은 은행원 처리·교사 개입·정정을 불변 원장으로 보존한다", async () => {
  const persistPath = await mkdtemp(
    path.join(tmpdir(), "siklassroom-finance-operations-d1-"),
  );
  try {
    runWrangler([
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      `--persist-to=${persistPath}`,
    ]);

    executeSql(
      persistPath,
      `
        INSERT INTO teachers (
          id, email, password_hash, status, created_at, updated_at
        ) VALUES
          ('teacher-ops', 'teacher-ops@test.local', 'hash', 'active', 1, 1),
          ('teacher-other', 'teacher-other@test.local', 'hash', 'active', 1, 1);
        INSERT INTO classes (
          id, teacher_id, school_name, school_normalized,
          school_year, grade, class_number, status, created_at, updated_at
        ) VALUES (
          'class-ops', 'teacher-ops', '테스트초', '테스트초',
          2099, 6, 2, 'active', 1, 1
        );
        INSERT INTO students (
          id, class_id, student_number, official_name, status, created_at, updated_at
        ) VALUES
          ('student-requester', 'class-ops', 1, '신청학생', 'active', 1, 1),
          ('student-banker', 'class-ops', 2, '은행학생', 'active', 1, 1);
        INSERT OR IGNORE INTO job_templates (
          id, name, short_description, detailed_tasks, category,
          recommended_min_members, recommended_max_members, icon_key,
          default_priority, is_active
        ) VALUES (
          'banker', '은행원', '은행 업무', '입출금 확인',
          'economy', 1, 2, 'bank', 1, 1
        );
        INSERT INTO class_jobs (
          id, class_id, template_id, name, description, member_capacity,
          category, source, sort_order, is_active, created_at, updated_at
        ) VALUES (
          'job-banker', 'class-ops', 'banker', '은행원', '은행 업무', 1,
          'economy', 'template', 1, 1, 1, 1
        );
        INSERT INTO class_job_assignment_periods (
          id, class_id, assignment_year, assignment_month, assignment_type,
          mode, status, confirmed_at, confirmed_by_teacher_id, revision,
          created_at, updated_at
        ) VALUES (
          'period-current', 'class-ops',
          CAST(strftime('%Y', 'now', '+9 hours') AS INTEGER),
          CAST(strftime('%m', 'now', '+9 hours') AS INTEGER),
          'monthly', 'choice', 'confirmed', 2, 'teacher-ops', 1, 1, 2
        );
        INSERT INTO student_job_assignments (
          id, period_id, class_id, class_job_id, student_id,
          assignment_method, request_id, assignment_sequence, assigned_at, created_at
        ) VALUES (
          'assignment-banker', 'period-current', 'class-ops', 'job-banker',
          'student-banker', 'teacher', 'assign-banker', 1, 2, 2
        );
      `,
    );

    executeSql(
      persistPath,
      `
        INSERT INTO finance_cash_requests (
          id, class_id, requester_student_id, wallet_account_id,
          request_type, amount, memo, idempotency_key, payload_hash,
          student_number_snapshot, student_name_snapshot,
          wallet_balance_snapshot, wallet_revision_snapshot, revision, created_at
        ) VALUES (
          'request-deposit', 'class-ops', 'student-requester',
          'finance:student:student-requester:wallet',
          'deposit', 500, NULL, 'request:deposit:1', 'request-hash-deposit',
          1, '신청학생', 0, 0, 0, 10
        );
        INSERT INTO finance_request_resolutions (
          id, request_id, class_id, decision, idempotency_key, payload_hash,
          expected_request_revision, actor_type, actor_teacher_id,
          actor_student_id, actor_job_period_id, actor_label,
          reason_code, reason_note, intervention_reason, is_emergency,
          posted_transaction_id, transaction_payload_hash, resolved_at, created_at
        ) VALUES (
          'resolution-deposit', 'request-deposit', 'class-ops', 'approved',
          'decision:deposit:1', 'decision-hash-deposit', 0,
          'banker', NULL, 'student-banker', 'period-current', '은행학생',
          NULL, NULL, NULL, 0,
          'transaction-deposit', 'transaction-hash-deposit', 20, 20
        );
        SELECT
          (SELECT status FROM finance_transactions
           WHERE id = 'transaction-deposit') AS transaction_status,
          (SELECT COUNT(*) FROM finance_ledger_entries
           WHERE transaction_id = 'transaction-deposit') AS entry_count,
          (SELECT COALESCE(SUM(amount), 0) FROM finance_ledger_entries
           WHERE transaction_id = 'transaction-deposit') AS entry_sum,
          (SELECT balance FROM finance_accounts
           WHERE id = 'finance:student:student-requester:wallet') AS wallet_balance,
          (SELECT balance FROM finance_accounts
           WHERE id = 'finance:class:class-ops:issuance') AS issuance_balance;
      `,
    );
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT
         (SELECT status FROM finance_transactions
          WHERE id = 'transaction-deposit') AS transaction_status,
         (SELECT COUNT(*) FROM finance_ledger_entries
          WHERE transaction_id = 'transaction-deposit') AS entry_count,
         (SELECT COALESCE(SUM(amount), 0) FROM finance_ledger_entries
          WHERE transaction_id = 'transaction-deposit') AS entry_sum,
         (SELECT balance FROM finance_accounts
          WHERE id = 'finance:student:student-requester:wallet') AS wallet_balance,
         (SELECT balance FROM finance_accounts
          WHERE id = 'finance:class:class-ops:issuance') AS issuance_balance;`,
    )), [{
      transaction_status: "posted",
      entry_count: 2,
      entry_sum: 0,
      wallet_balance: 500,
      issuance_balance: -500,
    }]);

    executeSql(
      persistPath,
      `
        INSERT INTO finance_cash_requests (
          id, class_id, requester_student_id, wallet_account_id,
          request_type, amount, idempotency_key, payload_hash,
          student_number_snapshot, student_name_snapshot,
          wallet_balance_snapshot, wallet_revision_snapshot, revision, created_at
        ) VALUES (
          'request-withdrawal', 'class-ops', 'student-requester',
          'finance:student:student-requester:wallet',
          'withdrawal', 200, 'request:withdrawal:1', 'request-hash-withdrawal',
          1, '신청학생', 500, 1, 0, 30
        );
      `,
    );

    const duplicatePending = executeSql(
      persistPath,
      `
        INSERT INTO finance_cash_requests (
          id, class_id, requester_student_id, wallet_account_id,
          request_type, amount, idempotency_key, payload_hash,
          student_number_snapshot, student_name_snapshot,
          wallet_balance_snapshot, wallet_revision_snapshot, revision, created_at
        ) VALUES (
          'request-duplicate-pending', 'class-ops', 'student-requester',
          'finance:student:student-requester:wallet',
          'deposit', 10, 'request:pending:2', 'request-hash-pending',
          1, '신청학생', 500, 1, 0, 31
        );
      `,
      { expectSuccess: false },
    );
    assert.match(duplicatePending.output, /FINANCE_REQUEST_PENDING_EXISTS/);

    executeSql(
      persistPath,
      `
        INSERT INTO finance_request_resolutions (
          id, request_id, class_id, decision, idempotency_key, payload_hash,
          expected_request_revision, actor_type, actor_student_id,
          actor_job_period_id, actor_label, is_emergency,
          posted_transaction_id, transaction_payload_hash, resolved_at, created_at
        ) VALUES (
          'resolution-withdrawal', 'request-withdrawal', 'class-ops', 'approved',
          'decision:withdrawal:1', 'decision-hash-withdrawal', 0,
          'banker', 'student-banker', 'period-current', '은행학생', 0,
          'transaction-withdrawal', 'transaction-hash-withdrawal', 40, 40
        );
      `,
    );
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT balance, revision
       FROM finance_accounts
       WHERE id = 'finance:student:student-requester:wallet';`,
    )), [{ balance: 300, revision: 2 }]);

    executeSql(
      persistPath,
      `
        INSERT INTO finance_cash_requests (
          id, class_id, requester_student_id, wallet_account_id,
          request_type, amount, idempotency_key, payload_hash,
          student_number_snapshot, student_name_snapshot,
          wallet_balance_snapshot, wallet_revision_snapshot, revision, created_at
        ) VALUES (
          'request-self', 'class-ops', 'student-banker',
          'finance:student:student-banker:wallet',
          'deposit', 10, 'request:self:1', 'request-hash-self',
          2, '은행학생', 0, 0, 0, 50
        );
      `,
    );
    const selfApproval = executeSql(
      persistPath,
      `
        INSERT INTO finance_request_resolutions (
          id, request_id, class_id, decision, idempotency_key, payload_hash,
          expected_request_revision, actor_type, actor_student_id,
          actor_job_period_id, actor_label, is_emergency,
          posted_transaction_id, transaction_payload_hash, resolved_at, created_at
        ) VALUES (
          'resolution-self', 'request-self', 'class-ops', 'approved',
          'decision:self:1', 'decision-hash-self', 0,
          'banker', 'student-banker', 'period-current', '은행학생', 0,
          'transaction-self', 'transaction-hash-self', 60, 60
        );
      `,
      { expectSuccess: false },
    );
    assert.match(selfApproval.output, /FINANCE_REQUEST_SELF_APPROVAL_DENIED/);
    executeSql(
      persistPath,
      `
        INSERT INTO finance_request_resolutions (
          id, request_id, class_id, decision, idempotency_key, payload_hash,
          expected_request_revision, actor_type, actor_teacher_id, actor_label,
          intervention_reason, is_emergency,
          posted_transaction_id, transaction_payload_hash, resolved_at, created_at
        ) VALUES (
          'resolution-self-teacher', 'request-self', 'class-ops', 'approved',
          'decision:self:teacher', 'decision-hash-self-teacher', 0,
          'teacher', 'teacher-ops', '교사', '은행원 본인 신청 지원', 1,
          'transaction-self-teacher', 'transaction-hash-self-teacher', 61, 61
        );
      `,
    );

    executeSql(
      persistPath,
      `
        INSERT INTO finance_cash_requests (
          id, class_id, requester_student_id, wallet_account_id,
          request_type, amount, idempotency_key, payload_hash,
          student_number_snapshot, student_name_snapshot,
          wallet_balance_snapshot, wallet_revision_snapshot, revision, created_at
        ) VALUES (
          'request-reject', 'class-ops', 'student-requester',
          'finance:student:student-requester:wallet',
          'deposit', 70, 'request:reject:1', 'request-hash-reject',
          1, '신청학생', 300, 2, 0, 70
        );
        INSERT INTO finance_request_resolutions (
          id, request_id, class_id, decision, idempotency_key, payload_hash,
          expected_request_revision, actor_type, actor_student_id,
          actor_job_period_id, actor_label, reason_code, is_emergency,
          posted_transaction_id, transaction_payload_hash, resolved_at, created_at
        ) VALUES (
          'resolution-reject', 'request-reject', 'class-ops', 'rejected',
          'decision:reject:1', 'decision-hash-reject', 0,
          'banker', 'student-banker', 'period-current', '은행학생',
          'amount_check', 0, NULL, NULL, 80, 80
        );
        SELECT
          (SELECT COUNT(*) FROM finance_transactions
           WHERE source_id = 'request-reject') AS transactions,
          (SELECT balance FROM finance_accounts
           WHERE id = 'finance:student:student-requester:wallet') AS balance;
      `,
    );
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT
         (SELECT COUNT(*) FROM finance_transactions
          WHERE source_id = 'request-reject') AS transactions,
         (SELECT balance FROM finance_accounts
          WHERE id = 'finance:student:student-requester:wallet') AS balance;`,
    )), [{ transactions: 0, balance: 300 }]);

    executeSql(
      persistPath,
      `
        INSERT INTO finance_cash_requests (
          id, class_id, requester_student_id, wallet_account_id,
          request_type, amount, idempotency_key, payload_hash,
          student_number_snapshot, student_name_snapshot,
          wallet_balance_snapshot, wallet_revision_snapshot, revision, created_at
        ) VALUES (
          'request-cancel', 'class-ops', 'student-requester',
          'finance:student:student-requester:wallet',
          'withdrawal', 20, 'request:cancel:1', 'request-hash-cancel',
          1, '신청학생', 300, 2, 0, 90
        );
        INSERT INTO finance_request_resolutions (
          id, request_id, class_id, decision, idempotency_key, payload_hash,
          expected_request_revision, actor_type, actor_student_id,
          actor_label, is_emergency, posted_transaction_id,
          transaction_payload_hash, resolved_at, created_at
        ) VALUES (
          'resolution-cancel', 'request-cancel', 'class-ops', 'cancelled',
          'decision:cancel:1', 'decision-hash-cancel', 0,
          'student', 'student-requester', '신청학생', 0,
          NULL, NULL, 100, 100
        );
      `,
    );

    const requestMutation = executeSql(
      persistPath,
      `UPDATE finance_cash_requests SET amount = 999
       WHERE id = 'request-deposit';`,
      { expectSuccess: false },
    );
    assert.match(requestMutation.output, /FINANCE_REQUEST_IMMUTABLE/);
    const resolutionMutation = executeSql(
      persistPath,
      `DELETE FROM finance_request_resolutions
       WHERE id = 'resolution-deposit';`,
      { expectSuccess: false },
    );
    assert.match(
      resolutionMutation.output,
      /FINANCE_REQUEST_RESOLUTION_IMMUTABLE/,
    );

    const directBankerWrite = executeSql(
      persistPath,
      `
        INSERT INTO finance_transactions (
          id, class_id, status, transaction_type, description,
          idempotency_key, payload_hash, actor_type, actor_student_id,
          actor_job_period_id, actor_label, created_at
        ) VALUES (
          'transaction-direct-banker', 'class-ops', 'pending',
          'manual_credit', '임의 거래', 'direct:banker:1', 'direct-hash',
          'banker', 'student-banker', 'period-current', '은행학생', 110
        );
      `,
      { expectSuccess: false },
    );
    assert.match(
      directBankerWrite.output,
      /FINANCE_BANKER_(SCOPE_DENIED|WRITES_NOT_ENABLED)/,
    );

    executeSql(
      persistPath,
      `
        INSERT INTO finance_transactions (
          id, class_id, status, transaction_type, description,
          idempotency_key, payload_hash, source_type, source_id,
          reversal_of_transaction_id, actor_type, actor_teacher_id,
          actor_label, created_at
        ) VALUES (
          'transaction-reversal', 'class-ops', 'pending', 'reversal',
          '교사 정정: 출금 금액 확인', 'reversal:withdrawal:1', 'reversal-hash',
          'reversal', 'transaction-withdrawal', 'transaction-withdrawal',
          'teacher', 'teacher-ops', '교사', 120
        );
        INSERT INTO finance_ledger_entries (
          id, transaction_id, class_id, account_id, amount,
          balance_after, account_revision_after, created_at
        ) VALUES (
          'entry-reversal-wallet', 'transaction-reversal', 'class-ops',
          'finance:student:student-requester:wallet', 200, 500, 3, 120
        );
        INSERT INTO finance_ledger_entries (
          id, transaction_id, class_id, account_id, amount,
          balance_after, account_revision_after, created_at
        ) VALUES (
          'entry-reversal-issuance', 'transaction-reversal', 'class-ops',
          'finance:class:class-ops:issuance', -200, -510, 4, 120
        );
        UPDATE finance_transactions
        SET status = 'posted', posted_at = 120
        WHERE id = 'transaction-reversal';
      `,
    );
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT
         (SELECT balance FROM finance_accounts
          WHERE id = 'finance:student:student-requester:wallet') AS balance,
         (SELECT COUNT(*) FROM finance_transactions
          WHERE reversal_of_transaction_id = 'transaction-withdrawal'
            AND status = 'posted') AS reversal_count;`,
    )), [{ balance: 500, reversal_count: 1 }]);

    executeSql(
      persistPath,
      `
        INSERT INTO finance_cash_requests (
          id, class_id, requester_student_id, wallet_account_id,
          request_type, amount, idempotency_key, payload_hash,
          student_number_snapshot, student_name_snapshot,
          wallet_balance_snapshot, wallet_revision_snapshot, revision, created_at
        ) VALUES (
          'request-reserved', 'class-ops', 'student-requester',
          'finance:student:student-requester:wallet',
          'withdrawal', 400, 'request:reserved:1', 'request-hash-reserved',
          1, '신청학생', 500, 3, 0, 130
        );
        INSERT INTO finance_transactions (
          id, class_id, status, transaction_type, description,
          idempotency_key, payload_hash, source_type, source_id,
          reversal_of_transaction_id, actor_type, actor_teacher_id,
          actor_label, created_at
        ) VALUES (
          'transaction-reserved-reversal', 'class-ops', 'pending', 'reversal',
          '교사 정정: 입금 취소', 'reversal:deposit:reserved', 'reversal-reserved-hash',
          'reversal', 'transaction-deposit', 'transaction-deposit',
          'teacher', 'teacher-ops', '교사', 131
        );
      `,
    );
    const reservedDebit = executeSql(
      persistPath,
      `
        INSERT INTO finance_ledger_entries (
          id, transaction_id, class_id, account_id, amount,
          balance_after, account_revision_after, created_at
        ) VALUES (
          'entry-reserved-reversal-wallet', 'transaction-reserved-reversal',
          'class-ops', 'finance:student:student-requester:wallet',
          -500, 0, 4, 131
        );
      `,
      { expectSuccess: false },
    );
    assert.match(
      reservedDebit.output,
      /FINANCE_INSUFFICIENT_AVAILABLE_BALANCE/,
    );
    executeSql(
      persistPath,
      `
        INSERT INTO finance_request_resolutions (
          id, request_id, class_id, decision, idempotency_key, payload_hash,
          expected_request_revision, actor_type, actor_student_id,
          actor_job_period_id, actor_label, is_emergency,
          posted_transaction_id, transaction_payload_hash, resolved_at, created_at
        ) VALUES (
          'resolution-reserved', 'request-reserved', 'class-ops', 'approved',
          'decision:reserved:1', 'decision-hash-reserved', 0,
          'banker', 'student-banker', 'period-current', '은행학생', 0,
          'transaction-reserved', 'transaction-hash-reserved', 132, 132
        );
      `,
    );
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT balance, revision
       FROM finance_accounts
       WHERE id = 'finance:student:student-requester:wallet';`,
    )), [{ balance: 100, revision: 4 }]);

    executeSql(
      persistPath,
      `
        INSERT INTO finance_transactions (
          id, class_id, status, transaction_type, description,
          idempotency_key, payload_hash, actor_type, actor_teacher_id,
          actor_label, created_at
        ) VALUES (
          'transaction-posting-race', 'class-ops', 'pending', 'manual_debit',
          '출금 신청과 동시에 시작된 교사 차감',
          'manual:posting-race:1', 'posting-race-hash',
          'teacher', 'teacher-ops', '교사', 140
        );
        INSERT INTO finance_ledger_entries (
          id, transaction_id, class_id, account_id, amount,
          balance_after, account_revision_after, created_at
        ) VALUES
          (
            'entry-posting-race-wallet', 'transaction-posting-race', 'class-ops',
            'finance:student:student-requester:wallet', -20, 80, 5, 140
          ),
          (
            'entry-posting-race-issuance', 'transaction-posting-race', 'class-ops',
            'finance:class:class-ops:issuance', 20, -90, 6, 140
          );
        INSERT INTO finance_cash_requests (
          id, class_id, requester_student_id, wallet_account_id,
          request_type, amount, idempotency_key, payload_hash,
          student_number_snapshot, student_name_snapshot,
          wallet_balance_snapshot, wallet_revision_snapshot, revision, created_at
        ) VALUES (
          'request-posting-race', 'class-ops', 'student-requester',
          'finance:student:student-requester:wallet',
          'withdrawal', 90, 'request:posting-race:1', 'request-hash-posting-race',
          1, '신청학생', 100, 4, 0, 141
        );
      `,
    );
    const reservedAtPosting = executeSql(
      persistPath,
      `UPDATE finance_transactions
       SET status = 'posted', posted_at = 142
       WHERE id = 'transaction-posting-race' AND status = 'pending';`,
      { expectSuccess: false },
    );
    assert.match(
      reservedAtPosting.output,
      /FINANCE_INSUFFICIENT_AVAILABLE_BALANCE/,
    );
    executeSql(
      persistPath,
      `
        INSERT INTO finance_request_resolutions (
          id, request_id, class_id, decision, idempotency_key, payload_hash,
          expected_request_revision, actor_type, actor_student_id,
          actor_label, is_emergency, posted_transaction_id,
          transaction_payload_hash, resolved_at, created_at
        ) VALUES (
          'resolution-posting-race', 'request-posting-race', 'class-ops',
          'cancelled', 'decision:posting-race:1', 'decision-hash-posting-race', 0,
          'student', 'student-requester', '신청학생', 0,
          NULL, NULL, 143, 143
        );
        UPDATE finance_transactions
        SET status = 'posted', posted_at = 144
        WHERE id = 'transaction-posting-race' AND status = 'pending';
      `,
    );
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT balance, revision
       FROM finance_accounts
       WHERE id = 'finance:student:student-requester:wallet';`,
    )), [{ balance: 80, revision: 5 }]);

    const foreignKeys = executeSql(persistPath, "PRAGMA foreign_key_check;");
    assert.deepEqual(lastResults(foreignKeys), []);
    const reconciliation = executeSql(
      persistPath,
      `
        SELECT account.id
        FROM finance_accounts account
        LEFT JOIN (
          SELECT entry.account_id, SUM(entry.amount) AS balance,
                 COUNT(*) AS revision
          FROM finance_ledger_entries entry
          JOIN finance_transactions transaction_row
            ON transaction_row.id = entry.transaction_id
           AND transaction_row.status = 'posted'
          GROUP BY entry.account_id
        ) ledger ON ledger.account_id = account.id
        WHERE account.class_id = 'class-ops'
          AND (
            account.balance <> COALESCE(ledger.balance, 0)
            OR account.revision <> COALESCE(ledger.revision, 0)
          );
      `,
    );
    assert.deepEqual(lastResults(reconciliation), []);
  } finally {
    await rm(persistPath, { recursive: true, force: true });
  }
});

test("unresolved cash requests atomically block class archive and student exclusion", {
  timeout: 120_000,
}, async () => {
  const persistPath = await mkdtemp(
    path.join(tmpdir(), "siklassroom-finance-cash-lifecycle-d1-"),
  );
  let worker;
  const rawTeacherToken = "teacher-cash-lifecycle-session";
  const teacherTokenHash = createHash("sha256")
    .update(rawTeacherToken)
    .digest("base64url");
  const cookie = `job_classroom_session=${rawTeacherToken}`;
  try {
    runWrangler([
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      `--persist-to=${persistPath}`,
    ]);
    executeSql(persistPath, `
      INSERT INTO teachers (
        id, email, password_hash, status, email_verified_at,
        teacher_access_status, teacher_access_verified_at, school_id,
        created_at, updated_at
      ) VALUES (
        'teacher-cash-lifecycle', 'teacher-cash-lifecycle@test.local', 'hash',
        'active', 1, 'invite_verified', 1, 'school-cash-lifecycle', 1, 1
      );
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized, school_id,
        school_year, grade, class_number, status, created_at, updated_at
      ) VALUES
        ('class-cash-archive', 'teacher-cash-lifecycle', 'Lifecycle School',
         'lifecycle school', 'school-cash-lifecycle', 2099, 6, 20,
         'active', 1, 1),
        ('class-cash-exclude', 'teacher-cash-lifecycle', 'Lifecycle School',
         'lifecycle school', 'school-cash-lifecycle', 2099, 6, 21,
         'active', 1, 1);
      INSERT INTO students (
        id, class_id, student_number, official_name, password_hash,
        status, activated_at, created_at, updated_at
      ) VALUES
        ('student-cash-archive', 'class-cash-archive', 1,
         'Archive Request Student', 'hash', 'active', 1, 1, 1),
        ('student-cash-archive-peer', 'class-cash-archive', 2,
         'Archive Peer Student', 'hash', 'active', 1, 1, 1),
        ('student-cash-exclude', 'class-cash-exclude', 1,
         'Exclude Request Student', 'hash', 'active', 1, 1, 1),
        ('student-cash-exclude-peer', 'class-cash-exclude', 2,
         'Exclude Peer Student', 'hash', 'active', 1, 1, 1);
      INSERT INTO sessions (
        id, token_hash, actor_type, teacher_id, student_id,
        expires_at, created_at, last_seen_at
      ) VALUES
        ('session-cash-teacher', '${teacherTokenHash}', 'teacher',
         'teacher-cash-lifecycle', NULL, 4102444800000, 1, 1),
        ('session-cash-archive', 'hash:session:cash:archive', 'student',
         NULL, 'student-cash-archive', 4102444800000, 1, 1),
        ('session-cash-archive-peer', 'hash:session:cash:archive:peer', 'student',
         NULL, 'student-cash-archive-peer', 4102444800000, 1, 1),
        ('session-cash-exclude', 'hash:session:cash:exclude', 'student',
         NULL, 'student-cash-exclude', 4102444800000, 1, 1),
        ('session-cash-exclude-peer', 'hash:session:cash:exclude:peer', 'student',
         NULL, 'student-cash-exclude-peer', 4102444800000, 1, 1);
    `);

    const classState = () => lastResults(executeSql(persistPath, `
      SELECT
        classroom.status AS class_status,
        student.status AS student_status,
        wallet.status AS wallet_status,
        (SELECT COUNT(*) FROM sessions
         WHERE student_id = 'student-cash-archive') AS student_session_count,
        (SELECT COUNT(*) FROM sessions
         WHERE student_id = 'student-cash-archive-peer') AS peer_session_count,
        (SELECT COUNT(*) FROM finance_cash_requests request_row
         WHERE request_row.id = 'request-cash-archive-race'
           AND request_row.class_id = classroom.id
           AND request_row.requester_student_id = student.id
           AND request_row.request_type = 'deposit'
           AND request_row.amount = 100
           AND request_row.revision = 0) AS request_count,
        (SELECT COUNT(*) FROM finance_request_resolutions resolution
         WHERE resolution.request_id = 'request-cash-archive-race')
          AS resolution_count
      FROM classes classroom
      JOIN students student ON student.id = 'student-cash-archive'
        AND student.class_id = classroom.id
      JOIN finance_accounts wallet
        ON wallet.class_id = classroom.id AND wallet.student_id = student.id
       AND wallet.account_type = 'student_wallet'
      WHERE classroom.id = 'class-cash-archive';
    `));
    const studentState = () => lastResults(executeSql(persistPath, `
      SELECT
        classroom.status AS class_status,
        student.status AS student_status,
        wallet.status AS wallet_status,
        (SELECT COUNT(*) FROM sessions
         WHERE student_id = 'student-cash-exclude') AS student_session_count,
        (SELECT COUNT(*) FROM sessions
         WHERE student_id = 'student-cash-exclude-peer') AS peer_session_count,
        (SELECT COUNT(*) FROM finance_cash_requests request_row
         WHERE request_row.id = 'request-cash-exclude-race'
           AND request_row.class_id = classroom.id
           AND request_row.requester_student_id = student.id
           AND request_row.request_type = 'deposit'
           AND request_row.amount = 100
           AND request_row.revision = 0) AS request_count,
        (SELECT COUNT(*) FROM finance_request_resolutions resolution
         WHERE resolution.request_id = 'request-cash-exclude-race')
          AS resolution_count
      FROM classes classroom
      JOIN students student ON student.id = 'student-cash-exclude'
        AND student.class_id = classroom.id
      JOIN finance_accounts wallet
        ON wallet.class_id = classroom.id AND wallet.student_id = student.id
       AND wallet.account_type = 'student_wallet'
      WHERE classroom.id = 'class-cash-exclude';
    `));

    const { unstable_dev: unstableDev } = await import("wrangler");
    worker = await unstableDev(cashLifecycleWorkerPath, {
      config: cashLifecycleConfigPath,
      moduleRoot: projectRoot,
      persistTo: persistPath,
      logLevel: "none",
      experimental: {
        disableDevRegistry: true,
        disableExperimentalWarning: true,
        watch: false,
      },
    });

    const archiveResponse = await worker.fetch(
      "http://test.local/classes/class-cash-archive",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-test-inject-pending-after-lifecycle-preflight": "class",
        },
        body: JSON.stringify({ status: "archived" }),
      },
    );
    const archiveResult = await archiveResponse.json();
    assert.equal(
      archiveResponse.headers.get("x-test-injection-matched"),
      "1",
      `The API preflight must inspect unresolved class cash requests: ${JSON.stringify({
        status: archiveResponse.status,
        result: archiveResult,
      })}`,
    );
    assert.equal(archiveResponse.status, 409, JSON.stringify(archiveResult));
    assert.equal(archiveResult.code, "FINANCE_REQUEST_PENDING_CLASS");
    assert.deepEqual(classState(), [{
      class_status: "active",
      student_status: "active",
      wallet_status: "active",
      student_session_count: 1,
      peer_session_count: 1,
      request_count: 1,
      resolution_count: 0,
    }]);

    const resolveClassResponse = await worker.fetch(
      "http://test.local/test/resolve?scope=class",
      { method: "POST" },
    );
    assert.equal(resolveClassResponse.status, 200);
    const archiveRetry = await worker.fetch(
      "http://test.local/classes/class-cash-archive",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ status: "archived" }),
      },
    );
    const archiveRetryBody = await archiveRetry.text();
    assert.equal(archiveRetry.status, 200, archiveRetryBody);
    assert.deepEqual(classState(), [{
      class_status: "archived",
      student_status: "active",
      wallet_status: "closed",
      student_session_count: 0,
      peer_session_count: 0,
      request_count: 1,
      resolution_count: 1,
    }]);

    const archivedMetadataUpdate = await worker.fetch(
      "http://test.local/classes/class-cash-archive",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ displayName: "Archived lifecycle class" }),
      },
    );
    const archivedMetadataBody = await archivedMetadataUpdate.text();
    assert.equal(archivedMetadataUpdate.status, 200, archivedMetadataBody);
    assert.deepEqual(classState(), [{
      class_status: "archived",
      student_status: "active",
      wallet_status: "closed",
      student_session_count: 0,
      peer_session_count: 0,
      request_count: 1,
      resolution_count: 1,
    }]);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT display_name FROM classes WHERE id = 'class-cash-archive';`,
    )), [{ display_name: "Archived lifecycle class" }]);

    const invalidClassStatus = await worker.fetch(
      "http://test.local/classes/class-cash-archive",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ status: "paused" }),
      },
    );
    const invalidClassStatusBody = await invalidClassStatus.json();
    assert.equal(invalidClassStatus.status, 400, JSON.stringify(invalidClassStatusBody));
    assert.equal(invalidClassStatusBody.code, "INVALID_CLASS_STATUS");
    assert.equal(lastResults(executeSql(
      persistPath,
      `SELECT status FROM classes WHERE id = 'class-cash-archive';`,
    ))[0]?.status, "archived");

    const reactivateBeforeRace = await worker.fetch(
      "http://test.local/classes/class-cash-archive",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ status: "active" }),
      },
    );
    const reactivateBeforeRaceBody = await reactivateBeforeRace.text();
    assert.equal(reactivateBeforeRace.status, 200, reactivateBeforeRaceBody);
    assert.equal(lastResults(executeSql(
      persistPath,
      `SELECT status FROM classes WHERE id = 'class-cash-archive';`,
    ))[0]?.status, "active");

    const archivedMetadataRace = await worker.fetch(
      "http://test.local/classes/class-cash-archive",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-test-archive-after-class-read": "1",
        },
        body: JSON.stringify({ displayName: "Metadata after archive race" }),
      },
    );
    const archivedMetadataRaceBody = await archivedMetadataRace.text();
    assert.equal(
      archivedMetadataRace.headers.get("x-test-injection-matched"),
      "1",
      archivedMetadataRaceBody,
    );
    assert.equal(archivedMetadataRace.status, 200, archivedMetadataRaceBody);
    assert.deepEqual(classState(), [{
      class_status: "archived",
      student_status: "active",
      wallet_status: "closed",
      student_session_count: 0,
      peer_session_count: 0,
      request_count: 1,
      resolution_count: 1,
    }]);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT COUNT(*) AS matching_count
       FROM audit_logs
       WHERE class_id = 'class-cash-archive'
         AND action = 'class_updated'
         AND json_extract(detail, '$.displayName') = 'Metadata after archive race'
         AND json_type(detail, '$.status') IS NULL;`,
    )), [{ matching_count: 1 }]);

    const activatedMetadataRace = await worker.fetch(
      "http://test.local/classes/class-cash-archive",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-test-activate-after-class-read": "1",
        },
        body: JSON.stringify({ displayName: "Metadata after activate race" }),
      },
    );
    const activatedMetadataRaceBody = await activatedMetadataRace.text();
    assert.equal(
      activatedMetadataRace.headers.get("x-test-injection-matched"),
      "1",
      activatedMetadataRaceBody,
    );
    assert.equal(activatedMetadataRace.status, 200, activatedMetadataRaceBody);
    assert.deepEqual(classState(), [{
      class_status: "active",
      student_status: "active",
      wallet_status: "active",
      student_session_count: 1,
      peer_session_count: 0,
      request_count: 1,
      resolution_count: 1,
    }]);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT COUNT(*) AS matching_count
       FROM audit_logs
       WHERE class_id = 'class-cash-archive'
         AND action = 'class_updated'
         AND json_extract(detail, '$.displayName') = 'Metadata after activate race'
         AND json_type(detail, '$.status') IS NULL;`,
    )), [{ matching_count: 1 }]);

    const excludeResponse = await worker.fetch(
      "http://test.local/students/student-cash-exclude",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-test-inject-pending-after-lifecycle-preflight": "student",
        },
        body: JSON.stringify({ status: "excluded" }),
      },
    );
    const excludeResult = await excludeResponse.json();
    assert.equal(
      excludeResponse.headers.get("x-test-injection-matched"),
      "1",
      `The API preflight must inspect unresolved student cash requests: ${JSON.stringify({
        status: excludeResponse.status,
        result: excludeResult,
      })}`,
    );
    assert.equal(excludeResponse.status, 409, JSON.stringify(excludeResult));
    assert.equal(excludeResult.code, "FINANCE_REQUEST_PENDING_STUDENT");
    assert.deepEqual(studentState(), [{
      class_status: "active",
      student_status: "active",
      wallet_status: "active",
      student_session_count: 1,
      peer_session_count: 1,
      request_count: 1,
      resolution_count: 0,
    }]);

    const resolveStudentResponse = await worker.fetch(
      "http://test.local/test/resolve?scope=student",
      { method: "POST" },
    );
    assert.equal(resolveStudentResponse.status, 200);
    const excludeRetry = await worker.fetch(
      "http://test.local/students/student-cash-exclude",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ status: "excluded" }),
      },
    );
    const excludeRetryBody = await excludeRetry.text();
    assert.equal(excludeRetry.status, 200, excludeRetryBody);
    assert.deepEqual(studentState(), [{
      class_status: "active",
      student_status: "excluded",
      wallet_status: "frozen",
      student_session_count: 0,
      peer_session_count: 1,
      request_count: 1,
      resolution_count: 1,
    }]);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      "PRAGMA foreign_key_check;",
    )), []);
  } finally {
    await worker?.stop();
    await rm(persistPath, { recursive: true, force: true });
  }
});
