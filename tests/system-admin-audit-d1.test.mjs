import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerPath = path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const migrationPath = path.join(projectRoot, "drizzle", "0037_system_admin_audit_append_only.sql");

function runWrangler(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [wranglerPath, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (expectedStatus === 0) {
    assert.equal(result.status, 0, output.slice(-6000));
  } else {
    assert.notEqual(result.status, 0, "The database mutation unexpectedly succeeded.");
  }
  return { ...result, output };
}

function executeSql(persistPath, sql, expectedStatus = 0) {
  return runWrangler([
    "d1", "execute", "DB", "--local", `--persist-to=${persistPath}`,
    "--json", "--command", sql,
  ], expectedStatus);
}

test("0037 이후 시스템 관리자 감사 로그는 추가만 가능하다", async () => {
  const persistPath = await mkdtemp(path.join(tmpdir(), "siklassroom-admin-audit-"));
  try {
    executeSql(persistPath, `
      CREATE TABLE system_admin_audit_logs (
        id TEXT PRIMARY KEY, admin_key TEXT NOT NULL, action TEXT NOT NULL,
        target_type TEXT, target_id TEXT, before_json TEXT, after_json TEXT,
        success INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
      );
    `);
    runWrangler([
      "d1", "execute", "DB", "--local", `--persist-to=${persistPath}`,
      `--file=${migrationPath}`,
    ]);
    executeSql(persistPath, `
      INSERT INTO system_admin_audit_logs
        (id, admin_key, action, success, created_at)
      VALUES ('audit-1', 'primary', 'teacher_access_changed', 1, 100);
    `);

    const update = executeSql(
      persistPath,
      "UPDATE system_admin_audit_logs SET action = 'tampered' WHERE id = 'audit-1';",
      1,
    );
    assert.match(update.output, /SYSTEM_ADMIN_AUDIT_LOG_IMMUTABLE/);

    const deletion = executeSql(
      persistPath,
      "DELETE FROM system_admin_audit_logs WHERE id = 'audit-1';",
      1,
    );
    assert.match(deletion.output, /SYSTEM_ADMIN_AUDIT_LOG_IMMUTABLE/);

    const queried = executeSql(
      persistPath,
      `SELECT id, action FROM system_admin_audit_logs;
       SELECT name FROM sqlite_master
       WHERE type = 'trigger' AND name LIKE 'system_admin_audit_logs_%_guard'
       ORDER BY name;`,
    );
    const resultSets = JSON.parse(queried.stdout);
    assert.deepEqual(resultSets.at(-2)?.results, [
      { id: "audit-1", action: "teacher_access_changed" },
    ]);
    assert.deepEqual(resultSets.at(-1)?.results, [
      { name: "system_admin_audit_logs_delete_guard" },
      { name: "system_admin_audit_logs_update_guard" },
    ]);
  } finally {
    await rm(persistPath, { recursive: true, force: true });
  }
});
