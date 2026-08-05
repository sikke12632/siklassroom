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
    if (
      result.status === 0
      || (!output.includes("bad port") && !output.includes("fetch failed"))
    ) break;
    Atomics.wait(retrySignal, 0, 0, 250 * (attempt + 1));
  }
  assert.ok(result, "Wrangler did not start.");
  if (expectSuccess) {
    assert.equal(
      result.status,
      0,
      `Wrangler command failed.\n${output.slice(-5_000)}`,
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
  return { ...result, data: JSON.parse(result.stdout) };
}

function lastResults(execution) {
  const last = execution.data.at(-1);
  assert.equal(last?.success, true);
  return last.results;
}

test("funding holds pledges, pays exact targets, and refunds failures in D1", async () => {
  const persistPath = await mkdtemp(
    path.join(tmpdir(), "siklassroom-finance-funding-d1-"),
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
        'teacher-funding', 'teacher-funding@test.local', 'hash',
        'active', 1, 1
      );
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized,
        school_year, grade, class_number, status, created_at, updated_at
      ) VALUES (
        'class-funding', 'teacher-funding', 'Test School', 'test school',
        2099, 6, 1, 'active', 1, 1
      );
      INSERT INTO students (
        id, class_id, student_number, official_name, status,
        created_at, updated_at
      ) VALUES
        ('student-creator', 'class-funding', 1, 'Creator', 'active', 1, 1),
        ('student-supporter', 'class-funding', 2, 'Supporter', 'active', 1, 1);
    `);

    executeSql(persistPath, `
      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, actor_type, actor_teacher_id,
        actor_label, created_at
      ) VALUES (
        'tx-fund-creator', 'class-funding', 'pending', 'manual_credit',
        'Fund creator wallet', 'funding:test:fund:creator', 'hash-fund-creator',
        'teacher', 'teacher-funding', 'Teacher', 10
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        ('entry-fund-creator-wallet', 'tx-fund-creator', 'class-funding',
         'finance:student:student-creator:wallet', 5000, 5000, 1, 10),
        ('entry-fund-creator-issuance', 'tx-fund-creator', 'class-funding',
         'finance:class:class-funding:issuance', -5000, -5000, 1, 10);
      UPDATE finance_transactions
      SET status = 'posted', posted_at = 10
      WHERE id = 'tx-fund-creator';

      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, actor_type, actor_teacher_id,
        actor_label, created_at
      ) VALUES (
        'tx-fund-supporter', 'class-funding', 'pending', 'manual_credit',
        'Fund supporter wallet', 'funding:test:fund:supporter',
        'hash-fund-supporter', 'teacher', 'teacher-funding', 'Teacher', 11
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        ('entry-fund-supporter-wallet', 'tx-fund-supporter', 'class-funding',
         'finance:student:student-supporter:wallet', 5000, 5000, 1, 11),
        ('entry-fund-supporter-issuance', 'tx-fund-supporter', 'class-funding',
         'finance:class:class-funding:issuance', -5000, -10000, 2, 11);
      UPDATE finance_transactions
      SET status = 'posted', posted_at = 11
      WHERE id = 'tx-fund-supporter';
    `);

    executeSql(persistPath, `
      INSERT INTO finance_funding_campaigns (
        id, class_id, creator_student_id, recipient_wallet_account_id,
        creator_student_number_snapshot, creator_student_name_snapshot,
        title, description, target_amount, pledged_amount, refunded_amount,
        status, deadline_at, revision, idempotency_key, payload_hash,
        created_at, updated_at
      ) VALUES (
        'campaign-success', 'class-funding', 'student-creator',
        'finance:student:student-creator:wallet', 1, 'Creator',
        'Class movie', 'Make a class movie', 3000, 0, 0,
        'active', 9999999999999, 0, 'funding:campaign:success',
        'hash-campaign-success', 100, 100
      );
      INSERT INTO finance_funding_campaign_events (
        id, class_id, campaign_id, revision, action, actor_type,
        actor_student_id, actor_label, idempotency_key, payload_hash,
        campaign_snapshot_json, created_at
      ) VALUES (
        'event-campaign-success-created', 'class-funding', 'campaign-success',
        0, 'created', 'student', 'student-creator', 'Creator',
        'funding:event:success:created', 'hash-event-success-created',
        '{"status":"active","revision":0}', 100
      );
    `);

    const duplicateActive = executeSql(
      persistPath,
      `INSERT INTO finance_funding_campaigns (
         id, class_id, creator_student_id, recipient_wallet_account_id,
         creator_student_number_snapshot, creator_student_name_snapshot,
         title, description, target_amount, status, deadline_at,
         idempotency_key, payload_hash, created_at, updated_at
       ) VALUES (
         'campaign-duplicate', 'class-funding', 'student-creator',
         'finance:student:student-creator:wallet', 1, 'Creator',
         'Another campaign', '', 1000, 'active', 9999999999999,
         'funding:campaign:duplicate', 'hash-campaign-duplicate', 101, 101
       );`,
      { expectSuccess: false },
    );
    assert.match(duplicateActive.output, /UNIQUE constraint failed/);

    executeSql(persistPath, `
      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_label, created_at
      ) VALUES (
        'tx-contribution-one', 'class-funding', 'pending',
        'funding_contribution', 'First pledge',
        'funding:tx:contribution:one', 'hash-tx-contribution-one',
        'funding_contribution', 'contribution-one',
        'system', 'Funding automation', 200
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        ('entry-contribution-one-wallet', 'tx-contribution-one', 'class-funding',
         'finance:student:student-supporter:wallet', -1000, 4000, 2, 200),
        ('entry-contribution-one-issuance', 'tx-contribution-one', 'class-funding',
         'finance:class:class-funding:issuance', 1000, -9000, 3, 200);
      UPDATE finance_transactions
      SET status = 'posted', posted_at = 200
      WHERE id = 'tx-contribution-one';
      INSERT INTO finance_funding_contributions (
        id, class_id, campaign_id, contributor_student_id,
        wallet_account_id, student_number_snapshot, student_name_snapshot,
        amount, campaign_revision_before, idempotency_key, payload_hash,
        posted_transaction_id, transaction_payload_hash, created_at
      ) VALUES (
        'contribution-one', 'class-funding', 'campaign-success',
        'student-supporter', 'finance:student:student-supporter:wallet',
        2, 'Supporter', 1000, 0, 'funding:contribution:one',
        'hash-contribution-one', 'tx-contribution-one',
        'hash-tx-contribution-one', 200
      );
      UPDATE finance_funding_campaigns
      SET pledged_amount = 1000, revision = 1, updated_at = 200
      WHERE id = 'campaign-success';
    `);

    executeSql(persistPath, `
      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_label, created_at
      ) VALUES (
        'tx-contribution-two', 'class-funding', 'pending',
        'funding_contribution', 'Target pledge',
        'funding:tx:contribution:two', 'hash-tx-contribution-two',
        'funding_contribution', 'contribution-two',
        'system', 'Funding automation', 201
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        ('entry-contribution-two-wallet', 'tx-contribution-two', 'class-funding',
         'finance:student:student-creator:wallet', -2000, 3000, 2, 201),
        ('entry-contribution-two-issuance', 'tx-contribution-two', 'class-funding',
         'finance:class:class-funding:issuance', 2000, -7000, 4, 201);
      UPDATE finance_transactions
      SET status = 'posted', posted_at = 201
      WHERE id = 'tx-contribution-two';
      INSERT INTO finance_funding_contributions (
        id, class_id, campaign_id, contributor_student_id,
        wallet_account_id, student_number_snapshot, student_name_snapshot,
        amount, campaign_revision_before, idempotency_key, payload_hash,
        posted_transaction_id, transaction_payload_hash, created_at
      ) VALUES (
        'contribution-two', 'class-funding', 'campaign-success',
        'student-creator', 'finance:student:student-creator:wallet',
        1, 'Creator', 2000, 1, 'funding:contribution:two',
        'hash-contribution-two', 'tx-contribution-two',
        'hash-tx-contribution-two', 201
      );
      UPDATE finance_funding_campaigns
      SET pledged_amount = 3000, status = 'funded', funded_at = 201,
          revision = 2, updated_at = 201
      WHERE id = 'campaign-success';
      INSERT INTO finance_funding_campaign_events (
        id, class_id, campaign_id, revision, action, actor_type,
        actor_label, idempotency_key, payload_hash,
        campaign_snapshot_json, created_at
      ) VALUES (
        'event-campaign-success-funded', 'class-funding', 'campaign-success',
        2, 'funded', 'system', 'Funding automation',
        'funding:event:success:funded', 'hash-event-success-funded',
        '{"status":"funded","revision":2}', 201
      );
    `);

    executeSql(persistPath, `
      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_label, created_at
      ) VALUES (
        'tx-funding-payout', 'class-funding', 'pending',
        'funding_payout', 'Pay exact target',
        'funding:tx:payout:success', 'hash-tx-funding-payout',
        'funding_settlement', 'campaign-success',
        'system', 'Funding automation', 202
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        ('entry-funding-payout-wallet', 'tx-funding-payout', 'class-funding',
         'finance:student:student-creator:wallet', 3000, 6000, 3, 202),
        ('entry-funding-payout-issuance', 'tx-funding-payout', 'class-funding',
         'finance:class:class-funding:issuance', -3000, -10000, 5, 202);
      UPDATE finance_transactions
      SET status = 'posted', posted_at = 202
      WHERE id = 'tx-funding-payout';
      INSERT INTO finance_funding_settlements (
        id, class_id, campaign_id, recipient_student_id, amount,
        idempotency_key, payload_hash, posted_transaction_id,
        transaction_payload_hash, settled_at, created_at
      ) VALUES (
        'settlement-success', 'class-funding', 'campaign-success',
        'student-creator', 3000, 'funding:settlement:success',
        'hash-settlement-success', 'tx-funding-payout',
        'hash-tx-funding-payout', 202, 202
      );
      UPDATE finance_funding_campaigns
      SET status = 'succeeded', payout_transaction_id = 'tx-funding-payout',
          settled_at = 202, revision = 3, updated_at = 202
      WHERE id = 'campaign-success';
      INSERT INTO finance_funding_campaign_events (
        id, class_id, campaign_id, revision, action, actor_type,
        actor_label, idempotency_key, payload_hash,
        campaign_snapshot_json, created_at
      ) VALUES (
        'event-campaign-success-succeeded', 'class-funding', 'campaign-success',
        3, 'succeeded', 'system', 'Funding automation',
        'funding:event:success:succeeded', 'hash-event-success-succeeded',
        '{"status":"succeeded","revision":3}', 202
      );
    `);

    assert.deepEqual(lastResults(executeSql(persistPath, `
      SELECT campaign.status, campaign.target_amount, campaign.pledged_amount,
             campaign.refunded_amount, settlement.amount AS settlement_amount,
             transaction_row.status AS transaction_status,
             COUNT(entry.id) AS entry_count,
             COALESCE(SUM(entry.amount), 0) AS entry_sum
      FROM finance_funding_campaigns campaign
      JOIN finance_funding_settlements settlement
        ON settlement.campaign_id = campaign.id
      JOIN finance_transactions transaction_row
        ON transaction_row.id = settlement.posted_transaction_id
      JOIN finance_ledger_entries entry
        ON entry.transaction_id = transaction_row.id
      WHERE campaign.id = 'campaign-success'
      GROUP BY campaign.id, settlement.id, transaction_row.id;
    `)), [{
      status: "succeeded",
      target_amount: 3000,
      pledged_amount: 3000,
      refunded_amount: 0,
      settlement_amount: 3000,
      transaction_status: "posted",
      entry_count: 2,
      entry_sum: 0,
    }]);

    executeSql(persistPath, `
      INSERT INTO finance_funding_campaigns (
        id, class_id, creator_student_id, recipient_wallet_account_id,
        creator_student_number_snapshot, creator_student_name_snapshot,
        title, description, target_amount, status, deadline_at,
        revision, idempotency_key, payload_hash, created_at, updated_at
      ) VALUES (
        'campaign-refund', 'class-funding', 'student-supporter',
        'finance:student:student-supporter:wallet', 2, 'Supporter',
        'Unfunded project', '', 2000, 'active', 9999999999999,
        0, 'funding:campaign:refund', 'hash-campaign-refund', 300, 300
      );
      INSERT INTO finance_funding_campaign_events (
        id, class_id, campaign_id, revision, action, actor_type,
        actor_student_id, actor_label, idempotency_key, payload_hash,
        campaign_snapshot_json, created_at
      ) VALUES (
        'event-campaign-refund-created', 'class-funding', 'campaign-refund',
        0, 'created', 'student', 'student-supporter', 'Supporter',
        'funding:event:refund:created', 'hash-event-refund-created',
        '{"status":"active","revision":0}', 300
      );

      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_label, created_at
      ) VALUES (
        'tx-contribution-refund', 'class-funding', 'pending',
        'funding_contribution', 'Refundable pledge',
        'funding:tx:contribution:refund', 'hash-tx-contribution-refund',
        'funding_contribution', 'contribution-refund',
        'system', 'Funding automation', 301
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        ('entry-contribution-refund-wallet', 'tx-contribution-refund',
         'class-funding', 'finance:student:student-creator:wallet',
         -1000, 5000, 4, 301),
        ('entry-contribution-refund-issuance', 'tx-contribution-refund',
         'class-funding', 'finance:class:class-funding:issuance',
         1000, -9000, 6, 301);
      UPDATE finance_transactions
      SET status = 'posted', posted_at = 301
      WHERE id = 'tx-contribution-refund';
      INSERT INTO finance_funding_contributions (
        id, class_id, campaign_id, contributor_student_id,
        wallet_account_id, student_number_snapshot, student_name_snapshot,
        amount, campaign_revision_before, idempotency_key, payload_hash,
        posted_transaction_id, transaction_payload_hash, created_at
      ) VALUES (
        'contribution-refund', 'class-funding', 'campaign-refund',
        'student-creator', 'finance:student:student-creator:wallet',
        1, 'Creator', 1000, 0, 'funding:contribution:refund',
        'hash-contribution-refund', 'tx-contribution-refund',
        'hash-tx-contribution-refund', 301
      );
      UPDATE finance_funding_campaigns
      SET pledged_amount = 1000, revision = 1, updated_at = 301
      WHERE id = 'campaign-refund';
      UPDATE finance_funding_campaigns
      SET status = 'refunding', terminal_reason = 'deadline',
          revision = 2, updated_at = 302
      WHERE id = 'campaign-refund';
      INSERT INTO finance_funding_campaign_events (
        id, class_id, campaign_id, revision, action, actor_type,
        actor_label, idempotency_key, payload_hash,
        campaign_snapshot_json, created_at
      ) VALUES (
        'event-campaign-refund-started', 'class-funding', 'campaign-refund',
        2, 'refund_started', 'system', 'Funding automation',
        'funding:event:refund:started', 'hash-event-refund-started',
        '{"status":"refunding","revision":2}', 302
      );
    `);

    executeSql(persistPath, `
      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_label, created_at
      ) VALUES (
        'tx-funding-refund', 'class-funding', 'pending',
        'funding_refund', 'Refund failed campaign',
        'funding:tx:refund:one', 'hash-tx-funding-refund',
        'funding_refund', 'contribution-refund',
        'system', 'Funding automation', 303
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES
        ('entry-funding-refund-wallet', 'tx-funding-refund', 'class-funding',
         'finance:student:student-creator:wallet', 1000, 6000, 5, 303),
        ('entry-funding-refund-issuance', 'tx-funding-refund', 'class-funding',
         'finance:class:class-funding:issuance', -1000, -10000, 7, 303);
      UPDATE finance_transactions
      SET status = 'posted', posted_at = 303
      WHERE id = 'tx-funding-refund';
      INSERT INTO finance_funding_refunds (
        id, class_id, campaign_id, contribution_id, student_id, amount,
        idempotency_key, payload_hash, posted_transaction_id,
        transaction_payload_hash, refunded_at, created_at
      ) VALUES (
        'refund-one', 'class-funding', 'campaign-refund',
        'contribution-refund', 'student-creator', 1000,
        'funding:refund:one', 'hash-refund-one', 'tx-funding-refund',
        'hash-tx-funding-refund', 303, 303
      );
      UPDATE finance_funding_campaigns
      SET refunded_amount = 1000, status = 'failed', revision = 3,
          updated_at = 303
      WHERE id = 'campaign-refund';
      INSERT INTO finance_funding_campaign_events (
        id, class_id, campaign_id, revision, action, actor_type,
        actor_label, idempotency_key, payload_hash,
        campaign_snapshot_json, created_at
      ) VALUES (
        'event-campaign-refund-failed', 'class-funding', 'campaign-refund',
        3, 'failed', 'system', 'Funding automation',
        'funding:event:refund:failed', 'hash-event-refund-failed',
        '{"status":"failed","revision":3}', 303
      );
    `);

    assert.deepEqual(lastResults(executeSql(persistPath, `
      SELECT campaign.status, campaign.pledged_amount,
             campaign.refunded_amount, campaign.terminal_reason,
             refund.amount AS refund_amount,
             transaction_row.status AS transaction_status,
             COALESCE(SUM(entry.amount), 0) AS entry_sum
      FROM finance_funding_campaigns campaign
      JOIN finance_funding_refunds refund ON refund.campaign_id = campaign.id
      JOIN finance_transactions transaction_row
        ON transaction_row.id = refund.posted_transaction_id
      JOIN finance_ledger_entries entry
        ON entry.transaction_id = transaction_row.id
      WHERE campaign.id = 'campaign-refund'
      GROUP BY campaign.id, refund.id, transaction_row.id;
    `)), [{
      status: "failed",
      pledged_amount: 1000,
      refunded_amount: 1000,
      terminal_reason: "deadline",
      refund_amount: 1000,
      transaction_status: "posted",
      entry_sum: 0,
    }]);

    assert.deepEqual(lastResults(executeSql(persistPath, `
      SELECT id, balance, revision
      FROM finance_accounts
      WHERE class_id = 'class-funding'
      ORDER BY id;
    `)), [
      {
        id: "finance:class:class-funding:issuance",
        balance: -10000,
        revision: 7,
      },
      {
        id: "finance:student:student-creator:wallet",
        balance: 6000,
        revision: 5,
      },
      {
        id: "finance:student:student-supporter:wallet",
        balance: 4000,
        revision: 2,
      },
    ]);

    const immutableContribution = executeSql(
      persistPath,
      `UPDATE finance_funding_contributions
       SET amount = 999 WHERE id = 'contribution-one';`,
      { expectSuccess: false },
    );
    assert.match(
      immutableContribution.output,
      /FINANCE_FUNDING_CONTRIBUTION_IMMUTABLE/,
    );
    const immutableEvent = executeSql(
      persistPath,
      `DELETE FROM finance_funding_campaign_events
       WHERE id = 'event-campaign-success-created';`,
      { expectSuccess: false },
    );
    assert.match(immutableEvent.output, /FINANCE_FUNDING_EVENT_IMMUTABLE/);

    const forbiddenGenericReversal = executeSql(
      persistPath,
      `INSERT INTO finance_transactions (
         id, class_id, status, transaction_type, description,
         idempotency_key, payload_hash, reversal_of_transaction_id,
         actor_type, actor_teacher_id, actor_label, created_at
       ) VALUES (
         'tx-forbidden-funding-reversal', 'class-funding', 'pending',
         'reversal', 'Unsafe generic reversal',
         'funding:test:forbidden:reversal', 'hash-forbidden-reversal',
         'tx-contribution-one', 'teacher', 'teacher-funding', 'Teacher', 400
       );`,
      { expectSuccess: false },
    );
    assert.match(
      forbiddenGenericReversal.output,
      /FINANCE_FUNDING_REVERSAL_REQUIRES_CAMPAIGN/,
    );

    assert.deepEqual(lastResults(executeSql(persistPath, `
      SELECT
        (SELECT COUNT(*) FROM finance_funding_contributions) AS contributions,
        (SELECT COUNT(*) FROM finance_funding_settlements) AS settlements,
        (SELECT COUNT(*) FROM finance_funding_refunds) AS refunds,
        (SELECT COUNT(*) FROM finance_transactions
         WHERE source_type IN (
           'funding_contribution', 'funding_settlement', 'funding_refund'
         ) AND status = 'posted') AS posted_transactions,
        (SELECT COALESCE(SUM(entry.amount), 0)
         FROM finance_ledger_entries entry
         JOIN finance_transactions transaction_row
           ON transaction_row.id = entry.transaction_id
         WHERE transaction_row.source_type IN (
           'funding_contribution', 'funding_settlement', 'funding_refund'
         )) AS funding_ledger_sum;
    `)), [{
      contributions: 3,
      settlements: 1,
      refunds: 1,
      posted_transactions: 5,
      funding_ledger_sum: 0,
    }]);
  } finally {
    await rm(persistPath, { recursive: true, force: true });
  }
});
