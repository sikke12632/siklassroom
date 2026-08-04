import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

function runWrangler(configPath, args, { expectSuccess = true } = {}) {
  const result = spawnSync(process.execPath, [
    wranglerPath,
    ...args,
    `--config=${configPath}`,
  ], {
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

async function copyMigrationsThrough(migrationsPath, maximumSequence) {
  await mkdir(migrationsPath, { recursive: true });
  const entries = await readdir(drizzlePath);
  const migrationNames = entries
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .filter((name) => Number(name.slice(0, 4)) <= maximumSequence)
    .sort();
  for (const migrationName of migrationNames) {
    await copyFile(
      path.join(drizzlePath, migrationName),
      path.join(migrationsPath, migrationName),
    );
  }
  return migrationNames;
}

function fundWallet(configPath, persistPath) {
  executeSql(configPath, persistPath, `
    INSERT INTO finance_transactions (
      id, class_id, status, transaction_type, description,
      idempotency_key, payload_hash, actor_type, actor_teacher_id,
      actor_label, created_at
    ) VALUES (
      'transaction-position-fund', 'class-position', 'pending',
      'manual_credit', 'Fund the migration test wallet',
      'stock-position-migration-fund', 'hash:position:fund',
      'teacher', 'teacher-position', 'Teacher', 20
    );
    INSERT INTO finance_ledger_entries (
      id, transaction_id, class_id, account_id, amount,
      balance_after, account_revision_after, created_at
    ) VALUES (
      'entry-position-fund-wallet', 'transaction-position-fund',
      'class-position', 'finance:student:student-position:wallet',
      1000000000, 1000000000, 1, 20
    );
    INSERT INTO finance_ledger_entries (
      id, transaction_id, class_id, account_id, amount,
      balance_after, account_revision_after, created_at
    ) VALUES (
      'entry-position-fund-issuance', 'transaction-position-fund',
      'class-position', 'finance:class:class-position:issuance',
      -1000000000, -1000000000, 1, 20
    );
    UPDATE finance_transactions
    SET status = 'posted', posted_at = 20
    WHERE id = 'transaction-position-fund';
  `);
}

function buyMillionShares(configPath, persistPath) {
  executeSql(configPath, persistPath, `
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
      'trade-position-buy', 'class-position', 'stock-position', 0,
      0, 1, 1, 0,
      'student-position', 'finance:student:student-position:wallet',
      1, 2, 'buy', 1000000, 1000, 0, 1000,
      1000000000, 0, 0, -1000000000,
      2000000, 1000000, 0, 1000000, 0, 1000000000,
      0, 1, 0, 0, 'pending',
      'stock-position-migration-buy', 'payload:position:buy', 30
    );
    INSERT INTO finance_stock_holdings (
      id, class_id, stock_id, student_id, wallet_account_id,
      quantity, cost_basis, revision, last_trade_id, created_at, updated_at
    ) VALUES (
      'holding-position', 'class-position', 'stock-position',
      'student-position', 'finance:student:student-position:wallet',
      1000000, 1000000000, 1, 'trade-position-buy', 30, 30
    );
    UPDATE finance_stocks
    SET available_shares = 1000000, inventory_revision = 1,
        last_trade_id = 'trade-position-buy', updated_at = 30
    WHERE id = 'stock-position' AND class_id = 'class-position';
    INSERT INTO finance_transactions (
      id, class_id, status, transaction_type, description,
      idempotency_key, payload_hash, source_type, source_id,
      actor_type, actor_label, created_at
    ) VALUES (
      'transaction-position-buy', 'class-position', 'pending',
      'stock_buy', 'Buy the legacy migration position',
      'stock-trade:trade-position-buy:ledger', 'tx-hash:position:buy',
      'stock_trade', 'trade-position-buy', 'system', 'Stock system', 30
    );
    INSERT INTO finance_ledger_entries (
      id, transaction_id, class_id, account_id, amount,
      balance_after, account_revision_after, created_at
    ) VALUES (
      'entry-position-buy-wallet', 'transaction-position-buy',
      'class-position', 'finance:student:student-position:wallet',
      -1000000000, 0, 2, 30
    );
    INSERT INTO finance_ledger_entries (
      id, transaction_id, class_id, account_id, amount,
      balance_after, account_revision_after, created_at
    ) VALUES (
      'entry-position-buy-issuance', 'transaction-position-buy',
      'class-position', 'finance:class:class-position:issuance',
      1000000000, 0, 2, 30
    );
    UPDATE finance_transactions
    SET status = 'posted', posted_at = 30
    WHERE id = 'transaction-position-buy';
    UPDATE finance_stock_trades
    SET status = 'posted',
        posted_transaction_id = 'transaction-position-buy',
        transaction_payload_hash = 'tx-hash:position:buy', posted_at = 30
    WHERE id = 'trade-position-buy';
  `);
}

function sellOneHundredThousandShares(configPath, persistPath) {
  executeSql(configPath, persistPath, `
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
      'trade-position-partial-sell', 'class-position', 'stock-position', 2,
      1, 2, 1, 0,
      'student-position', 'finance:student:student-position:wallet',
      2, 3, 'sell', 100000, 900, 0, 900,
      90000000, 0, 0, 90000000,
      1000000, 1100000, 1000000, 900000,
      1000000000, 900000000, 1, 2,
      100000000, -10000000, 'pending',
      'stock-position-migration-sell', 'payload:position:sell', 60
    );
    UPDATE finance_stock_holdings
    SET quantity = 900000, cost_basis = 900000000, revision = 2,
        last_trade_id = 'trade-position-partial-sell', updated_at = 60
    WHERE id = 'holding-position' AND class_id = 'class-position'
      AND revision = 1;
    UPDATE finance_stocks
    SET available_shares = 1100000, inventory_revision = 2,
        last_trade_id = 'trade-position-partial-sell', updated_at = 60
    WHERE id = 'stock-position' AND class_id = 'class-position'
      AND inventory_revision = 1;
    INSERT INTO finance_transactions (
      id, class_id, status, transaction_type, description,
      idempotency_key, payload_hash, source_type, source_id,
      actor_type, actor_label, created_at
    ) VALUES (
      'transaction-position-partial-sell', 'class-position', 'pending',
      'stock_sell', 'Sell part of the legacy migration position',
      'stock-trade:trade-position-partial-sell:ledger',
      'tx-hash:position:sell', 'stock_trade',
      'trade-position-partial-sell', 'system', 'Stock system', 60
    );
    INSERT INTO finance_ledger_entries (
      id, transaction_id, class_id, account_id, amount,
      balance_after, account_revision_after, created_at
    ) VALUES (
      'entry-position-sell-wallet', 'transaction-position-partial-sell',
      'class-position', 'finance:student:student-position:wallet',
      90000000, 90000000, 3, 60
    );
    INSERT INTO finance_ledger_entries (
      id, transaction_id, class_id, account_id, amount,
      balance_after, account_revision_after, created_at
    ) VALUES (
      'entry-position-sell-issuance', 'transaction-position-partial-sell',
      'class-position', 'finance:class:class-position:issuance',
      -90000000, -90000000, 3, 60
    );
    UPDATE finance_transactions
    SET status = 'posted', posted_at = 60
    WHERE id = 'transaction-position-partial-sell';
    UPDATE finance_stock_trades
    SET status = 'posted',
        posted_transaction_id = 'transaction-position-partial-sell',
        transaction_payload_hash = 'tx-hash:position:sell', posted_at = 60
    WHERE id = 'trade-position-partial-sell';
  `);
}

test("0019 preserves an oversized legacy stock position and only permits safe recovery", {
  timeout: 120_000,
}, async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "siklassroom-stock-position-migration-"),
  );
  const migrationsPath = path.join(temporaryRoot, "migrations");
  const persistPath = path.join(temporaryRoot, "d1");
  const configPath = path.join(temporaryRoot, "wrangler.jsonc");
  try {
    const initialMigrations = await copyMigrationsThrough(migrationsPath, 18);
    assert.equal(initialMigrations.at(-1), "0018_stock-emergency-liquidation.sql");
    await writeFile(configPath, JSON.stringify({
      name: "stock-position-migration-test",
      compatibility_date: "2026-05-22",
      d1_databases: [{
        binding: "DB",
        database_name: "stock-position-migration-test",
        database_id: "45ab94b4-5577-47f2-a69f-d011f93bd3f8",
        migrations_dir: "./migrations",
      }],
    }, null, 2));

    runWrangler(configPath, [
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      `--persist-to=${persistPath}`,
    ]);

    executeSql(configPath, persistPath, `
      INSERT INTO teachers (
        id, email, password_hash, status, email_verified_at,
        teacher_access_status, teacher_access_verified_at, school_id,
        created_at, updated_at
      ) VALUES (
        'teacher-position', 'teacher-position@test.local', 'hash', 'active', 1,
        'invite_verified', 1, 'school-position', 1, 1
      );
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized, school_id,
        school_year, grade, class_number, status, created_at, updated_at
      ) VALUES (
        'class-position', 'teacher-position', 'Migration School',
        'migration school', 'school-position', 2099, 6, 8, 'active', 1, 1
      );
      INSERT INTO students (
        id, class_id, student_number, official_name, status,
        created_at, updated_at
      ) VALUES (
        'student-position', 'class-position', 1, 'Position Student',
        'active', 1, 1
      );
      INSERT INTO finance_stocks (
        id, class_id, name, symbol, description,
        initial_price, current_price, previous_price,
        total_shares, available_shares, max_shares_per_student,
        status, revision, inventory_revision, last_trade_id,
        created_by_teacher_id, updated_by_actor_type,
        updated_by_teacher_id, created_at, updated_at
      ) VALUES (
        'stock-position', 'class-position', 'Migration Company', 'MIG',
        'Legacy oversized position test', 1000, 1000, 1000,
        2000000, 2000000, 1000000, 'active', 0, 0, NULL,
        'teacher-position', 'teacher', 'teacher-position', 10, 10
      );
      INSERT INTO finance_stock_events (
        id, class_id, stock_id, revision, action, reason,
        idempotency_key, payload_hash, stock_snapshot_json,
        actor_type, actor_teacher_id, created_at
      ) VALUES (
        'stock-position-issued', 'class-position', 'stock-position', 0,
        'issued', 'Initial issue', 'stock-position-event-issued',
        'hash:stock:position:issued', '{"price":1000}',
        'teacher', 'teacher-position', 10
      );
      UPDATE finance_stock_markets
      SET is_open = 1, buy_fee_bps = 0, sell_fee_bps = 0,
          buy_spread = 0, sell_spread = 0, next_tick_at = 1000,
          revision = 1, updated_by_teacher_id = 'teacher-position',
          updated_at = 15
      WHERE class_id = 'class-position';
    `);
    fundWallet(configPath, persistPath);
    buyMillionShares(configPath, persistPath);
    executeSql(configPath, persistPath, `
      UPDATE finance_stocks
      SET current_price = 1100, previous_price = 1000, revision = 1,
          updated_by_actor_type = 'teacher',
          updated_by_teacher_id = 'teacher-position', updated_at = 40
      WHERE id = 'stock-position' AND class_id = 'class-position';
      INSERT INTO finance_stock_events (
        id, class_id, stock_id, revision, action, reason,
        idempotency_key, payload_hash, previous_snapshot_json,
        stock_snapshot_json, actor_type, actor_teacher_id, created_at
      ) VALUES (
        'stock-position-price-1100', 'class-position', 'stock-position', 1,
        'price_changed', 'Legacy price increase',
        'stock-position-event-price-1100', 'hash:stock:position:price:1100',
        '{"price":1000}', '{"price":1100,"marketRevision":1}',
        'teacher', 'teacher-position', 40
      );
    `);

    const beforeUpgrade = lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT
         stock.current_price, stock.previous_price, stock.revision,
         stock.available_shares, stock.inventory_revision,
         holding.quantity, holding.cost_basis, holding.revision AS holding_revision,
         holding.quantity * stock.current_price AS market_value,
         wallet.balance AS wallet_balance, wallet.revision AS wallet_revision,
         (SELECT COUNT(*) FROM finance_stock_trades) AS trade_count,
         (SELECT COUNT(*) FROM finance_transactions) AS transaction_count,
         (SELECT COUNT(*) FROM finance_ledger_entries) AS entry_count
       FROM finance_stocks stock
       JOIN finance_stock_holdings holding ON holding.stock_id = stock.id
       JOIN finance_accounts wallet ON wallet.id = holding.wallet_account_id
       WHERE stock.id = 'stock-position';`,
    ));
    assert.deepEqual(beforeUpgrade, [{
      current_price: 1100,
      previous_price: 1000,
      revision: 1,
      available_shares: 1000000,
      inventory_revision: 1,
      quantity: 1000000,
      cost_basis: 1000000000,
      holding_revision: 1,
      market_value: 1100000000,
      wallet_balance: 0,
      wallet_revision: 2,
      trade_count: 1,
      transaction_count: 2,
      entry_count: 4,
    }]);

    await copyFile(
      path.join(drizzlePath, "0019_stock-position-value-limit.sql"),
      path.join(migrationsPath, "0019_stock-position-value-limit.sql"),
    );
    runWrangler(configPath, [
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      `--persist-to=${persistPath}`,
    ]);

    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT name FROM d1_migrations
       WHERE name = '0019_stock-position-value-limit.sql';`,
    )), [{ name: "0019_stock-position-value-limit.sql" }]);
    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT
         stock.current_price, stock.previous_price, stock.revision,
         stock.available_shares, stock.inventory_revision,
         holding.quantity, holding.cost_basis, holding.revision AS holding_revision,
         holding.quantity * stock.current_price AS market_value,
         wallet.balance AS wallet_balance, wallet.revision AS wallet_revision,
         (SELECT COUNT(*) FROM finance_stock_trades) AS trade_count,
         (SELECT COUNT(*) FROM finance_transactions) AS transaction_count,
         (SELECT COUNT(*) FROM finance_ledger_entries) AS entry_count
       FROM finance_stocks stock
       JOIN finance_stock_holdings holding ON holding.stock_id = stock.id
       JOIN finance_accounts wallet ON wallet.id = holding.wallet_account_id
       WHERE stock.id = 'stock-position';`,
    )), beforeUpgrade);

    const unsafeIncrease = executeSql(
      configPath,
      persistPath,
      `UPDATE finance_stocks
       SET current_price = 1200, previous_price = 1100, revision = 2,
           updated_by_actor_type = 'teacher',
           updated_by_teacher_id = 'teacher-position', updated_at = 50
       WHERE id = 'stock-position' AND class_id = 'class-position';`,
      { expectSuccess: false },
    );
    assert.match(unsafeIncrease.output, /FINANCE_STOCK_POSITION_VALUE_LIMIT/u);

    executeSql(configPath, persistPath, `
      UPDATE finance_stocks
      SET current_price = 900, previous_price = 1100, revision = 2,
          updated_by_actor_type = 'teacher',
          updated_by_teacher_id = 'teacher-position', updated_at = 50
      WHERE id = 'stock-position' AND class_id = 'class-position';
      INSERT INTO finance_stock_events (
        id, class_id, stock_id, revision, action, reason,
        idempotency_key, payload_hash, previous_snapshot_json,
        stock_snapshot_json, actor_type, actor_teacher_id, created_at
      ) VALUES (
        'stock-position-price-900', 'class-position', 'stock-position', 2,
        'price_changed', 'Safe recovery price decrease',
        'stock-position-event-price-900', 'hash:stock:position:price:900',
        '{"price":1100}', '{"price":900,"marketRevision":1}',
        'teacher', 'teacher-position', 50
      );
    `);
    sellOneHundredThousandShares(configPath, persistPath);

    executeSql(configPath, persistPath, `
      UPDATE finance_stocks
      SET current_price = 1100, previous_price = 900, revision = 3,
          updated_by_actor_type = 'teacher',
          updated_by_teacher_id = 'teacher-position', updated_at = 70
      WHERE id = 'stock-position' AND class_id = 'class-position';
      INSERT INTO finance_stock_events (
        id, class_id, stock_id, revision, action, reason,
        idempotency_key, payload_hash, previous_snapshot_json,
        stock_snapshot_json, actor_type, actor_teacher_id, created_at
      ) VALUES (
        'stock-position-price-recovered', 'class-position', 'stock-position', 3,
        'price_changed', 'Safe price increase after partial sale',
        'stock-position-event-price-recovered',
        'hash:stock:position:price:recovered',
        '{"price":900}', '{"price":1100,"marketRevision":1}',
        'teacher', 'teacher-position', 70
      );
    `);

    const unsafeBuy = executeSql(
      configPath,
      persistPath,
      `INSERT INTO finance_stock_trades (
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
         'trade-position-unsafe-buy', 'class-position', 'stock-position', 3,
         2, 3, 1, 0,
         'student-position', 'finance:student:student-position:wallet',
         3, 4, 'buy', 10000, 1100, 0, 1100,
         11000000, 0, 0, -11000000,
         1100000, 1090000, 900000, 910000,
         900000000, 911000000, 2, 3, 0, 0, 'pending',
         'stock-position-migration-unsafe-buy',
         'payload:position:unsafe:buy', 80
       );`,
      { expectSuccess: false },
    );
    assert.match(unsafeBuy.output, /FINANCE_STOCK_POSITION_VALUE_LIMIT/u);

    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT
         stock.current_price, stock.previous_price, stock.revision,
         stock.available_shares, stock.inventory_revision,
         holding.quantity, holding.cost_basis,
         holding.revision AS holding_revision,
         holding.quantity * stock.current_price AS market_value,
         wallet.balance AS wallet_balance, wallet.revision AS wallet_revision,
         issuance.balance AS issuance_balance,
         (SELECT COUNT(*) FROM finance_stock_trades) AS trade_count,
         (SELECT COUNT(*) FROM finance_transactions) AS transaction_count,
         (SELECT COUNT(*) FROM finance_ledger_entries) AS entry_count,
         (SELECT COUNT(*) FROM finance_stock_trades
          WHERE id = 'trade-position-unsafe-buy') AS rejected_trade_count
       FROM finance_stocks stock
       JOIN finance_stock_holdings holding ON holding.stock_id = stock.id
       JOIN finance_accounts wallet ON wallet.id = holding.wallet_account_id
       JOIN finance_accounts issuance
         ON issuance.class_id = stock.class_id
        AND issuance.account_type = 'class_issuance'
       WHERE stock.id = 'stock-position';`,
    )), [{
      current_price: 1100,
      previous_price: 900,
      revision: 3,
      available_shares: 1100000,
      inventory_revision: 2,
      quantity: 900000,
      cost_basis: 900000000,
      holding_revision: 2,
      market_value: 990000000,
      wallet_balance: 90000000,
      wallet_revision: 3,
      issuance_balance: -90000000,
      trade_count: 2,
      transaction_count: 3,
      entry_count: 6,
      rejected_trade_count: 0,
    }]);
    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      "PRAGMA foreign_key_check;",
    )), []);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
