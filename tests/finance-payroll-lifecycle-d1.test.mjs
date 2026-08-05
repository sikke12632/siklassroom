import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerPath = path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const migrationPath = path.join(projectRoot, "drizzle", "0038_finance_payroll_lifecycle_guards.sql");

function runWrangler(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [wranglerPath, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (expectedStatus === 0) assert.equal(result.status, 0, output.slice(-5000));
  else assert.notEqual(result.status, 0, "The protected mutation unexpectedly succeeded.");
  return { ...result, output };
}

function executeSql(persistPath, sql, expectedStatus = 0) {
  return runWrangler([
    "d1", "execute", "DB", "--local", `--persist-to=${persistPath}`,
    "--json", "--command", sql,
  ], expectedStatus);
}

test("미완료 월급은 학급·학생·설정을 보호하고 준비 시점도 원자적으로 재검증한다", async () => {
  const persistPath = await mkdtemp(path.join(tmpdir(), "siklassroom-payroll-lifecycle-"));
  try {
    executeSql(persistPath, `
      CREATE TABLE classes (id TEXT PRIMARY KEY, status TEXT NOT NULL);
      CREATE TABLE students (id TEXT PRIMARY KEY, class_id TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE finance_salary_settings (
        class_id TEXT PRIMARY KEY, grade_a_amount INTEGER NOT NULL,
        grade_b_amount INTEGER NOT NULL, grade_c_amount INTEGER NOT NULL,
        revision INTEGER NOT NULL
      );
      CREATE TABLE finance_settings (class_id TEXT PRIMARY KEY, denominations_json TEXT NOT NULL);
      CREATE TABLE finance_payroll_runs (
        id TEXT PRIMARY KEY, class_id TEXT NOT NULL, status TEXT NOT NULL,
        salary_settings_revision INTEGER NOT NULL
      );
      CREATE TABLE finance_payroll_items (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, class_id TEXT NOT NULL,
        student_id TEXT NOT NULL, status TEXT NOT NULL
      );
      CREATE TABLE finance_accounts (
        id TEXT PRIMARY KEY, class_id TEXT NOT NULL, student_id TEXT,
        account_type TEXT NOT NULL, status TEXT NOT NULL
      );
    `);
    runWrangler([
      "d1", "execute", "DB", "--local", `--persist-to=${persistPath}`,
      `--file=${migrationPath}`,
    ]);
    executeSql(persistPath, `
      INSERT INTO classes VALUES ('class-1', 'active');
      INSERT INTO students VALUES ('student-1', 'class-1', 'active');
      INSERT INTO finance_salary_settings VALUES ('class-1', 1300, 1000, 700, 0);
      INSERT INTO finance_settings VALUES ('class-1', '[100]');
      INSERT INTO finance_accounts VALUES ('wallet-1', 'class-1', 'student-1', 'student_wallet', 'active');
      INSERT INTO finance_payroll_runs VALUES ('run-1', 'class-1', 'prepared', 0);
      INSERT INTO finance_payroll_items VALUES ('item-1', 'run-1', 'class-1', 'student-1', 'pending');
    `);

    assert.match(executeSql(
      persistPath, "UPDATE classes SET status='archived' WHERE id='class-1';", 1,
    ).output, /FINANCE_PAYROLL_PENDING_CLASS/);
    assert.match(executeSql(
      persistPath, "UPDATE students SET status='excluded' WHERE id='student-1';", 1,
    ).output, /FINANCE_PAYROLL_PENDING_STUDENT/);
    assert.match(executeSql(
      persistPath, "UPDATE finance_salary_settings SET grade_c_amount=800 WHERE class_id='class-1';", 1,
    ).output, /FINANCE_PAYROLL_PENDING_SETTINGS/);
    assert.match(executeSql(
      persistPath, "UPDATE finance_settings SET denominations_json='[500]' WHERE class_id='class-1';", 1,
    ).output, /FINANCE_PAYROLL_PENDING_DENOMINATIONS/);

    executeSql(persistPath, `
      INSERT INTO classes VALUES ('class-stale', 'archived');
      INSERT INTO finance_salary_settings VALUES ('class-stale', 1300, 1000, 700, 0);
      INSERT INTO finance_settings VALUES ('class-stale', '[100]');
    `);
    assert.match(executeSql(
      persistPath,
      "INSERT INTO finance_payroll_runs VALUES ('run-stale', 'class-stale', 'prepared', 0);",
      1,
    ).output, /FINANCE_PAYROLL_PREPARE_STALE/);

    executeSql(persistPath, `
      INSERT INTO classes VALUES ('class-recipient', 'active');
      INSERT INTO students VALUES ('student-disabled', 'class-recipient', 'excluded');
      INSERT INTO finance_salary_settings VALUES ('class-recipient', 1300, 1000, 700, 0);
      INSERT INTO finance_settings VALUES ('class-recipient', '[100]');
      INSERT INTO finance_accounts VALUES ('wallet-disabled', 'class-recipient', 'student-disabled', 'student_wallet', 'active');
      INSERT INTO finance_payroll_runs VALUES ('run-recipient', 'class-recipient', 'prepared', 0);
    `);
    assert.match(executeSql(
      persistPath,
      "INSERT INTO finance_payroll_items VALUES ('item-disabled','run-recipient','class-recipient','student-disabled','pending');",
      1,
    ).output, /FINANCE_PAYROLL_RECIPIENT_STALE/);
  } finally {
    await rm(persistPath, { recursive: true, force: true });
  }
});
