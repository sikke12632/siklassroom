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
    assert.equal(result.status, 0, `Wrangler command failed.\n${output.slice(-6000)}`);
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

test("0028 backfills immutable publication and terminal stock-news history", {
  timeout: 120_000,
}, async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "siklassroom-stock-news-migration-"),
  );
  const migrationsPath = path.join(temporaryRoot, "migrations");
  const persistPath = path.join(temporaryRoot, "d1");
  const configPath = path.join(temporaryRoot, "wrangler.jsonc");
  try {
    const initialMigrations = await copyMigrationsThrough(migrationsPath, 27);
    assert.equal(
      initialMigrations.at(-1),
      "0027_finance_account_status_guard.sql",
    );
    await writeFile(configPath, JSON.stringify({
      name: "stock-news-migration-test",
      compatibility_date: "2026-05-22",
      d1_databases: [{
        binding: "DB",
        database_name: "stock-news-migration-test",
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
        id, email, password_hash, status, created_at, updated_at
      ) VALUES (
        'teacher-news-migration', 'teacher-news-migration@test.local',
        'hash', 'active', 1, 1
      );
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized,
        school_year, grade, class_number, status, created_at, updated_at
      ) VALUES (
        'class-news-migration', 'teacher-news-migration',
        'Migration School', 'migration school',
        2099, 6, 9, 'active', 1, 1
      );
      INSERT INTO finance_stock_news (
        id, class_id, title, content, impact_bps, status, revision,
        idempotency_key, payload_hash, created_by_teacher_id,
        updated_by_actor_type, updated_by_teacher_id,
        created_at, expires_at, updated_at
      ) VALUES
        ('legacy-news-active', 'class-news-migration', 'Active legacy news',
         'Still active during migration.', 100, 'active', 0,
         'legacy-news-create:active', 'hash:legacy-news:create:active',
         'teacher-news-migration', 'teacher', 'teacher-news-migration',
         100, 1000, 100),
        ('legacy-news-cancelled', 'class-news-migration',
         'Cancelled legacy news', 'Cancelled before migration.', 200,
         'active', 0, 'legacy-news-create:cancelled',
         'hash:legacy-news:create:cancelled', 'teacher-news-migration',
         'teacher', 'teacher-news-migration', 200, 1200, 200),
        ('legacy-news-expired', 'class-news-migration', 'Expired legacy news',
         'Expired before migration.', -300, 'active', 0,
         'legacy-news-create:expired', 'hash:legacy-news:create:expired',
         'teacher-news-migration', 'teacher', 'teacher-news-migration',
         300, 400, 300);
      UPDATE finance_stock_news
      SET status = 'cancelled', revision = 1,
          cancellation_reason = 'Legacy cancellation reason',
          cancellation_idempotency_key = 'legacy-news-cancel:cancelled',
          cancellation_payload_hash = 'hash:legacy-news:cancel:cancelled',
          cancelled_at = 500, updated_at = 500
      WHERE id = 'legacy-news-cancelled';
      UPDATE finance_stock_news
      SET status = 'expired', revision = 1,
          updated_by_actor_type = 'system', updated_by_teacher_id = NULL,
          updated_at = 600
      WHERE id = 'legacy-news-expired';
    `);

    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'table' AND name = 'finance_stock_news_events';`,
    )), [{ count: 0 }]);

    await copyFile(
      path.join(drizzlePath, "0028_stock_news_events.sql"),
      path.join(migrationsPath, "0028_stock_news_events.sql"),
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
      `SELECT news_id, revision, action, reason, actor_type,
              actor_teacher_id, created_at
       FROM finance_stock_news_events
       ORDER BY news_id, revision;`,
    )), [
      {
        news_id: "legacy-news-active",
        revision: 0,
        action: "published",
        reason: "주식 뉴스를 게시했습니다.",
        actor_type: "teacher",
        actor_teacher_id: "teacher-news-migration",
        created_at: 100,
      },
      {
        news_id: "legacy-news-cancelled",
        revision: 0,
        action: "published",
        reason: "주식 뉴스를 게시했습니다.",
        actor_type: "teacher",
        actor_teacher_id: "teacher-news-migration",
        created_at: 200,
      },
      {
        news_id: "legacy-news-cancelled",
        revision: 1,
        action: "cancelled",
        reason: "Legacy cancellation reason",
        actor_type: "teacher",
        actor_teacher_id: "teacher-news-migration",
        created_at: 500,
      },
      {
        news_id: "legacy-news-expired",
        revision: 0,
        action: "published",
        reason: "주식 뉴스를 게시했습니다.",
        actor_type: "teacher",
        actor_teacher_id: "teacher-news-migration",
        created_at: 300,
      },
      {
        news_id: "legacy-news-expired",
        revision: 1,
        action: "expired",
        reason: "설정한 공개 시간이 끝났습니다.",
        actor_type: "system",
        actor_teacher_id: null,
        created_at: 600,
      },
    ]);
    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      `SELECT name FROM d1_migrations
       WHERE name = '0028_stock_news_events.sql';`,
    )), [{ name: "0028_stock_news_events.sql" }]);
    assert.deepEqual(lastResults(executeSql(
      configPath,
      persistPath,
      "PRAGMA foreign_key_check;",
    )), []);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
