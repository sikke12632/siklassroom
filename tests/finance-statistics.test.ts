import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateFinanceMoneyChange,
  normalizeFinanceStudentAssets,
  previousSeoulMonthEnd,
  projectFinanceStatistics,
  recordedFinanceMoneySupply,
  summarizeFinanceStudentAssets,
} from "../lib/finance-statistics-rules";

function assetRows(count = 6) {
  return normalizeFinanceStudentAssets(Array.from({ length: count }, (_, index) => ({
    studentId: `student-${index + 1}`,
    studentNumber: index + 1,
    studentName: `학생 ${index + 1}`,
    wallet: index * 100,
    deposits: index === 1 ? 250 : 0,
    stocks: index === 2 ? 500 : 0,
    funding: index === 3 ? 300 : 0,
  })));
}

test("서울 시간 기준 지난달 마지막 순간을 정확히 계산한다", () => {
  assert.deepEqual(previousSeoulMonthEnd({ year: 2026, month: 8 }), {
    monthValue: "2026-07",
    cutoffEpochMs: Date.parse("2026-07-31T14:59:59.999Z"),
  });
  assert.deepEqual(previousSeoulMonthEnd({ year: 2027, month: 1 }), {
    monthValue: "2026-12",
    cutoffEpochMs: Date.parse("2026-12-31T14:59:59.999Z"),
  });
});

test("기록 통화량은 지갑, 정산 전 예금 원금과 미정산 펀딩 참여금을 더한다", () => {
  assert.equal(recordedFinanceMoneySupply(12_000, 3_500, 800), 16_300);
  assert.equal(recordedFinanceMoneySupply(12_000, 3_500), 15_500);
  assert.throws(() => recordedFinanceMoneySupply(-1, 0), RangeError);
  assert.throws(() => recordedFinanceMoneySupply(0, 0, -1), RangeError);
  assert.throws(
    () => recordedFinanceMoneySupply(Number.MAX_SAFE_INTEGER, 1),
    RangeError,
  );
});

test("전월 자료가 없거나 0이면 허위 증감률을 만들지 않는다", () => {
  assert.deepEqual(calculateFinanceMoneyChange(1_200, null), {
    previous: null,
    change: null,
    changeBps: null,
  });
  assert.deepEqual(calculateFinanceMoneyChange(1_200, 0), {
    previous: 0,
    change: 1_200,
    changeBps: null,
  });
  assert.deepEqual(calculateFinanceMoneyChange(1_200, 1_000), {
    previous: 1_000,
    change: 200,
    changeBps: 2_000,
  });
});

test("학생 총자산과 평균·중앙값을 지갑, 예금, 주식, 펀딩 참여금으로 계산한다", () => {
  const rows = normalizeFinanceStudentAssets([
    {
      studentId: "student-2",
      studentNumber: 2,
      studentName: " 둘째 ",
      wallet: 200,
      deposits: 300,
      stocks: 500,
      funding: 200,
    },
    {
      studentId: "student-1",
      studentNumber: 1,
      studentName: "첫째",
      wallet: 100,
      deposits: 0,
      stocks: 0,
      funding: 0,
    },
  ]);
  assert.deepEqual(rows.map((row) => ({
    id: row.studentId,
    name: row.studentName,
    total: row.total,
  })), [
    { id: "student-1", name: "첫째", total: 100 },
    { id: "student-2", name: "둘째", total: 1_200 },
  ]);
  assert.deepEqual(summarizeFinanceStudentAssets(rows), {
    activeStudentCount: 2,
    trackedTotal: 1_300,
    walletTotal: 300,
    depositValueTotal: 300,
    stockMarketValueTotal: 500,
    fundingLockedTotal: 200,
    average: 650,
    median: 650,
  });
});

test("교사만 학생별 상세 자산을 받고 은행원은 익명 분포만 받는다", () => {
  const rows = assetRows(6);
  const summary = summarizeFinanceStudentAssets(rows);
  const teacher = projectFinanceStatistics("teacher", null, rows, summary);
  assert.equal(teacher.students?.length, 6);
  assert.ok(teacher.distribution);
  assert.equal("ownAsset" in teacher, false);

  const banker = projectFinanceStatistics("banker", "student-1", rows, summary);
  assert.ok(banker.distribution);
  assert.equal("students" in banker, false);
  assert.equal("ownAsset" in banker, false);

  const smallClass = rows.slice(0, 4);
  const smallBanker = projectFinanceStatistics(
    "banker",
    "student-1",
    smallClass,
    summarizeFinanceStudentAssets(smallClass),
  );
  assert.equal(smallBanker.distribution, null);
  assert.equal("students" in smallBanker, false);
});

test("일반 학생은 자신의 자산만 받고 반 친구 목록과 분포는 받지 않는다", () => {
  const rows = assetRows(6);
  const student = projectFinanceStatistics(
    "student",
    "student-3",
    rows,
    summarizeFinanceStudentAssets(rows),
  );
  assert.equal(student.ownAsset?.studentId, "student-3");
  assert.equal(student.distribution, null);
  assert.equal("students" in student, false);

  const missing = projectFinanceStatistics(
    "student",
    "student-missing",
    rows,
    summarizeFinanceStudentAssets(rows),
  );
  assert.equal("ownAsset" in missing, false);
});

test("중복 학생이나 안전 범위를 벗어난 자산은 통계에 넣지 않는다", () => {
  assert.throws(() => normalizeFinanceStudentAssets([
    {
      studentId: "same",
      studentNumber: 1,
      studentName: "하나",
      wallet: 0,
      deposits: 0,
      stocks: 0,
      funding: 0,
    },
    {
      studentId: "same",
      studentNumber: 2,
      studentName: "둘",
      wallet: 0,
      deposits: 0,
      stocks: 0,
      funding: 0,
    },
  ]), RangeError);
  assert.throws(() => normalizeFinanceStudentAssets([{
    studentId: "student-invalid",
    studentNumber: 1,
    studentName: "잘못된 값",
    wallet: Number.NaN,
    deposits: 0,
    stocks: 0,
    funding: 0,
  }]), RangeError);
  assert.throws(() => normalizeFinanceStudentAssets([{
    studentId: "student-invalid-funding",
    studentNumber: 2,
    studentName: "잘못된 펀딩",
    wallet: 0,
    deposits: 0,
    stocks: 0,
    funding: -1,
  }]), RangeError);
});
