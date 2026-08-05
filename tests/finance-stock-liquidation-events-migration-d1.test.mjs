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

function runWrangler(configPath, args) {
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
  assert.equal(result.status, 0, `Wrangler command failed.\n${output.slice(-6000)}`);
  return { ...result, output };
}

function executeSql(configPath, persistPath, sql) {
  const result = runWrangler(configPath, [
    "d1",
    "execute",
    "DB",
    "--local",
    `--persist-to=${persistPath}`,
    "--json",
    "--command",
    sql,
  ]);
  return { ...result, data: JSON.parse(result.stdout) };
}

function lastResults(execution) {
  const last = execution.data.at(-1);
  assert.equal(last?.success, true);
  return last.results;
}

async function copyMigrationsThrough(migrationsPath, maximumSequence) {
  await mkdir(migrationsPath, { recursive: true });
  const migrationNames = (await readdir(drizzlePath))
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

test("0029 backfills immutable liquidation start and cancellation history", {
  timeout: 120_000,
}, async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "siklassroom-stock-liquidation-event-migration-"),
  );
  const migrationsPath = path.join(temporaryRoot, "migrations");
  const persistPath = path.join(temporaryRoot, "d1");
  const configPath = path.join(temporaryRoot, "wrangler.jsonc");
  try {
    const initialMigrations = await copyMigrationsThrough(migrationsPath, 28);
    assert.equal(initialMigrations.at(-1), "0028_stock_news_events.sql");
    await writeFile(configPath, JSON.stringify({
      name: "stock-liquidation-event-migration-test",
      compatibility_date: "2026-05-22",
      d1_databases: [{
        binding: "DB",
        database_name: "stock-liquidation-event-migration-test",
        database_id: "de926f2b-e621-4e7b-8781-700298088859",
        migrations_dir: "./migrations",
      }],
    }, null, 2));
    runWrangler(configPath, [
      "d1", "migrations", "apply", "DB", "--local",
      `--persist-to=${persistPath}`,
    ]);

    executeSql(configPath, persistPath, `
      INSERT INTO teachers (
        id, email, password_hash, status, created_at, updated_at
      ) VALUES (
        'teacher-liquidation-migration',
        'teacher-liquidation-migration@test.local', 'hash', 'active', 1, 1
      );
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized,
        school_year, grade, class_number, status, created_at, updated_at
      ) VALUES (
        'class-liquidation-migration', 'teacher-liquidation-migration',
        'Migration School', 'migration school', 2099, 6, 10, 'active', 1, 1
      );
      INSERT INTO students (
        id, class_id, student_number, official_name, status,
        created_at, updated_at
      ) VALUES (
        'student-liquidation-migration', 'class-liquidation-migration',
        1, 'Legacy Student', 'active', 1, 1
      );
      DROP TRIGGER finance_stocks_insert_guard;
      INSERT INTO finance_stocks (
        id, class_id, name, symbol, description,
        initial_price, current_price, previous_price,
        total_shares, available_shares, max_shares_per_student,
        status, revision, inventory_revision, last_trade_id,
        created_by_teacher_id, updated_by_actor_type,
        updated_by_teacher_id, created_at, updated_at
      ) VALUES (
        'stock-liquidation-migration', 'class-liquidation-migration',
        'Legacy Company', 'LEGACY', 'Migration fixture',
        100000000, 100000000, 100000000,
        20, 9, 20, 'active', 0, 0, NULL,
        'teacher-liquidation-migration', 'teacher',
        'teacher-liquidation-migration', 10, 10
      );
      DROP TRIGGER finance_stock_liquidation_operations_insert_guard;
      INSERT INTO finance_stock_liquidation_operations (
        id, class_id, stock_id, student_id, teacher_id,
        root_idempotency_key, payload_hash, origin, intervention_reason,
        status, snapshot_reference_price, snapshot_spread,
        snapshot_unit_price, snapshot_fee_bps,
        snapshot_denomination_step, snapshot_stock_revision,
        snapshot_market_revision, snapshot_finance_settings_revision,
        snapshot_holding_revision, snapshot_wallet_revision,
        snapshot_wallet_balance, snapshot_student_status,
        snapshot_stock_status, snapshot_market_was_open,
        initial_quantity, remaining_quantity, sold_quantity,
        initial_cost_basis, remaining_cost_basis,
        expected_gross_amount, expected_fee_amount, expected_wallet_delta,
        completed_chunk_count, total_gross_amount, total_fee_amount,
        total_wallet_delta, total_cost_basis_removed, total_realized_gain,
        next_chunk_index, last_trade_id, revision,
        created_at, updated_at, completed_at, cancelled_at,
        cancellation_reason, cancellation_idempotency_key,
        cancellation_payload_hash
      ) VALUES (
        'legacy-liquidation-cancelled', 'class-liquidation-migration',
        'stock-liquidation-migration', 'student-liquidation-migration',
        'teacher-liquidation-migration', 'legacy-liquidation-root-request',
        'hash:legacy-liquidation-root-request', 'finance_center',
        'Legacy recovery attempt', 'cancelled',
        100000000, 0, 100000000, 1000, 1, 0, 0, 0, 1, 0, 0,
        'active', 'active', 1, 11, 11, 0, 413, 413,
        1100000000, 110000000, 990000000,
        0, 0, 0, 0, 0, 0, 0, NULL, 1,
        100, 200, NULL, 200, 'Legacy teacher cancellation',
        'legacy-liquidation-cancel-request',
        'hash:legacy-liquidation-cancel-request'
      );
    `);

    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'table'
         AND name = 'finance_stock_liquidation_events';`,
    )), [{ count: 0 }]);

    const migrationName = (await readdir(drizzlePath))
      .find((name) => /^0029_.+\.sql$/u.test(name));
    assert.ok(migrationName, "The 0029 liquidation event migration is required.");
    await copyFile(
      path.join(drizzlePath, migrationName),
      path.join(migrationsPath, migrationName),
    );
    runWrangler(configPath, [
      "d1", "migrations", "apply", "DB", "--local",
      `--persist-to=${persistPath}`,
    ]);

    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT id, revision, action, reason, request_idempotency_key,
              initial_quantity, remaining_quantity, sold_quantity,
              completed_chunk_count, quantity_delta, wallet_delta, created_at
       FROM finance_stock_liquidation_events
       WHERE operation_id = 'legacy-liquidation-cancelled'
       ORDER BY revision, action;`,
    )), [
      {
        id: "finance:stock-liquidation-event:legacy-liquidation-cancelled:0:started",
        revision: 0,
        action: "started",
        reason: "Legacy recovery attempt",
        request_idempotency_key: "legacy-liquidation-root-request",
        initial_quantity: 11,
        remaining_quantity: 11,
        sold_quantity: 0,
        completed_chunk_count: 0,
        quantity_delta: 0,
        wallet_delta: 0,
        created_at: 100,
      },
      {
        id: "finance:stock-liquidation-event:legacy-liquidation-cancelled:1:cancelled",
        revision: 1,
        action: "cancelled",
        reason: "Legacy teacher cancellation",
        request_idempotency_key: "legacy-liquidation-cancel-request",
        initial_quantity: 11,
        remaining_quantity: 11,
        sold_quantity: 0,
        completed_chunk_count: 0,
        quantity_delta: 0,
        wallet_delta: 0,
        created_at: 200,
      },
    ]);
    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      "PRAGMA foreign_key_check;",
    )), []);
    assert.ok(lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT name FROM d1_migrations WHERE name = '${migrationName}';`,
    )).some((row) => row.name === migrationName));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
