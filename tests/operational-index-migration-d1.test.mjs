import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerPath = path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const migrationPath = path.join(projectRoot, "drizzle", "0040_operational_indexes.sql");

function runWrangler(args) {
  const result = spawnSync(process.execPath, [wranglerPath, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`.slice(-6000));
  return result;
}

function executeSql(persistPath, sql) {
  const result = runWrangler([
    "d1", "execute", "DB", "--local", `--persist-to=${persistPath}`,
    "--json", "--command", sql,
  ]);
  return JSON.parse(result.stdout);
}

test("0040 can follow runtime fallback index creation without an already-exists failure", async () => {
  const persistPath = await mkdtemp(path.join(tmpdir(), "siklassroom-operational-index-"));
  try {
    executeSql(persistPath, `
      CREATE TABLE sessions (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      CREATE TABLE teacher_password_resets (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      CREATE TABLE registration_tokens (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      CREATE TABLE audit_logs (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
      CREATE TABLE system_admin_sessions (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      CREATE INDEX sessions_expires_idx ON sessions(expires_at);
      CREATE INDEX teacher_password_resets_expires_idx ON teacher_password_resets(expires_at);
      CREATE INDEX registration_tokens_expires_idx ON registration_tokens(expires_at);
      CREATE INDEX audit_logs_created_idx ON audit_logs(created_at);
      CREATE INDEX system_admin_sessions_expires_idx ON system_admin_sessions(expires_at);
    `);

    runWrangler([
      "d1", "execute", "DB", "--local", `--persist-to=${persistPath}`,
      `--file=${migrationPath}`,
    ]);

    const rows = executeSql(persistPath, `
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name IN (
        'sessions_expires_idx',
        'teacher_password_resets_expires_idx',
        'registration_tokens_expires_idx',
        'audit_logs_created_idx',
        'system_admin_sessions_expires_idx'
      ) ORDER BY name;
    `).at(-1)?.results;
    assert.deepEqual(rows, [
      { name: "audit_logs_created_idx" },
      { name: "registration_tokens_expires_idx" },
      { name: "sessions_expires_idx" },
      { name: "system_admin_sessions_expires_idx" },
      { name: "teacher_password_resets_expires_idx" },
    ]);
  } finally {
    await rm(persistPath, { recursive: true, force: true });
  }
});
