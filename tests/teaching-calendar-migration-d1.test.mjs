import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerPath = path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const migrationPath = path.join(projectRoot, "drizzle", "0039_class_timetable.sql");

function runWrangler(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [wranglerPath, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (expectedStatus === 0) {
    assert.equal(result.status, 0, output.slice(-5000));
  } else {
    assert.notEqual(result.status, 0, "보호되어야 할 D1 변경이 성공했습니다.");
  }
  return { ...result, output };
}

function executeSql(persistPath, sql, expectedStatus = 0) {
  const result = runWrangler([
    "d1",
    "execute",
    "DB",
    "--local",
    `--persist-to=${persistPath}`,
    "--json",
    "--command",
    sql,
  ], expectedStatus);
  if (result.status !== 0) return result;
  return { ...result, data: JSON.parse(result.stdout) };
}

function lastResults(execution) {
  const last = execution.data.at(-1);
  assert.equal(last?.success, true);
  return last.results;
}

function expectConstraint(persistPath, sql, constraint) {
  const result = executeSql(persistPath, sql, 1);
  assert.match(result.output, constraint);
}

test("0039는 시간표 제약을 강제하면서 기존 직업 운영 달력 revision을 바꾸지 않는다", async () => {
  const persistPath = await mkdtemp(path.join(tmpdir(), "siklassroom-teaching-calendar-"));
  try {
    executeSql(persistPath, `
      PRAGMA foreign_keys = ON;
      CREATE TABLE classes (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE class_calendars (
        class_id TEXT PRIMARY KEY NOT NULL,
        revision INTEGER NOT NULL,
        FOREIGN KEY (class_id) REFERENCES classes(id)
      );
      INSERT INTO classes (id) VALUES
        ('class-main'), ('class-other'), ('class-period-low'),
        ('class-period-high'), ('class-revision-low');
      INSERT INTO class_calendars (class_id, revision) VALUES ('class-main', 17);
    `);

    runWrangler([
      "d1",
      "execute",
      "DB",
      "--local",
      `--persist-to=${persistPath}`,
      `--file=${migrationPath}`,
    ]);

    executeSql(persistPath, `
      INSERT INTO class_timetables (
        class_id, period_count, revision, created_at, updated_at
      ) VALUES
        ('class-main', 6, 1, 1, 1),
        ('class-other', 6, 1, 1, 1);
      INSERT INTO class_timetable_slots (
        id, class_id, weekday, period_number, subject_name, created_at, updated_at
      ) VALUES
        ('slot-main', 'class-main', 1, 1, '국어', 1, 1),
        ('slot-other', 'class-other', 1, 1, '수학', 1, 1);
      UPDATE class_timetables
      SET period_count = 7, revision = revision + 1, updated_at = 2
      WHERE class_id = 'class-main' AND revision = 1;
      DELETE FROM class_timetable_slots WHERE id = 'slot-main';
      INSERT INTO class_timetable_slots (
        id, class_id, weekday, period_number, subject_name, created_at, updated_at
      ) VALUES ('slot-main-next', 'class-main', 5, 7, '창의적 체험활동', 2, 2);
    `);

    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT calendar.revision AS calendar_revision,
              timetable.revision AS timetable_revision,
              timetable.period_count,
              slot.weekday, slot.period_number, slot.subject_name
       FROM class_calendars calendar
       JOIN class_timetables timetable ON timetable.class_id = calendar.class_id
       JOIN class_timetable_slots slot ON slot.class_id = timetable.class_id
       WHERE calendar.class_id = 'class-main';`,
    )), [{
      calendar_revision: 17,
      timetable_revision: 2,
      period_count: 7,
      weekday: 5,
      period_number: 7,
      subject_name: "창의적 체험활동",
    }]);

    expectConstraint(
      persistPath,
      "INSERT INTO class_timetables VALUES ('class-period-low', 0, 1, 1, 1);",
      /class_timetables_period_count_ck/,
    );
    expectConstraint(
      persistPath,
      "INSERT INTO class_timetables VALUES ('class-period-high', 11, 1, 1, 1);",
      /class_timetables_period_count_ck/,
    );
    expectConstraint(
      persistPath,
      "INSERT INTO class_timetables VALUES ('class-revision-low', 6, 0, 1, 1);",
      /class_timetables_revision_ck/,
    );
    expectConstraint(
      persistPath,
      "INSERT INTO class_timetable_slots VALUES ('bad-weekday', 'class-main', 0, 1, '국어', 1, 1);",
      /class_timetable_slots_weekday_ck/,
    );
    expectConstraint(
      persistPath,
      "INSERT INTO class_timetable_slots VALUES ('bad-period', 'class-main', 1, 11, '국어', 1, 1);",
      /class_timetable_slots_period_ck/,
    );
    expectConstraint(
      persistPath,
      "INSERT INTO class_timetable_slots VALUES ('blank-subject', 'class-main', 1, 2, '   ', 1, 1);",
      /class_timetable_slots_subject_ck/,
    );
    expectConstraint(
      persistPath,
      `INSERT INTO class_timetable_slots VALUES (
        'long-subject', 'class-main', 1, 2, '${"가".repeat(41)}', 1, 1
      );`,
      /class_timetable_slots_subject_ck/,
    );
    expectConstraint(
      persistPath,
      "INSERT INTO class_timetable_slots VALUES ('duplicate-slot', 'class-other', 1, 1, '과학', 1, 1);",
      /class_timetable_slots_class_weekday_period_uq|UNIQUE constraint failed/,
    );
    expectConstraint(
      persistPath,
      "INSERT INTO class_timetable_slots VALUES ('missing-parent', 'class-missing', 1, 1, '국어', 1, 1);",
      /FOREIGN KEY constraint failed/,
    );

    assert.deepEqual(lastResults(executeSql(
      persistPath,
      "SELECT revision FROM class_calendars WHERE class_id = 'class-main';",
    )), [{ revision: 17 }]);
  } finally {
    await rm(persistPath, { recursive: true, force: true });
  }
});
