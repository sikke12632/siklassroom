import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { manualSchoolInput, normalizeSchoolSearch, schoolSearchVariants } from "../lib/schools";
import { generateInviteCode, normalizeInviteCode } from "../lib/invite-code";
import { teacherAccountIssue } from "../lib/teacher-access-rules";

test("권한이 회수되거나 비활성화된 교사는 학급 API를 사용할 수 없다", () => {
  assert.equal(teacherAccountIssue("active", "invite_verified"), null);
  assert.equal(teacherAccountIssue("active", "pending"), null);
  assert.equal(teacherAccountIssue("active", "revoked"), "TEACHER_ACCESS_REVOKED");
  assert.equal(teacherAccountIssue("disabled", "invite_verified"), "ACCOUNT_DISABLED");
});

test("학교 검색어는 공백과 학교급 약칭을 같은 형태로 정규화한다", () => {
  assert.equal(normalizeSchoolSearch(" 서울 서이 초등학교 "), "서울서이초");
  assert.equal(normalizeSchoolSearch("서울서이초"), "서울서이초");
  assert.deepEqual(schoolSearchVariants("서이초등학교"), ["서이초등학교", "서이초"]);
});

test("직접 입력 학교는 별도 요청에 필요한 안전한 값으로 정리한다", () => {
  const input = manualSchoolInput({
    enteredName: "  새봄 초등학교  ",
    provinceName: "서울특별시",
    schoolLevel: "초등학교",
    districtOrAddress: "서초구 123",
    note: "신설 학교",
  });
  assert.equal(input.enteredName, "새봄 초등학교");
  assert.equal(input.normalizedName, "새봄초등학교");
  assert.equal(input.provinceName, "서울특별시");
});

test("초대코드는 사람이 읽기 쉬운 20자 일회용 형식이다", () => {
  const code = generateInviteCode();
  assert.match(code, /^[A-HJ-NP-Z2-9]{5}(?:-[A-HJ-NP-Z2-9]{5}){3}$/);
  assert.equal(normalizeInviteCode(code).length, 20);
  assert.equal(normalizeInviteCode(code.toLowerCase().replaceAll("-", " ")), normalizeInviteCode(code));
});

test("최신 D1 마이그레이션 DB는 Worker 시작 때 전체 스키마를 다시 만들지 않는다", async () => {
  const [databaseSource, lifeAccessSource] = await Promise.all([
    readFile(new URL("../lib/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/life-check-access.ts", import.meta.url), "utf8"),
  ]);
  assert.match(databaseSource, /LATEST_RUNTIME_SCHEMA_MIGRATION = "0038_finance_payroll_lifecycle_guards\.sql"/);
  assert.match(databaseSource, /SELECT 1 AS applied FROM d1_migrations WHERE name = \? LIMIT 1/);
  assert.match(databaseSource, /if \(await hasLatestRuntimeMigration\(db\)\) \{\s*schemaProvidedByMigrations = true;\s*return;/);
  assert.match(lifeAccessSource, /if \(runtimeSchemaProvidedByMigrations\(\)\) return;/);
});

test("기본 직업 시드는 DB마다 한 번만 저장하고 같은 Worker의 동시 조회가 공유한다", async () => {
  const jobStorage = await readFile(new URL("../lib/job-storage.ts", import.meta.url), "utf8");
  assert.match(jobStorage, /JOB_TEMPLATE_SEED_KEY = "2026-08-job-template-seed-v1"/);
  assert.match(jobStorage, /let jobTemplatesReady: Promise<void> \| null = null/);
  assert.match(jobStorage, /SELECT 1 AS seeded FROM system_migrations WHERE key = \? LIMIT 1/);
  assert.match(jobStorage, /INSERT OR IGNORE INTO system_migrations \(key, applied_at\)/);
  assert.match(jobStorage, /jobTemplatesReady = null;\s*throw error;/);
});

test("공개 가입 중에도 교사 한 명의 학급과 학교 요청이 무제한 쌓이지 않는다", async () => {
  const [classesRoute, classRoute, classLimits, manualSchoolRoute] = await Promise.all([
    readFile(new URL("../app/api/classes/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/classes/[classId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/class-limits.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/schools/manual/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(classLimits, /MAX_ACTIVE_CLASSES_PER_TEACHER = 10/);
  assert.match(classLimits, /MAX_TOTAL_CLASSES_PER_TEACHER = 50/);
  assert.match(classesRoute, /SELECT COUNT\(\*\) FROM classes WHERE teacher_id = \? AND status = 'active'/);
  assert.match(classRoute, /const restoring = current\.status === "archived" && status === "active"/);
  assert.match(classRoute, /active_class\.status = 'active'\) < \?/);
  assert.match(manualSchoolRoute, /submitted_by_teacher_id = \? AND status = 'pending'/);
  assert.match(manualSchoolRoute, /'manual_school_request'/);
  assert.match(manualSchoolRoute, /MANUAL_SCHOOL_REQUEST_PENDING/);
});
