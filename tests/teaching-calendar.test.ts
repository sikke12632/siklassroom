import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { seoulServerTime } from "../lib/seoul-time";
import {
  changedFields,
  draftsEqual,
  mergeDrafts,
  timetableSlotKey,
  type TimetableDraft,
} from "../lib/timetable-draft";

function timetableDraft(
  periodCount: number,
  subjects: Record<string, string>,
  revision = 1,
): TimetableDraft {
  return {
    saved: true,
    revision,
    periodCount,
    subjects,
  };
}

test("수업 달력의 오늘과 월 경계는 브라우저 현지 시각이 아닌 서울 시각을 따른다", () => {
  const beforeMidnight = seoulServerTime(Date.parse("2026-08-10T14:59:59.999Z"));
  const atMidnight = seoulServerTime(Date.parse("2026-08-10T15:00:00.000Z"));
  const newYear = seoulServerTime(Date.parse("2026-12-31T15:00:00.000Z"));

  assert.equal(beforeMidnight.date, "2026-08-10");
  assert.equal(atMidnight.date, "2026-08-11");
  assert.equal(newYear.date, "2027-01-01");
  assert.equal(newYear.monthValue, "2027-01");
  assert.equal(beforeMidnight.timeZone, "Asia/Seoul");
  assert.equal(atMidnight.timeZone, "Asia/Seoul");
});

test("서버가 교시 수를 줄여도 로컬에서 수정한 더 늦은 교시와 필요한 교시 수를 보존한다", () => {
  const fifthPeriod = timetableSlotKey(1, 5);
  const base = timetableDraft(6, { [fifthPeriod]: "과학" }, 3);
  const local = timetableDraft(6, { [fifthPeriod]: "미술" }, 3);
  const latest = timetableDraft(4, {}, 4);

  const merged = mergeDrafts(base, local, latest);

  assert.equal(merged.revision, 4);
  assert.equal(merged.periodCount, 5);
  assert.equal(merged.subjects[fifthPeriod], "미술");
});

test("로컬 교시 축소로 서버의 새 과목이 잘리면 교시 수와 해당 칸을 구조 충돌로 표시한다", () => {
  const changedSlot = timetableSlotKey(2, 5);
  const base = timetableDraft(6, { [changedSlot]: "수학" }, 2);
  const local = timetableDraft(4, { [changedSlot]: "수학" }, 2);
  const latest = timetableDraft(6, { [changedSlot]: "과학" }, 3);

  const changes = changedFields(base, local, latest);

  assert.equal(changes.find((change) => change.key === "periodCount")?.collision, true);
  assert.equal(changes.find((change) => change.key === changedSlot)?.collision, true);
});

test("병합은 건드리지 않은 칸에 최신 저장본을 쓰고 같은 칸의 로컬 변경을 우선한다", () => {
  const collisionSlot = timetableSlotKey(1, 1);
  const untouchedSlot = timetableSlotKey(1, 2);
  const base = timetableDraft(6, {
    [collisionSlot]: "국어",
    [untouchedSlot]: "수학",
  });
  const local = timetableDraft(6, {
    [collisionSlot]: "사회",
    [untouchedSlot]: "수학",
  });
  const latest = timetableDraft(6, {
    [collisionSlot]: "영어",
    [untouchedSlot]: "과학",
  }, 2);

  const merged = mergeDrafts(base, local, latest);

  assert.equal(merged.subjects[collisionSlot], "사회");
  assert.equal(merged.subjects[untouchedSlot], "과학");
  assert.equal(draftsEqual(merged, timetableDraft(6, {
    [collisionSlot]: " 사회 ",
    [untouchedSlot]: "과학",
  }, 99)), true);
  assert.equal(draftsEqual(merged, latest), false);
});

test("기초 시간표는 월요일부터 금요일까지의 유효한 교시와 과목만 정규화한다", async () => {
  const source = await readFile(
    new URL("../lib/class-timetable.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /MAX_TIMETABLE_SLOTS = 50/);
  assert.match(source, /integerInRange\(item\.weekday, 1, 5\)/);
  assert.match(source, /integerInRange\(item\.period, 1, 10\)/);
  assert.match(source, /period > periodCount/);
  assert.match(source, /value\.normalize\("NFC"\)\.trim\(\)\.replace\(\/\\s\+\/g, " "\)/);
  assert.match(source, /normalized\.length < 1 \|\| normalized\.length > 40/);
  assert.match(source, /seen\.has\(position\)/);
  assert.match(source, /"DUPLICATE_TIMETABLE_SLOT"/);
  assert.match(
    source,
    /slots\.sort\(\(left, right\) => \([\s\S]*left\.weekday - right\.weekday \|\| left\.period - right\.period/,
  );
  assert.match(source, /stableSlotId\(classId, weekday, period\)/);
  assert.match(source, /LEFT JOIN class_timetable_slots slot/);
  assert.match(source, /period: Number\(slot\.slot_period_number\)/);
  assert.match(source, /subject: slot\.slot_subject_name/);
  assert.doesNotMatch(source, /periodNumber: Number\(slot\.period_number\)/);
  assert.doesNotMatch(source, /subjectName: slot\.subject_name/);
});

test("시간표 API는 로그인 교사의 소유 학급만 읽고 활성 학급만 저장한다", async () => {
  const route = await readFile(
    new URL("../app/api/classes/[classId]/teaching-calendar/route.ts", import.meta.url),
    "utf8",
  );
  const getStart = route.indexOf("export async function GET");
  const putStart = route.indexOf("export async function PUT");
  assert.ok(getStart >= 0 && putStart > getStart, "GET과 PUT 처리기가 모두 필요합니다.");
  const getHandler = route.slice(getStart, putStart);
  const putHandler = route.slice(putStart);

  for (const handler of [getHandler, putHandler]) {
    assert.match(handler, /requireClassManagement\(request\)/);
    assert.match(handler, /const \{ teacherId \}/);
  }
  assert.match(getHandler, /await ownedClass\(teacherId, classId\)/);
  assert.match(getHandler, /const epochMs = Date\.now\(\)/);
  assert.match(getHandler, /requestedMonth \|\| seoulServerTime\(epochMs\)\.monthValue/);
  assert.match(getHandler, /loadClassCalendar\(classId, \{ monthValue, epochMs \}\)/);
  assert.doesNotMatch(getHandler, /saveClassTimetable/);
  assert.match(putHandler, /await ownedActiveClass\(teacherId, classId\)/);
  assert.match(putHandler, /readJson<\{/);
  assert.match(putHandler, /expectedRevision\?: unknown/);
  assert.match(putHandler, /saveClassTimetable\(\{[\s\S]*classId,[\s\S]*teacherId,[\s\S]*expectedRevision:/);
  assert.doesNotMatch(putHandler, /body\.teacherId/);
});

test("시간표 저장은 revision guard와 감사 기록을 같은 D1 batch에 묶는다", async () => {
  const source = await readFile(
    new URL("../lib/class-timetable.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /expectedRevision/);
  assert.match(source, /Number\.isInteger\(expectedRevision\)/);
  assert.match(source, /registration_operation_guards/);
  assert.match(source, /'class_timetable_save'/);
  assert.match(source, /WHERE class_id = \? AND revision = \?/);
  assert.match(source, /"TIMETABLE_STALE"/);
  assert.match(source, /isOperationGuardFailure\(error\)/);
  assert.match(
    source,
    /await db\.batch\(\[[\s\S]*revisionGuard,[\s\S]*timetableStatement,[\s\S]*DELETE FROM class_timetable_slots[\s\S]*INSERT INTO class_timetable_slots[\s\S]*INSERT INTO audit_logs[\s\S]*'class_timetable_saved'[\s\S]*DELETE FROM registration_operation_guards/,
  );
  assert.doesNotMatch(source, /await audit\(/);
});

test("시간표 저장소는 기존 직업 운영 달력을 수정하지 않고 별도 schema를 사용한다", async () => {
  const [source, schema, database, migration] = await Promise.all([
    readFile(new URL("../lib/class-timetable.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0039_class_timetable.sql", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /export const classTimetables = sqliteTable\("class_timetables"/);
  assert.match(schema, /export const classTimetableSlots = sqliteTable\("class_timetable_slots"/);
  assert.match(database, /LATEST_RUNTIME_SCHEMA_MIGRATION = "0039_class_timetable\.sql"/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS class_timetables/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS class_timetable_slots/);
  assert.match(migration, /CREATE TABLE `class_timetables`/);
  assert.match(migration, /CREATE TABLE `class_timetable_slots`/);
  assert.doesNotMatch(`${source}\n${migration}`, /(?:UPDATE|DELETE FROM)\s+`?class_calendars`?/i);
  assert.doesNotMatch(`${source}\n${migration}`, /(?:UPDATE|DELETE FROM)\s+`?class_calendar_days`?/i);
});
