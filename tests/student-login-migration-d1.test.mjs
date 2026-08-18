import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerPath = path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const migrationPath = path.join(projectRoot, "drizzle", "0041_student_login_stabilization.sql");

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

test("학교코드 마이그레이션은 기존 학생 계정과 비밀번호를 변경하지 않는다", async () => {
  const persistPath = await mkdtemp(path.join(tmpdir(), "siklassroom-student-login-migration-"));
  try {
    executeSql(persistPath, `
      CREATE TABLE schools (
        id TEXT PRIMARY KEY, office_code TEXT NOT NULL, school_code TEXT NOT NULL,
        official_name TEXT NOT NULL, normalized_name TEXT NOT NULL, search_name TEXT NOT NULL,
        school_level TEXT NOT NULL, province_name TEXT NOT NULL, district_name TEXT,
        road_address TEXT, status TEXT NOT NULL, source TEXT NOT NULL,
        source_updated_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE classes (
        id TEXT PRIMARY KEY, school_id TEXT, status TEXT NOT NULL,
        grade INTEGER NOT NULL, class_number INTEGER NOT NULL, school_year INTEGER NOT NULL
      );
      CREATE TABLE students (
        id TEXT PRIMARY KEY, class_id TEXT NOT NULL, password_hash TEXT,
        status TEXT NOT NULL, credential_revision INTEGER NOT NULL
      );
      INSERT INTO schools VALUES (
        'school:B10:7091394', 'B10', '7091394', '서울서이초등학교',
        '서울서이초등학교', '서울서이초', '초등학교', '서울특별시', NULL,
        NULL, 'active', 'neis', 100, 100, 100
      );
      INSERT INTO classes VALUES ('class-existing', 'school:B10:7091394', 'active', 5, 1, 2026);
      INSERT INTO students VALUES ('student-existing', 'class-existing', 'pbkdf2$existing', 'active', 7);
    `);
    runWrangler([
      "d1", "execute", "DB", "--local", `--persist-to=${persistPath}`,
      `--file=${migrationPath}`,
    ]);
    const school = executeSql(persistPath, `
      SELECT student_login_code FROM schools WHERE id = 'school:B10:7091394';
    `).at(-1)?.results?.[0];
    assert.deepEqual(school, { student_login_code: "01" });
    const student = executeSql(persistPath, `
      SELECT id, class_id, password_hash, status, credential_revision FROM students;
    `).at(-1)?.results?.[0];
    assert.deepEqual(student, {
      id: "student-existing",
      class_id: "class-existing",
      password_hash: "pbkdf2$existing",
      status: "active",
      credential_revision: 7,
    });
    const indexes = executeSql(persistPath, `
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name IN ('schools_student_login_code_uq', 'classes_student_login_idx')
      ORDER BY name;
    `).at(-1)?.results;
    assert.deepEqual(indexes, [
      { name: "classes_student_login_idx" },
      { name: "schools_student_login_code_uq" },
    ]);
  } finally {
    await rm(persistPath, { recursive: true, force: true });
  }
});
