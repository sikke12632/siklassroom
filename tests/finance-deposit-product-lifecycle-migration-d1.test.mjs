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
    "d1", "execute", "DB", "--local", `--persist-to=${persistPath}`,
    "--json", "--command", sql,
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

test("0031 backfills request-backed and current-only deposit product history", {
  timeout: 120_000,
}, async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "siklassroom-deposit-product-lifecycle-migration-"),
  );
  const migrationsPath = path.join(temporaryRoot, "migrations");
  const persistPath = path.join(temporaryRoot, "d1");
  const configPath = path.join(temporaryRoot, "wrangler.jsonc");
  try {
    const initialMigrations = await copyMigrationsThrough(migrationsPath, 30);
    assert.match(initialMigrations.at(-1), /^0030_.+\.sql$/u);
    await writeFile(configPath, JSON.stringify({
      name: "deposit-product-lifecycle-migration-test",
      compatibility_date: "2026-05-22",
      d1_databases: [{
        binding: "DB",
        database_name: "deposit-product-lifecycle-migration-test",
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
        'teacher-deposit-product-migration',
        'teacher-deposit-product-migration@test.local',
        'hash', 'active', 1, 1
      );
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized,
        school_year, grade, class_number, status, created_at, updated_at
      ) VALUES (
        'class-deposit-product-migration',
        'teacher-deposit-product-migration',
        'Migration School', 'migration school',
        2099, 6, 12, 'active', 1, 1
      );
      INSERT INTO finance_deposit_products (
        id, class_id, name, description, term_weeks,
        maturity_interest_bps, early_interest_bps, min_amount, max_amount,
        is_open, revision, created_by_teacher_id, updated_by_teacher_id,
        created_at, updated_at
      ) VALUES
        (
          'product-with-request-history', 'class-deposit-product-migration',
          'History Product', 'Existing request events', 4, 500, 100,
          1000, 10000, 1, 0, 'teacher-deposit-product-migration',
          'teacher-deposit-product-migration', 100, 100
        ),
        (
          'product-without-request-history', 'class-deposit-product-migration',
          'Current Only Product', 'No old request event', 2, 200, 0,
          1000, 5000, 1, 0, 'teacher-deposit-product-migration',
          'teacher-deposit-product-migration', 150, 150
        );
      INSERT INTO finance_deposit_product_events (
        id, class_id, product_id, revision, action,
        idempotency_key, payload_hash, product_snapshot_json,
        actor_teacher_id, created_at
      ) VALUES (
        'legacy-product-issued-event', 'class-deposit-product-migration',
        'product-with-request-history', 0, 'issued',
        'deposit-product:legacy:issued', 'hash:deposit-product:legacy:issued',
        '{"description":"Existing request events","earlyInterestBps":100,"isOpen":true,"maturityInterestBps":500,"maxAmount":10000,"minAmount":1000,"name":"History Product","revision":0,"termWeeks":4}',
        'teacher-deposit-product-migration', 100
      );
      UPDATE finance_deposit_products
      SET is_open = 0, revision = 1,
          updated_by_teacher_id = 'teacher-deposit-product-migration',
          updated_at = 200
      WHERE id = 'product-with-request-history';
      INSERT INTO finance_deposit_product_events (
        id, class_id, product_id, revision, action,
        idempotency_key, payload_hash, product_snapshot_json,
        actor_teacher_id, created_at
      ) VALUES (
        'legacy-product-paused-event', 'class-deposit-product-migration',
        'product-with-request-history', 1, 'paused',
        'deposit-product:legacy:paused', 'hash:deposit-product:legacy:paused',
        '{"description":"Existing request events","earlyInterestBps":100,"isOpen":false,"maturityInterestBps":500,"maxAmount":10000,"minAmount":1000,"name":"History Product","revision":1,"termWeeks":4}',
        'teacher-deposit-product-migration', 200
      );
    `);

    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'table'
         AND name = 'finance_deposit_product_lifecycle_events';`,
    )), [{ count: 0 }]);

    const migrationName = (await readdir(drizzlePath))
      .find((name) => /^0031_.+\.sql$/u.test(name));
    assert.ok(migrationName, "The 0031 deposit lifecycle migration is required.");
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
      `SELECT product_id, revision, action, capture_status, source_event_id,
              json_extract(product_snapshot_json, '$.name') AS product_name
       FROM finance_deposit_product_lifecycle_events
       ORDER BY product_id, revision;`,
    )), [
      {
        product_id: "product-with-request-history",
        revision: 0,
        action: "issued",
        capture_status: "legacy_event",
        source_event_id: "legacy-product-issued-event",
        product_name: "History Product",
      },
      {
        product_id: "product-with-request-history",
        revision: 1,
        action: "paused",
        capture_status: "legacy_event",
        source_event_id: "legacy-product-paused-event",
        product_name: "History Product",
      },
      {
        product_id: "product-without-request-history",
        revision: 0,
        action: "issued",
        capture_status: "legacy_current_only",
        source_event_id: null,
        product_name: "Current Only Product",
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
