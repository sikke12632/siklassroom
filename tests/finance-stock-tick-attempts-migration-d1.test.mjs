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

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const drizzlePath = path.join(projectRoot, "drizzle");
const wranglerPath = path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");

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
    assert.equal(result.status, 0, `Wrangler command failed.\n${output.slice(-6000)}`);
  } else {
    assert.notEqual(result.status, 0, "The D1 command should have failed.");
  }
  return { ...result, output };
}

function executeSql(configPath, persistPath, sql, options) {
  const result = runWrangler(configPath, [
    "d1", "execute", "DB", "--local", `--persist-to=${persistPath}`,
    "--json", "--command", sql,
  ], options);
  if (result.status !== 0) return result;
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

test("0033 preserves the latest legacy stock tick failure and later attempts", {
  timeout: 120_000,
}, async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "siklassroom-stock-tick-attempts-migration-"),
  );
  const migrationsPath = path.join(temporaryRoot, "migrations");
  const persistPath = path.join(temporaryRoot, "d1");
  const configPath = path.join(temporaryRoot, "wrangler.jsonc");
  try {
    const initialMigrations = await copyMigrationsThrough(migrationsPath, 32);
    assert.match(initialMigrations.at(-1), /^0032_.+\.sql$/u);
    await writeFile(configPath, JSON.stringify({
      name: "stock-tick-attempts-migration-test",
      compatibility_date: "2026-05-22",
      d1_databases: [{
        binding: "DB",
        database_name: "stock-tick-attempts-migration-test",
        database_id: "0750c65b-c48d-4aa8-b796-25b69c28eb0e",
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
        'teacher-stock-attempt-migration',
        'teacher-stock-attempt-migration@test.local',
        'hash', 'active', 1, 1
      );
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized,
        school_year, grade, class_number, status, created_at, updated_at
      ) VALUES (
        'class-stock-attempt-migration', 'teacher-stock-attempt-migration',
        'Migration School', 'migration school',
        2099, 6, 16, 'active', 1, 1
      );
      INSERT INTO finance_stocks (
        id, class_id, name, symbol, description,
        initial_price, current_price, previous_price,
        total_shares, available_shares, max_shares_per_student,
        status, revision, inventory_revision, last_trade_id,
        created_by_teacher_id, updated_by_actor_type,
        updated_by_teacher_id, created_at, updated_at
      ) VALUES (
        'stock-attempt-migration', 'class-stock-attempt-migration',
        'Migration Stock', 'MIG', 'Legacy retry migration fixture',
        1000, 1000, 1000, 20, 20, 10, 'active', 0, 0, NULL,
        'teacher-stock-attempt-migration', 'teacher',
        'teacher-stock-attempt-migration', 10, 10
      );
      UPDATE finance_stock_markets
      SET is_open = 1, buy_fee_bps = 0, sell_fee_bps = 0,
          buy_spread = 0, sell_spread = 0, market_mood = 'mixed',
          tick_interval_minutes = 10, next_tick_at = 1000,
          revision = 1,
          updated_by_teacher_id = 'teacher-stock-attempt-migration',
          updated_at = 20
      WHERE class_id = 'class-stock-attempt-migration';
      INSERT INTO finance_stock_tick_retries (
        id, class_id, stock_id, stock_revision, market_revision,
        scheduled_tick_at, attempt_count, next_attempt_at,
        last_error_code, last_failed_at, created_at, updated_at
      ) VALUES (
        'legacy-stock-tick-retry', 'class-stock-attempt-migration',
        'stock-attempt-migration', 0, 1, 1000, 3, 7000,
        'FINANCE_LEGACY_STOCK_FAILURE', 6000, 2000, 6000
      );
    `);

    const migrationName = (await readdir(drizzlePath))
      .find((name) => /^0033_.+\.sql$/u.test(name));
    assert.ok(migrationName, "The 0033 stock-tick attempt migration is required.");
    await copyFile(
      path.join(drizzlePath, migrationName),
      path.join(migrationsPath, migrationName),
    );
    runWrangler(configPath, [
      "d1", "migrations", "apply", "DB", "--local",
      `--persist-to=${persistPath}`,
    ]);

    executeSql(configPath, persistPath, `
      UPDATE finance_stock_tick_retries
      SET attempt_count = 4, next_attempt_at = 10000,
          last_error_code = 'FINANCE_NEW_STOCK_FAILURE', last_failed_at = 8000,
          updated_at = 8000
      WHERE id = 'legacy-stock-tick-retry';
    `);
    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT attempt_count, stock_price_snapshot, error_code,
              failed_at, next_attempt_at, capture_status
       FROM finance_stock_tick_attempts ORDER BY attempt_count;`,
    )), [
      {
        attempt_count: 3,
        stock_price_snapshot: 1000,
        error_code: "FINANCE_LEGACY_STOCK_FAILURE",
        failed_at: 6000,
        next_attempt_at: 7000,
        capture_status: "legacy_latest",
      },
      {
        attempt_count: 4,
        stock_price_snapshot: 1000,
        error_code: "FINANCE_NEW_STOCK_FAILURE",
        failed_at: 8000,
        next_attempt_at: 10000,
        capture_status: "exact",
      },
    ]);
    const immutable = executeSql(
      configPath,
      persistPath,
      "DELETE FROM finance_stock_tick_attempts WHERE attempt_count = 3;",
      { expectSuccess: false },
    );
    assert.match(immutable.output, /FINANCE_STOCK_TICK_ATTEMPT_IMMUTABLE/);
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
