import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

function runWrangler(args) {
  let result;
  let output = "";
  const retrySignal = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    result = spawnSync(process.execPath, [wranglerPath, ...args], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: "false",
        WRANGLER_WRITE_LOGS: "false",
      },
      maxBuffer: 20 * 1024 * 1024,
    });
    output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (
      result.status === 0
      || (!output.includes("bad port") && !output.includes("fetch failed"))
    ) break;
    Atomics.wait(retrySignal, 0, 0, 250 * (attempt + 1));
  }
  assert.ok(result, "Wrangler did not start.");
  assert.equal(
    result.status,
    0,
    `wrangler command failed\n${output.slice(-5000)}`,
  );
  return result;
}

function executeSql(persistPath, sql) {
  const result = runWrangler([
    "d1",
    "execute",
    "DB",
    "--local",
    `--persist-to=${persistPath}`,
    "--json",
    "--command",
    sql,
  ]);
  return JSON.parse(result.stdout);
}

function lastResults(execution) {
  const last = execution.at(-1);
  assert.equal(last?.success, true);
  return last.results;
}

const MONEY_SUPPLY_QUERY = `
  WITH cutoffs(point, cutoff_epoch_ms) AS (
    VALUES ('current', 250), ('previous', 150)
  )
  SELECT cutoff.point,
         COALESCE((
           SELECT SUM(entry.amount)
           FROM finance_ledger_entries entry
           JOIN finance_transactions transaction_row
             ON transaction_row.id = entry.transaction_id
            AND transaction_row.class_id = entry.class_id
            AND transaction_row.status = 'posted'
           JOIN finance_accounts account
             ON account.id = entry.account_id
            AND account.class_id = entry.class_id
            AND account.account_type = 'student_wallet'
           WHERE entry.class_id = 'class-statistics'
             AND transaction_row.posted_at <= cutoff.cutoff_epoch_ms
         ), 0) AS wallet_balance,
         COALESCE((
           SELECT SUM(contract.principal)
           FROM finance_deposit_contracts contract
           WHERE contract.class_id = 'class-statistics'
             AND contract.opened_at <= cutoff.cutoff_epoch_ms
             AND NOT EXISTS (
               SELECT 1 FROM finance_deposit_settlements settlement
               WHERE settlement.contract_id = contract.id
                 AND settlement.class_id = contract.class_id
                 AND settlement.settled_at <= cutoff.cutoff_epoch_ms
             )
         ), 0) AS deposit_principal,
         COALESCE((
           SELECT SUM(contribution.amount)
           FROM finance_funding_contributions contribution
           JOIN finance_transactions contribution_transaction
             ON contribution_transaction.id = contribution.posted_transaction_id
            AND contribution_transaction.class_id = contribution.class_id
            AND contribution_transaction.status = 'posted'
           WHERE contribution.class_id = 'class-statistics'
             AND contribution_transaction.posted_at <= cutoff.cutoff_epoch_ms
             AND NOT EXISTS (
               SELECT 1
               FROM finance_funding_settlements settlement
               JOIN finance_transactions settlement_transaction
                 ON settlement_transaction.id = settlement.posted_transaction_id
                AND settlement_transaction.class_id = settlement.class_id
                AND settlement_transaction.status = 'posted'
               WHERE settlement.class_id = contribution.class_id
                 AND settlement.campaign_id = contribution.campaign_id
                 AND settlement_transaction.posted_at <= cutoff.cutoff_epoch_ms
             )
             AND NOT EXISTS (
               SELECT 1
               FROM finance_funding_refunds refund
               JOIN finance_transactions refund_transaction
                 ON refund_transaction.id = refund.posted_transaction_id
                AND refund_transaction.class_id = refund.class_id
                AND refund_transaction.status = 'posted'
               WHERE refund.class_id = contribution.class_id
                 AND refund.contribution_id = contribution.id
                 AND refund_transaction.posted_at <= cutoff.cutoff_epoch_ms
             )
         ), 0) AS funding_locked
  FROM cutoffs cutoff
  ORDER BY CASE cutoff.point WHEN 'current' THEN 0 ELSE 1 END;`;

const STUDENT_ASSET_QUERY = `
  WITH active_deposits AS (
    SELECT contract.student_id,
           SUM(CASE WHEN 250 >= contract.matures_at
             THEN contract.maturity_payout ELSE contract.early_payout END)
             AS deposit_value
    FROM finance_deposit_contracts contract
    WHERE contract.class_id = 'class-statistics'
      AND NOT EXISTS (
        SELECT 1 FROM finance_deposit_settlements settlement
        WHERE settlement.contract_id = contract.id
          AND settlement.class_id = contract.class_id
      )
    GROUP BY contract.student_id
  ), stock_values AS (
    SELECT holding.student_id,
           SUM(holding.quantity * stock.current_price) AS stock_market_value
    FROM finance_stock_holdings holding
    JOIN finance_stocks stock
      ON stock.id = holding.stock_id AND stock.class_id = holding.class_id
    WHERE holding.class_id = 'class-statistics' AND holding.quantity > 0
    GROUP BY holding.student_id
  ), funding_values AS (
    SELECT contribution.contributor_student_id AS student_id,
           SUM(contribution.amount) AS funding_locked
    FROM finance_funding_contributions contribution
    JOIN finance_transactions contribution_transaction
      ON contribution_transaction.id = contribution.posted_transaction_id
     AND contribution_transaction.class_id = contribution.class_id
     AND contribution_transaction.status = 'posted'
     AND contribution_transaction.posted_at <= 250
    WHERE contribution.class_id = 'class-statistics'
      AND NOT EXISTS (
        SELECT 1
        FROM finance_funding_settlements settlement
        JOIN finance_transactions settlement_transaction
          ON settlement_transaction.id = settlement.posted_transaction_id
         AND settlement_transaction.class_id = settlement.class_id
         AND settlement_transaction.status = 'posted'
         AND settlement_transaction.posted_at <= 250
        WHERE settlement.class_id = contribution.class_id
          AND settlement.campaign_id = contribution.campaign_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM finance_funding_refunds refund
        JOIN finance_transactions refund_transaction
          ON refund_transaction.id = refund.posted_transaction_id
         AND refund_transaction.class_id = refund.class_id
         AND refund_transaction.status = 'posted'
         AND refund_transaction.posted_at <= 250
        WHERE refund.class_id = contribution.class_id
          AND refund.contribution_id = contribution.id
      )
    GROUP BY contribution.contributor_student_id
  )
  SELECT student.id AS student_id,
         COALESCE(wallet.balance, 0) AS wallet_balance,
         COALESCE(active_deposits.deposit_value, 0) AS deposit_value,
         COALESCE(stock_values.stock_market_value, 0) AS stock_market_value,
         COALESCE(funding_values.funding_locked, 0) AS funding_locked
  FROM students student
  LEFT JOIN finance_accounts wallet
    ON wallet.student_id = student.id
   AND wallet.class_id = student.class_id
   AND wallet.account_type = 'student_wallet'
  LEFT JOIN active_deposits ON active_deposits.student_id = student.id
  LEFT JOIN stock_values ON stock_values.student_id = student.id
  LEFT JOIN funding_values ON funding_values.student_id = student.id
  WHERE student.class_id = 'class-statistics' AND student.status <> 'excluded'
  ORDER BY student.student_number;`;

test("D1 statistics reconstruct locked assets and include every student except excluded", async () => {
  const persistPath = await mkdtemp(
    path.join(tmpdir(), "siklassroom-finance-statistics-d1-"),
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
      INSERT INTO teachers (
        id, email, password_hash, status, created_at, updated_at
      ) VALUES (
        'teacher-statistics', 'statistics@test.local', 'hash', 'active', 1, 1
      );
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized,
        school_year, grade, class_number, status, created_at, updated_at
      ) VALUES (
        'class-statistics', 'teacher-statistics', '테스트초', '테스트초',
        2099, 6, 9, 'active', 1, 1
      );
      INSERT INTO students (
        id, class_id, student_number, official_name, status, created_at, updated_at
      ) VALUES
        ('student-statistics-1', 'class-statistics', 1, '학생1', 'active', 1, 1),
        ('student-statistics-2', 'class-statistics', 2, '학생2', 'active', 1, 1),
        ('student-statistics-3', 'class-statistics', 3, '학생3', 'active', 1, 1),
        ('student-statistics-4', 'class-statistics', 4, '학생4', 'active', 1, 1),
        ('student-statistics-5', 'class-statistics', 5, '학생5', 'active', 1, 1),
        ('student-statistics-6', 'class-statistics', 6, '학생6', 'active', 1, 1),
        ('student-statistics-7', 'class-statistics', 7, '제외학생', 'active', 1, 1),
        ('student-statistics-8', 'class-statistics', 8, '등록전학생', 'pending', 1, 1);

      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, actor_type, actor_teacher_id,
        actor_label, created_at
      ) VALUES (
        'tx-statistics-opening', 'class-statistics', 'pending',
        'manual_credit', '테스트 지급', 'statistics:opening:0001',
        'hash:statistics:opening', 'teacher', 'teacher-statistics', '담임교사', 100
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        ('entry-statistics-1', 'tx-statistics-opening', 'class-statistics',
         'finance:student:student-statistics-1:wallet', 1000, 1000, 1, 100),
        ('entry-statistics-2', 'tx-statistics-opening', 'class-statistics',
         'finance:student:student-statistics-2:wallet', 2000, 2000, 1, 100),
        ('entry-statistics-3', 'tx-statistics-opening', 'class-statistics',
         'finance:student:student-statistics-3:wallet', 3000, 3000, 1, 100),
        ('entry-statistics-4', 'tx-statistics-opening', 'class-statistics',
         'finance:student:student-statistics-4:wallet', 4000, 4000, 1, 100),
        ('entry-statistics-5', 'tx-statistics-opening', 'class-statistics',
         'finance:student:student-statistics-5:wallet', 5000, 5000, 1, 100),
        ('entry-statistics-6', 'tx-statistics-opening', 'class-statistics',
         'finance:student:student-statistics-6:wallet', 6000, 6000, 1, 100),
        ('entry-statistics-7', 'tx-statistics-opening', 'class-statistics',
         'finance:student:student-statistics-7:wallet', 7000, 7000, 1, 100),
        ('entry-statistics-8', 'tx-statistics-opening', 'class-statistics',
         'finance:student:student-statistics-8:wallet', 8000, 8000, 1, 100),
        ('entry-statistics-issuance', 'tx-statistics-opening', 'class-statistics',
         'finance:class:class-statistics:issuance', -36000, -36000, 1, 100);
      UPDATE finance_transactions SET status = 'posted', posted_at = 100
      WHERE id = 'tx-statistics-opening';

      INSERT INTO finance_funding_campaigns (
        id, class_id, creator_student_id, recipient_wallet_account_id,
        creator_student_number_snapshot, creator_student_name_snapshot,
        title, description, target_amount, pledged_amount, refunded_amount,
        status, deadline_at, terminal_reason, revision,
        idempotency_key, payload_hash, created_at, updated_at,
        funded_at, settled_at, cancelled_at
      ) VALUES
        (
          'campaign-statistics-refund', 'class-statistics',
          'student-statistics-4', 'finance:student:student-statistics-4:wallet',
          4, '학생4', '환불된 펀딩', '', 400, 400, 400,
          'failed', 140, '목표 미달', 2,
          'statistics:campaign:refund', 'hash:statistics:campaign:refund',
          110, 220, 120, NULL, 220
        ),
        (
          'campaign-statistics-settlement', 'class-statistics',
          'student-statistics-5', 'finance:student:student-statistics-5:wallet',
          5, '학생5', '성공한 펀딩', '', 200, 200, 0,
          'succeeded', 140, '목표 달성', 2,
          'statistics:campaign:settlement', 'hash:statistics:campaign:settlement',
          110, 240, 130, 240, NULL
        ),
        (
          'campaign-statistics-active', 'class-statistics',
          'student-statistics-6', 'finance:student:student-statistics-6:wallet',
          6, '학생6', '진행 중 펀딩', '', 1000, 300, 0,
          'active', 1000, NULL, 1,
          'statistics:campaign:active', 'hash:statistics:campaign:active',
          210, 230, NULL, NULL, NULL
        );

      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_label, created_at
      ) VALUES (
        'tx-statistics-funding-refund-contribution', 'class-statistics', 'pending',
        'funding_contribution', '환불 전 참여',
        'statistics:funding:refund:contribution',
        'hash:statistics:funding:refund:contribution',
        'funding_contribution', 'contribution-statistics-refund',
        'system', '펀딩 자동화', 120
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        (
          'entry-statistics-funding-refund-wallet',
          'tx-statistics-funding-refund-contribution', 'class-statistics',
          'finance:student:student-statistics-3:wallet', -400, 2600, 2, 120
        ),
        (
          'entry-statistics-funding-refund-issuance',
          'tx-statistics-funding-refund-contribution', 'class-statistics',
          'finance:class:class-statistics:issuance', 400, -35600, 2, 120
        );
      UPDATE finance_transactions SET status = 'posted', posted_at = 120
      WHERE id = 'tx-statistics-funding-refund-contribution';
      INSERT INTO finance_funding_contributions (
        id, class_id, campaign_id, contributor_student_id,
        wallet_account_id, student_number_snapshot, student_name_snapshot,
        amount, campaign_revision_before, idempotency_key, payload_hash,
        posted_transaction_id, transaction_payload_hash, created_at
      ) VALUES (
        'contribution-statistics-refund', 'class-statistics',
        'campaign-statistics-refund', 'student-statistics-3',
        'finance:student:student-statistics-3:wallet', 3, '학생3',
        400, 0, 'statistics:contribution:refund',
        'hash:statistics:contribution:refund',
        'tx-statistics-funding-refund-contribution',
        'hash:statistics:funding:refund:contribution', 120
      );

      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_label, created_at
      ) VALUES (
        'tx-statistics-funding-settle-contribution', 'class-statistics', 'pending',
        'funding_contribution', '성공 전 참여',
        'statistics:funding:settle:contribution',
        'hash:statistics:funding:settle:contribution',
        'funding_contribution', 'contribution-statistics-settlement',
        'system', '펀딩 자동화', 130
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        (
          'entry-statistics-funding-settle-wallet',
          'tx-statistics-funding-settle-contribution', 'class-statistics',
          'finance:student:student-statistics-4:wallet', -200, 3800, 2, 130
        ),
        (
          'entry-statistics-funding-settle-issuance',
          'tx-statistics-funding-settle-contribution', 'class-statistics',
          'finance:class:class-statistics:issuance', 200, -35400, 3, 130
        );
      UPDATE finance_transactions SET status = 'posted', posted_at = 130
      WHERE id = 'tx-statistics-funding-settle-contribution';
      INSERT INTO finance_funding_contributions (
        id, class_id, campaign_id, contributor_student_id,
        wallet_account_id, student_number_snapshot, student_name_snapshot,
        amount, campaign_revision_before, idempotency_key, payload_hash,
        posted_transaction_id, transaction_payload_hash, created_at
      ) VALUES (
        'contribution-statistics-settlement', 'class-statistics',
        'campaign-statistics-settlement', 'student-statistics-4',
        'finance:student:student-statistics-4:wallet', 4, '학생4',
        200, 0, 'statistics:contribution:settlement',
        'hash:statistics:contribution:settlement',
        'tx-statistics-funding-settle-contribution',
        'hash:statistics:funding:settle:contribution', 130
      );

      INSERT INTO finance_deposit_products (
        id, class_id, name, description, term_weeks,
        maturity_interest_bps, early_interest_bps, min_amount, max_amount,
        is_open, revision, created_by_teacher_id, updated_by_teacher_id,
        created_at, updated_at
      ) VALUES (
        'product-statistics', 'class-statistics', '통계 예금', '', 1,
        1000, 500, 100, 10000, 1, 0,
        'teacher-statistics', 'teacher-statistics', 150, 150
      );
      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_label, created_at
      ) VALUES (
        'tx-statistics-deposit', 'class-statistics', 'pending',
        'deposit_open', '통계 예금 가입', 'statistics:deposit:0001',
        'hash:statistics:deposit', 'deposit_contract', 'contract-statistics',
        'system', '예금 자동화', 200
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        ('entry-statistics-deposit-wallet', 'tx-statistics-deposit', 'class-statistics',
         'finance:student:student-statistics-1:wallet', -500, 500, 2, 200),
        ('entry-statistics-deposit-issuance', 'tx-statistics-deposit', 'class-statistics',
         'finance:class:class-statistics:issuance', 500, -34900, 4, 200);
      UPDATE finance_transactions SET status = 'posted', posted_at = 200
      WHERE id = 'tx-statistics-deposit';
      INSERT INTO finance_deposit_contracts (
        id, class_id, product_id, product_revision, student_id,
        wallet_account_id, principal, product_name_snapshot,
        term_weeks_snapshot, maturity_interest_bps_snapshot,
        early_interest_bps_snapshot, maturity_interest, early_interest,
        maturity_payout, early_payout, opened_at, matures_at,
        idempotency_key, payload_hash, posted_transaction_id,
        transaction_payload_hash, created_at
      ) VALUES (
        'contract-statistics', 'class-statistics', 'product-statistics', 0,
        'student-statistics-1', 'finance:student:student-statistics-1:wallet',
        500, '통계 예금', 1, 1000, 500, 50, 2, 550, 502,
        200, 604800200, 'statistics:contract:0001', 'hash:statistics:contract',
        'tx-statistics-deposit', 'hash:statistics:deposit', 200
      );

      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_label, created_at
      ) VALUES (
        'tx-statistics-funding-refund', 'class-statistics', 'pending',
        'funding_refund', '펀딩 참여금 환불',
        'statistics:funding:refund', 'hash:statistics:funding:refund',
        'funding_refund', 'refund-statistics',
        'system', '펀딩 자동화', 220
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        (
          'entry-statistics-funding-refund-return-wallet',
          'tx-statistics-funding-refund', 'class-statistics',
          'finance:student:student-statistics-3:wallet', 400, 3000, 3, 220
        ),
        (
          'entry-statistics-funding-refund-return-issuance',
          'tx-statistics-funding-refund', 'class-statistics',
          'finance:class:class-statistics:issuance', -400, -35300, 5, 220
        );
      UPDATE finance_transactions SET status = 'posted', posted_at = 220
      WHERE id = 'tx-statistics-funding-refund';
      INSERT INTO finance_funding_refunds (
        id, class_id, campaign_id, contribution_id, student_id, amount,
        idempotency_key, payload_hash, posted_transaction_id,
        transaction_payload_hash, refunded_at, created_at
      ) VALUES (
        'refund-statistics', 'class-statistics', 'campaign-statistics-refund',
        'contribution-statistics-refund', 'student-statistics-3', 400,
        'statistics:refund:0001', 'hash:statistics:refund',
        'tx-statistics-funding-refund', 'hash:statistics:funding:refund', 220, 220
      );

      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_label, created_at
      ) VALUES (
        'tx-statistics-funding-active', 'class-statistics', 'pending',
        'funding_contribution', '진행 중 펀딩 참여',
        'statistics:funding:active', 'hash:statistics:funding:active',
        'funding_contribution', 'contribution-statistics-active',
        'system', '펀딩 자동화', 230
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        (
          'entry-statistics-funding-active-wallet',
          'tx-statistics-funding-active', 'class-statistics',
          'finance:student:student-statistics-2:wallet', -300, 1700, 2, 230
        ),
        (
          'entry-statistics-funding-active-issuance',
          'tx-statistics-funding-active', 'class-statistics',
          'finance:class:class-statistics:issuance', 300, -35000, 6, 230
        );
      UPDATE finance_transactions SET status = 'posted', posted_at = 230
      WHERE id = 'tx-statistics-funding-active';
      INSERT INTO finance_funding_contributions (
        id, class_id, campaign_id, contributor_student_id,
        wallet_account_id, student_number_snapshot, student_name_snapshot,
        amount, campaign_revision_before, idempotency_key, payload_hash,
        posted_transaction_id, transaction_payload_hash, created_at
      ) VALUES (
        'contribution-statistics-active', 'class-statistics',
        'campaign-statistics-active', 'student-statistics-2',
        'finance:student:student-statistics-2:wallet', 2, '학생2',
        300, 0, 'statistics:contribution:active',
        'hash:statistics:contribution:active',
        'tx-statistics-funding-active',
        'hash:statistics:funding:active', 230
      );

      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_label, created_at
      ) VALUES (
        'tx-statistics-funding-settlement', 'class-statistics', 'pending',
        'funding_settlement', '성공 펀딩 지급',
        'statistics:funding:settlement', 'hash:statistics:funding:settlement',
        'funding_settlement', 'settlement-statistics',
        'system', '펀딩 자동화', 240
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        (
          'entry-statistics-funding-settlement-wallet',
          'tx-statistics-funding-settlement', 'class-statistics',
          'finance:student:student-statistics-5:wallet', 200, 5200, 2, 240
        ),
        (
          'entry-statistics-funding-settlement-issuance',
          'tx-statistics-funding-settlement', 'class-statistics',
          'finance:class:class-statistics:issuance', -200, -35200, 7, 240
        );
      UPDATE finance_transactions SET status = 'posted', posted_at = 240
      WHERE id = 'tx-statistics-funding-settlement';
      INSERT INTO finance_funding_settlements (
        id, class_id, campaign_id, recipient_student_id, amount,
        idempotency_key, payload_hash, posted_transaction_id,
        transaction_payload_hash, settled_at, created_at
      ) VALUES (
        'settlement-statistics', 'class-statistics',
        'campaign-statistics-settlement', 'student-statistics-5', 200,
        'statistics:settlement:0001', 'hash:statistics:settlement',
        'tx-statistics-funding-settlement',
        'hash:statistics:funding:settlement', 240, 240
      );

      UPDATE students SET status = 'excluded', updated_at = 220
      WHERE id = 'student-statistics-7';
    `);

    const money = lastResults(executeSql(persistPath, MONEY_SUPPLY_QUERY));
    assert.deepEqual(money, [
      {
        point: "current",
        wallet_balance: 35200,
        deposit_principal: 500,
        funding_locked: 300,
      },
      {
        point: "previous",
        wallet_balance: 35400,
        deposit_principal: 0,
        funding_locked: 600,
      },
    ]);
    assert.equal(
      money[0].wallet_balance
        + money[0].deposit_principal
        + money[0].funding_locked,
      money[1].wallet_balance
        + money[1].deposit_principal
        + money[1].funding_locked,
      "moving money into deposits or unresolved funding must not change recorded supply",
    );

    const assets = lastResults(executeSql(persistPath, STUDENT_ASSET_QUERY));
    assert.equal(
      assets.length,
      7,
      "only excluded students must be omitted; pending and registered students remain",
    );
    assert.deepEqual(assets[0], {
      student_id: "student-statistics-1",
      wallet_balance: 500,
      deposit_value: 502,
      stock_market_value: 0,
      funding_locked: 0,
    });
    assert.deepEqual(assets[1], {
      student_id: "student-statistics-2",
      wallet_balance: 1700,
      deposit_value: 0,
      stock_market_value: 0,
      funding_locked: 300,
    });
    assert.deepEqual(assets.at(-1), {
      student_id: "student-statistics-8",
      wallet_balance: 8000,
      deposit_value: 0,
      stock_market_value: 0,
      funding_locked: 0,
    });
    assert.equal(
      assets.reduce((sum, row) => (
        sum
          + row.wallet_balance
          + row.deposit_value
          + row.stock_market_value
          + row.funding_locked
      ), 0),
      29002,
    );
  } finally {
    await rm(persistPath, { recursive: true, force: true });
  }
});
