import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerPath = path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const migrationPath = path.join(projectRoot, "drizzle", "0014_thick_justice.sql");

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

test("QR 보안 마이그레이션은 기존 강제 재설정 상태를 보존한다", async () => {
  const persistPath = await mkdtemp(path.join(tmpdir(), "siklassroom-registration-migration-"));
  try {
    executeSql(persistPath, `
      CREATE TABLE teachers (id TEXT PRIMARY KEY);
      CREATE TABLE students (
        id TEXT PRIMARY KEY, class_id TEXT NOT NULL, password_hash TEXT,
        status TEXT NOT NULL, qr_generation INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE registration_tokens (
        id TEXT PRIMARY KEY, student_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
        purpose TEXT NOT NULL, generation INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        used_at INTEGER, revoked_at INTEGER, created_at INTEGER NOT NULL
      );
      INSERT INTO teachers (id) VALUES ('teacher-existing');
      INSERT INTO students VALUES
        ('student-reset', 'class-a', 'existing-pin-hash', 'reset_required', 4, 100),
        ('student-incomplete', 'class-a', NULL, 'reset_required', 2, 100);
      INSERT INTO registration_tokens VALUES
        ('token-reset', 'student-reset', 'hash-reset', 'reset', 4, 9999999999999, NULL, NULL, 100),
        ('token-reset-revoked', 'student-reset', 'hash-reset-revoked', 'reset', 4, 9999999999999, NULL, 200, 90),
        ('token-incomplete', 'student-incomplete', 'hash-incomplete', 'reset', 2, 9999999999999, NULL, NULL, 100);
    `);
    runWrangler([
      "d1", "execute", "DB", "--local", `--persist-to=${persistPath}`,
      `--file=${migrationPath}`,
    ]);
    const queried = executeSql(persistPath, `
      SELECT s.id, s.status, s.credential_revision, rt.purpose
      FROM students s JOIN registration_tokens rt ON rt.student_id = s.id
      WHERE rt.revoked_at IS NULL
      ORDER BY s.id;
    `);
    const rows = queried.at(-1)?.results;
    assert.deepEqual(rows, [
      { id: "student-incomplete", status: "pending", credential_revision: 0, purpose: "activate" },
      { id: "student-reset", status: "reset_required", credential_revision: 0, purpose: "reset" },
    ]);
    const indexDefinition = executeSql(persistPath, `
      SELECT sql FROM sqlite_master
      WHERE type = 'index' AND name = 'registration_tokens_student_generation_uq';
    `).at(-1)?.results?.[0]?.sql;
    assert.match(indexDefinition, /WHERE\s+"registration_tokens"\."revoked_at"\s+IS\s+NULL/i);
  } finally {
    await rm(persistPath, { recursive: true, force: true });
  }
});
