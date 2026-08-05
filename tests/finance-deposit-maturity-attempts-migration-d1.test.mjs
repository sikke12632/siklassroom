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

test("0032 preserves the latest legacy maturity failure and captures later attempts", {
  timeout: 120_000,
}, async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "siklassroom-deposit-maturity-attempts-migration-"),
  );
  const migrationsPath = path.join(temporaryRoot, "migrations");
  const persistPath = path.join(temporaryRoot, "d1");
  const configPath = path.join(temporaryRoot, "wrangler.jsonc");
  try {
    const initialMigrations = await copyMigrationsThrough(migrationsPath, 31);
    assert.match(initialMigrations.at(-1), /^0031_.+\.sql$/u);
    await writeFile(configPath, JSON.stringify({
      name: "deposit-maturity-attempts-migration-test",
      compatibility_date: "2026-05-22",
      d1_databases: [{
        binding: "DB",
        database_name: "deposit-maturity-attempts-migration-test",
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
        'teacher-maturity-attempt-migration',
        'teacher-maturity-attempt-migration@test.local',
        'hash', 'active', 1, 1
      );
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized,
        school_year, grade, class_number, status, created_at, updated_at
      ) VALUES (
        'class-maturity-attempt-migration',
        'teacher-maturity-attempt-migration',
        'Migration School', 'migration school',
        2099, 6, 13, 'active', 1, 1
      );
      INSERT INTO students (
        id, class_id, student_number, official_name, status,
        created_at, updated_at
      ) VALUES (
        'student-maturity-attempt-migration',
        'class-maturity-attempt-migration', 1, 'Migration Student',
        'active', 1, 1
      );
      INSERT INTO finance_deposit_products (
        id, class_id, name, description, term_weeks,
        maturity_interest_bps, early_interest_bps, min_amount, max_amount,
        is_open, revision, created_by_teacher_id, updated_by_teacher_id,
        created_at, updated_at
      ) VALUES (
        'product-maturity-attempt-migration',
        'class-maturity-attempt-migration', 'Migration Savings',
        'Legacy retry migration fixture', 1, 500, 0, 100, 1000,
        1, 0, 'teacher-maturity-attempt-migration',
        'teacher-maturity-attempt-migration', 10, 10
      );
      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_label, created_at
      ) VALUES (
        'tx-maturity-attempt-migration', 'class-maturity-attempt-migration',
        'pending', 'deposit_open', 'Migration contract fixture',
        'tx:maturity-attempt:migration', 'hash:tx:maturity-attempt:migration',
        'deposit_contract', 'contract-maturity-attempt-migration',
        'system', 'Migration system', 1000
      );
      DROP TRIGGER finance_deposit_contracts_insert_guard;
      INSERT INTO finance_deposit_contracts (
        id, class_id, product_id, product_revision, student_id,
        wallet_account_id, principal, product_name_snapshot,
        term_weeks_snapshot, maturity_interest_bps_snapshot,
        early_interest_bps_snapshot, maturity_interest, early_interest,
        maturity_payout, early_payout, opened_at, matures_at,
        idempotency_key, payload_hash, posted_transaction_id,
        transaction_payload_hash, created_at
      ) VALUES (
        'contract-maturity-attempt-migration',
        'class-maturity-attempt-migration',
        'product-maturity-attempt-migration', 0,
        'student-maturity-attempt-migration',
        'finance:student:student-maturity-attempt-migration:wallet',
        100, 'Migration Savings', 1, 500, 0, 5, 0, 105, 100,
        1000, 604801000, 'contract:maturity-attempt:migration',
        'hash:contract:maturity-attempt:migration',
        'tx-maturity-attempt-migration',
        'hash:tx:maturity-attempt:migration', 1000
      );
      INSERT INTO finance_deposit_maturity_retries (
        contract_id, class_id, attempt_count, next_attempt_at,
        last_error_code, last_failed_at, created_at, updated_at
      ) VALUES (
        'contract-maturity-attempt-migration',
        'class-maturity-attempt-migration', 3, 7000,
        'FINANCE_LEGACY_FAILURE', 6000, 2000, 6000
      );
    `);

    const migrationName = (await readdir(drizzlePath))
      .find((name) => /^0032_.+\.sql$/u.test(name));
    assert.ok(migrationName, "The 0032 maturity-attempt migration is required.");
    await copyFile(
      path.join(drizzlePath, migrationName),
      path.join(migrationsPath, migrationName),
    );
    runWrangler(configPath, [
      "d1", "migrations", "apply", "DB", "--local",
      `--persist-to=${persistPath}`,
    ]);

    executeSql(configPath, persistPath, `
      UPDATE finance_deposit_maturity_retries
      SET attempt_count = 4, next_attempt_at = 10000,
          last_error_code = 'FINANCE_NEW_FAILURE', last_failed_at = 8000,
          updated_at = 8000
      WHERE contract_id = 'contract-maturity-attempt-migration';
    `);
    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT attempt_count, error_code, failed_at, next_attempt_at,
              capture_status
       FROM finance_deposit_maturity_attempts
       ORDER BY attempt_count;`,
    )), [
      {
        attempt_count: 3,
        error_code: "FINANCE_LEGACY_FAILURE",
        failed_at: 6000,
        next_attempt_at: 7000,
        capture_status: "legacy_latest",
      },
      {
        attempt_count: 4,
        error_code: "FINANCE_NEW_FAILURE",
        failed_at: 8000,
        next_attempt_at: 10000,
        capture_status: "exact",
      },
    ]);
    const immutable = executeSql(
      configPath,
      persistPath,
      "DELETE FROM finance_deposit_maturity_attempts WHERE attempt_count = 3;",
      { expectSuccess: false },
    );
    assert.match(immutable.output, /FINANCE_DEPOSIT_MATURITY_ATTEMPT_IMMUTABLE/);
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
