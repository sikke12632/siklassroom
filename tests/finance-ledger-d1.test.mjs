import assert from "node:assert/strict";
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
      `wrangler 명령이 실패했습니다.\n${output.slice(-4000)}`,
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

test("D1은 확정된 금융 원장만 잔액에 반영하고 보존 상태를 지킨다", async () => {
  const persistPath = await mkdtemp(path.join(tmpdir(), "siklassroom-finance-d1-"));
  try {
    runWrangler([
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      `--persist-to=${persistPath}`,
    ]);

    const pending = executeSql(
      persistPath,
      `
        INSERT INTO teachers (
          id, email, password_hash, status, created_at, updated_at
        ) VALUES (
          'teacher-test', 'teacher@test.local', 'hash', 'active', 1, 1
        );
        INSERT INTO classes (
          id, teacher_id, school_name, school_normalized,
          school_year, grade, class_number, status, created_at, updated_at
        ) VALUES (
          'class-test', 'teacher-test', '테스트초', '테스트초',
          2099, 6, 1, 'active', 1, 1
        );
        INSERT INTO students (
          id, class_id, student_number, official_name, status, created_at, updated_at
        ) VALUES (
          'student-test', 'class-test', 1, '테스트학생', 'active', 1, 1
        );
        INSERT INTO finance_transactions (
          id, class_id, status, transaction_type, description,
          idempotency_key, payload_hash, actor_type, actor_teacher_id,
          actor_label, created_at
        ) VALUES (
          'tx-pending', 'class-test', 'pending', 'manual_credit', '테스트 지급',
          'idem-1', 'hash-1', 'teacher', 'teacher-test', '담임', 10
        );
        INSERT INTO finance_ledger_entries (
          id, transaction_id, class_id, account_id, amount,
          balance_after, account_revision_after, created_at
        ) VALUES (
          'entry-wallet', 'tx-pending', 'class-test',
          'finance:student:student-test:wallet', 100, 100, 1, 10
        );
        INSERT INTO finance_ledger_entries (
          id, transaction_id, class_id, account_id, amount,
          balance_after, account_revision_after, created_at
        ) VALUES (
          'entry-issuance', 'tx-pending', 'class-test',
          'finance:class:class-test:issuance', -100, -100, 1, 10
        );
        SELECT id, balance, revision, status
        FROM finance_accounts
        WHERE class_id = 'class-test'
        ORDER BY id;
      `,
    );
    assert.deepEqual(
      lastResults(pending).map(({ balance, revision }) => ({ balance, revision })),
      [
        { balance: 0, revision: 0 },
        { balance: 0, revision: 0 },
      ],
      "pending 원장은 실제 잔액을 바꾸면 안 됩니다.",
    );

    const posted = executeSql(
      persistPath,
      `
        UPDATE finance_transactions
        SET status = 'posted', posted_at = 20
        WHERE id = 'tx-pending';
        SELECT id, balance, revision
        FROM finance_accounts
        WHERE class_id = 'class-test'
        ORDER BY id;
      `,
    );
    assert.deepEqual(lastResults(posted), [
      {
        id: "finance:class:class-test:issuance",
        balance: -100,
        revision: 1,
      },
      {
        id: "finance:student:student-test:wallet",
        balance: 100,
        revision: 1,
      },
    ]);

    const directMutation = executeSql(
      persistPath,
      `
        UPDATE finance_accounts
        SET balance = 999
        WHERE id = 'finance:student:student-test:wallet';
      `,
      { expectSuccess: false },
    );
    assert.match(directMutation.output, /FINANCE_ACCOUNT_LEDGER_MISMATCH/);

    executeSql(
      persistPath,
      `
        INSERT INTO finance_transactions (
          id, class_id, status, transaction_type, description,
          idempotency_key, payload_hash, actor_type, actor_teacher_id,
          actor_label, created_at
        ) VALUES (
          'tx-unbalanced', 'class-test', 'pending', 'manual_credit', '잘못된 지급',
          'idem-2', 'hash-2', 'teacher', 'teacher-test', '담임', 30
        );
        INSERT INTO finance_ledger_entries (
          id, transaction_id, class_id, account_id, amount,
          balance_after, account_revision_after, created_at
        ) VALUES (
          'entry-unbalanced-wallet', 'tx-unbalanced', 'class-test',
          'finance:student:student-test:wallet', 30, 130, 2, 30
        );
        INSERT INTO finance_ledger_entries (
          id, transaction_id, class_id, account_id, amount,
          balance_after, account_revision_after, created_at
        ) VALUES (
          'entry-unbalanced-issuance', 'tx-unbalanced', 'class-test',
          'finance:class:class-test:issuance', -20, -120, 2, 30
        );
      `,
    );
    const unbalancedPost = executeSql(
      persistPath,
      `
        UPDATE finance_transactions
        SET status = 'posted', posted_at = 40
        WHERE id = 'tx-unbalanced';
      `,
      { expectSuccess: false },
    );
    assert.match(unbalancedPost.output, /FINANCE_TRANSACTION_UNBALANCED/);

    const pendingIgnored = executeSql(
      persistPath,
      `
        SELECT account.id, account.balance, account.revision,
               COALESCE(SUM(
                 CASE WHEN transaction_row.status = 'posted' THEN entry.amount ELSE 0 END
               ), 0) AS posted_balance,
               COALESCE(SUM(
                 CASE WHEN transaction_row.status = 'posted' THEN 1 ELSE 0 END
               ), 0) AS posted_revision
        FROM finance_accounts account
        LEFT JOIN finance_ledger_entries entry
          ON entry.account_id = account.id
        LEFT JOIN finance_transactions transaction_row
          ON transaction_row.id = entry.transaction_id
        WHERE account.class_id = 'class-test'
        GROUP BY account.id
        ORDER BY account.id;
      `,
    );
    for (const row of lastResults(pendingIgnored)) {
      assert.equal(row.balance, row.posted_balance);
      assert.equal(row.revision, row.posted_revision);
    }

    const frozen = executeSql(
      persistPath,
      `
        UPDATE students
        SET status = 'excluded', updated_at = 50
        WHERE id = 'student-test';
        SELECT balance, revision, status
        FROM finance_accounts
        WHERE id = 'finance:student:student-test:wallet';
      `,
    );
    assert.deepEqual(lastResults(frozen), [
      { balance: 100, revision: 1, status: "frozen" },
    ]);

    const duplicateIssuance = executeSql(
      persistPath,
      `
        INSERT INTO finance_accounts (
          id, class_id, student_id, account_type, balance, allow_negative,
          status, revision, created_at, updated_at
        ) VALUES (
          'duplicate-issuance', 'class-test', NULL, 'class_issuance',
          0, 1, 'active', 0, 60, 60
        );
      `,
      { expectSuccess: false },
    );
    assert.match(duplicateIssuance.output, /UNIQUE constraint failed/);

    executeSql(
      persistPath,
      `INSERT INTO finance_transactions (
         id, class_id, status, transaction_type, description,
         idempotency_key, payload_hash, actor_type, actor_teacher_id,
         actor_label, created_at
       ) VALUES (
         'tx-empty-pending', 'class-test', 'pending', 'manual_credit',
         'Interrupted posting attempt', 'idem-empty-pending',
         'hash-empty-pending', 'teacher', 'teacher-test', 'Teacher', 70
       );`,
    );
    const pendingDelete = executeSql(
      persistPath,
      `DELETE FROM finance_transactions WHERE id = 'tx-empty-pending';`,
      { expectSuccess: false },
    );
    assert.match(pendingDelete.output, /FINANCE_TRANSACTION_IMMUTABLE/);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT status FROM finance_transactions
       WHERE id = 'tx-empty-pending';`,
    )), [{ status: "pending" }]);

    executeSql(
      persistPath,
      `INSERT INTO audit_logs (
         id, teacher_id, class_id, student_id, action, detail, created_at
       ) VALUES (
         'audit-immutable', 'teacher-test', 'class-test', 'student-one',
         'finance_test_event', '{"reason":"original"}', 80
       );`,
    );
    const auditUpdate = executeSql(
      persistPath,
      `UPDATE audit_logs SET detail = '{"reason":"changed"}'
       WHERE id = 'audit-immutable';`,
      { expectSuccess: false },
    );
    assert.match(auditUpdate.output, /AUDIT_LOG_IMMUTABLE/);
    const auditDelete = executeSql(
      persistPath,
      `DELETE FROM audit_logs WHERE id = 'audit-immutable';`,
      { expectSuccess: false },
    );
    assert.match(auditDelete.output, /AUDIT_LOG_IMMUTABLE/);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT action, detail FROM audit_logs WHERE id = 'audit-immutable';`,
    )), [{
      action: "finance_test_event",
      detail: '{"reason":"original"}',
    }]);

    const foreignKeys = executeSql(
      persistPath,
      "PRAGMA foreign_key_check;",
    );
    assert.deepEqual(lastResults(foreignKeys), []);
  } finally {
    await rm(persistPath, { recursive: true, force: true });
  }
});
