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
import { chooseSecureCandidate, secureRandomIndex } from "../lib/local-job-assignment";
import {
  nextJobMonth,
  sortChoiceOrder,
  suggestJobGrade,
  type ChoiceOrderItem,
} from "../lib/monthly-job-choice-rules";
import { assignmentPeriod, randomCandidate, seoulServerTime } from "../lib/seoul-time";

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

test("관리자 기본 직업 설정은 이후 추천 입력에 반영된다", () => {
  const templates = JOB_TEMPLATES
    .filter((template) => template.id !== "classroom-cleaner")
    .map((template) => template.id === "milk-manager"
      ? { ...template, defaultPriority: 1, recommendedMaxMembers: 8 }
      : template);
  const result = recommendJobs(8, { distribution: "shared" }, templates);
  assert.equal(result.jobs.some((job) => job.templateId === "classroom-cleaner"), false);
  assert.equal(result.jobs.some((job) => job.templateId === "milk-manager"), true);
});

test("Cloudflare 서버 시각을 서울 표준시로 바꿔 현재 월을 자동 선택한다", () => {
  const epochMs = Date.parse("2026-07-24T17:18:00.000Z");
  const serverTime = seoulServerTime(epochMs);
  assert.equal(serverTime.date, "2026-07-25");
  assert.equal(serverTime.monthValue, "2026-07");
  assert.equal(serverTime.timeZone, "Asia/Seoul");
  assert.deepEqual(
    assignmentPeriod({ epochMs }),
    {
      year: 2026,
      month: 7,
      monthValue: "2026-07",
      label: "2026년 7월",
      serverTime,
    },
  );
});

test("랜덤 배정은 체크한 희망자 안에서만 한 명을 고른다", () => {
  const hopefuls = ["학생1", "학생2", "학생3"];
  assert.equal(randomCandidate(hopefuls, () => 0), "학생1");
  assert.equal(randomCandidate(hopefuls, () => 0.5), "학생2");
  assert.equal(randomCandidate(hopefuls, () => 0.999999), "학생3");
});

test("로컬 추첨은 브라우저 보안 난수로 선택하고 편향 없는 인덱스를 만든다", () => {
  const fillFive = (values: Uint32Array) => {
    values[0] = 5;
    return values;
  };
  assert.equal(secureRandomIndex(3, fillFive), 2);
  assert.equal(chooseSecureCandidate(["학생1", "학생2", "학생3"], fillFive), "학생3");
  assert.throws(() => secureRandomIndex(0, fillFive), /한 명 이상/);
});

test("12월 다음 직업 월은 다음 해 1월로 넘어간다", () => {
  assert.deepEqual(nextJobMonth(2026, 11), { year: 2026, month: 12 });
  assert.deepEqual(nextJobMonth(2026, 12), { year: 2027, month: 1 });
  assert.throws(() => nextJobMonth(2026, 13), /올바른 연도와 월/);
});

test("다음 달 직업 선택은 C, B, A, 새 학생, D 순서다", () => {
  const source: ChoiceOrderItem[] = [
    { studentId: "d", studentNumber: 5, studentName: "다은", previousJobName: "기록원", previousGrade: "D" },
    { studentId: "new", studentNumber: 4, studentName: "나래", previousJobName: null, previousGrade: "NEW" },
    { studentId: "a", studentNumber: 3, studentName: "가온", previousJobName: "은행원", previousGrade: "A" },
    { studentId: "b", studentNumber: 2, studentName: "보라", previousJobName: "기자", previousGrade: "B" },
    { studentId: "c", studentNumber: 1, studentName: "초롱", previousJobName: "환경미화원", previousGrade: "C" },
  ];

  assert.deepEqual(
    sortChoiceOrder(source).map((student) => student.previousGrade),
    ["C", "B", "A", "NEW", "D"],
  );
});

test("같은 등급 학생은 번호순이며 같은 입력은 항상 같은 순서를 만든다", () => {
  const source: ChoiceOrderItem[] = [
    { studentId: "s-12", studentNumber: 12, studentName: "하늘", previousJobName: "기자", previousGrade: "B" },
    { studentId: "s-2", studentNumber: 2, studentName: "나무", previousJobName: "기자", previousGrade: "B" },
    { studentId: "s-7", studentNumber: 7, studentName: "바다", previousJobName: "기자", previousGrade: "B" },
  ];
  const original = structuredClone(source);
  const first = sortChoiceOrder(source).map((student) => student.studentId);
  const second = sortChoiceOrder(source).map((student) => student.studentId);

  assert.deepEqual(first, ["s-2", "s-7", "s-12"]);
  assert.deepEqual(second, first);
  assert.deepEqual(source, original);
});

test("대표 직업의 등급 추천은 A, B, C 업무 규칙을 따른다", () => {
  assert.equal(suggestJobGrade({ templateId: "banker", name: "은행원" }), "A");
  assert.equal(suggestJobGrade({ templateId: "class-reporter", name: "학급 기자" }), "B");
  assert.equal(suggestJobGrade({ templateId: "classroom-cleaner", name: "환경미화원" }), "C");
  assert.equal(suggestJobGrade({ templateId: null, name: "디지털 기기 관리원" }), "A");
  assert.equal(suggestJobGrade({ templateId: null, name: "분리수거원" }), "C");
});
