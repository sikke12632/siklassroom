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

test("0030 marks ambiguous legacy news links without consuming newer news", {
  timeout: 120_000,
}, async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "siklassroom-stock-news-application-migration-"),
  );
  const migrationsPath = path.join(temporaryRoot, "migrations");
  const persistPath = path.join(temporaryRoot, "d1");
  const configPath = path.join(temporaryRoot, "wrangler.jsonc");
  try {
    const initialMigrations = await copyMigrationsThrough(migrationsPath, 29);
    assert.match(initialMigrations.at(-1), /^0029_.+\.sql$/u);
    await writeFile(configPath, JSON.stringify({
      name: "stock-news-application-migration-test",
      compatibility_date: "2026-05-22",
      d1_databases: [{
        binding: "DB",
        database_name: "stock-news-application-migration-test",
        database_id: "4eff3b48-7f40-44f1-896e-024a91f9bdbd",
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
        'teacher-news-application-migration',
        'teacher-news-application-migration@test.local',
        'hash', 'active', 1, 1
      );
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized,
        school_year, grade, class_number, status, created_at, updated_at
      ) VALUES (
        'class-news-application-migration',
        'teacher-news-application-migration',
        'Migration School', 'migration school',
        2099, 6, 11, 'active', 1, 1
      );
      INSERT INTO finance_stocks (
        id, class_id, name, symbol, description,
        initial_price, current_price, previous_price,
        total_shares, available_shares, max_shares_per_student,
        status, revision, inventory_revision, last_trade_id,
        created_by_teacher_id, updated_by_actor_type,
        updated_by_teacher_id, created_at, updated_at
      ) VALUES (
        'stock-news-application-migration',
        'class-news-application-migration',
        'Legacy News Company', 'LEGACYNEWS', 'Migration fixture',
        1000, 1000, 1000, 20, 20, 10, 'active', 0, 0, NULL,
        'teacher-news-application-migration', 'teacher',
        'teacher-news-application-migration', 10, 10
      );
      INSERT INTO finance_stock_events (
        id, class_id, stock_id, revision, action, reason,
        idempotency_key, payload_hash, previous_snapshot_json,
        stock_snapshot_json, actor_type, actor_teacher_id, created_at
      ) VALUES (
        'stock-news-application-issued', 'class-news-application-migration',
        'stock-news-application-migration', 0, 'issued', 'Initial issue',
        'stock:news-application:issued', 'hash:stock:news-application:issued',
        NULL, '{"currentPrice":1000,"revision":0}',
        'teacher', 'teacher-news-application-migration', 10
      );
      INSERT INTO finance_stock_news (
        id, class_id, title, content, impact_bps, status, revision,
        idempotency_key, payload_hash, created_by_teacher_id,
        updated_by_actor_type, updated_by_teacher_id,
        created_at, expires_at, updated_at
      ) VALUES
        (
          'legacy-news-same-time', 'class-news-application-migration',
          'Same-time legacy news', 'Its exact historical link is ambiguous.',
          250, 'active', 0, 'stock-news:create:legacy-same-time',
          'hash:stock-news:create:legacy-same-time',
          'teacher-news-application-migration', 'teacher',
          'teacher-news-application-migration', 100, 1000, 100
        ),
        (
          'legacy-news-still-pending', 'class-news-application-migration',
          'Newer pending news', 'It must remain available for a future tick.',
          -100, 'active', 0, 'stock-news:create:legacy-still-pending',
          'hash:stock-news:create:legacy-still-pending',
          'teacher-news-application-migration', 'teacher',
          'teacher-news-application-migration', 200, 1000, 200
        );
      UPDATE finance_stocks
      SET current_price = 1100, previous_price = 1000, revision = 1,
          updated_by_actor_type = 'teacher',
          updated_by_teacher_id = 'teacher-news-application-migration',
          updated_at = 100
      WHERE id = 'stock-news-application-migration';
      INSERT INTO finance_stock_events (
        id, class_id, stock_id, revision, action, reason,
        idempotency_key, payload_hash, previous_snapshot_json,
        stock_snapshot_json, actor_type, actor_teacher_id, created_at
      ) VALUES (
        'stock-news-application-tick', 'class-news-application-migration',
        'stock-news-application-migration', 1, 'price_changed',
        'Legacy tick', 'stock:news-application:tick',
        'hash:stock:news-application:tick',
        '{"currentPrice":1000,"revision":0}',
        '{"currentPrice":1100,"revision":1,"marketRevision":0}',
        'teacher', 'teacher-news-application-migration', 100
      );
    `);

    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'table'
         AND name = 'finance_stock_news_applications';`,
    )), [{ count: 0 }]);

    const migrationName = (await readdir(drizzlePath))
      .find((name) => /^0030_.+\.sql$/u.test(name));
    assert.ok(migrationName, "The 0030 stock-news application migration is required.");
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
      `SELECT news_id, link_status, stock_event_id, stock_event_revision,
              impact_bps, applied_at
       FROM finance_stock_news_applications
       ORDER BY news_id;`,
    )), [{
      news_id: "legacy-news-same-time",
      link_status: "legacy_inferred",
      stock_event_id: "stock-news-application-tick",
      stock_event_revision: 1,
      impact_bps: 250,
      applied_at: 100,
    }]);
    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      "PRAGMA foreign_key_check;",
    )), []);
    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT key FROM system_migrations
       WHERE key = 'finance-stock-news-applications-v1';`,
    )), [{ key: "finance-stock-news-applications-v1" }]);
    assert.ok(lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT name FROM d1_migrations WHERE name = '${migrationName}';`,
    )).some((row) => row.name === migrationName));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
