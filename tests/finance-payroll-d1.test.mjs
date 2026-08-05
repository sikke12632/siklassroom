import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerPath = path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const denominationWorkerPath =
  "tests/fixtures/finance-payroll-denomination-worker.ts";
const denominationConfigPath = path.join(
  projectRoot,
  "tests",
  "fixtures",
  "wrangler.finance-payroll-denomination.jsonc",
);

function runWrangler(args, { expectSuccess = true } = {}) {
  let result;
  let output = "";
  const retrySignal = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    result = spawnSync(process.execPath, [wranglerPath, ...args], {
      cwd: projectRoot,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    });
    output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (result.status === 0 || (!output.includes("bad port") && !output.includes("fetch failed"))) break;
    Atomics.wait(retrySignal, 0, 0, 250 * (attempt + 1));
  }
  assert.ok(result);
  if (expectSuccess) {
    assert.equal(result.status, 0, `Wrangler command failed.\n${output.slice(-5000)}`);
  } else {
    assert.notEqual(result.status, 0, "The D1 command should have failed.");
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
  return { ...result, data: JSON.parse(result.stdout) };
}

function lastResults(execution) {
  const last = execution.data.at(-1);
  assert.equal(last?.success, true);
  return last.results;
}

test("월별 직업 급여는 마감·학생별 항목·원장 거래를 한 번만 연결한다", async () => {
  const persistPath = await mkdtemp(path.join(tmpdir(), "siklassroom-payroll-d1-"));
  try {
    runWrangler([
      "d1", "migrations", "apply", "DB", "--local", `--persist-to=${persistPath}`,
    ]);

    executeSql(persistPath, `
      INSERT INTO teachers (id, email, password_hash, status, created_at, updated_at)
      VALUES ('teacher-payroll', 'payroll@test.local', 'hash', 'active', 1, 1);
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized, school_year,
        grade, class_number, status, created_at, updated_at
      ) VALUES (
        'class-payroll', 'teacher-payroll', 'Test School', 'test school',
        2026, 6, 9, 'active', 1, 1
      );
      INSERT INTO students (
        id, class_id, student_number, official_name, status, created_at, updated_at
      ) VALUES
        ('student-a', 'class-payroll', 1, 'Student A', 'active', 1, 1),
        ('student-c', 'class-payroll', 2, 'Student C', 'active', 1, 1);
      INSERT INTO class_job_assignment_periods (
        id, class_id, assignment_year, assignment_month, assignment_type,
        status, revision, created_at, updated_at
      ) VALUES (
        'period-payroll', 'class-payroll', 2026, 7, 'monthly',
        'confirmed', 1, 1, 1
      );
      INSERT INTO class_job_month_closures (
        id, class_id, source_period_id, source_year, source_month, status,
        closed_by_teacher_id, closed_at, created_at
      ) VALUES (
        'closure-payroll', 'class-payroll', 'period-payroll', 2026, 7,
        'closed', 'teacher-payroll', 10, 10
      );
      INSERT INTO class_job_month_results (
        id, closure_id, class_id, student_id, student_number, student_name,
        class_job_id, job_name, job_grade, created_at
      ) VALUES
        ('result-a', 'closure-payroll', 'class-payroll', 'student-a', 1,
         'Student A', 'job-a', 'Job A', 'A', 10),
        ('result-c', 'closure-payroll', 'class-payroll', 'student-c', 2,
         'Student C', 'job-c', 'Job C', 'C', 10);

      INSERT INTO finance_payroll_runs (
        id, class_id, closure_id, source_period_id, source_year, source_month,
        salary_settings_revision, salary_settings_json, status,
        recipient_count, posted_count, total_amount, idempotency_key,
        payload_hash, initiated_by_teacher_id, created_at, updated_at
      ) VALUES (
        'run-payroll', 'class-payroll', 'closure-payroll', 'period-payroll',
        2026, 7, 0,
        '{"gradeAAmount":1300,"gradeBAmount":1000,"gradeCAmount":700}',
        'prepared', 2, 0, 2000, 'payroll:test:run', 'hash-run',
        'teacher-payroll', 20, 20
      );
      INSERT INTO finance_payroll_items (
        id, run_id, class_id, closure_result_id, student_id, student_number,
        student_name, class_job_id, job_name, job_grade, base_amount,
        total_amount, status, created_at, updated_at
      ) VALUES
        ('item-a', 'run-payroll', 'class-payroll', 'result-a', 'student-a', 1,
         'Student A', 'job-a', 'Job A', 'A', 1300, 1300, 'pending', 20, 20),
        ('item-c', 'run-payroll', 'class-payroll', 'result-c', 'student-c', 2,
         'Student C', 'job-c', 'Job C', 'C', 700, 700, 'pending', 20, 20);
    `);

    const settings = lastResults(executeSql(
      persistPath,
      `SELECT grade_a_amount, grade_b_amount, grade_c_amount, revision
       FROM finance_salary_settings WHERE class_id = 'class-payroll';`,
    ));
    assert.deepEqual(settings, [{
      grade_a_amount: 1300,
      grade_b_amount: 1000,
      grade_c_amount: 700,
      revision: 0,
    }]);

    executeSql(persistPath, `
      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_teacher_id, actor_label, created_at
      ) VALUES (
        'tx-salary-a', 'class-payroll', 'pending', 'salary', 'July salary A',
        'salary:item:item-a', 'hash-a', 'salary_item', 'item-a',
        'teacher', 'teacher-payroll', 'Teacher', 30
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        ('entry-salary-a-wallet', 'tx-salary-a', 'class-payroll',
         'finance:student:student-a:wallet', 1300, 1300, 1, 30),
        ('entry-salary-a-issuance', 'tx-salary-a', 'class-payroll',
         'finance:class:class-payroll:issuance', -1300, -1300, 1, 30);
      UPDATE finance_transactions SET status = 'posted', posted_at = 30
      WHERE id = 'tx-salary-a';
      UPDATE finance_payroll_items
      SET status = 'posted', posted_transaction_id = 'tx-salary-a',
          posted_at = 30, updated_at = 30
      WHERE id = 'item-a';
    `);

    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT account_type, student_id, balance, revision
       FROM finance_accounts WHERE class_id = 'class-payroll'
       ORDER BY account_type, student_id;`,
    )), [
      { account_type: "class_issuance", student_id: null, balance: -1300, revision: 1 },
      { account_type: "student_wallet", student_id: "student-a", balance: 1300, revision: 1 },
      { account_type: "student_wallet", student_id: "student-c", balance: 0, revision: 0 },
    ]);

    executeSql(persistPath, `
      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_teacher_id, actor_label, created_at
      ) VALUES (
        'tx-salary-c', 'class-payroll', 'pending', 'salary', 'July salary C',
        'salary:item:item-c', 'hash-c', 'salary_item', 'item-c',
        'teacher', 'teacher-payroll', 'Teacher', 31
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        ('entry-salary-c-wallet', 'tx-salary-c', 'class-payroll',
         'finance:student:student-c:wallet', 700, 700, 1, 31),
        ('entry-salary-c-issuance', 'tx-salary-c', 'class-payroll',
         'finance:class:class-payroll:issuance', -700, -2000, 2, 31);
      UPDATE finance_transactions SET status = 'posted', posted_at = 31
      WHERE id = 'tx-salary-c';
      UPDATE finance_payroll_items
      SET status = 'posted', posted_transaction_id = 'tx-salary-c',
          posted_at = 31, updated_at = 31
      WHERE id = 'item-c';
      UPDATE finance_payroll_runs
      SET status = 'completed', posted_count = 2, posted_at = 31, updated_at = 31
      WHERE id = 'run-payroll';
    `);

    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT status, recipient_count, posted_count, total_amount, posted_at
       FROM finance_payroll_runs WHERE id = 'run-payroll';`,
    )), [{
      status: "completed",
      recipient_count: 2,
      posted_count: 2,
      total_amount: 2000,
      posted_at: 31,
    }]);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT account_type, student_id, balance, revision
       FROM finance_accounts WHERE class_id = 'class-payroll'
       ORDER BY account_type, student_id;`,
    )), [
      { account_type: "class_issuance", student_id: null, balance: -2000, revision: 2 },
      { account_type: "student_wallet", student_id: "student-a", balance: 1300, revision: 1 },
      { account_type: "student_wallet", student_id: "student-c", balance: 700, revision: 1 },
    ]);

    executeSql(persistPath, `
      INSERT INTO finance_payroll_runs (
        id, class_id, closure_id, source_period_id, source_year, source_month,
        salary_settings_revision, salary_settings_json, status,
        recipient_count, posted_count, total_amount, idempotency_key,
        payload_hash, initiated_by_teacher_id, created_at, updated_at
      ) VALUES (
        'run-duplicate', 'class-payroll', 'closure-payroll', 'period-payroll',
        2026, 7, 0, '{}', 'prepared', 2, 0, 2000,
        'payroll:test:duplicate', 'other-hash', 'teacher-payroll', 40, 40
      );
    `, { expectSuccess: false });

    executeSql(persistPath, `
      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_teacher_id, actor_label, created_at
      ) VALUES (
        'tx-salary-a-duplicate', 'class-payroll', 'pending', 'salary',
        'Duplicate salary', 'salary:item:other-key', 'other-hash',
        'salary_item', 'item-a', 'teacher', 'teacher-payroll', 'Teacher', 40
      );
    `, { expectSuccess: false });
  } finally {
    await rm(persistPath, { recursive: true, force: true });
  }
});

test("payroll rechecks current denominations before new and incomplete payouts", {
  timeout: 120_000,
}, async () => {
  const persistPath = await mkdtemp(
    path.join(tmpdir(), "siklassroom-payroll-denomination-d1-"),
  );
  let worker;
  try {
    runWrangler([
      "d1", "migrations", "apply", "DB", "--local", `--persist-to=${persistPath}`,
    ]);

    executeSql(persistPath, `
      INSERT INTO teachers (id, email, password_hash, status, created_at, updated_at)
      VALUES ('teacher-denomination', 'payroll-denomination@test.local', 'hash', 'active', 1, 1);

      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized, school_year,
        grade, class_number, status, created_at, updated_at
      ) VALUES
        ('class-payroll-new', 'teacher-denomination', 'Test School', 'test school new',
         2026, 6, 1, 'active', 1, 1),
        ('class-payroll-retry', 'teacher-denomination', 'Test School', 'test school retry',
         2026, 6, 2, 'active', 1, 1),
        ('class-payroll-done', 'teacher-denomination', 'Test School', 'test school done',
         2026, 6, 3, 'active', 1, 1);

      INSERT INTO students (
        id, class_id, student_number, official_name, status, created_at, updated_at
      ) VALUES
        ('student-payroll-new', 'class-payroll-new', 1, 'New payout student', 'active', 1, 1),
        ('student-payroll-retry', 'class-payroll-retry', 1, 'Retry payout student', 'active', 1, 1),
        ('student-payroll-done', 'class-payroll-done', 1, 'Completed payout student', 'active', 1, 1);

      INSERT INTO class_job_assignment_periods (
        id, class_id, assignment_year, assignment_month, assignment_type,
        status, revision, created_at, updated_at
      ) VALUES
        ('period-payroll-new', 'class-payroll-new', 2026, 7, 'monthly', 'confirmed', 1, 1, 1),
        ('period-payroll-retry', 'class-payroll-retry', 2026, 7, 'monthly', 'confirmed', 1, 1, 1),
        ('period-payroll-done', 'class-payroll-done', 2026, 7, 'monthly', 'confirmed', 1, 1, 1);

      INSERT INTO class_job_month_closures (
        id, class_id, source_period_id, source_year, source_month, status,
        closed_by_teacher_id, closed_at, created_at
      ) VALUES
        ('closure-payroll-new', 'class-payroll-new', 'period-payroll-new', 2026, 7,
         'closed', 'teacher-denomination', 10, 10),
        ('closure-payroll-retry', 'class-payroll-retry', 'period-payroll-retry', 2026, 7,
         'closed', 'teacher-denomination', 10, 10),
        ('closure-payroll-done', 'class-payroll-done', 'period-payroll-done', 2026, 7,
         'closed', 'teacher-denomination', 10, 10);

      INSERT INTO class_job_month_results (
        id, closure_id, class_id, student_id, student_number, student_name,
        class_job_id, job_name, job_grade, created_at
      ) VALUES
        ('result-payroll-new', 'closure-payroll-new', 'class-payroll-new',
         'student-payroll-new', 1, 'New payout student', 'job-new', 'New job', 'A', 10),
        ('result-payroll-retry', 'closure-payroll-retry', 'class-payroll-retry',
         'student-payroll-retry', 1, 'Retry payout student', 'job-retry', 'Retry job', 'C', 10),
        ('result-payroll-done', 'closure-payroll-done', 'class-payroll-done',
         'student-payroll-done', 1, 'Completed payout student', 'job-done', 'Done job', 'B', 10);

      UPDATE finance_salary_settings
      SET grade_a_amount = 1500, grade_b_amount = 1000, grade_c_amount = 500,
          revision = 1, updated_by_teacher_id = 'teacher-denomination', updated_at = 20
      WHERE class_id IN ('class-payroll-new', 'class-payroll-retry', 'class-payroll-done');

      UPDATE finance_settings
      SET denominations_json = '[1000]', revision = 1,
          updated_by_teacher_id = 'teacher-denomination', updated_at = 21
      WHERE class_id IN ('class-payroll-new', 'class-payroll-retry', 'class-payroll-done');

      INSERT INTO finance_payroll_runs (
        id, class_id, closure_id, source_period_id, source_year, source_month,
        salary_settings_revision, salary_settings_json, status,
        recipient_count, posted_count, total_amount, idempotency_key,
        payload_hash, initiated_by_teacher_id, created_at, posted_at, updated_at
      ) VALUES
        ('run-payroll-retry', 'class-payroll-retry', 'closure-payroll-retry',
         'period-payroll-retry', 2026, 7, 1,
         '{"gradeAAmount":1500,"gradeBAmount":1000,"gradeCAmount":500}',
         'prepared', 1, 0, 500, 'salary-auto:closure-payroll-retry',
         'hash-payroll-retry', NULL, 30, NULL, 30),
        ('run-payroll-done', 'class-payroll-done', 'closure-payroll-done',
         'period-payroll-done', 2026, 7, 1,
         '{"gradeAAmount":1500,"gradeBAmount":1000,"gradeCAmount":500}',
         'completed', 1, 1, 1000, 'salary-auto:closure-payroll-done',
         'hash-payroll-done', NULL, 30, 40, 40);

      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_label, created_at
      ) VALUES (
        'tx-payroll-done', 'class-payroll-done', 'pending', 'salary',
        'Completed salary', 'salary:item:item-payroll-done', 'hash-tx-payroll-done',
        'salary_item', 'item-payroll-done', 'system', 'Salary automation', 40
      );

      INSERT INTO finance_payroll_items (
        id, run_id, class_id, closure_result_id, student_id, student_number,
        student_name, class_job_id, job_name, job_grade, base_amount,
        total_amount, status, posted_transaction_id, created_at, posted_at, updated_at
      ) VALUES
        ('item-payroll-retry', 'run-payroll-retry', 'class-payroll-retry',
         'result-payroll-retry', 'student-payroll-retry', 1, 'Retry payout student',
         'job-retry', 'Retry job', 'C', 500, 500, 'pending', NULL, 30, NULL, 30),
        ('item-payroll-done', 'run-payroll-done', 'class-payroll-done',
         'result-payroll-done', 'student-payroll-done', 1, 'Completed payout student',
         'job-done', 'Done job', 'B', 1000, 1000, 'posted',
         'tx-payroll-done', 30, 40, 40);
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        ('entry-payroll-done-wallet', 'tx-payroll-done', 'class-payroll-done',
         'finance:student:student-payroll-done:wallet', 1000, 1000, 1, 40),
        ('entry-payroll-done-issuance', 'tx-payroll-done', 'class-payroll-done',
         'finance:class:class-payroll-done:issuance', -1000, -1000, 1, 40);
      UPDATE finance_transactions
      SET status = 'posted', posted_at = 40
      WHERE id = 'tx-payroll-done';
    `);

    worker = await (await import("wrangler")).unstable_dev(
      denominationWorkerPath,
      {
        config: denominationConfigPath,
        moduleRoot: projectRoot,
        persistTo: persistPath,
        logLevel: "none",
        experimental: {
          disableDevRegistry: true,
          disableExperimentalWarning: true,
          watch: false,
        },
      },
    );

    const pay = async (classId, closureId) => {
      const response = await worker.fetch("http://test.local/pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ classId, closureId }),
      });
      return { response, body: await response.json() };
    };

    const newPayout = await pay("class-payroll-new", "closure-payroll-new");
    assert.equal(newPayout.response.status, 409);
    assert.equal(newPayout.body.code, "FINANCE_PAYROLL_DENOMINATION_MISMATCH");
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT
         (SELECT COUNT(*) FROM finance_payroll_runs
          WHERE class_id = 'class-payroll-new') AS run_count,
         (SELECT COUNT(*) FROM finance_transactions
          WHERE class_id = 'class-payroll-new') AS transaction_count;`,
    )), [{ run_count: 0, transaction_count: 0 }]);

    const incompleteRetry = await pay(
      "class-payroll-retry",
      "closure-payroll-retry",
    );
    assert.equal(incompleteRetry.response.status, 409);
    assert.equal(
      incompleteRetry.body.code,
      "FINANCE_PAYROLL_DENOMINATION_MISMATCH",
    );
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT
         (SELECT status FROM finance_payroll_runs
          WHERE id = 'run-payroll-retry') AS run_status,
         (SELECT status FROM finance_payroll_items
          WHERE id = 'item-payroll-retry') AS item_status,
         (SELECT COUNT(*) FROM finance_transactions
          WHERE class_id = 'class-payroll-retry') AS transaction_count;`,
    )), [{ run_status: "prepared", item_status: "pending", transaction_count: 0 }]);

    const beforeCompletedReplay = lastResults(executeSql(
      persistPath,
      `SELECT
         (SELECT COUNT(*) FROM finance_transactions
          WHERE class_id = 'class-payroll-done') AS transaction_count,
         (SELECT COUNT(*) FROM finance_ledger_entries
          WHERE class_id = 'class-payroll-done') AS entry_count,
         (SELECT balance FROM finance_accounts
          WHERE id = 'finance:student:student-payroll-done:wallet') AS wallet_balance,
         (SELECT balance FROM finance_accounts
          WHERE id = 'finance:class:class-payroll-done:issuance') AS issuance_balance;`,
    ));
    const completedReplay = await pay(
      "class-payroll-done",
      "closure-payroll-done",
    );
    assert.equal(completedReplay.response.status, 200);
    assert.equal(completedReplay.body.deduplicated, true);
    assert.equal(completedReplay.body.payroll.status, "completed");
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT
         (SELECT COUNT(*) FROM finance_transactions
          WHERE class_id = 'class-payroll-done') AS transaction_count,
         (SELECT COUNT(*) FROM finance_ledger_entries
          WHERE class_id = 'class-payroll-done') AS entry_count,
         (SELECT balance FROM finance_accounts
          WHERE id = 'finance:student:student-payroll-done:wallet') AS wallet_balance,
         (SELECT balance FROM finance_accounts
          WHERE id = 'finance:class:class-payroll-done:issuance') AS issuance_balance;`,
    )), beforeCompletedReplay);
  } finally {
    await worker?.stop();
    await rm(persistPath, { recursive: true, force: true });
  }
});
