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
const settlementRetryConfigPath = path.join(
  projectRoot,
  "tests",
  "fixtures",
  "wrangler.deposit-settlement-retry.jsonc",
);
const settlementRetryWorkerPath = "tests/fixtures/deposit-settlement-retry-worker.ts";

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
      `Wrangler command failed.\n${output.slice(-5000)}`,
    );
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

function legacySettlementHash(payload) {
  const stablePayload = Object.fromEntries(
    Object.entries(payload).sort(([left], [right]) => left.localeCompare(right)),
  );
  return createHash("sha256")
    .update(JSON.stringify(stablePayload))
    .digest("base64url");
}

test("deposit products and contracts keep terms, timing, and ledger data safe in D1", async () => {
  const persistPath = await mkdtemp(
    path.join(tmpdir(), "siklassroom-finance-deposits-d1-"),
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
        ) VALUES (
          'teacher-deposits', 'teacher-deposits@test.local', 'hash',
          'active', 1, 1
        );
        INSERT INTO classes (
          id, teacher_id, school_name, school_normalized,
          school_year, grade, class_number, status, created_at, updated_at
        ) VALUES (
          'class-deposits', 'teacher-deposits', 'Test School', 'test school',
          2099, 6, 4, 'active', 1, 1
        );
        INSERT INTO students (
          id, class_id, student_number, official_name, status,
          created_at, updated_at
        ) VALUES
          ('student-early', 'class-deposits', 1, 'Early Student', 'active', 1, 1),
          ('student-maturity', 'class-deposits', 2, 'Maturity Student', 'active', 1, 1);
      `,
    );

    executeSql(
      persistPath,
      `
        INSERT INTO finance_transactions (
          id, class_id, status, transaction_type, description,
          idempotency_key, payload_hash, actor_type, actor_teacher_id,
          actor_label, created_at
        ) VALUES (
          'tx-fund-early', 'class-deposits', 'pending', 'manual_credit',
          'Fund the early-settlement wallet', 'tx:fund:early', 'hash:fund:early',
          'teacher', 'teacher-deposits', 'Teacher', 10
        );
        INSERT INTO finance_ledger_entries (
          id, transaction_id, class_id, account_id, amount,
          balance_after, account_revision_after, created_at
        ) VALUES
          ('entry-fund-early-wallet', 'tx-fund-early', 'class-deposits',
           'finance:student:student-early:wallet', 10000, 10000, 1, 10),
          ('entry-fund-early-issuance', 'tx-fund-early', 'class-deposits',
           'finance:class:class-deposits:issuance', -10000, -10000, 1, 10);
        UPDATE finance_transactions
        SET status = 'posted', posted_at = 10
        WHERE id = 'tx-fund-early';

        INSERT INTO finance_transactions (
          id, class_id, status, transaction_type, description,
          idempotency_key, payload_hash, actor_type, actor_teacher_id,
          actor_label, created_at
        ) VALUES (
          'tx-fund-maturity', 'class-deposits', 'pending', 'manual_credit',
          'Fund the maturity wallet', 'tx:fund:maturity', 'hash:fund:maturity',
          'teacher', 'teacher-deposits', 'Teacher', 11
        );
        INSERT INTO finance_ledger_entries (
          id, transaction_id, class_id, account_id, amount,
          balance_after, account_revision_after, created_at
        ) VALUES
          ('entry-fund-maturity-wallet', 'tx-fund-maturity', 'class-deposits',
           'finance:student:student-maturity:wallet', 10000, 10000, 1, 11),
          ('entry-fund-maturity-issuance', 'tx-fund-maturity', 'class-deposits',
           'finance:class:class-deposits:issuance', -10000, -20000, 2, 11);
        UPDATE finance_transactions
        SET status = 'posted', posted_at = 11
        WHERE id = 'tx-fund-maturity';
      `,
    );

    executeSql(
      persistPath,
      `
        INSERT INTO finance_deposit_products (
          id, class_id, name, description, term_weeks,
          maturity_interest_bps, early_interest_bps, min_amount, max_amount,
          is_open, revision, created_by_teacher_id, updated_by_teacher_id,
          created_at, updated_at
        ) VALUES (
          'product-one-week', 'class-deposits', 'One Week Savings',
          'A fixed classroom savings product', 1,
          1000, 5000, 1000, 5000,
          1, 0, 'teacher-deposits', 'teacher-deposits', 1000, 1000
        );
        INSERT INTO finance_deposit_product_events (
          id, class_id, product_id, revision, action,
          idempotency_key, payload_hash, product_snapshot_json,
          actor_teacher_id, created_at
        ) VALUES (
          'product-event-issued', 'class-deposits', 'product-one-week', 0,
          'issued', 'product:issue:one-week', 'hash:product:issue',
          '{"name":"One Week Savings","revision":0,"isOpen":true}',
          'teacher-deposits', 1000
        );
      `,
    );
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT product.name, product.revision, product.is_open,
              event.action, event.actor_teacher_id
       FROM finance_deposit_products product
       JOIN finance_deposit_product_events event
         ON event.product_id = product.id
       WHERE product.id = 'product-one-week';`,
    )), [{
      name: "One Week Savings",
      revision: 0,
      is_open: 1,
      action: "issued",
      actor_teacher_id: "teacher-deposits",
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
          'request-deposit-reserve', 'class-deposits', 'student-early',
          'finance:student:student-early:wallet', 'withdrawal', 9000,
          'request:deposit-reserve:1', 'hash:request:deposit-reserve',
          1, 'Early Student', 10000, 1, 0, 1900
        );
        INSERT INTO finance_transactions (
          id, class_id, status, transaction_type, description,
          idempotency_key, payload_hash, source_type, source_id,
          actor_type, actor_label, created_at
        ) VALUES (
          'tx-open-reserved-probe', 'class-deposits', 'pending', 'deposit_open',
          'Reserved withdrawal deposit probe', 'tx:deposit:reserved-probe',
          'hash:tx:deposit:reserved-probe', 'deposit_contract',
          'contract-reserved-probe', 'system', 'Automatic deposit system', 1901
        );
      `,
    );
    const reservedDeposit = executeSql(
      persistPath,
      `
        INSERT INTO finance_ledger_entries (
          id, transaction_id, class_id, account_id, amount,
          balance_after, account_revision_after, created_at
        ) VALUES (
          'entry-open-reserved-probe-wallet', 'tx-open-reserved-probe',
          'class-deposits', 'finance:student:student-early:wallet',
          -2000, 8000, 2, 1901
        );
      `,
      { expectSuccess: false },
    );
    assert.match(
      reservedDeposit.output,
      /FINANCE_INSUFFICIENT_AVAILABLE_BALANCE/,
    );
    executeSql(
      persistPath,
      `
        DELETE FROM finance_transactions
        WHERE id = 'tx-open-reserved-probe' AND status = 'pending';
        INSERT INTO finance_request_resolutions (
          id, request_id, class_id, decision, idempotency_key, payload_hash,
          expected_request_revision, actor_type, actor_student_id,
          actor_label, is_emergency, posted_transaction_id,
          transaction_payload_hash, resolved_at, created_at
        ) VALUES (
          'resolution-deposit-reserve', 'request-deposit-reserve',
          'class-deposits', 'cancelled', 'decision:deposit-reserve:1',
          'hash:decision:deposit-reserve', 0, 'student', 'student-early',
          'Early Student', 0, NULL, NULL, 1902, 1902
        );
      `,
    );

    executeSql(
      persistPath,
      `
        INSERT INTO finance_transactions (
          id, class_id, status, transaction_type, description,
          idempotency_key, payload_hash, source_type, source_id,
          actor_type, actor_label, created_at
        ) VALUES (
          'tx-open-early', 'class-deposits', 'pending', 'deposit_open',
          'Subscribe to One Week Savings', 'tx:deposit:open:early',
          'hash:tx:deposit:open:early', 'deposit_contract', 'contract-early',
          'system', 'Automatic deposit system', 2000
        );
        INSERT INTO finance_ledger_entries (
          id, transaction_id, class_id, account_id, amount,
          balance_after, account_revision_after, created_at
        ) VALUES
          ('entry-open-early-wallet', 'tx-open-early', 'class-deposits',
           'finance:student:student-early:wallet', -2000, 8000, 2, 2000),
          ('entry-open-early-issuance', 'tx-open-early', 'class-deposits',
           'finance:class:class-deposits:issuance', 2000, -18000, 3, 2000);
        UPDATE finance_transactions
        SET status = 'posted', posted_at = 2000
        WHERE id = 'tx-open-early';
        INSERT INTO finance_deposit_contracts (
          id, class_id, product_id, product_revision, student_id,
          wallet_account_id, principal, product_name_snapshot,
          term_weeks_snapshot, maturity_interest_bps_snapshot,
          early_interest_bps_snapshot, maturity_interest, early_interest,
          maturity_payout, early_payout, opened_at, matures_at,
          idempotency_key, payload_hash, posted_transaction_id,
          transaction_payload_hash, created_at
        ) VALUES (
          'contract-early', 'class-deposits', 'product-one-week', 0,
          'student-early', 'finance:student:student-early:wallet', 2000,
          'One Week Savings', 1, 1000, 5000, 200, 100, 2200, 2100,
          2000, 604802000, 'contract:early:one', 'hash:contract:early',
          'tx-open-early', 'hash:tx:deposit:open:early', 2000
        );
      `,
    );
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT contract.principal, contract.maturity_interest,
              contract.early_interest, contract.maturity_payout,
              contract.early_payout, transaction_row.status,
              COUNT(entry.id) AS entry_count,
              COALESCE(SUM(entry.amount), 0) AS entry_sum
       FROM finance_deposit_contracts contract
       JOIN finance_transactions transaction_row
         ON transaction_row.id = contract.posted_transaction_id
       JOIN finance_ledger_entries entry
         ON entry.transaction_id = transaction_row.id
       WHERE contract.id = 'contract-early'
       GROUP BY contract.id, transaction_row.id;`,
    )), [{
      principal: 2000,
      maturity_interest: 200,
      early_interest: 100,
      maturity_payout: 2200,
      early_payout: 2100,
      status: "posted",
      entry_count: 2,
      entry_sum: 0,
    }]);

    const activeStudentExcluded = executeSql(
      persistPath,
      `UPDATE students
       SET status = 'excluded', updated_at = 2200
       WHERE id = 'student-early';`,
      { expectSuccess: false },
    );
    assert.match(
      activeStudentExcluded.output,
      /FINANCE_DEPOSIT_ACTIVE_STUDENT/,
    );

    const classWithActiveDepositArchived = executeSql(
      persistPath,
      `UPDATE classes
       SET status = 'archived', updated_at = 2200
       WHERE id = 'class-deposits';`,
      { expectSuccess: false },
    );
    assert.match(
      classWithActiveDepositArchived.output,
      /FINANCE_DEPOSIT_ACTIVE_CLASS/,
    );

    executeSql(
      persistPath,
      `
        INSERT INTO finance_transactions (
          id, class_id, status, transaction_type, description,
          idempotency_key, payload_hash, source_type, source_id,
          actor_type, actor_label, created_at
        ) VALUES (
          'tx-open-duplicate', 'class-deposits', 'pending', 'deposit_open',
          'Duplicate subscription attempt', 'tx:deposit:open:duplicate',
          'hash:tx:deposit:open:duplicate', 'deposit_contract',
          'contract-duplicate', 'system', 'Automatic deposit system', 2500
        );
        INSERT INTO finance_ledger_entries (
          id, transaction_id, class_id, account_id, amount,
          balance_after, account_revision_after, created_at
        ) VALUES
          ('entry-open-duplicate-wallet', 'tx-open-duplicate', 'class-deposits',
           'finance:student:student-early:wallet', -1000, 7000, 3, 2500),
          ('entry-open-duplicate-issuance', 'tx-open-duplicate', 'class-deposits',
           'finance:class:class-deposits:issuance', 1000, -17000, 4, 2500);
        UPDATE finance_transactions
        SET status = 'posted', posted_at = 2500
        WHERE id = 'tx-open-duplicate';
      `,
    );
    const duplicateActive = executeSql(
      persistPath,
      `INSERT INTO finance_deposit_contracts (
         id, class_id, product_id, product_revision, student_id,
         wallet_account_id, principal, product_name_snapshot,
         term_weeks_snapshot, maturity_interest_bps_snapshot,
         early_interest_bps_snapshot, maturity_interest, early_interest,
         maturity_payout, early_payout, opened_at, matures_at,
         idempotency_key, payload_hash, posted_transaction_id,
         transaction_payload_hash, created_at
       ) VALUES (
         'contract-duplicate', 'class-deposits', 'product-one-week', 0,
         'student-early', 'finance:student:student-early:wallet', 1000,
         'One Week Savings', 1, 1000, 5000, 100, 50, 1100, 1050,
         2500, 604802500, 'contract:early:duplicate',
         'hash:contract:duplicate', 'tx-open-duplicate',
         'hash:tx:deposit:open:duplicate', 2500
       );`,
      { expectSuccess: false },
    );
    assert.match(duplicateActive.output, /FINANCE_DEPOSIT_ACTIVE_EXISTS/);

    const maturityTooEarly = executeSql(
      persistPath,
      `INSERT INTO finance_deposit_settlements (
         id, class_id, contract_id, student_id, settlement_type,
         principal, interest, payout, idempotency_key, payload_hash,
         posted_transaction_id, transaction_payload_hash, settled_at, created_at
       ) VALUES (
         'settlement-too-early', 'class-deposits', 'contract-early',
         'student-early', 'maturity', 2000, 200, 2200,
         'settlement:maturity:too-early', 'hash:settlement:too-early',
         'tx-fund-early', 'hash:unused', 3000, 3000
       );`,
      { expectSuccess: false },
    );
    assert.match(maturityTooEarly.output, /FINANCE_DEPOSIT_SETTLEMENT_STALE/);

    const earlyTooLate = executeSql(
      persistPath,
      `INSERT INTO finance_deposit_settlements (
         id, class_id, contract_id, student_id, settlement_type,
         principal, interest, payout, idempotency_key, payload_hash,
         posted_transaction_id, transaction_payload_hash, settled_at, created_at
       ) VALUES (
         'settlement-early-too-late', 'class-deposits', 'contract-early',
         'student-early', 'early_termination', 2000, 100, 2100,
         'settlement:early:too-late', 'hash:settlement:early:too-late',
         'tx-fund-early', 'hash:unused', 604802000, 604802000
       );`,
      { expectSuccess: false },
    );
    assert.match(earlyTooLate.output, /FINANCE_DEPOSIT_SETTLEMENT_STALE/);

    executeSql(
      persistPath,
      `
        INSERT INTO finance_transactions (
          id, class_id, status, transaction_type, description,
          idempotency_key, payload_hash, source_type, source_id,
          actor_type, actor_label, created_at
        ) VALUES (
          'tx-settle-early', 'class-deposits', 'pending',
          'deposit_early_termination', 'Settle deposit early',
          'tx:deposit:settle:early', 'hash:tx:deposit:settle:early',
          'deposit_settlement', 'contract-early',
          'system', 'Automatic deposit system', 3000
        );
        INSERT INTO finance_ledger_entries (
          id, transaction_id, class_id, account_id, amount,
          balance_after, account_revision_after, created_at
        ) VALUES
          ('entry-settle-early-wallet', 'tx-settle-early', 'class-deposits',
           'finance:student:student-early:wallet', 2100, 9100, 4, 3000),
          ('entry-settle-early-issuance', 'tx-settle-early', 'class-deposits',
           'finance:class:class-deposits:issuance', -2100, -19100, 5, 3000);
        UPDATE finance_transactions
        SET status = 'posted', posted_at = 3000
        WHERE id = 'tx-settle-early';
        INSERT INTO finance_deposit_settlements (
          id, class_id, contract_id, student_id, settlement_type,
          principal, interest, payout, idempotency_key, payload_hash,
          posted_transaction_id, transaction_payload_hash, settled_at, created_at
        ) VALUES (
          'settlement-early', 'class-deposits', 'contract-early',
          'student-early', 'early_termination', 2000, 100, 2100,
          'settlement:early:one', 'hash:settlement:early',
          'tx-settle-early', 'hash:tx:deposit:settle:early', 3000, 3000
        );
      `,
    );
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT settlement_type, principal, interest, payout, settled_at
       FROM finance_deposit_settlements
       WHERE contract_id = 'contract-early';`,
    )), [{
      settlement_type: "early_termination",
      principal: 2000,
      interest: 100,
      payout: 2100,
      settled_at: 3000,
    }]);

    const duplicateSettlement = executeSql(
      persistPath,
      `INSERT INTO finance_deposit_settlements (
         id, class_id, contract_id, student_id, settlement_type,
         principal, interest, payout, idempotency_key, payload_hash,
         posted_transaction_id, transaction_payload_hash, settled_at, created_at
       ) VALUES (
         'settlement-early-duplicate', 'class-deposits', 'contract-early',
         'student-early', 'early_termination', 2000, 100, 2100,
         'settlement:early:duplicate', 'hash:settlement:early:duplicate',
         'tx-fund-early', 'hash:unused', 3100, 3100
       );`,
      { expectSuccess: false },
    );
    assert.match(duplicateSettlement.output, /FINANCE_DEPOSIT_SETTLEMENT_STALE/);

    const studentExcludedAfterSettlement = executeSql(
      persistPath,
      `UPDATE students
       SET status = 'excluded', updated_at = 3200
       WHERE id = 'student-early';
       SELECT student.status,
              (SELECT account.status
               FROM finance_accounts account
               WHERE account.id = 'finance:student:student-early:wallet')
                AS wallet_status
       FROM students student
       WHERE student.id = 'student-early';`,
    );
    assert.deepEqual(lastResults(studentExcludedAfterSettlement), [{
      status: "excluded",
      wallet_status: "frozen",
    }]);
    executeSql(
      persistPath,
      `UPDATE students
       SET status = 'active', updated_at = 3201
       WHERE id = 'student-early';`,
    );

    const classArchivedAfterSettlement = executeSql(
      persistPath,
      `UPDATE classes
       SET status = 'archived', updated_at = 3202
       WHERE id = 'class-deposits';
       SELECT class_row.status,
              (SELECT COUNT(*) FROM finance_accounts account
               WHERE account.class_id = class_row.id
                 AND account.status = 'closed') AS closed_account_count
       FROM classes class_row
       WHERE class_row.id = 'class-deposits';`,
    );
    assert.deepEqual(lastResults(classArchivedAfterSettlement), [{
      status: "archived",
      closed_account_count: 3,
    }]);
    executeSql(
      persistPath,
      `UPDATE classes
       SET status = 'active', updated_at = 3203
       WHERE id = 'class-deposits';`,
    );

    executeSql(
      persistPath,
      `
        INSERT INTO finance_transactions (
          id, class_id, status, transaction_type, description,
          idempotency_key, payload_hash, source_type, source_id,
          actor_type, actor_label, created_at
        ) VALUES (
          'tx-open-maturity', 'class-deposits', 'pending', 'deposit_open',
          'Subscribe to maturity product', 'tx:deposit:open:maturity',
          'hash:tx:deposit:open:maturity', 'deposit_contract',
          'contract-maturity', 'system', 'Automatic deposit system', 10000
        );
        INSERT INTO finance_ledger_entries (
          id, transaction_id, class_id, account_id, amount,
          balance_after, account_revision_after, created_at
        ) VALUES
          ('entry-open-maturity-wallet', 'tx-open-maturity', 'class-deposits',
           'finance:student:student-maturity:wallet', -3000, 7000, 2, 10000),
          ('entry-open-maturity-issuance', 'tx-open-maturity', 'class-deposits',
           'finance:class:class-deposits:issuance', 3000, -16100, 6, 10000);
        UPDATE finance_transactions
        SET status = 'posted', posted_at = 10000
        WHERE id = 'tx-open-maturity';
        INSERT INTO finance_deposit_contracts (
          id, class_id, product_id, product_revision, student_id,
          wallet_account_id, principal, product_name_snapshot,
          term_weeks_snapshot, maturity_interest_bps_snapshot,
          early_interest_bps_snapshot, maturity_interest, early_interest,
          maturity_payout, early_payout, opened_at, matures_at,
          idempotency_key, payload_hash, posted_transaction_id,
          transaction_payload_hash, created_at
        ) VALUES (
          'contract-maturity', 'class-deposits', 'product-one-week', 0,
          'student-maturity', 'finance:student:student-maturity:wallet', 3000,
          'One Week Savings', 1, 1000, 5000, 300, 150, 3300, 3150,
          10000, 604810000, 'contract:maturity:one',
          'hash:contract:maturity', 'tx-open-maturity',
          'hash:tx:deposit:open:maturity', 10000
        );

        INSERT INTO finance_transactions (
          id, class_id, status, transaction_type, description,
          idempotency_key, payload_hash, source_type, source_id,
          actor_type, actor_label, created_at
        ) VALUES (
          'tx-settle-maturity', 'class-deposits', 'pending', 'deposit_maturity',
          'Automatically pay matured deposit', 'tx:deposit:settle:maturity',
          'hash:tx:deposit:settle:maturity', 'deposit_settlement',
          'contract-maturity', 'system', 'Automatic deposit system', 604810000
        );
        INSERT INTO finance_ledger_entries (
          id, transaction_id, class_id, account_id, amount,
          balance_after, account_revision_after, created_at
        ) VALUES
          ('entry-settle-maturity-wallet', 'tx-settle-maturity', 'class-deposits',
           'finance:student:student-maturity:wallet', 3300, 10300, 3, 604810000),
          ('entry-settle-maturity-issuance', 'tx-settle-maturity', 'class-deposits',
           'finance:class:class-deposits:issuance', -3300, -19400, 7, 604810000);
        UPDATE finance_transactions
        SET status = 'posted', posted_at = 604810000
        WHERE id = 'tx-settle-maturity';
        INSERT INTO finance_deposit_settlements (
          id, class_id, contract_id, student_id, settlement_type,
          principal, interest, payout, idempotency_key, payload_hash,
          posted_transaction_id, transaction_payload_hash, settled_at, created_at
        ) VALUES (
          'settlement-maturity', 'class-deposits', 'contract-maturity',
          'student-maturity', 'maturity', 3000, 300, 3300,
          'settlement:maturity:one', 'hash:settlement:maturity',
          'tx-settle-maturity', 'hash:tx:deposit:settle:maturity',
          604810000, 604810000
        );
      `,
    );
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT settlement_type, principal, interest, payout, settled_at
       FROM finance_deposit_settlements
       WHERE contract_id = 'contract-maturity';`,
    )), [{
      settlement_type: "maturity",
      principal: 3000,
      interest: 300,
      payout: 3300,
      settled_at: 604810000,
    }]);

    executeSql(
      persistPath,
      `
        UPDATE finance_deposit_products
        SET is_open = 0, revision = 1,
            updated_by_teacher_id = 'teacher-deposits', updated_at = 700000000
        WHERE id = 'product-one-week' AND revision = 0;
        INSERT INTO finance_deposit_product_events (
          id, class_id, product_id, revision, action,
          idempotency_key, payload_hash, product_snapshot_json,
          actor_teacher_id, created_at
        ) VALUES (
          'product-event-paused', 'class-deposits', 'product-one-week', 1,
          'paused', 'product:pause:one-week', 'hash:product:pause',
          '{"name":"One Week Savings","revision":1,"isOpen":false}',
          'teacher-deposits', 700000000
        );
      `,
    );

    const productTermsImmutable = executeSql(
      persistPath,
      `UPDATE finance_deposit_products
       SET name = 'Changed Terms', is_open = 1, revision = 2,
           updated_by_teacher_id = 'teacher-deposits', updated_at = 700000001
       WHERE id = 'product-one-week';`,
      { expectSuccess: false },
    );
    assert.match(
      productTermsImmutable.output,
      /FINANCE_DEPOSIT_PRODUCT_TERMS_IMMUTABLE/,
    );

    const productEventImmutable = executeSql(
      persistPath,
      `UPDATE finance_deposit_product_events
       SET payload_hash = 'changed' WHERE id = 'product-event-issued';`,
      { expectSuccess: false },
    );
    assert.match(
      productEventImmutable.output,
      /FINANCE_DEPOSIT_PRODUCT_EVENT_IMMUTABLE/,
    );

    const contractImmutable = executeSql(
      persistPath,
      `UPDATE finance_deposit_contracts
       SET created_at = created_at + 1 WHERE id = 'contract-early';`,
      { expectSuccess: false },
    );
    assert.match(
      contractImmutable.output,
      /FINANCE_DEPOSIT_CONTRACT_IMMUTABLE/,
    );

    const settlementImmutable = executeSql(
      persistPath,
      `DELETE FROM finance_deposit_settlements
       WHERE id = 'settlement-maturity';`,
      { expectSuccess: false },
    );
    assert.match(
      settlementImmutable.output,
      /FINANCE_DEPOSIT_SETTLEMENT_IMMUTABLE/,
    );

    const reversalBlocked = executeSql(
      persistPath,
      `INSERT INTO finance_transactions (
         id, class_id, status, transaction_type, description,
         idempotency_key, payload_hash, reversal_of_transaction_id,
         actor_type, actor_teacher_id, actor_label, created_at
       ) VALUES (
         'tx-reverse-deposit', 'class-deposits', 'pending', 'reversal',
         'Attempt to reverse a deposit directly', 'tx:reverse:deposit',
         'hash:tx:reverse:deposit', 'tx-open-early',
         'teacher', 'teacher-deposits', 'Teacher', 700000002
       );`,
      { expectSuccess: false },
    );
    assert.match(
      reversalBlocked.output,
      /FINANCE_DEPOSIT_REVERSAL_REQUIRES_CONTRACT/,
    );

    const depositTransactions = lastResults(executeSql(
      persistPath,
      `SELECT transaction_row.id,
              COUNT(entry.id) AS entry_count,
              COALESCE(SUM(entry.amount), 0) AS entry_sum
       FROM finance_transactions transaction_row
       JOIN finance_ledger_entries entry
         ON entry.transaction_id = transaction_row.id
       WHERE transaction_row.source_type IN ('deposit_contract', 'deposit_settlement')
         AND transaction_row.status = 'posted'
       GROUP BY transaction_row.id
       ORDER BY transaction_row.id;`,
    ));
    assert.equal(depositTransactions.length, 5);
    for (const transaction of depositTransactions) {
      assert.equal(transaction.entry_count, 2);
      assert.equal(transaction.entry_sum, 0);
    }

    const reconciledAccounts = lastResults(executeSql(
      persistPath,
      `SELECT account.id, account.balance, account.revision,
              COALESCE(SUM(CASE WHEN transaction_row.status = 'posted'
                                THEN entry.amount ELSE 0 END), 0) AS posted_balance,
              COALESCE(SUM(CASE WHEN transaction_row.status = 'posted'
                                THEN 1 ELSE 0 END), 0) AS posted_revision
       FROM finance_accounts account
       LEFT JOIN finance_ledger_entries entry ON entry.account_id = account.id
       LEFT JOIN finance_transactions transaction_row
         ON transaction_row.id = entry.transaction_id
       WHERE account.class_id = 'class-deposits'
       GROUP BY account.id
       ORDER BY account.id;`,
    ));
    assert.deepEqual(
      reconciledAccounts.map((row) => ({
        id: row.id,
        balance: row.balance,
        revision: row.revision,
      })),
      [
        {
          id: "finance:class:class-deposits:issuance",
          balance: -19400,
          revision: 7,
        },
        {
          id: "finance:student:student-early:wallet",
          balance: 9100,
          revision: 4,
        },
        {
          id: "finance:student:student-maturity:wallet",
          balance: 10300,
          revision: 3,
        },
      ],
    );
    for (const account of reconciledAccounts) {
      assert.equal(account.balance, account.posted_balance);
      assert.equal(account.revision, account.posted_revision);
    }

    assert.deepEqual(lastResults(executeSql(
      persistPath,
      "PRAGMA foreign_key_check;",
    )), []);
  } finally {
    await rm(persistPath, { recursive: true, force: true });
  }
});

test("teacher emergency deposit settlement requires owned access and an immutable reason", async () => {
  const persistPath = await mkdtemp(
    path.join(tmpdir(), "siklassroom-finance-deposit-emergency-d1-"),
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
    executeSql(persistPath, `
      INSERT INTO teachers (id, email, password_hash, status, created_at, updated_at)
      VALUES
        ('teacher-emergency', 'teacher-emergency@test.local', 'hash', 'active', 1, 1),
        ('teacher-other', 'teacher-other@test.local', 'hash', 'active', 1, 1);
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized,
        school_year, grade, class_number, status, created_at, updated_at
      ) VALUES (
        'class-emergency', 'teacher-emergency', 'Test School', 'test school',
        2099, 6, 8, 'active', 1, 1
      );
      INSERT INTO students (
        id, class_id, student_number, official_name, status, created_at, updated_at
      ) VALUES
        ('student-emergency-valid', 'class-emergency', 1, 'Valid Student', 'active', 1, 1),
        ('student-emergency-no-reason', 'class-emergency', 2, 'No Reason Student', 'active', 1, 1);
      INSERT INTO finance_deposit_products (
        id, class_id, name, description, term_weeks,
        maturity_interest_bps, early_interest_bps, min_amount, max_amount,
        is_open, revision, created_by_teacher_id, updated_by_teacher_id,
        created_at, updated_at
      ) VALUES (
        'product-emergency', 'class-emergency', 'Emergency Savings', '', 1,
        1000, 5000, 1000, 5000, 1, 0,
        'teacher-emergency', 'teacher-emergency', 1000, 1000
      );
    `);

    executeSql(persistPath, `
      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, actor_type, actor_teacher_id,
        actor_label, created_at
      ) VALUES
        ('tx-emergency-fund-valid', 'class-emergency', 'pending', 'manual_credit',
         'Fund valid wallet', 'emergency:fund:valid', 'hash:emergency:fund:valid',
         'teacher', 'teacher-emergency', 'Teacher', 10),
        ('tx-emergency-fund-no-reason', 'class-emergency', 'pending', 'manual_credit',
         'Fund no reason wallet', 'emergency:fund:no-reason', 'hash:emergency:fund:no-reason',
         'teacher', 'teacher-emergency', 'Teacher', 11);
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        ('entry-emergency-fund-valid-wallet', 'tx-emergency-fund-valid', 'class-emergency',
         'finance:student:student-emergency-valid:wallet', 10000, 10000, 1, 10),
        ('entry-emergency-fund-valid-issuance', 'tx-emergency-fund-valid', 'class-emergency',
         'finance:class:class-emergency:issuance', -10000, -10000, 1, 10);
      UPDATE finance_transactions SET status = 'posted', posted_at = 10
      WHERE id = 'tx-emergency-fund-valid';
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        ('entry-emergency-fund-no-reason-wallet', 'tx-emergency-fund-no-reason', 'class-emergency',
         'finance:student:student-emergency-no-reason:wallet', 10000, 10000, 1, 11),
        ('entry-emergency-fund-no-reason-issuance', 'tx-emergency-fund-no-reason', 'class-emergency',
         'finance:class:class-emergency:issuance', -10000, -20000, 2, 11);
      UPDATE finance_transactions SET status = 'posted', posted_at = 11
      WHERE id = 'tx-emergency-fund-no-reason';
    `);

    executeSql(persistPath, `
      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_label, created_at
      ) VALUES
        ('tx-emergency-open-valid', 'class-emergency', 'pending', 'deposit_open',
         'Open valid emergency contract', 'emergency:open:valid', 'hash:emergency:open:valid',
         'deposit_contract', 'contract-emergency-valid', 'system', 'Deposit automation', 2000),
        ('tx-emergency-open-no-reason', 'class-emergency', 'pending', 'deposit_open',
         'Open no-reason contract', 'emergency:open:no-reason', 'hash:emergency:open:no-reason',
         'deposit_contract', 'contract-emergency-no-reason', 'system', 'Deposit automation', 2001);
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        ('entry-emergency-open-valid-wallet', 'tx-emergency-open-valid', 'class-emergency',
         'finance:student:student-emergency-valid:wallet', -2000, 8000, 2, 2000),
        ('entry-emergency-open-valid-issuance', 'tx-emergency-open-valid', 'class-emergency',
         'finance:class:class-emergency:issuance', 2000, -18000, 3, 2000);
      UPDATE finance_transactions SET status = 'posted', posted_at = 2000
      WHERE id = 'tx-emergency-open-valid';
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        ('entry-emergency-open-no-reason-wallet', 'tx-emergency-open-no-reason', 'class-emergency',
         'finance:student:student-emergency-no-reason:wallet', -2000, 8000, 2, 2001),
        ('entry-emergency-open-no-reason-issuance', 'tx-emergency-open-no-reason', 'class-emergency',
         'finance:class:class-emergency:issuance', 2000, -16000, 4, 2001);
      UPDATE finance_transactions SET status = 'posted', posted_at = 2001
      WHERE id = 'tx-emergency-open-no-reason';
      INSERT INTO finance_deposit_contracts (
        id, class_id, product_id, product_revision, student_id,
        wallet_account_id, principal, product_name_snapshot,
        term_weeks_snapshot, maturity_interest_bps_snapshot,
        early_interest_bps_snapshot, maturity_interest, early_interest,
        maturity_payout, early_payout, opened_at, matures_at,
        idempotency_key, payload_hash, posted_transaction_id,
        transaction_payload_hash, created_at
      ) VALUES
        ('contract-emergency-valid', 'class-emergency', 'product-emergency', 0,
         'student-emergency-valid', 'finance:student:student-emergency-valid:wallet',
         2000, 'Emergency Savings', 1, 1000, 5000, 200, 100, 2200, 2100,
         2000, 604802000, 'contract:emergency:valid', 'hash:contract:emergency:valid',
         'tx-emergency-open-valid', 'hash:emergency:open:valid', 2000),
        ('contract-emergency-no-reason', 'class-emergency', 'product-emergency', 0,
         'student-emergency-no-reason', 'finance:student:student-emergency-no-reason:wallet',
         2000, 'Emergency Savings', 1, 1000, 5000, 200, 100, 2200, 2100,
         2001, 604802001, 'contract:emergency:no-reason', 'hash:contract:emergency:no-reason',
         'tx-emergency-open-no-reason', 'hash:emergency:open:no-reason', 2001);
    `);

    const otherTeacher = executeSql(
      persistPath,
      `INSERT INTO finance_transactions (
         id, class_id, status, transaction_type, description,
         idempotency_key, payload_hash, source_type, source_id,
         actor_type, actor_teacher_id, actor_label, metadata_json, created_at
       ) VALUES (
         'tx-emergency-other-teacher', 'class-emergency', 'pending',
         'deposit_early_termination', 'Unauthorized emergency settlement',
         'emergency:settle:other-teacher', 'hash:emergency:settle:other-teacher',
         'deposit_settlement', 'contract-emergency-valid',
         'teacher', 'teacher-other', 'Other Teacher',
         '{"isEmergency":true,"interventionReason":"Wrong teacher"}', 2999
       );`,
      { expectSuccess: false },
    );
    assert.match(otherTeacher.output, /FINANCE_CLASS_ACCESS_DENIED/);

    executeSql(persistPath, `
      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_teacher_id, actor_label, metadata_json, created_at
      ) VALUES (
        'tx-emergency-settle-valid', 'class-emergency', 'pending',
        'deposit_early_termination', 'Emergency Savings teacher settlement',
        'deposit-contract:contract-emergency-valid:settlement',
        'hash:tx:emergency:settle:valid', 'deposit_settlement',
        'contract-emergency-valid', 'teacher', 'teacher-emergency',
        'Homeroom emergency settlement',
        '{"contractId":"contract-emergency-valid","expectedSettlementRevision":0,"interest":100,"interventionReason":"Transfer cleanup before exclusion","isEmergency":true,"origin":"student_exclusion","payout":2100,"principal":2000,"settlementPolicy":"contract_terms_at_settlement","settlementType":"early_termination","studentId":"student-emergency-valid"}',
        3000
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        ('entry-emergency-settle-valid-wallet', 'tx-emergency-settle-valid', 'class-emergency',
         'finance:student:student-emergency-valid:wallet', 2100, 10100, 3, 3000),
        ('entry-emergency-settle-valid-issuance', 'tx-emergency-settle-valid', 'class-emergency',
         'finance:class:class-emergency:issuance', -2100, -18100, 5, 3000);
      UPDATE finance_transactions SET status = 'posted', posted_at = 3000
      WHERE id = 'tx-emergency-settle-valid';
      INSERT INTO finance_deposit_settlements (
        id, class_id, contract_id, student_id, settlement_type,
        principal, interest, payout, idempotency_key, payload_hash,
        posted_transaction_id, transaction_payload_hash, settled_at, created_at
      ) VALUES (
        'settlement-emergency-valid', 'class-emergency', 'contract-emergency-valid',
        'student-emergency-valid', 'early_termination', 2000, 100, 2100,
        'settlement:emergency:valid', 'hash:settlement:emergency:valid',
        'tx-emergency-settle-valid', 'hash:tx:emergency:settle:valid', 3000, 3000
      );
    `);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT settlement.settlement_type, settlement.payout,
              transaction_row.actor_type, transaction_row.actor_teacher_id,
              json_extract(transaction_row.metadata_json, '$.interventionReason') AS reason,
              account.balance, account.revision
       FROM finance_deposit_settlements settlement
       JOIN finance_transactions transaction_row
         ON transaction_row.id = settlement.posted_transaction_id
       JOIN finance_accounts account
         ON account.id = 'finance:student:student-emergency-valid:wallet'
       WHERE settlement.contract_id = 'contract-emergency-valid';`,
    )), [{
      settlement_type: "early_termination",
      payout: 2100,
      actor_type: "teacher",
      actor_teacher_id: "teacher-emergency",
      reason: "Transfer cleanup before exclusion",
      balance: 10100,
      revision: 3,
    }]);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `UPDATE students SET status = 'excluded', updated_at = 3001
       WHERE id = 'student-emergency-valid';
       SELECT status FROM students WHERE id = 'student-emergency-valid';`,
    )), [{ status: "excluded" }]);

    executeSql(persistPath, `
      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_teacher_id, actor_label, metadata_json, created_at
      ) VALUES (
        'tx-emergency-settle-no-reason', 'class-emergency', 'pending',
        'deposit_early_termination', 'Missing reason settlement',
        'deposit-contract:contract-emergency-no-reason:settlement',
        'hash:tx:emergency:settle:no-reason', 'deposit_settlement',
        'contract-emergency-no-reason', 'teacher', 'teacher-emergency',
        'Homeroom emergency settlement',
        '{"contractId":"contract-emergency-no-reason","expectedSettlementRevision":0,"interest":100,"interventionReason":" ","isEmergency":true,"origin":"finance_center","payout":2100,"principal":2000,"settlementPolicy":"contract_terms_at_settlement","settlementType":"early_termination","studentId":"student-emergency-no-reason"}',
        3002
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        ('entry-emergency-settle-no-reason-wallet', 'tx-emergency-settle-no-reason', 'class-emergency',
         'finance:student:student-emergency-no-reason:wallet', 2100, 10100, 3, 3002),
        ('entry-emergency-settle-no-reason-issuance', 'tx-emergency-settle-no-reason', 'class-emergency',
         'finance:class:class-emergency:issuance', -2100, -20200, 6, 3002);
      UPDATE finance_transactions SET status = 'posted', posted_at = 3002
      WHERE id = 'tx-emergency-settle-no-reason';
    `);
    const missingReason = executeSql(
      persistPath,
      `INSERT INTO finance_deposit_settlements (
         id, class_id, contract_id, student_id, settlement_type,
         principal, interest, payout, idempotency_key, payload_hash,
         posted_transaction_id, transaction_payload_hash, settled_at, created_at
       ) VALUES (
         'settlement-emergency-no-reason', 'class-emergency',
         'contract-emergency-no-reason', 'student-emergency-no-reason',
         'early_termination', 2000, 100, 2100,
         'settlement:emergency:no-reason', 'hash:settlement:emergency:no-reason',
         'tx-emergency-settle-no-reason', 'hash:tx:emergency:settle:no-reason',
         3002, 3002
       );`,
      { expectSuccess: false },
    );
    assert.match(missingReason.output, /FINANCE_DEPOSIT_LEDGER_MISMATCH/);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT COUNT(*) AS count FROM finance_deposit_settlements
       WHERE contract_id = 'contract-emergency-no-reason';`,
    )), [{ count: 0 }]);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      "PRAGMA foreign_key_check;",
    )), []);
  } finally {
    await rm(persistPath, { recursive: true, force: true });
  }
});

test("pre-0017 settlement retries deduplicate without another ledger posting", {
  timeout: 120_000,
}, async () => {
  const persistPath = await mkdtemp(
    path.join(tmpdir(), "siklassroom-finance-deposit-legacy-retry-d1-"),
  );
  let worker;
  try {
    runWrangler([
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      `--persist-to=${persistPath}`,
    ]);

    const legacyPayloadHash = legacySettlementHash({
      classId: "class-legacy",
      contractId: "contract-legacy",
      payout: 2_100,
      settlementType: "early_termination",
      studentId: "student-legacy",
    });
    executeSql(persistPath, `
      INSERT INTO teachers (id, email, password_hash, status, created_at, updated_at)
      VALUES ('teacher-legacy', 'teacher-legacy@test.local', 'hash', 'active', 1, 1);
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized,
        school_year, grade, class_number, status, created_at, updated_at
      ) VALUES (
        'class-legacy', 'teacher-legacy', 'Test School', 'test school',
        2099, 6, 9, 'active', 1, 1
      );
      INSERT INTO students (
        id, class_id, student_number, official_name, status, created_at, updated_at
      ) VALUES ('student-legacy', 'class-legacy', 1, 'Legacy Student', 'active', 1, 1);
      INSERT INTO finance_deposit_products (
        id, class_id, name, description, term_weeks,
        maturity_interest_bps, early_interest_bps, min_amount, max_amount,
        is_open, revision, created_by_teacher_id, updated_by_teacher_id,
        created_at, updated_at
      ) VALUES (
        'product-legacy', 'class-legacy', 'Legacy Savings', '', 1,
        1000, 5000, 1000, 5000, 1, 0,
        'teacher-legacy', 'teacher-legacy', 1000, 1000
      );

      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, actor_type, actor_teacher_id,
        actor_label, created_at
      ) VALUES (
        'tx-legacy-fund', 'class-legacy', 'pending', 'manual_credit',
        'Fund legacy wallet', 'legacy:fund:wallet', 'hash:legacy:fund',
        'teacher', 'teacher-legacy', 'Teacher', 10
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        ('entry-legacy-fund-wallet', 'tx-legacy-fund', 'class-legacy',
         'finance:student:student-legacy:wallet', 10000, 10000, 1, 10),
        ('entry-legacy-fund-issuance', 'tx-legacy-fund', 'class-legacy',
         'finance:class:class-legacy:issuance', -10000, -10000, 1, 10);
      UPDATE finance_transactions SET status = 'posted', posted_at = 10
      WHERE id = 'tx-legacy-fund';

      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_label, created_at
      ) VALUES (
        'tx-legacy-open', 'class-legacy', 'pending', 'deposit_open',
        'Open legacy deposit', 'legacy:open:contract', 'hash:legacy:open',
        'deposit_contract', 'contract-legacy', 'system', 'Deposit automation', 2000
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        ('entry-legacy-open-wallet', 'tx-legacy-open', 'class-legacy',
         'finance:student:student-legacy:wallet', -2000, 8000, 2, 2000),
        ('entry-legacy-open-issuance', 'tx-legacy-open', 'class-legacy',
         'finance:class:class-legacy:issuance', 2000, -8000, 2, 2000);
      UPDATE finance_transactions SET status = 'posted', posted_at = 2000
      WHERE id = 'tx-legacy-open';
      INSERT INTO finance_deposit_contracts (
        id, class_id, product_id, product_revision, student_id,
        wallet_account_id, principal, product_name_snapshot,
        term_weeks_snapshot, maturity_interest_bps_snapshot,
        early_interest_bps_snapshot, maturity_interest, early_interest,
        maturity_payout, early_payout, opened_at, matures_at,
        idempotency_key, payload_hash, posted_transaction_id,
        transaction_payload_hash, created_at
      ) VALUES (
        'contract-legacy', 'class-legacy', 'product-legacy', 0,
        'student-legacy', 'finance:student:student-legacy:wallet',
        2000, 'Legacy Savings', 1, 1000, 5000, 200, 100, 2200, 2100,
        2000, 604802000, 'legacy:contract:open', 'hash:legacy:contract',
        'tx-legacy-open', 'hash:legacy:open', 2000
      );

      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_label, created_at
      ) VALUES (
        'tx-legacy-settle', 'class-legacy', 'pending',
        'deposit_early_termination', 'Settle legacy deposit',
        'deposit-contract:contract-legacy:settlement', 'hash:legacy:settle-transaction',
        'deposit_settlement', 'contract-legacy', 'system', 'Deposit automation', 3000
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        ('entry-legacy-settle-wallet', 'tx-legacy-settle', 'class-legacy',
         'finance:student:student-legacy:wallet', 2100, 10100, 3, 3000),
        ('entry-legacy-settle-issuance', 'tx-legacy-settle', 'class-legacy',
         'finance:class:class-legacy:issuance', -2100, -10100, 3, 3000);
      UPDATE finance_transactions SET status = 'posted', posted_at = 3000
      WHERE id = 'tx-legacy-settle';
      INSERT INTO finance_deposit_settlements (
        id, class_id, contract_id, student_id, settlement_type,
        principal, interest, payout, idempotency_key, payload_hash,
        posted_transaction_id, transaction_payload_hash, settled_at, created_at
      ) VALUES (
        'settlement-legacy', 'class-legacy', 'contract-legacy',
        'student-legacy', 'early_termination', 2000, 100, 2100,
        'settlement:legacy:original', '${legacyPayloadHash}',
        'tx-legacy-settle', 'hash:legacy:settle-transaction', 3000, 3000
      );
    `);

    const before = lastResults(executeSql(
      persistPath,
      `SELECT
         (SELECT COUNT(*) FROM finance_transactions WHERE class_id = 'class-legacy') AS transaction_count,
         (SELECT COUNT(*) FROM finance_ledger_entries WHERE class_id = 'class-legacy') AS entry_count,
         (SELECT COUNT(*) FROM finance_deposit_settlements WHERE class_id = 'class-legacy') AS settlement_count,
         (SELECT balance FROM finance_accounts WHERE id = 'finance:student:student-legacy:wallet') AS wallet_balance,
         (SELECT revision FROM finance_accounts WHERE id = 'finance:student:student-legacy:wallet') AS wallet_revision,
         (SELECT balance FROM finance_accounts WHERE id = 'finance:class:class-legacy:issuance') AS issuance_balance,
         (SELECT revision FROM finance_accounts WHERE id = 'finance:class:class-legacy:issuance') AS issuance_revision;`,
    ));

    const { unstable_dev: unstableDev } = await import("wrangler");
    worker = await unstableDev(settlementRetryWorkerPath, {
      config: settlementRetryConfigPath,
      moduleRoot: projectRoot,
      persistTo: persistPath,
      logLevel: "none",
      experimental: {
        disableDevRegistry: true,
        disableExperimentalWarning: true,
        watch: false,
      },
    });
    const systemResponse = await worker.fetch("http://test.local/retry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actorType: "system" }),
    });
    assert.equal(systemResponse.status, 200);
    const systemBody = await systemResponse.json();
    assert.equal(systemBody.deduplicated, true);
    assert.equal(systemBody.settlement.id, "settlement-legacy");

    const teacherResponse = await worker.fetch("http://test.local/retry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actorType: "teacher" }),
    });
    assert.equal(teacherResponse.status, 409);
    assert.equal(
      (await teacherResponse.json()).code,
      "FINANCE_DEPOSIT_IDEMPOTENCY_CONFLICT",
    );

    const after = lastResults(executeSql(
      persistPath,
      `SELECT
         (SELECT COUNT(*) FROM finance_transactions WHERE class_id = 'class-legacy') AS transaction_count,
         (SELECT COUNT(*) FROM finance_ledger_entries WHERE class_id = 'class-legacy') AS entry_count,
         (SELECT COUNT(*) FROM finance_deposit_settlements WHERE class_id = 'class-legacy') AS settlement_count,
         (SELECT balance FROM finance_accounts WHERE id = 'finance:student:student-legacy:wallet') AS wallet_balance,
         (SELECT revision FROM finance_accounts WHERE id = 'finance:student:student-legacy:wallet') AS wallet_revision,
         (SELECT balance FROM finance_accounts WHERE id = 'finance:class:class-legacy:issuance') AS issuance_balance,
         (SELECT revision FROM finance_accounts WHERE id = 'finance:class:class-legacy:issuance') AS issuance_revision;`,
    ));
    assert.deepEqual(after, before);
  } finally {
    await worker?.stop();
    await rm(persistPath, { recursive: true, force: true });
  }
});
