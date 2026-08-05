import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const drizzlePath = path.join(projectRoot, "drizzle");
const wranglerPath = path.join(
  projectRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);
const workerPath = "tests/fixtures/stock-chunk-liquidation-worker.ts";
const workerConfigPath = "tests/fixtures/wrangler.stock-chunk-liquidation.jsonc";

function runWrangler(configPath, args, { expectSuccess = true } = {}) {
  let result;
  let output = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    result = spawnSync(process.execPath, [
      wranglerPath,
      ...args,
      `--config=${configPath}`,
    ], {
      cwd: projectRoot,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    });
    output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (result.status === 0 || !output.includes("bad port")) break;
  }
  assert.ok(result, "Wrangler did not start.");
  if (expectSuccess) {
    assert.equal(
      result.status,
      0,
      `Wrangler command failed.\n${output.slice(-6000)}`,
    );
  } else {
    assert.notEqual(result.status, 0, "The D1 command should have failed.");
  }
  return { ...result, output };
}

function executeSql(configPath, persistPath, sql, options) {
  const result = runWrangler(configPath, [
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

async function waitForPauseHook(worker, id) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await worker.fetch(
      `http://test.local/test/pause-status?id=${encodeURIComponent(id)}`,
    );
    assert.equal(response.status, 200);
    const status = await response.json();
    if (status.matched) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`The liquidation pause hook did not match: ${id}`);
}

async function releasePauseHook(worker, id) {
  const response = await worker.fetch(
    `http://test.local/test/pause-release?id=${encodeURIComponent(id)}`,
    { method: "POST" },
  );
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.released, true);
}

async function copyMigrationRange(migrationsPath, minimum, maximum) {
  await mkdir(migrationsPath, { recursive: true });
  const migrationNames = (await readdir(drizzlePath))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .filter((name) => {
      const sequence = Number(name.slice(0, 4));
      return sequence >= minimum && sequence <= maximum;
    })
    .sort();
  for (const migrationName of migrationNames) {
    await copyFile(
      path.join(drizzlePath, migrationName),
      path.join(migrationsPath, migrationName),
    );
  }
  return migrationNames;
}

function seedLegacyChunkedPosition(
  configPath,
  persistPath,
  sessionTokenHash,
  { includeSecondPosition = false } = {},
) {
  executeSql(configPath, persistPath, `
    INSERT INTO teachers (
      id, email, password_hash, status, email_verified_at,
      teacher_access_status, teacher_access_verified_at, school_id,
      created_at, updated_at
    ) VALUES (
      'teacher-chunked', 'teacher-chunked@test.local', 'hash', 'active', 1,
      'invite_verified', 1, 'school-chunked', 1, 1
    );
    INSERT INTO classes (
      id, teacher_id, school_name, school_normalized, school_id,
      school_year, grade, class_number, status, created_at, updated_at
    ) VALUES (
      'class-chunked', 'teacher-chunked', 'Chunked School',
      'chunked school', 'school-chunked', 2099, 6, 9, 'active', 1, 1
    );
    INSERT INTO students (
      id, class_id, student_number, official_name, status,
      created_at, updated_at
    ) VALUES (
      'student-chunked', 'class-chunked', 1, 'Chunked Student',
      'active', 1, 1
    );
    INSERT INTO sessions (
      id, token_hash, actor_type, teacher_id, student_id,
      expires_at, created_at, last_seen_at
    ) VALUES (
      'session-chunked', '${sessionTokenHash}', 'teacher',
      'teacher-chunked', NULL, 4102444800000, 1, 1
    );
    UPDATE finance_settings
    SET denominations_json = '[1,10,100,1000]', revision = 1,
        updated_by_teacher_id = 'teacher-chunked', updated_at = 2
    WHERE class_id = 'class-chunked';
    INSERT INTO finance_stocks (
      id, class_id, name, symbol, description,
      initial_price, current_price, previous_price,
      total_shares, available_shares, max_shares_per_student,
      status, revision, inventory_revision, last_trade_id,
      created_by_teacher_id, updated_by_actor_type,
      updated_by_teacher_id, created_at, updated_at
    ) VALUES (
      'stock-chunked', 'class-chunked', 'Chunked Company', 'CHUNK',
      'Resumable liquidation test stock', 37, 37, 37,
      22, 22, 11, 'active', 0, 0, NULL,
      'teacher-chunked', 'teacher', 'teacher-chunked', 10, 10
    );
    INSERT INTO finance_stock_events (
      id, class_id, stock_id, revision, action, reason,
      idempotency_key, payload_hash, stock_snapshot_json,
      actor_type, actor_teacher_id, created_at
    ) VALUES (
      'stock-chunked-issued', 'class-chunked', 'stock-chunked', 0,
      'issued', 'Initial issue', 'stock-chunked-event-issued',
      'hash:stock:chunked:issued', '{"price":37}',
      'teacher', 'teacher-chunked', 10
    );
    UPDATE finance_stock_markets
    SET is_open = 1, buy_fee_bps = 148, sell_fee_bps = 1000,
        buy_spread = 0, sell_spread = 0, next_tick_at = 1000,
        revision = 1, updated_by_teacher_id = 'teacher-chunked',
        updated_at = 15
    WHERE class_id = 'class-chunked';

    INSERT INTO finance_transactions (
      id, class_id, status, transaction_type, description,
      idempotency_key, payload_hash, actor_type, actor_teacher_id,
      actor_label, created_at
    ) VALUES (
      'transaction-chunked-fund', 'class-chunked', 'pending',
      'manual_credit', 'Fund the chunked liquidation wallet',
      'stock-chunked-migration-fund', 'hash:stock:chunked:fund',
      'teacher', 'teacher-chunked', 'Teacher', 20
    );
    INSERT INTO finance_ledger_entries (
      id, transaction_id, class_id, account_id, amount,
      balance_after, account_revision_after, created_at
    ) VALUES (
      'entry-chunked-fund-wallet', 'transaction-chunked-fund',
      'class-chunked', 'finance:student:student-chunked:wallet',
      413, 413, 1, 20
    );
    INSERT INTO finance_ledger_entries (
      id, transaction_id, class_id, account_id, amount,
      balance_after, account_revision_after, created_at
    ) VALUES (
      'entry-chunked-fund-issuance', 'transaction-chunked-fund',
      'class-chunked', 'finance:class:class-chunked:issuance',
      -413, -413, 1, 20
    );
    UPDATE finance_transactions SET status = 'posted', posted_at = 20
    WHERE id = 'transaction-chunked-fund';

    INSERT INTO finance_stock_trades (
      id, class_id, stock_id, stock_revision,
      inventory_revision_before, inventory_revision_after,
      market_revision, finance_settings_revision,
      student_id, wallet_account_id,
      wallet_revision_before, wallet_revision_after,
      side, quantity, reference_price, spread_snapshot, unit_price,
      gross_amount, fee_bps_snapshot, fee_amount, wallet_delta,
      available_shares_before, available_shares_after,
      holding_quantity_before, holding_quantity_after,
      holding_cost_basis_before, holding_cost_basis_after,
      holding_revision_before, holding_revision_after,
      cost_basis_removed, realized_gain, status,
      idempotency_key, payload_hash, created_at
    ) VALUES (
      'trade-chunked-buy', 'class-chunked', 'stock-chunked', 0,
      0, 1, 1, 1,
      'student-chunked', 'finance:student:student-chunked:wallet',
      1, 2, 'buy', 11, 37, 0, 37, 407, 148, 6, -413,
      22, 11, 0, 11, 0, 413, 0, 1, 0, 0, 'pending',
      'stock-chunked-migration-buy', 'payload:stock:chunked:buy', 30
    );
    INSERT INTO finance_stock_holdings (
      id, class_id, stock_id, student_id, wallet_account_id,
      quantity, cost_basis, revision, last_trade_id, created_at, updated_at
    ) VALUES (
      'holding-chunked', 'class-chunked', 'stock-chunked',
      'student-chunked', 'finance:student:student-chunked:wallet',
      11, 413, 1, 'trade-chunked-buy', 30, 30
    );
    UPDATE finance_stocks
    SET available_shares = 11, inventory_revision = 1,
        last_trade_id = 'trade-chunked-buy', updated_at = 30
    WHERE id = 'stock-chunked' AND class_id = 'class-chunked';
    INSERT INTO finance_transactions (
      id, class_id, status, transaction_type, description,
      idempotency_key, payload_hash, source_type, source_id,
      actor_type, actor_label, created_at
    ) VALUES (
      'transaction-chunked-buy', 'class-chunked', 'pending',
      'stock_buy', 'Buy the legacy chunked position',
      'stock-trade:trade-chunked-buy:ledger', 'tx-hash:stock:chunked:buy',
      'stock_trade', 'trade-chunked-buy', 'system', 'Stock system', 30
    );
    INSERT INTO finance_ledger_entries (
      id, transaction_id, class_id, account_id, amount,
      balance_after, account_revision_after, created_at
    ) VALUES (
      'entry-chunked-buy-wallet', 'transaction-chunked-buy',
      'class-chunked', 'finance:student:student-chunked:wallet',
      -413, 0, 2, 30
    );
    INSERT INTO finance_ledger_entries (
      id, transaction_id, class_id, account_id, amount,
      balance_after, account_revision_after, created_at
    ) VALUES (
      'entry-chunked-buy-issuance', 'transaction-chunked-buy',
      'class-chunked', 'finance:class:class-chunked:issuance',
      413, 0, 2, 30
    );
    UPDATE finance_transactions SET status = 'posted', posted_at = 30
    WHERE id = 'transaction-chunked-buy';
    UPDATE finance_stock_trades
    SET status = 'posted',
        posted_transaction_id = 'transaction-chunked-buy',
        transaction_payload_hash = 'tx-hash:stock:chunked:buy', posted_at = 30
    WHERE id = 'trade-chunked-buy';

    ${includeSecondPosition ? `
    INSERT INTO students (
      id, class_id, student_number, official_name, status,
      created_at, updated_at
    ) VALUES (
      'student-chunked-second', 'class-chunked', 2, 'Second Chunked Student',
      'active', 31, 31
    );
    INSERT INTO finance_transactions (
      id, class_id, status, transaction_type, description,
      idempotency_key, payload_hash, actor_type, actor_teacher_id,
      actor_label, created_at
    ) VALUES (
      'transaction-chunked-fund-second', 'class-chunked', 'pending',
      'manual_credit', 'Fund the second chunked liquidation wallet',
      'stock-chunked-migration-fund-second',
      'hash:stock:chunked:fund:second',
      'teacher', 'teacher-chunked', 'Teacher', 31
    );
    INSERT INTO finance_ledger_entries (
      id, transaction_id, class_id, account_id, amount,
      balance_after, account_revision_after, created_at
    ) VALUES (
      'entry-chunked-fund-wallet-second',
      'transaction-chunked-fund-second', 'class-chunked',
      'finance:student:student-chunked-second:wallet', 413, 413, 1, 31
    );
    INSERT INTO finance_ledger_entries (
      id, transaction_id, class_id, account_id, amount,
      balance_after, account_revision_after, created_at
    ) VALUES (
      'entry-chunked-fund-issuance-second',
      'transaction-chunked-fund-second', 'class-chunked',
      'finance:class:class-chunked:issuance', -413, -413, 3, 31
    );
    UPDATE finance_transactions SET status = 'posted', posted_at = 31
    WHERE id = 'transaction-chunked-fund-second';

    INSERT INTO finance_stock_trades (
      id, class_id, stock_id, stock_revision,
      inventory_revision_before, inventory_revision_after,
      market_revision, finance_settings_revision,
      student_id, wallet_account_id,
      wallet_revision_before, wallet_revision_after,
      side, quantity, reference_price, spread_snapshot, unit_price,
      gross_amount, fee_bps_snapshot, fee_amount, wallet_delta,
      available_shares_before, available_shares_after,
      holding_quantity_before, holding_quantity_after,
      holding_cost_basis_before, holding_cost_basis_after,
      holding_revision_before, holding_revision_after,
      cost_basis_removed, realized_gain, status,
      idempotency_key, payload_hash, created_at
    ) VALUES (
      'trade-chunked-buy-second', 'class-chunked', 'stock-chunked', 0,
      1, 2, 1, 1,
      'student-chunked-second',
      'finance:student:student-chunked-second:wallet',
      1, 2, 'buy', 11, 37, 0, 37, 407, 148, 6, -413,
      11, 0, 0, 11, 0, 413, 0, 1, 0, 0, 'pending',
      'stock-chunked-migration-buy-second',
      'payload:stock:chunked:buy:second', 32
    );
    INSERT INTO finance_stock_holdings (
      id, class_id, stock_id, student_id, wallet_account_id,
      quantity, cost_basis, revision, last_trade_id, created_at, updated_at
    ) VALUES (
      'holding-chunked-second', 'class-chunked', 'stock-chunked',
      'student-chunked-second',
      'finance:student:student-chunked-second:wallet',
      11, 413, 1, 'trade-chunked-buy-second', 32, 32
    );
    UPDATE finance_stocks
    SET available_shares = 0, inventory_revision = 2,
        last_trade_id = 'trade-chunked-buy-second', updated_at = 32
    WHERE id = 'stock-chunked' AND class_id = 'class-chunked';
    INSERT INTO finance_transactions (
      id, class_id, status, transaction_type, description,
      idempotency_key, payload_hash, source_type, source_id,
      actor_type, actor_label, created_at
    ) VALUES (
      'transaction-chunked-buy-second', 'class-chunked', 'pending',
      'stock_buy', 'Buy the second legacy chunked position',
      'stock-trade:trade-chunked-buy-second:ledger',
      'tx-hash:stock:chunked:buy:second',
      'stock_trade', 'trade-chunked-buy-second',
      'system', 'Stock system', 32
    );
    INSERT INTO finance_ledger_entries (
      id, transaction_id, class_id, account_id, amount,
      balance_after, account_revision_after, created_at
    ) VALUES (
      'entry-chunked-buy-wallet-second',
      'transaction-chunked-buy-second', 'class-chunked',
      'finance:student:student-chunked-second:wallet', -413, 0, 2, 32
    );
    INSERT INTO finance_ledger_entries (
      id, transaction_id, class_id, account_id, amount,
      balance_after, account_revision_after, created_at
    ) VALUES (
      'entry-chunked-buy-issuance-second',
      'transaction-chunked-buy-second', 'class-chunked',
      'finance:class:class-chunked:issuance', 413, 0, 4, 32
    );
    UPDATE finance_transactions SET status = 'posted', posted_at = 32
    WHERE id = 'transaction-chunked-buy-second';
    UPDATE finance_stock_trades
    SET status = 'posted',
        posted_transaction_id = 'transaction-chunked-buy-second',
        transaction_payload_hash = 'tx-hash:stock:chunked:buy:second',
        posted_at = 32
    WHERE id = 'trade-chunked-buy-second';
    ` : ""}

    UPDATE finance_stock_markets
    SET is_open = 0, next_tick_at = NULL, revision = 2,
        updated_by_teacher_id = 'teacher-chunked', updated_at = 40
    WHERE class_id = 'class-chunked';
    UPDATE finance_stocks
    SET current_price = 100000000, previous_price = 37,
        status = 'halted', revision = 1,
        updated_by_actor_type = 'teacher',
        updated_by_teacher_id = 'teacher-chunked', updated_at = 40
    WHERE id = 'stock-chunked' AND class_id = 'class-chunked';
    INSERT INTO finance_stock_events (
      id, class_id, stock_id, revision, action, reason,
      idempotency_key, payload_hash, previous_snapshot_json,
      stock_snapshot_json, actor_type, actor_teacher_id, created_at
    ) VALUES (
      'stock-chunked-price-legacy', 'class-chunked', 'stock-chunked', 1,
      'price_changed', 'Legacy oversized position',
      'stock-chunked-event-price-legacy',
      'hash:stock:chunked:price:legacy', '{"price":37}',
      '{"price":100000000,"marketRevision":2}',
      'teacher', 'teacher-chunked', 40
    );
    UPDATE students SET status = 'locked', updated_at = 40
    WHERE id = 'student-chunked' AND class_id = 'class-chunked';
    ${includeSecondPosition ? `
    UPDATE students SET status = 'locked', updated_at = 40
    WHERE id = 'student-chunked-second' AND class_id = 'class-chunked';
    ` : ""}
  `);
}

function creditWalletBeforeLiquidationMigration(
  configPath,
  persistPath,
  { recipientStudentId, amount },
) {
  const isTargetStudent = recipientStudentId === "student-chunked";
  if (!isTargetStudent) {
    executeSql(configPath, persistPath, `
      INSERT INTO students (
        id, class_id, student_number, official_name, status,
        created_at, updated_at
      ) VALUES (
        '${recipientStudentId}', 'class-chunked', 2, 'Headroom Student',
        'active', 41, 41
      );
    `);
  }
  const walletRevisionAfter = isTargetStudent ? 3 : 1;
  executeSql(configPath, persistPath, `
    INSERT INTO finance_transactions (
      id, class_id, status, transaction_type, description,
      idempotency_key, payload_hash, actor_type, actor_teacher_id,
      actor_label, created_at
    ) VALUES (
      'transaction-headroom-fund', 'class-chunked', 'pending',
      'manual_credit', 'Create a bounded headroom preflight fixture',
      'stock-chunked-headroom-fund', 'hash:stock:chunked:headroom:fund',
      'teacher', 'teacher-chunked', 'Teacher', 42
    );
    INSERT INTO finance_ledger_entries (
      id, transaction_id, class_id, account_id, amount,
      balance_after, account_revision_after, created_at
    ) VALUES (
      'entry-headroom-fund-wallet', 'transaction-headroom-fund',
      'class-chunked', 'finance:student:${recipientStudentId}:wallet',
      ${amount}, ${amount}, ${walletRevisionAfter}, 42
    );
    INSERT INTO finance_ledger_entries (
      id, transaction_id, class_id, account_id, amount,
      balance_after, account_revision_after, created_at
    ) VALUES (
      'entry-headroom-fund-issuance', 'transaction-headroom-fund',
      'class-chunked', 'finance:class:class-chunked:issuance',
      -${amount}, -${amount}, 3, 42
    );
    UPDATE finance_transactions SET status = 'posted', posted_at = 42
    WHERE id = 'transaction-headroom-fund';
  `);
}

function financialMutationSnapshot(configPath, persistPath) {
  return lastResults(executeSql(configPath, persistPath, `
    SELECT
      (SELECT COUNT(*) FROM finance_stock_liquidation_operations)
        AS operation_count,
      (SELECT COUNT(*) FROM finance_stock_liquidation_chunks) AS chunk_count,
      (SELECT COUNT(*) FROM finance_stock_trades) AS trade_count,
      (SELECT COUNT(*) FROM finance_transactions) AS transaction_count,
      (SELECT COUNT(*) FROM finance_ledger_entries) AS entry_count,
      (SELECT COUNT(*) FROM finance_stock_trades WHERE status = 'pending')
        AS pending_trade_count,
      (SELECT COUNT(*) FROM finance_transactions WHERE status = 'pending')
        AS pending_transaction_count,
      (SELECT balance FROM finance_accounts
       WHERE id = 'finance:student:student-chunked:wallet') AS wallet_balance,
      (SELECT revision FROM finance_accounts
       WHERE id = 'finance:student:student-chunked:wallet') AS wallet_revision,
      (SELECT balance FROM finance_accounts
       WHERE id = 'finance:class:class-chunked:issuance') AS issuance_balance,
      (SELECT revision FROM finance_accounts
       WHERE id = 'finance:class:class-chunked:issuance') AS issuance_revision,
      (SELECT quantity FROM finance_stock_holdings
       WHERE id = 'holding-chunked') AS holding_quantity,
      (SELECT cost_basis FROM finance_stock_holdings
       WHERE id = 'holding-chunked') AS holding_cost_basis,
      (SELECT revision FROM finance_stock_holdings
       WHERE id = 'holding-chunked') AS holding_revision,
      (SELECT available_shares FROM finance_stocks
       WHERE id = 'stock-chunked') AS available_shares,
      (SELECT inventory_revision FROM finance_stocks
       WHERE id = 'stock-chunked') AS inventory_revision,
      (SELECT last_trade_id FROM finance_stocks
       WHERE id = 'stock-chunked') AS stock_last_trade_id;
  `));
}

function configureSmallDirectLiquidation(configPath, persistPath) {
  const changedAt = Date.now() + 1_000;
  executeSql(configPath, persistPath, `
    UPDATE finance_stocks
    SET current_price = 20000000, previous_price = 100000000,
        revision = 2, updated_by_actor_type = 'teacher',
        updated_by_teacher_id = 'teacher-chunked', updated_at = ${changedAt}
    WHERE id = 'stock-chunked' AND class_id = 'class-chunked';
    INSERT INTO finance_stock_events (
      id, class_id, stock_id, revision, action, reason,
      idempotency_key, payload_hash, previous_snapshot_json,
      stock_snapshot_json, actor_type, actor_teacher_id, created_at
    ) VALUES (
      'stock-chunked-price-small', 'class-chunked', 'stock-chunked', 2,
      'price_changed', 'Prepare a small direct liquidation fixture',
      'stock-chunked-event-price-small',
      'hash:stock:chunked:price:small', '{"price":100000000}',
      '{"price":20000000,"marketRevision":2}',
      'teacher', 'teacher-chunked', ${changedAt}
    );
  `);
}

async function createLiquidationFixture({
  temporaryPrefix,
  rawSessionToken,
  walletCredit = 0,
  smallDirect = false,
}) {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), temporaryPrefix));
  const migrationsPath = path.join(temporaryRoot, "migrations");
  const persistPath = path.join(temporaryRoot, "d1");
  const configPath = path.join(temporaryRoot, "wrangler.jsonc");
  let worker;
  try {
    await copyMigrationRange(migrationsPath, 0, 18);
    await writeFile(configPath, JSON.stringify({
      name: "stock-chunk-liquidation-test",
      compatibility_date: "2026-05-22",
      compatibility_flags: ["nodejs_compat"],
      d1_databases: [{
        binding: "DB",
        database_name: "stock-chunk-liquidation-test",
        database_id: "935f3153-b687-4d03-925d-65219d137034",
        migrations_dir: "./migrations",
      }],
    }, null, 2));
    runWrangler(configPath, [
      "d1", "migrations", "apply", "DB", "--local",
      `--persist-to=${persistPath}`,
    ]);
    const sessionTokenHash = createHash("sha256")
      .update(rawSessionToken)
      .digest("base64url");
    seedLegacyChunkedPosition(configPath, persistPath, sessionTokenHash);
    if (walletCredit > 0) {
      creditWalletBeforeLiquidationMigration(configPath, persistPath, {
        recipientStudentId: "student-chunked",
        amount: walletCredit,
      });
    }
    await copyMigrationRange(migrationsPath, 19, Number.POSITIVE_INFINITY);
    runWrangler(configPath, [
      "d1", "migrations", "apply", "DB", "--local",
      `--persist-to=${persistPath}`,
    ]);
    if (smallDirect) configureSmallDirectLiquidation(configPath, persistPath);

    worker = await (await import("wrangler")).unstable_dev(workerPath, {
      config: workerConfigPath,
      moduleRoot: projectRoot,
      persistTo: persistPath,
      logLevel: "none",
      experimental: {
        disableDevRegistry: true,
        disableExperimentalWarning: true,
        watch: false,
      },
    });
    return {
      configPath,
      persistPath,
      worker,
      async close() {
        await worker.stop();
        await rm(temporaryRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await worker?.stop();
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

async function assertLiquidationHeadroomRejection({
  temporaryPrefix,
  recipientStudentId,
  rootIdempotencyKey,
  expectedCode,
}) {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), temporaryPrefix));
  const migrationsPath = path.join(temporaryRoot, "migrations");
  const persistPath = path.join(temporaryRoot, "d1");
  const configPath = path.join(temporaryRoot, "wrangler.jsonc");
  let worker;
  try {
    await copyMigrationRange(migrationsPath, 0, 18);
    await writeFile(configPath, JSON.stringify({
      name: "stock-chunk-liquidation-test",
      compatibility_date: "2026-05-22",
      compatibility_flags: ["nodejs_compat"],
      d1_databases: [{
        binding: "DB",
        database_name: "stock-chunk-liquidation-test",
        database_id: "935f3153-b687-4d03-925d-65219d137034",
        migrations_dir: "./migrations",
      }],
    }, null, 2));
    runWrangler(configPath, [
      "d1", "migrations", "apply", "DB", "--local",
      `--persist-to=${persistPath}`,
    ]);
    const rawSessionToken = `teacher-${rootIdempotencyKey}-session`;
    const sessionTokenHash = createHash("sha256")
      .update(rawSessionToken)
      .digest("base64url");
    seedLegacyChunkedPosition(configPath, persistPath, sessionTokenHash);
    creditWalletBeforeLiquidationMigration(configPath, persistPath, {
      recipientStudentId,
      amount: 20_000_000,
    });
    await copyMigrationRange(migrationsPath, 19, Number.POSITIVE_INFINITY);
    runWrangler(configPath, [
      "d1", "migrations", "apply", "DB", "--local",
      `--persist-to=${persistPath}`,
    ]);

    worker = await (await import("wrangler")).unstable_dev(workerPath, {
      config: workerConfigPath,
      moduleRoot: projectRoot,
      persistTo: persistPath,
      logLevel: "none",
      experimental: {
        disableDevRegistry: true,
        disableExperimentalWarning: true,
        watch: false,
      },
    });
    const before = financialMutationSnapshot(configPath, persistPath);
    const response = await worker.fetch(
      "http://test.local/liquidate?classId=class-chunked",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `job_classroom_session=${rawSessionToken}`,
        },
        body: JSON.stringify({
          studentId: "student-chunked",
          reason: "Verify the liquidation headroom preflight",
          origin: "account_recovery",
          expectedStockRevision: 1,
          expectedMarketRevision: 2,
          expectedFinanceSettingsRevision: 1,
          expectedHoldingRevision: 1,
          idempotencyKey: rootIdempotencyKey,
        }),
      },
    );
    const result = await response.json();
    assert.equal(response.status, 409, JSON.stringify(result));
    assert.equal(result.code, expectedCode);
    assert.deepEqual(
      financialMutationSnapshot(configPath, persistPath),
      before,
      "A rejected preflight must not create an operation or mutate finance state.",
    );
  } finally {
    await worker?.stop();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function operationAndProjectionState(configPath, persistPath) {
  return lastResults(executeSql(configPath, persistPath, `
    SELECT
      operation.status,
      operation.revision AS operation_revision,
      operation.initial_quantity,
      operation.remaining_quantity,
      operation.sold_quantity,
      operation.initial_cost_basis,
      operation.remaining_cost_basis,
      operation.completed_chunk_count,
      operation.total_gross_amount,
      operation.total_fee_amount,
      operation.total_wallet_delta AS total_payout_amount,
      operation.total_cost_basis_removed,
      operation.total_realized_gain,
      operation.snapshot_reference_price AS reference_price_snapshot,
      operation.snapshot_spread AS sell_spread_snapshot,
      operation.snapshot_unit_price AS unit_price_snapshot,
      operation.snapshot_fee_bps AS fee_bps_snapshot,
      operation.snapshot_stock_revision AS stock_revision_snapshot,
      operation.snapshot_market_revision AS market_revision_snapshot,
      operation.snapshot_finance_settings_revision
        AS finance_settings_revision_snapshot,
      wallet.balance AS wallet_balance,
      wallet.revision AS wallet_revision,
      issuance.balance AS issuance_balance,
      issuance.revision AS issuance_revision,
      holding.quantity AS holding_quantity,
      holding.cost_basis AS holding_cost_basis,
      holding.revision AS holding_revision,
      stock.available_shares,
      stock.inventory_revision,
      (SELECT COUNT(*) FROM finance_stock_liquidation_operations) AS operation_count,
      (SELECT COUNT(*) FROM finance_stock_liquidation_chunks) AS chunk_count,
      (SELECT COUNT(*) FROM finance_stock_trades) AS trade_count,
      (SELECT COUNT(*) FROM finance_transactions) AS transaction_count,
      (SELECT COUNT(*) FROM finance_ledger_entries) AS entry_count,
      (SELECT COUNT(*) FROM finance_stock_trades WHERE status = 'pending')
        AS pending_trade_count,
      (SELECT COUNT(*) FROM finance_transactions WHERE status = 'pending')
        AS pending_transaction_count
    FROM finance_stock_liquidation_operations operation
    JOIN finance_accounts wallet
      ON wallet.class_id = operation.class_id
     AND wallet.student_id = operation.student_id
     AND wallet.account_type = 'student_wallet'
    JOIN finance_accounts issuance
      ON issuance.class_id = operation.class_id
     AND issuance.account_type = 'class_issuance'
    JOIN finance_stock_holdings holding
      ON holding.class_id = operation.class_id
     AND holding.stock_id = operation.stock_id
     AND holding.student_id = operation.student_id
    JOIN finance_stocks stock ON stock.id = operation.stock_id
    WHERE operation.root_idempotency_key = 'stock-chunk-liquidation-root-1';
  `));
}

function assertOperationResponse(operation) {
  assert.deepEqual({
    status: operation.status,
    rootIdempotencyKey: operation.rootIdempotencyKey,
    initialQuantity: operation.initialQuantity,
    remainingQuantity: operation.remainingQuantity,
    soldQuantity: operation.soldQuantity,
    initialCostBasis: operation.initialCostBasis,
    remainingCostBasis: operation.remainingCostBasis,
    expectedPayoutAmount: operation.expectedPayoutAmount,
    completedChunkCount: operation.completedChunkCount,
    totalGrossAmount: operation.totalGrossAmount,
    totalFeeAmount: operation.totalFeeAmount,
    totalPayoutAmount: operation.totalPayoutAmount,
    totalCostBasisRemoved: operation.totalCostBasisRemoved,
    totalRealizedGain: operation.totalRealizedGain,
    frozenQuote: operation.frozenQuote,
  }, {
    status: "completed",
    rootIdempotencyKey: "stock-chunk-liquidation-root-1",
    initialQuantity: 11,
    remainingQuantity: 0,
    soldQuantity: 11,
    initialCostBasis: 413,
    remainingCostBasis: 0,
    expectedPayoutAmount: 990_000_000,
    completedChunkCount: 2,
    totalGrossAmount: 1_100_000_000,
    totalFeeAmount: 110_000_000,
    totalPayoutAmount: 990_000_000,
    totalCostBasisRemoved: 413,
    totalRealizedGain: 989_999_587,
    frozenQuote: {
      referencePrice: 100_000_000,
      sellSpread: 0,
      unitPrice: 100_000_000,
      feeBps: 1_000,
      denominationStep: 1,
      stockRevision: 1,
      marketRevision: 2,
      financeSettingsRevision: 1,
    },
  });
}

test("chunked liquidation rejects unsafe wallet and issuance headroom before mutation", {
  timeout: 180_000,
}, async (t) => {
  await t.test("target wallet payout headroom", async () => {
    await assertLiquidationHeadroomRejection({
      temporaryPrefix: "siklassroom-stock-chunk-wallet-limit-",
      recipientStudentId: "student-chunked",
      rootIdempotencyKey: "stock-chunk-liquidation-wallet-limit",
      expectedCode: "FINANCE_STOCK_LIQUIDATION_PAYOUT_LIMIT",
    });
  });
  await t.test("class issuance account headroom", async () => {
    await assertLiquidationHeadroomRejection({
      temporaryPrefix: "siklassroom-stock-chunk-issuance-limit-",
      recipientStudentId: "student-headroom",
      rootIdempotencyKey: "stock-chunk-liquidation-issuance-limit",
      expectedCode: "FINANCE_STOCK_LIQUIDATION_ISSUANCE_LIMIT",
    });
  });
});

test("small direct liquidation enforces payout headroom without changing the safe path", {
  timeout: 180_000,
}, async (t) => {
  await t.test("an existing 900m wallet rejects an approximately 200m payout", async () => {
    const rawSessionToken = "teacher-small-liquidation-limit-session";
    const fixture = await createLiquidationFixture({
      temporaryPrefix: "siklassroom-stock-small-limit-",
      rawSessionToken,
      walletCredit: 900_000_000,
      smallDirect: true,
    });
    try {
      const before = financialMutationSnapshot(
        fixture.configPath,
        fixture.persistPath,
      );
      const response = await fixture.worker.fetch(
        "http://test.local/liquidate?classId=class-chunked",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `job_classroom_session=${rawSessionToken}`,
          },
          body: JSON.stringify({
            studentId: "student-chunked",
            reason: "Reject a direct payout beyond the wallet limit",
            origin: "account_recovery",
            expectedStockRevision: 2,
            expectedMarketRevision: 2,
            expectedFinanceSettingsRevision: 1,
            expectedHoldingRevision: 1,
            idempotencyKey: "stock-small-liquidation-wallet-limit",
          }),
        },
      );
      const result = await response.json();
      assert.equal(response.status, 409, JSON.stringify(result));
      assert.equal(result.code, "FINANCE_STOCK_LIQUIDATION_PAYOUT_LIMIT");
      assert.deepEqual(
        financialMutationSnapshot(fixture.configPath, fixture.persistPath),
        before,
      );
    } finally {
      await fixture.close();
    }
  });

  await t.test("the same direct liquidation succeeds when headroom is available", async () => {
    const rawSessionToken = "teacher-small-liquidation-success-session";
    const fixture = await createLiquidationFixture({
      temporaryPrefix: "siklassroom-stock-small-success-",
      rawSessionToken,
      smallDirect: true,
    });
    try {
      const response = await fixture.worker.fetch(
        "http://test.local/liquidate?classId=class-chunked",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `job_classroom_session=${rawSessionToken}`,
          },
          body: JSON.stringify({
            studentId: "student-chunked",
            reason: "Complete a safe direct liquidation",
            origin: "account_recovery",
            expectedStockRevision: 2,
            expectedMarketRevision: 2,
            expectedFinanceSettingsRevision: 1,
            expectedHoldingRevision: 1,
            idempotencyKey: "stock-small-liquidation-success",
          }),
        },
      );
      const result = await response.json();
      assert.equal(response.status, 201, JSON.stringify(result));
      assert.equal(result.deduplicated, false);
      assert.equal(result.trade.quantity, 11);
      assert.equal(result.trade.grossAmount, 220_000_000);
      assert.equal(result.trade.feeAmount, 22_000_000);
      assert.equal(result.trade.netAmount, 198_000_000);
      assert.deepEqual(
        financialMutationSnapshot(fixture.configPath, fixture.persistPath),
        [{
          operation_count: 0,
          chunk_count: 0,
          trade_count: 2,
          transaction_count: 3,
          entry_count: 6,
          pending_trade_count: 0,
          pending_transaction_count: 0,
          wallet_balance: 198_000_000,
          wallet_revision: 3,
          issuance_balance: -198_000_000,
          issuance_revision: 3,
          holding_quantity: 0,
          holding_cost_basis: 0,
          holding_revision: 2,
          available_shares: 22,
          inventory_revision: 2,
          stock_last_trade_id: result.trade.id,
        }],
      );
    } finally {
      await fixture.close();
    }
  });
});

test("identical chunked liquidation requests converge across operation races", {
  timeout: 180_000,
}, async () => {
  const rawSessionToken = "teacher-stock-chunk-race-session";
  const fixture = await createLiquidationFixture({
    temporaryPrefix: "siklassroom-stock-chunk-race-",
    rawSessionToken,
  });
  try {
    const cookie = `job_classroom_session=${rawSessionToken}`;
    const endpoint = "http://test.local/liquidate?classId=class-chunked";
    const requestBody = {
      studentId: "student-chunked",
      reason: "Converge identical overlapping liquidation requests",
      origin: "account_recovery",
      expectedStockRevision: 1,
      expectedMarketRevision: 2,
      expectedFinanceSettingsRevision: 1,
      expectedHoldingRevision: 1,
      idempotencyKey: "stock-chunk-liquidation-root-1",
    };

    const initialPauseId = "same-initial-operation-insert";
    const pausedInitial = fixture.worker.fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-test-pause-before-operation-insert": initialPauseId,
      },
      body: JSON.stringify(requestBody),
    });
    await waitForPauseHook(fixture.worker, initialPauseId);
    let winningInitialResponse;
    try {
      winningInitialResponse = await fixture.worker.fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(requestBody),
      });
    } finally {
      await releasePauseHook(fixture.worker, initialPauseId);
    }
    const winningInitial = await winningInitialResponse.json();
    const losingInitialResponse = await pausedInitial;
    const losingInitial = await losingInitialResponse.json();
    assert.equal(winningInitialResponse.status, 201, JSON.stringify(winningInitial));
    assert.equal(losingInitialResponse.status, 201, JSON.stringify(losingInitial));
    assert.equal(winningInitial.deduplicated, false);
    assert.equal(winningInitial.chunksProcessed, 1);
    assert.equal(losingInitial.deduplicated, true);
    assert.equal(losingInitial.chunksProcessed, 0);
    assert.equal(losingInitial.trade.id, winningInitial.trade.id);
    assert.equal(losingInitial.operation.id, winningInitial.operation.id);
    assert.equal(losingInitial.operation.revision, 1);
    assert.deepEqual(
      operationAndProjectionState(fixture.configPath, fixture.persistPath)
        .map((row) => ({
          operation_revision: row.operation_revision,
          completed_chunk_count: row.completed_chunk_count,
          chunk_count: row.chunk_count,
          trade_count: row.trade_count,
          transaction_count: row.transaction_count,
          entry_count: row.entry_count,
          holding_quantity: row.holding_quantity,
          wallet_balance: row.wallet_balance,
        })),
      [{
        operation_revision: 1,
        completed_chunk_count: 1,
        chunk_count: 1,
        trade_count: 2,
        transaction_count: 3,
        entry_count: 6,
        holding_quantity: 1,
        wallet_balance: 900_000_000,
      }],
    );

    const continuationBody = {
      ...requestBody,
      operationId: winningInitial.operation.id,
      expectedOperationRevision: 1,
    };
    const continuationPauseId = "same-continuation-root-read";
    const pausedContinuation = fixture.worker.fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-test-pause-after-root-read": continuationPauseId,
      },
      body: JSON.stringify(continuationBody),
    });
    await waitForPauseHook(fixture.worker, continuationPauseId);
    let winningContinuationResponse;
    try {
      winningContinuationResponse = await fixture.worker.fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(continuationBody),
      });
    } finally {
      await releasePauseHook(fixture.worker, continuationPauseId);
    }
    const winningContinuation = await winningContinuationResponse.json();
    const losingContinuationResponse = await pausedContinuation;
    const losingContinuation = await losingContinuationResponse.json();
    assert.equal(
      winningContinuationResponse.status,
      201,
      JSON.stringify(winningContinuation),
    );
    assert.equal(
      losingContinuationResponse.status,
      201,
      JSON.stringify(losingContinuation),
    );
    assert.equal(winningContinuation.deduplicated, false);
    assert.equal(winningContinuation.chunksProcessed, 1);
    assert.equal(losingContinuation.deduplicated, true);
    assert.equal(losingContinuation.chunksProcessed, 0);
    assert.equal(losingContinuation.trade.id, winningContinuation.trade.id);
    assertOperationResponse(losingContinuation.operation);
    const finalState = operationAndProjectionState(
      fixture.configPath,
      fixture.persistPath,
    );
    assert.equal(finalState[0].operation_revision, 2);
    assert.equal(finalState[0].completed_chunk_count, 2);
    assert.equal(finalState[0].chunk_count, 2);
    assert.equal(finalState[0].trade_count, 3);
    assert.equal(finalState[0].transaction_count, 4);
    assert.equal(finalState[0].entry_count, 8);
    assert.equal(finalState[0].holding_quantity, 0);
    assert.equal(finalState[0].wallet_balance, 990_000_000);
  } finally {
    await fixture.close();
  }
});

test("identical small direct liquidations converge after the first duplicate read", {
  timeout: 180_000,
}, async () => {
  const rawSessionToken = "teacher-stock-small-race-session";
  const fixture = await createLiquidationFixture({
    temporaryPrefix: "siklassroom-stock-small-race-",
    rawSessionToken,
    smallDirect: true,
  });
  try {
    const cookie = `job_classroom_session=${rawSessionToken}`;
    const endpoint = "http://test.local/liquidate?classId=class-chunked";
    const requestBody = {
      studentId: "student-chunked",
      reason: "Converge identical direct liquidation requests",
      origin: "account_recovery",
      expectedStockRevision: 2,
      expectedMarketRevision: 2,
      expectedFinanceSettingsRevision: 1,
      expectedHoldingRevision: 1,
      idempotencyKey: "stock-small-liquidation-race",
    };
    const pauseId = "same-small-initial-duplicate-read";
    const pausedRequest = fixture.worker.fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-test-pause-after-trade-idempotency-read": pauseId,
      },
      body: JSON.stringify(requestBody),
    });
    await waitForPauseHook(fixture.worker, pauseId);
    let winningResponse;
    try {
      winningResponse = await fixture.worker.fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(requestBody),
      });
    } finally {
      await releasePauseHook(fixture.worker, pauseId);
    }
    const winning = await winningResponse.json();
    const losingResponse = await pausedRequest;
    const losing = await losingResponse.json();
    assert.equal(winningResponse.status, 201, JSON.stringify(winning));
    assert.equal(losingResponse.status, 201, JSON.stringify(losing));
    assert.equal(winning.deduplicated, false);
    assert.equal(losing.deduplicated, true);
    assert.equal(losing.trade.id, winning.trade.id);
    assert.equal(losing.trade.netAmount, 198_000_000);
    assert.deepEqual(
      financialMutationSnapshot(fixture.configPath, fixture.persistPath),
      [{
        operation_count: 0,
        chunk_count: 0,
        trade_count: 2,
        transaction_count: 3,
        entry_count: 6,
        pending_trade_count: 0,
        pending_transaction_count: 0,
        wallet_balance: 198_000_000,
        wallet_revision: 3,
        issuance_balance: -198_000_000,
        issuance_revision: 3,
        holding_quantity: 0,
        holding_cost_basis: 0,
        holding_revision: 2,
        available_shares: 22,
        inventory_revision: 2,
        stock_last_trade_id: winning.trade.id,
      }],
    );
  } finally {
    await fixture.close();
  }
});

test("competing liquidations cannot overdraw shared issuance headroom", {
  timeout: 180_000,
}, async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "siklassroom-stock-chunk-shared-headroom-"),
  );
  const migrationsPath = path.join(temporaryRoot, "migrations");
  const persistPath = path.join(temporaryRoot, "d1");
  const configPath = path.join(temporaryRoot, "wrangler.jsonc");
  let worker;
  try {
    await copyMigrationRange(migrationsPath, 0, 18);
    await writeFile(configPath, JSON.stringify({
      name: "stock-chunk-liquidation-test",
      compatibility_date: "2026-05-22",
      compatibility_flags: ["nodejs_compat"],
      d1_databases: [{
        binding: "DB",
        database_name: "stock-chunk-liquidation-test",
        database_id: "935f3153-b687-4d03-925d-65219d137034",
        migrations_dir: "./migrations",
      }],
    }, null, 2));
    runWrangler(configPath, [
      "d1", "migrations", "apply", "DB", "--local",
      `--persist-to=${persistPath}`,
    ]);
    const rawSessionToken = "teacher-stock-shared-headroom-session";
    const sessionTokenHash = createHash("sha256")
      .update(rawSessionToken)
      .digest("base64url");
    seedLegacyChunkedPosition(
      configPath,
      persistPath,
      sessionTokenHash,
      { includeSecondPosition: true },
    );
    await copyMigrationRange(migrationsPath, 19, Number.POSITIVE_INFINITY);
    runWrangler(configPath, [
      "d1", "migrations", "apply", "DB", "--local",
      `--persist-to=${persistPath}`,
    ]);
    executeSql(configPath, persistPath, `
      CREATE TRIGGER test_pause_liquidations_after_preflight
      BEFORE UPDATE ON finance_stock_liquidation_operations
      WHEN NEW.completed_chunk_count = OLD.completed_chunk_count + 1
      BEGIN
        SELECT RAISE(ABORT, 'TEST_PAUSE_LIQUIDATION_AFTER_PREFLIGHT');
      END;
    `);

    worker = await (await import("wrangler")).unstable_dev(workerPath, {
      config: workerConfigPath,
      moduleRoot: projectRoot,
      persistTo: persistPath,
      logLevel: "none",
      experimental: {
        disableDevRegistry: true,
        disableExperimentalWarning: true,
        watch: false,
      },
    });
    const cookie = `job_classroom_session=${rawSessionToken}`;
    const endpoint = "http://test.local/liquidate?classId=class-chunked";
    const requestFor = (studentId, idempotencyKey) => ({
      studentId,
      reason: `Reserve shared issuance headroom for ${studentId}`,
      origin: "account_recovery",
      expectedStockRevision: 1,
      expectedMarketRevision: 2,
      expectedFinanceSettingsRevision: 1,
      expectedHoldingRevision: 1,
      idempotencyKey,
    });
    const firstRequest = requestFor(
      "student-chunked",
      "stock-chunk-shared-headroom-first",
    );
    const secondRequest = requestFor(
      "student-chunked-second",
      "stock-chunk-shared-headroom-second",
    );
    for (const body of [firstRequest, secondRequest]) {
      const response = await worker.fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 503);
      assert.equal(
        (await response.json()).code,
        "FINANCE_STOCK_LIQUIDATION_RETRY_REQUIRED",
      );
    }
    const reservedOperations = lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT id, student_id, root_idempotency_key, status, revision,
              completed_chunk_count
       FROM finance_stock_liquidation_operations
       ORDER BY student_id;`,
    ));
    assert.deepEqual(
      reservedOperations.map((row) => ({
        student_id: row.student_id,
        root_idempotency_key: row.root_idempotency_key,
        status: row.status,
        revision: row.revision,
        completed_chunk_count: row.completed_chunk_count,
      })),
      [
        {
          student_id: "student-chunked",
          root_idempotency_key: "stock-chunk-shared-headroom-first",
          status: "running",
          revision: 0,
          completed_chunk_count: 0,
        },
        {
          student_id: "student-chunked-second",
          root_idempotency_key: "stock-chunk-shared-headroom-second",
          status: "running",
          revision: 0,
          completed_chunk_count: 0,
        },
      ],
    );
    executeSql(configPath, persistPath,
      "DROP TRIGGER test_pause_liquidations_after_preflight;",
    );

    const firstOperation = reservedOperations.find(
      (row) => row.student_id === "student-chunked",
    );
    const secondOperation = reservedOperations.find(
      (row) => row.student_id === "student-chunked-second",
    );
    assert.ok(firstOperation?.id);
    assert.ok(secondOperation?.id);
    const firstChunkResponse = await worker.fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        ...firstRequest,
        operationId: firstOperation.id,
        expectedOperationRevision: 0,
      }),
    });
    const firstChunkResult = await firstChunkResponse.json();
    assert.equal(firstChunkResponse.status, 201, JSON.stringify(firstChunkResult));
    assert.equal(firstChunkResult.operation.revision, 1);
    assert.equal(firstChunkResult.operation.totalPayoutAmount, 900_000_000);

    const sharedState = () => lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT
         (SELECT balance FROM finance_accounts
          WHERE id = 'finance:class:class-chunked:issuance')
            AS issuance_balance,
         (SELECT revision FROM finance_accounts
          WHERE id = 'finance:class:class-chunked:issuance')
            AS issuance_revision,
         (SELECT balance FROM finance_accounts
          WHERE id = 'finance:student:student-chunked:wallet')
            AS first_wallet_balance,
         (SELECT revision FROM finance_accounts
          WHERE id = 'finance:student:student-chunked:wallet')
            AS first_wallet_revision,
         (SELECT balance FROM finance_accounts
          WHERE id = 'finance:student:student-chunked-second:wallet')
            AS second_wallet_balance,
         (SELECT revision FROM finance_accounts
          WHERE id = 'finance:student:student-chunked-second:wallet')
            AS second_wallet_revision,
         (SELECT quantity FROM finance_stock_holdings
          WHERE id = 'holding-chunked') AS first_holding_quantity,
         (SELECT revision FROM finance_stock_holdings
          WHERE id = 'holding-chunked') AS first_holding_revision,
         (SELECT quantity FROM finance_stock_holdings
          WHERE id = 'holding-chunked-second') AS second_holding_quantity,
         (SELECT cost_basis FROM finance_stock_holdings
          WHERE id = 'holding-chunked-second') AS second_holding_cost_basis,
         (SELECT revision FROM finance_stock_holdings
          WHERE id = 'holding-chunked-second') AS second_holding_revision,
         (SELECT available_shares FROM finance_stocks
          WHERE id = 'stock-chunked') AS available_shares,
         (SELECT inventory_revision FROM finance_stocks
          WHERE id = 'stock-chunked') AS inventory_revision,
         (SELECT COUNT(*) FROM finance_stock_liquidation_operations)
           AS operation_count,
         (SELECT COUNT(*) FROM finance_stock_liquidation_chunks)
           AS chunk_count,
         (SELECT COUNT(*) FROM finance_stock_trades) AS trade_count,
         (SELECT COUNT(*) FROM finance_transactions) AS transaction_count,
         (SELECT COUNT(*) FROM finance_ledger_entries) AS entry_count,
         (SELECT revision FROM finance_stock_liquidation_operations
          WHERE id = '${secondOperation.id}') AS second_operation_revision,
         (SELECT completed_chunk_count
          FROM finance_stock_liquidation_operations
          WHERE id = '${secondOperation.id}') AS second_completed_chunk_count;
      `,
    ));
    const beforeRejectedChunk = sharedState();
    const rejectedResponse = await worker.fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        ...secondRequest,
        operationId: secondOperation.id,
        expectedOperationRevision: 0,
      }),
    });
    const rejectedResult = await rejectedResponse.json();
    assert.equal(rejectedResponse.status, 409, JSON.stringify(rejectedResult));
    assert.equal(
      rejectedResult.code,
      "FINANCE_STOCK_LIQUIDATION_ISSUANCE_LIMIT",
    );
    assert.deepEqual(
      sharedState(),
      beforeRejectedChunk,
      "The losing operation must not leave a partial trade, ledger line, or projection.",
    );
    assert.deepEqual(beforeRejectedChunk, [{
      issuance_balance: -900_000_000,
      issuance_revision: 5,
      first_wallet_balance: 900_000_000,
      first_wallet_revision: 3,
      second_wallet_balance: 0,
      second_wallet_revision: 2,
      first_holding_quantity: 1,
      first_holding_revision: 2,
      second_holding_quantity: 11,
      second_holding_cost_basis: 413,
      second_holding_revision: 1,
      available_shares: 10,
      inventory_revision: 3,
      operation_count: 2,
      chunk_count: 1,
      trade_count: 3,
      transaction_count: 5,
      entry_count: 10,
      second_operation_revision: 0,
      second_completed_chunk_count: 0,
    }]);
  } finally {
    await worker?.stop();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("issuance floor guard permits legacy recovery but blocks further deterioration", {
  timeout: 180_000,
}, async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "siklassroom-issuance-floor-legacy-"),
  );
  const migrationsPath = path.join(temporaryRoot, "migrations");
  const persistPath = path.join(temporaryRoot, "d1");
  const configPath = path.join(temporaryRoot, "wrangler.jsonc");
  try {
    await copyMigrationRange(migrationsPath, 0, 18);
    await writeFile(configPath, JSON.stringify({
      name: "stock-chunk-liquidation-test",
      compatibility_date: "2026-05-22",
      compatibility_flags: ["nodejs_compat"],
      d1_databases: [{
        binding: "DB",
        database_name: "stock-chunk-liquidation-test",
        database_id: "935f3153-b687-4d03-925d-65219d137034",
        migrations_dir: "./migrations",
      }],
    }, null, 2));
    runWrangler(configPath, [
      "d1", "migrations", "apply", "DB", "--local",
      `--persist-to=${persistPath}`,
    ]);
    const sessionTokenHash = createHash("sha256")
      .update("teacher-stock-issuance-legacy-session")
      .digest("base64url");
    seedLegacyChunkedPosition(configPath, persistPath, sessionTokenHash);
    await copyMigrationRange(migrationsPath, 19, 19);
    runWrangler(configPath, [
      "d1", "migrations", "apply", "DB", "--local",
      `--persist-to=${persistPath}`,
    ]);
    executeSql(configPath, persistPath, `
      INSERT INTO students (
        id, class_id, student_number, official_name, status,
        created_at, updated_at
      ) VALUES (
        'student-legacy-issuance', 'class-chunked', 3,
        'Legacy Issuance Student', 'active', 45, 45
      );
      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, actor_type, actor_teacher_id,
        actor_label, created_at
      ) VALUES (
        'transaction-legacy-issuance', 'class-chunked', 'pending',
        'manual_credit', 'Create a legacy issuance balance below the new floor',
        'stock-legacy-issuance-fixture', 'hash:legacy:issuance:fixture',
        'teacher', 'teacher-chunked', 'Teacher', 46
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES (
        'entry-legacy-issuance-wallet', 'transaction-legacy-issuance',
        'class-chunked', 'finance:student:student-legacy-issuance:wallet',
        1500000000, 1500000000, 1, 46
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES (
        'entry-legacy-issuance-account', 'transaction-legacy-issuance',
        'class-chunked', 'finance:class:class-chunked:issuance',
        -1500000000, -1500000000, 3, 46
      );
      UPDATE finance_transactions SET status = 'posted', posted_at = 46
      WHERE id = 'transaction-legacy-issuance';
    `);
    await copyMigrationRange(migrationsPath, 20, Number.POSITIVE_INFINITY);
    runWrangler(configPath, [
      "d1", "migrations", "apply", "DB", "--local",
      `--persist-to=${persistPath}`,
    ]);

    executeSql(configPath, persistPath, `
      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, actor_type, actor_teacher_id,
        actor_label, created_at
      ) VALUES (
        'transaction-legacy-recovery', 'class-chunked', 'pending',
        'manual_debit', 'Recover the legacy issuance balance by 100',
        'stock-legacy-issuance-recovery', 'hash:legacy:issuance:recovery',
        'teacher', 'teacher-chunked', 'Teacher', 47
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES (
        'entry-legacy-recovery-issuance', 'transaction-legacy-recovery',
        'class-chunked', 'finance:class:class-chunked:issuance',
        100, -1499999900, 4, 47
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES (
        'entry-legacy-recovery-wallet', 'transaction-legacy-recovery',
        'class-chunked', 'finance:student:student-legacy-issuance:wallet',
        -100, 1499999900, 2, 47
      );
      UPDATE finance_transactions SET status = 'posted', posted_at = 47
      WHERE id = 'transaction-legacy-recovery';
      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, actor_type, actor_teacher_id,
        actor_label, created_at
      ) VALUES (
        'transaction-legacy-deterioration', 'class-chunked', 'pending',
        'manual_credit', 'Attempt to worsen the legacy issuance balance',
        'stock-legacy-issuance-deterioration',
        'hash:legacy:issuance:deterioration',
        'teacher', 'teacher-chunked', 'Teacher', 48
      );
    `);
    const state = () => lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT
         (SELECT balance FROM finance_accounts
          WHERE id = 'finance:class:class-chunked:issuance')
            AS issuance_balance,
         (SELECT revision FROM finance_accounts
          WHERE id = 'finance:class:class-chunked:issuance')
            AS issuance_revision,
         (SELECT balance FROM finance_accounts
          WHERE id = 'finance:student:student-legacy-issuance:wallet')
            AS wallet_balance,
         (SELECT revision FROM finance_accounts
          WHERE id = 'finance:student:student-legacy-issuance:wallet')
            AS wallet_revision,
         (SELECT COUNT(*) FROM finance_ledger_entries) AS entry_count,
         (SELECT COUNT(*) FROM finance_ledger_entries
          WHERE id = 'entry-legacy-deterioration-issuance')
            AS rejected_entry_count;
      `,
    ));
    const afterRecovery = state();
    assert.deepEqual(afterRecovery, [{
      issuance_balance: -1_499_999_900,
      issuance_revision: 4,
      wallet_balance: 1_499_999_900,
      wallet_revision: 2,
      entry_count: 8,
      rejected_entry_count: 0,
    }]);
    const rejected = executeSql(
      configPath,
      persistPath,
      `INSERT INTO finance_ledger_entries (
         id, transaction_id, class_id, account_id, amount,
         balance_after, account_revision_after, created_at
       ) VALUES (
         'entry-legacy-deterioration-issuance',
         'transaction-legacy-deterioration', 'class-chunked',
         'finance:class:class-chunked:issuance',
         -100, -1500000000, 5, 48
       );`,
      { expectSuccess: false },
    );
    assert.match(rejected.output, /FINANCE_ISSUANCE_BALANCE_LIMIT/u);
    assert.deepEqual(state(), afterRecovery);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("teacher stock liquidation rolls back a failed chunk and resumes with one frozen quote", {
  timeout: 180_000,
}, async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "siklassroom-stock-chunk-liquidation-"),
  );
  const migrationsPath = path.join(temporaryRoot, "migrations");
  const persistPath = path.join(temporaryRoot, "d1");
  const configPath = path.join(temporaryRoot, "wrangler.jsonc");
  let worker;
  try {
    const initialMigrations = await copyMigrationRange(migrationsPath, 0, 18);
    assert.equal(initialMigrations.at(-1), "0018_stock-emergency-liquidation.sql");
    await writeFile(configPath, JSON.stringify({
      name: "stock-chunk-liquidation-test",
      compatibility_date: "2026-05-22",
      compatibility_flags: ["nodejs_compat"],
      d1_databases: [{
        binding: "DB",
        database_name: "stock-chunk-liquidation-test",
        database_id: "935f3153-b687-4d03-925d-65219d137034",
        migrations_dir: "./migrations",
      }],
    }, null, 2));
    runWrangler(configPath, [
      "d1", "migrations", "apply", "DB", "--local",
      `--persist-to=${persistPath}`,
    ]);

    const rawSessionToken = "teacher-stock-chunk-liquidation-session";
    const sessionTokenHash = createHash("sha256")
      .update(rawSessionToken)
      .digest("base64url");
    seedLegacyChunkedPosition(configPath, persistPath, sessionTokenHash);

    const laterMigrations = await copyMigrationRange(
      migrationsPath,
      19,
      Number.POSITIVE_INFINITY,
    );
    assert.ok(
      laterMigrations.some((name) => name.startsWith("0019_")),
      "The position-limit migration must be part of the upgrade.",
    );
    runWrangler(configPath, [
      "d1", "migrations", "apply", "DB", "--local",
      `--persist-to=${persistPath}`,
    ]);
    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name IN (
           'finance_stock_liquidation_operations',
           'finance_stock_liquidation_chunks'
         ) ORDER BY name;`,
    )), [
      { name: "finance_stock_liquidation_chunks" },
      { name: "finance_stock_liquidation_operations" },
    ]);

    worker = await (await import("wrangler")).unstable_dev(workerPath, {
      config: workerConfigPath,
      moduleRoot: projectRoot,
      persistTo: persistPath,
      logLevel: "none",
      experimental: {
        disableDevRegistry: true,
        disableExperimentalWarning: true,
        watch: false,
      },
    });
    const requestBody = {
      studentId: "student-chunked",
      reason: "Resume a safely bounded legacy stock liquidation",
      origin: "account_recovery",
      expectedStockRevision: 1,
      expectedMarketRevision: 2,
      expectedFinanceSettingsRevision: 1,
      expectedHoldingRevision: 1,
      idempotencyKey: "stock-chunk-liquidation-root-1",
    };
    const cookie = `job_classroom_session=${rawSessionToken}`;
    const endpoint = "http://test.local/liquidate?classId=class-chunked";

    const startResponse = await worker.fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(requestBody),
    });
    const startResult = await startResponse.json();
    assert.equal(startResponse.status, 201, JSON.stringify(startResult));
    assert.equal(startResult.deduplicated, false);
    assert.equal(startResult.chunksProcessed, 1);
    assert.equal(startResult.trade.quantity, 10);
    assert.equal(startResult.trade.netAmount, 900_000_000);
    assert.equal(startResult.operation.status, "running");
    assert.equal(startResult.operation.revision, 1);
    assert.equal(startResult.operation.expectedPayoutAmount, 990_000_000);
    assert.equal(startResult.operation.totalPayoutAmount, 900_000_000);
    const operationId = startResult.operation.id;
    assert.equal(typeof operationId, "string");
    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT revision, action, remaining_quantity, sold_quantity,
              completed_chunk_count, quantity_delta, wallet_delta,
              total_wallet_delta
       FROM finance_stock_liquidation_events
       WHERE operation_id = '${operationId}'
       ORDER BY revision, action;`,
    )), [
      {
        revision: 0,
        action: "started",
        remaining_quantity: 11,
        sold_quantity: 0,
        completed_chunk_count: 0,
        quantity_delta: 0,
        wallet_delta: 0,
        total_wallet_delta: 0,
      },
      {
        revision: 1,
        action: "chunk_completed",
        remaining_quantity: 1,
        sold_quantity: 10,
        completed_chunk_count: 1,
        quantity_delta: 10,
        wallet_delta: 900_000_000,
        total_wallet_delta: 900_000_000,
      },
    ]);

    executeSql(configPath, persistPath, `
      CREATE TRIGGER test_fail_second_liquidation_chunk_progress
      BEFORE UPDATE ON finance_stock_liquidation_operations
      WHEN OLD.completed_chunk_count = 1 AND NEW.completed_chunk_count = 2
      BEGIN
        SELECT RAISE(ABORT, 'TEST_SECOND_LIQUIDATION_CHUNK_FAILURE');
      END;
    `);
    const continuationBody = {
      ...requestBody,
      operationId,
      expectedOperationRevision: 1,
    };
    const failedResponse = await worker.fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(continuationBody),
    });
    assert.equal(failedResponse.status, 503);
    assert.equal(
      (await failedResponse.json()).code,
      "FINANCE_STOCK_LIQUIDATION_RETRY_REQUIRED",
    );
    assert.deepEqual(operationAndProjectionState(configPath, persistPath), [{
      status: "running",
      operation_revision: 1,
      initial_quantity: 11,
      remaining_quantity: 1,
      sold_quantity: 10,
      initial_cost_basis: 413,
      remaining_cost_basis: 38,
      completed_chunk_count: 1,
      total_gross_amount: 1_000_000_000,
      total_fee_amount: 100_000_000,
      total_payout_amount: 900_000_000,
      total_cost_basis_removed: 375,
      total_realized_gain: 899_999_625,
      reference_price_snapshot: 100_000_000,
      sell_spread_snapshot: 0,
      unit_price_snapshot: 100_000_000,
      fee_bps_snapshot: 1_000,
      stock_revision_snapshot: 1,
      market_revision_snapshot: 2,
      finance_settings_revision_snapshot: 1,
      wallet_balance: 900_000_000,
      wallet_revision: 3,
      issuance_balance: -900_000_000,
      issuance_revision: 3,
      holding_quantity: 1,
      holding_cost_basis: 38,
      holding_revision: 2,
      available_shares: 21,
      inventory_revision: 2,
      operation_count: 1,
      chunk_count: 1,
      trade_count: 2,
      transaction_count: 3,
      entry_count: 6,
      pending_trade_count: 0,
      pending_transaction_count: 0,
    }]);

    const liveChangeAt = Date.now() + 1_000;
    executeSql(configPath, persistPath, `
      DROP TRIGGER test_fail_second_liquidation_chunk_progress;
      UPDATE finance_settings
      SET denominations_json = '[1,10,100,1000,10000]', revision = 2,
          updated_by_teacher_id = 'teacher-chunked',
          updated_at = ${liveChangeAt}
      WHERE class_id = 'class-chunked';
      UPDATE finance_stock_markets
      SET sell_fee_bps = 0, sell_spread = 10000000, revision = 3,
          updated_by_teacher_id = 'teacher-chunked',
          updated_at = ${liveChangeAt}
      WHERE class_id = 'class-chunked';
      UPDATE finance_stocks
      SET current_price = 200000000, previous_price = 100000000,
          revision = 2, updated_by_actor_type = 'teacher',
          updated_by_teacher_id = 'teacher-chunked',
          updated_at = ${liveChangeAt}
      WHERE id = 'stock-chunked' AND class_id = 'class-chunked';
      INSERT INTO finance_stock_events (
        id, class_id, stock_id, revision, action, reason,
        idempotency_key, payload_hash, previous_snapshot_json,
        stock_snapshot_json, actor_type, actor_teacher_id, created_at
      ) VALUES (
        'stock-chunked-price-live-change', 'class-chunked',
        'stock-chunked', 2, 'price_changed',
        'Live quote changed after the first chunk',
        'stock-chunked-event-live-change',
        'hash:stock:chunked:live:change', '{"price":100000000}',
        '{"price":200000000,"marketRevision":3}',
        'teacher', 'teacher-chunked', ${liveChangeAt}
      );
    `);

    executeSql(configPath, persistPath, `
      CREATE TRIGGER test_fail_completed_liquidation_event
      BEFORE INSERT ON finance_stock_liquidation_events
      WHEN NEW.operation_id = '${operationId}' AND NEW.action = 'completed'
      BEGIN
        SELECT RAISE(ABORT, 'TEST_COMPLETED_LIQUIDATION_EVENT_FAILURE');
      END;
    `);
    const failedEventResponse = await worker.fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(continuationBody),
    });
    assert.equal(failedEventResponse.status, 503);
    assert.equal(
      (await failedEventResponse.json()).code,
      "FINANCE_STOCK_LIQUIDATION_RETRY_REQUIRED",
    );
    executeSql(
      configPath,
      persistPath,
      "DROP TRIGGER test_fail_completed_liquidation_event;",
    );
    assert.equal(lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT COUNT(*) AS count
       FROM finance_stock_liquidation_events
       WHERE operation_id = '${operationId}';`,
    ))[0].count, 2);

    const lostResponse = await worker.fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-test-drop-response-after-commit": "1",
      },
      body: JSON.stringify(continuationBody),
    });
    assert.equal(lostResponse.status, 504);
    assert.equal(
      (await lostResponse.json()).code,
      "SIMULATED_LIQUIDATION_RESPONSE_LOSS",
    );

    const completedState = operationAndProjectionState(configPath, persistPath);
    assert.deepEqual(completedState, [{
      status: "completed",
      operation_revision: 2,
      initial_quantity: 11,
      remaining_quantity: 0,
      sold_quantity: 11,
      initial_cost_basis: 413,
      remaining_cost_basis: 0,
      completed_chunk_count: 2,
      total_gross_amount: 1_100_000_000,
      total_fee_amount: 110_000_000,
      total_payout_amount: 990_000_000,
      total_cost_basis_removed: 413,
      total_realized_gain: 989_999_587,
      reference_price_snapshot: 100_000_000,
      sell_spread_snapshot: 0,
      unit_price_snapshot: 100_000_000,
      fee_bps_snapshot: 1_000,
      stock_revision_snapshot: 1,
      market_revision_snapshot: 2,
      finance_settings_revision_snapshot: 1,
      wallet_balance: 990_000_000,
      wallet_revision: 4,
      issuance_balance: -990_000_000,
      issuance_revision: 4,
      holding_quantity: 0,
      holding_cost_basis: 0,
      holding_revision: 3,
      available_shares: 22,
      inventory_revision: 3,
      operation_count: 1,
      chunk_count: 2,
      trade_count: 3,
      transaction_count: 4,
      entry_count: 8,
      pending_trade_count: 0,
      pending_transaction_count: 0,
    }]);

    const retryResponse = await worker.fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(continuationBody),
    });
    assert.equal(retryResponse.status, 201);
    const retryResult = await retryResponse.json();
    assert.equal(retryResult.deduplicated, true);
    assert.equal(retryResult.chunksProcessed, 0);
    assert.equal(retryResult.trade.quantity, 1);
    assert.equal(retryResult.trade.netAmount, 90_000_000);
    assertOperationResponse(retryResult.operation);
    assert.deepEqual(operationAndProjectionState(configPath, persistPath), completedState);
    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT revision, action, remaining_quantity, sold_quantity,
              completed_chunk_count, quantity_delta, wallet_delta,
              total_wallet_delta
       FROM finance_stock_liquidation_events
       WHERE operation_id = '${operationId}'
       ORDER BY revision,
         CASE action WHEN 'chunk_completed' THEN 0 ELSE 1 END;`,
    )), [
      {
        revision: 0,
        action: "started",
        remaining_quantity: 11,
        sold_quantity: 0,
        completed_chunk_count: 0,
        quantity_delta: 0,
        wallet_delta: 0,
        total_wallet_delta: 0,
      },
      {
        revision: 1,
        action: "chunk_completed",
        remaining_quantity: 1,
        sold_quantity: 10,
        completed_chunk_count: 1,
        quantity_delta: 10,
        wallet_delta: 900_000_000,
        total_wallet_delta: 900_000_000,
      },
      {
        revision: 2,
        action: "chunk_completed",
        remaining_quantity: 0,
        sold_quantity: 11,
        completed_chunk_count: 2,
        quantity_delta: 1,
        wallet_delta: 90_000_000,
        total_wallet_delta: 990_000_000,
      },
      {
        revision: 2,
        action: "completed",
        remaining_quantity: 0,
        sold_quantity: 11,
        completed_chunk_count: 2,
        quantity_delta: 0,
        wallet_delta: 0,
        total_wallet_delta: 990_000_000,
      },
    ]);

    const chunkRows = lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT
         operation.id AS operation_id,
         chunk.chunk_index,
         trade.quantity, trade.reference_price, trade.spread_snapshot,
         trade.unit_price, trade.fee_bps_snapshot, trade.gross_amount,
         trade.fee_amount, trade.wallet_delta, trade.cost_basis_removed,
         trade.realized_gain, trade.status,
         transaction_row.status AS transaction_status,
         json_extract(transaction_row.metadata_json, '$.operationId')
           AS metadata_operation_id,
         json_extract(transaction_row.metadata_json, '$.chunkIndex')
           AS metadata_chunk_index,
         json_extract(transaction_row.metadata_json, '$.referencePrice')
           AS metadata_reference_price,
         json_extract(transaction_row.metadata_json, '$.feeBpsSnapshot')
           AS metadata_fee_bps
       FROM finance_stock_liquidation_chunks chunk
       JOIN finance_stock_liquidation_operations operation
         ON operation.id = chunk.operation_id
       JOIN finance_stock_trades trade ON trade.id = chunk.trade_id
       JOIN finance_transactions transaction_row
         ON transaction_row.id = trade.posted_transaction_id
       WHERE operation.root_idempotency_key = 'stock-chunk-liquidation-root-1'
       ORDER BY chunk.chunk_index;`,
    ));
    const chunkEconomics = chunkRows.map((row) => {
      assert.equal(row.metadata_operation_id, row.operation_id);
      const economics = { ...row };
      delete economics.operation_id;
      delete economics.metadata_operation_id;
      return economics;
    });
    assert.deepEqual(chunkEconomics, [
      {
        chunk_index: 0,
        quantity: 10,
        reference_price: 100_000_000,
        spread_snapshot: 0,
        unit_price: 100_000_000,
        fee_bps_snapshot: 1_000,
        gross_amount: 1_000_000_000,
        fee_amount: 100_000_000,
        wallet_delta: 900_000_000,
        cost_basis_removed: 375,
        realized_gain: 899_999_625,
        status: "posted",
        transaction_status: "posted",
        metadata_chunk_index: 0,
        metadata_reference_price: 100_000_000,
        metadata_fee_bps: 1_000,
      },
      {
        chunk_index: 1,
        quantity: 1,
        reference_price: 100_000_000,
        spread_snapshot: 0,
        unit_price: 100_000_000,
        fee_bps_snapshot: 1_000,
        gross_amount: 100_000_000,
        fee_amount: 10_000_000,
        wallet_delta: 90_000_000,
        cost_basis_removed: 38,
        realized_gain: 89_999_962,
        status: "posted",
        transaction_status: "posted",
        metadata_chunk_index: 1,
        metadata_reference_price: 100_000_000,
        metadata_fee_bps: 1_000,
      },
    ]);
    const operationIdentity = lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT id FROM finance_stock_liquidation_operations
       WHERE root_idempotency_key = 'stock-chunk-liquidation-root-1';`,
    ))[0].id;
    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT DISTINCT
         json_extract(transaction_row.metadata_json, '$.operationId')
           AS operation_id
       FROM finance_stock_liquidation_chunks chunk
       JOIN finance_stock_trades trade ON trade.id = chunk.trade_id
       JOIN finance_transactions transaction_row
         ON transaction_row.id = trade.posted_transaction_id
       ORDER BY operation_id;`,
    )), [{ operation_id: operationIdentity }]);
    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      "PRAGMA foreign_key_check;",
    )), []);
  } finally {
    await worker?.stop();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("a teacher can cancel a running liquidation without losing its completed chunk", {
  timeout: 180_000,
}, async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "siklassroom-stock-chunk-cancel-"),
  );
  const migrationsPath = path.join(temporaryRoot, "migrations");
  const persistPath = path.join(temporaryRoot, "d1");
  const configPath = path.join(temporaryRoot, "wrangler.jsonc");
  let worker;
  try {
    await copyMigrationRange(migrationsPath, 0, 18);
    await writeFile(configPath, JSON.stringify({
      name: "stock-chunk-liquidation-test",
      compatibility_date: "2026-05-22",
      compatibility_flags: ["nodejs_compat"],
      d1_databases: [{
        binding: "DB",
        database_name: "stock-chunk-liquidation-test",
        database_id: "935f3153-b687-4d03-925d-65219d137034",
        migrations_dir: "./migrations",
      }],
    }, null, 2));
    runWrangler(configPath, [
      "d1", "migrations", "apply", "DB", "--local",
      `--persist-to=${persistPath}`,
    ]);
    const rawSessionToken = "teacher-stock-chunk-cancel-session";
    const sessionTokenHash = createHash("sha256")
      .update(rawSessionToken)
      .digest("base64url");
    seedLegacyChunkedPosition(configPath, persistPath, sessionTokenHash);
    await copyMigrationRange(
      migrationsPath,
      19,
      Number.POSITIVE_INFINITY,
    );
    runWrangler(configPath, [
      "d1", "migrations", "apply", "DB", "--local",
      `--persist-to=${persistPath}`,
    ]);

    worker = await (await import("wrangler")).unstable_dev(workerPath, {
      config: workerConfigPath,
      moduleRoot: projectRoot,
      persistTo: persistPath,
      logLevel: "none",
      experimental: {
        disableDevRegistry: true,
        disableExperimentalWarning: true,
        watch: false,
      },
    });
    const cookie = `job_classroom_session=${rawSessionToken}`;
    const endpoint = "http://test.local/liquidate?classId=class-chunked";
    const requestBody = {
      studentId: "student-chunked",
      reason: "Start a liquidation that will be cancelled",
      origin: "finance_center",
      expectedStockRevision: 1,
      expectedMarketRevision: 2,
      expectedFinanceSettingsRevision: 1,
      expectedHoldingRevision: 1,
      idempotencyKey: "stock-chunk-liquidation-cancel-root",
    };
    const startResponse = await worker.fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(requestBody),
    });
    const startResult = await startResponse.json();
    assert.equal(startResponse.status, 201, JSON.stringify(startResult));
    assert.equal(startResult.operation.status, "running");
    assert.equal(startResult.operation.revision, 1);
    assert.equal(startResult.operation.remainingQuantity, 1);

    const cancelBody = {
      action: "cancel",
      operationId: startResult.operation.id,
      expectedOperationRevision: 1,
      reason: "The teacher stopped this recovery operation",
      idempotencyKey: "stock-chunk-liquidation-cancel-1",
    };
    executeSql(configPath, persistPath, `
      CREATE TRIGGER test_fail_cancelled_liquidation_event
      BEFORE INSERT ON finance_stock_liquidation_events
      WHEN NEW.operation_id = '${startResult.operation.id}'
        AND NEW.action = 'cancelled'
      BEGIN
        SELECT RAISE(ABORT, 'TEST_CANCELLED_LIQUIDATION_EVENT_FAILURE');
      END;
    `);
    const failedCancelResponse = await worker.fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(cancelBody),
    });
    assert.ok(failedCancelResponse.status >= 500);
    executeSql(
      configPath,
      persistPath,
      "DROP TRIGGER test_fail_cancelled_liquidation_event;",
    );
    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT operation.status, operation.revision,
              (SELECT COUNT(*) FROM finance_stock_liquidation_events event
               WHERE event.operation_id = operation.id) AS event_count
       FROM finance_stock_liquidation_operations operation
       WHERE operation.id = '${startResult.operation.id}';`,
    )), [{ status: "running", revision: 1, event_count: 2 }]);
    const cancelResponse = await worker.fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(cancelBody),
    });
    assert.equal(cancelResponse.status, 201);
    const cancelResult = await cancelResponse.json();
    assert.equal(cancelResult.deduplicated, false);
    assert.equal(cancelResult.operation.status, "cancelled");
    assert.equal(cancelResult.operation.revision, 2);
    assert.equal(cancelResult.operation.remainingQuantity, 1);

    const cancelledState = lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT
         operation.status, operation.revision,
         operation.completed_chunk_count, operation.remaining_quantity,
         operation.remaining_cost_basis, operation.cancelled_at,
         operation.cancellation_reason,
         operation.cancellation_idempotency_key,
         holding.quantity AS holding_quantity,
         holding.cost_basis AS holding_cost_basis,
         wallet.balance AS wallet_balance,
         (SELECT COUNT(*) FROM finance_stock_liquidation_chunks)
           AS chunk_count,
         (SELECT COUNT(*) FROM finance_stock_trades) AS trade_count,
         (SELECT COUNT(*) FROM finance_transactions) AS transaction_count,
         (SELECT COUNT(*) FROM finance_ledger_entries) AS entry_count
       FROM finance_stock_liquidation_operations operation
       JOIN finance_stock_holdings holding
         ON holding.class_id = operation.class_id
        AND holding.stock_id = operation.stock_id
        AND holding.student_id = operation.student_id
       JOIN finance_accounts wallet
         ON wallet.class_id = operation.class_id
        AND wallet.student_id = operation.student_id
        AND wallet.account_type = 'student_wallet'
       WHERE operation.root_idempotency_key =
         'stock-chunk-liquidation-cancel-root';`,
    ));
    assert.equal(cancelledState.length, 1);
    assert.deepEqual({
      ...cancelledState[0],
      cancelled_at: typeof cancelledState[0].cancelled_at,
    }, {
      status: "cancelled",
      revision: 2,
      completed_chunk_count: 1,
      remaining_quantity: 1,
      remaining_cost_basis: 38,
      cancelled_at: "number",
      cancellation_reason: "The teacher stopped this recovery operation",
      cancellation_idempotency_key: "stock-chunk-liquidation-cancel-1",
      holding_quantity: 1,
      holding_cost_basis: 38,
      wallet_balance: 900_000_000,
      chunk_count: 1,
      trade_count: 2,
      transaction_count: 3,
      entry_count: 6,
    });
    const cancellationEvents = lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT id, revision, action, reason, request_idempotency_key,
              remaining_quantity, sold_quantity, completed_chunk_count,
              quantity_delta, wallet_delta, total_wallet_delta
       FROM finance_stock_liquidation_events
       WHERE operation_id = '${startResult.operation.id}'
       ORDER BY revision, action;`,
    ));
    assert.deepEqual(cancellationEvents.map(({ id, ...event }) => event), [
      {
        revision: 0,
        action: "started",
        reason: "Start a liquidation that will be cancelled",
        request_idempotency_key: "stock-chunk-liquidation-cancel-root",
        remaining_quantity: 11,
        sold_quantity: 0,
        completed_chunk_count: 0,
        quantity_delta: 0,
        wallet_delta: 0,
        total_wallet_delta: 0,
      },
      {
        revision: 1,
        action: "chunk_completed",
        reason: "Start a liquidation that will be cancelled",
        request_idempotency_key: `${startResult.operation.id}:chunk:0`,
        remaining_quantity: 1,
        sold_quantity: 10,
        completed_chunk_count: 1,
        quantity_delta: 10,
        wallet_delta: 900_000_000,
        total_wallet_delta: 900_000_000,
      },
      {
        revision: 2,
        action: "cancelled",
        reason: "The teacher stopped this recovery operation",
        request_idempotency_key: "stock-chunk-liquidation-cancel-1",
        remaining_quantity: 1,
        sold_quantity: 10,
        completed_chunk_count: 1,
        quantity_delta: 0,
        wallet_delta: 0,
        total_wallet_delta: 900_000_000,
      },
    ]);
    for (const event of cancellationEvents) {
      assert.equal(
        event.id,
        `finance:stock-liquidation-event:${startResult.operation.id}:${event.revision}:${event.action}`,
      );
    }
    const auditResponse = await worker.fetch(
      "http://test.local/audit?classId=class-chunked&category=stock&query=stopped%20this%20recovery",
      { headers: { cookie } },
    );
    const auditResult = await auditResponse.json();
    assert.equal(auditResponse.status, 200, JSON.stringify(auditResult));
    assert.deepEqual(auditResult.events.map((event) => ({
      action: event.action,
      outcome: event.outcome,
      studentName: event.studentName,
      relatedId: event.relatedId,
    })), [{
      action: "stock_liquidation_cancelled",
      outcome: "cancelled",
      studentName: "Chunked Student",
      relatedId: startResult.operation.id,
    }]);

    const firstAuditPageResponse = await worker.fetch(
      "http://test.local/audit?classId=class-chunked&category=stock&limit=2",
      { headers: { cookie } },
    );
    const firstAuditPage = await firstAuditPageResponse.json();
    assert.equal(firstAuditPageResponse.status, 200, JSON.stringify(firstAuditPage));
    assert.equal(firstAuditPage.events.length, 2);
    assert.ok(firstAuditPage.nextCursor);
    const secondAuditPageResponse = await worker.fetch(
      `http://test.local/audit?classId=class-chunked&category=stock&limit=2&cursor=${encodeURIComponent(firstAuditPage.nextCursor)}`,
      { headers: { cookie } },
    );
    const secondAuditPage = await secondAuditPageResponse.json();
    assert.equal(secondAuditPageResponse.status, 200, JSON.stringify(secondAuditPage));
    assert.equal(secondAuditPage.events.length, 2);
    const pagedAuditEvents = [
      ...firstAuditPage.events,
      ...secondAuditPage.events,
    ];
    assert.equal(new Set(pagedAuditEvents.map((event) => event.id)).size, 4);
    for (let index = 1; index < pagedAuditEvents.length; index += 1) {
      const previous = pagedAuditEvents[index - 1];
      const current = pagedAuditEvents[index];
      const previousTime = Date.parse(previous.occurredAt);
      const currentTime = Date.parse(current.occurredAt);
      assert.ok(
        previousTime > currentTime
          || (previousTime === currentTime && previous.id > current.id),
        "Audit pagination must preserve the global time/id ordering across query groups.",
      );
    }

    const duplicateCancelResponse = await worker.fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(cancelBody),
    });
    assert.equal(duplicateCancelResponse.status, 201);
    assert.equal((await duplicateCancelResponse.json()).deduplicated, true);

    const conflictingCancelResponse = await worker.fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        ...cancelBody,
        reason: "A different cancellation payload reused the same request key",
      }),
    });
    assert.equal(conflictingCancelResponse.status, 409);
    assert.equal(
      (await conflictingCancelResponse.json()).code,
      "FINANCE_STOCK_IDEMPOTENCY_CONFLICT",
    );

    const winningCancellation = lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT cancellation_reason, cancellation_idempotency_key,
              cancellation_payload_hash, revision
       FROM finance_stock_liquidation_operations
       WHERE id = '${startResult.operation.id}';`,
    ));
    const losingCancelResponse = await worker.fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        action: "cancel",
        operationId: startResult.operation.id,
        expectedOperationRevision: 1,
        reason: "A competing teacher cancellation must not replace the winner",
        idempotencyKey: "stock-chunk-liquidation-cancel-competitor",
      }),
    });
    assert.equal(losingCancelResponse.status, 409);
    assert.ok(
      [
        "FINANCE_STOCK_LIQUIDATION_CANCELLED",
        "FINANCE_STOCK_LIQUIDATION_STALE",
      ].includes((await losingCancelResponse.json()).code),
    );
    assert.deepEqual(
      lastResults(executeSql(
        configPath,
        persistPath,
        `SELECT cancellation_reason, cancellation_idempotency_key,
                cancellation_payload_hash, revision
         FROM finance_stock_liquidation_operations
         WHERE id = '${startResult.operation.id}';`,
      )),
      winningCancellation,
      "A losing cancellation must not claim success or overwrite the winner.",
    );
    assert.equal(lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT COUNT(*) AS count FROM finance_stock_liquidation_events
       WHERE operation_id = '${startResult.operation.id}';`,
    ))[0].count, 3);

    const eventUpdate = executeSql(
      configPath,
      persistPath,
      `UPDATE finance_stock_liquidation_events
       SET reason = 'Changed history'
       WHERE operation_id = '${startResult.operation.id}' AND revision = 0;`,
      { expectSuccess: false },
    );
    assert.match(eventUpdate.output, /FINANCE_STOCK_LIQUIDATION_EVENT_IMMUTABLE/);
    const eventReplace = executeSql(
      configPath,
      persistPath,
      `INSERT OR REPLACE INTO finance_stock_liquidation_events
       SELECT 'finance:stock-liquidation-event:forged', class_id, operation_id,
              revision, action, stock_id, student_id, actor_teacher_id,
              chunk_id, chunk_index, trade_id, request_idempotency_key,
              request_payload_hash, reason, initial_quantity,
              remaining_quantity, sold_quantity, completed_chunk_count,
              quantity_delta, wallet_delta, total_gross_amount,
              total_fee_amount, total_wallet_delta, total_cost_basis_removed,
              total_realized_gain, created_at
       FROM finance_stock_liquidation_events
       WHERE operation_id = '${startResult.operation.id}' AND revision = 0;`,
      { expectSuccess: false },
    );
    assert.match(eventReplace.output, /FINANCE_STOCK_LIQUIDATION_EVENT_INVALID/);

    const resumeResponse = await worker.fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        ...requestBody,
        operationId: startResult.operation.id,
        expectedOperationRevision: 1,
      }),
    });
    assert.equal(resumeResponse.status, 409);
    assert.equal(
      (await resumeResponse.json()).code,
      "FINANCE_STOCK_LIQUIDATION_CANCELLED",
    );
    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT status, revision, completed_chunk_count, remaining_quantity
       FROM finance_stock_liquidation_operations
       WHERE root_idempotency_key =
         'stock-chunk-liquidation-cancel-root';`,
    )), [{
      status: "cancelled",
      revision: 2,
      completed_chunk_count: 1,
      remaining_quantity: 1,
    }]);
  } finally {
    await worker?.stop();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
