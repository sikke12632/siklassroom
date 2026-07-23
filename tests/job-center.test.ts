import assert from "node:assert/strict";
import test from "node:test";
import {
  adjustJobsToStudentCount,
  DEFAULT_SURVEY_ANSWERS,
  JOB_TEMPLATES,
  recommendJobs,
  sumJobCapacity,
  type ClassJobDraft,
} from "../lib/job-catalog";

test("26명 균형형 추천은 항상 같은 26자리를 만든다", () => {
  const first = recommendJobs(26, { ...DEFAULT_SURVEY_ANSWERS, distribution: "balanced" });
  const second = recommendJobs(26, { ...DEFAULT_SURVEY_ANSWERS, distribution: "balanced" });
  assert.equal(sumJobCapacity(first.jobs), 26);
  assert.ok(first.jobs.length >= 8 && first.jobs.length <= 12);
  assert.deepEqual(first, second);
});

test("경제 미운영과 생활 확인 미선택은 관련 직업을 자동 추천하지 않는다", () => {
  const result = recommendJobs(26, {
    ...DEFAULT_SURVEY_ANSWERS,
    economy: "none",
    checks: [],
  });
  const templateIds = result.jobs.map((job) => job.templateId);
  assert.ok(!templateIds.includes("banker"));
  assert.ok(!templateIds.includes("market-clerk"));
  assert.ok(!templateIds.includes("routine-checker"));
  assert.ok(!templateIds.includes("meal-checker"));
});

test("필수 포함은 우선하고 제외 직업은 결과에서 제거한다", () => {
  const result = recommendJobs(18, {
    ...DEFAULT_SURVEY_ANSWERS,
    includeJobIds: ["class-reporter", "banker"],
    excludeJobIds: ["class-reporter"],
    economy: "none",
  });
  const templateIds = result.jobs.map((job) => job.templateId);
  assert.ok(templateIds.includes("banker"));
  assert.ok(!templateIds.includes("class-reporter"));
  assert.equal(sumJobCapacity(result.jobs), 18);
});

test("1명과 60명 학급도 정확한 자리 수를 만든다", () => {
  for (const studentCount of [1, 60]) {
    const result = recommendJobs(studentCount, DEFAULT_SURVEY_ANSWERS);
    assert.equal(sumJobCapacity(result.jobs), studentCount);
    assert.ok(result.jobs.length > 0);
  }
});

test("자동 맞춤은 부족·초과 자리를 정확히 조정하고 원본을 바꾸지 않는다", () => {
  const source: ClassJobDraft[] = [
    {
      id: "class-a:classroom-cleaner",
      templateId: "classroom-cleaner",
      name: JOB_TEMPLATES[0].name,
      description: JOB_TEMPLATES[0].shortDescription,
      memberCapacity: 2,
      category: "cleaning",
      source: "template",
      sortOrder: 0,
    },
    {
      id: "class-a:class-reporter",
      templateId: "class-reporter",
      name: "학급 기자",
      description: "학급 소식을 기록해요.",
      memberCapacity: 2,
      category: "records",
      source: "template",
      sortOrder: 1,
    },
  ];
  const original = structuredClone(source);
  assert.equal(sumJobCapacity(adjustJobsToStudentCount(12, source).jobs), 12);
  assert.equal(sumJobCapacity(adjustJobsToStudentCount(2, source).jobs), 2);
  assert.deepEqual(source, original);
});
