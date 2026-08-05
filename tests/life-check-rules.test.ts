import assert from "node:assert/strict";
import test from "node:test";
import {
  LIFE_CHECK_MAX_YEAR,
  LIFE_CHECK_MIN_YEAR,
  lifeCheckMonthForYear,
  lifeCheckYears,
  parseLifeCheckMonth,
} from "../app/life-checks/life-check-navigation";
import {
  LIFE_CHECK_INFO,
  baseLifeCheckReward,
  calculateLifeCheckReward,
  parseLifeCheckPeriod,
  parseLifeCheckType,
  splitSchoolDays,
} from "../lib/life-check-rules";

test("생활확인 연도 선택은 월을 보존하고 2020~2100 범위를 벗어나지 않는다", () => {
  assert.deepEqual(parseLifeCheckMonth("2026-01"), { year: 2026, month: 1 });
  assert.equal(parseLifeCheckMonth("2019-12"), null);
  assert.equal(parseLifeCheckMonth("2101-01"), null);
  assert.equal(parseLifeCheckMonth("2026-13"), null);
  assert.equal(lifeCheckMonthForYear("2026-01", 2025), "2025-01");
  assert.equal(lifeCheckMonthForYear("2026-12", 1900), "2020-12");
  assert.equal(lifeCheckMonthForYear("2026-12", 2200), "2100-12");
  assert.equal(lifeCheckMonthForYear("2026-12", Number.NaN), "2026-12");

  const years = lifeCheckYears();
  assert.equal(years[0], LIFE_CHECK_MAX_YEAR);
  assert.equal(years.at(-1), LIFE_CHECK_MIN_YEAR);
  assert.equal(years.length, LIFE_CHECK_MAX_YEAR - LIFE_CHECK_MIN_YEAR + 1);
});

test("생활확인 담당 직업을 현재 직업 템플릿과 고정한다", () => {
  assert.equal(LIFE_CHECK_INFO.tooth.jobTemplateId, "routine-checker");
  assert.equal(LIFE_CHECK_INFO.milk.jobTemplateId, "milk-manager");
  assert.equal(LIFE_CHECK_INFO.lunch.jobTemplateId, "meal-checker");
  assert.equal(parseLifeCheckType("tooth"), "tooth");
  assert.equal(parseLifeCheckPeriod("second"), "second");
  assert.throws(() => parseLifeCheckType("unknown"));
  assert.throws(() => parseLifeCheckPeriod("all"));
});

test("수업일은 기존 시스템처럼 앞쪽을 한 날 더 가진 두 기간으로 나눈다", () => {
  const dates = Array.from({ length: 9 }, (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`);
  const periods = splitSchoolDays(dates);
  assert.equal(periods.first.length, 5);
  assert.equal(periods.second.length, 4);
  assert.equal(periods.first[4], "2026-08-05");
  assert.equal(periods.second[0], "2026-08-06");
});

test("양치와 우유는 70퍼센트, 급식은 50·80퍼센트 기준을 보존한다", () => {
  assert.equal(baseLifeCheckReward("tooth", 6, 10), 0);
  assert.equal(baseLifeCheckReward("tooth", 7, 10), 100);
  assert.equal(baseLifeCheckReward("tooth", 6, 9), 0);
  assert.equal(baseLifeCheckReward("tooth", 7, 9), 100);
  assert.equal(baseLifeCheckReward("milk", 7, 10), 100);
  assert.equal(baseLifeCheckReward("milk", 6, 9), 0);
  assert.equal(baseLifeCheckReward("milk", 7, 9), 100);
  assert.equal(baseLifeCheckReward("lunch", 3, 8), 0);
  assert.equal(baseLifeCheckReward("lunch", 4, 8), 100);
  assert.equal(baseLifeCheckReward("lunch", 5, 10), 100);
  assert.equal(baseLifeCheckReward("lunch", 8, 10), 200);
  assert.equal(baseLifeCheckReward("lunch", 7, 9), 100);
  assert.equal(baseLifeCheckReward("lunch", 8, 9), 200);
  assert.equal(baseLifeCheckReward("tooth", 0, 0), 0);
});

test("하반기 계산에서만 한 달 전체 통과 보너스 100을 더한다", () => {
  assert.deepEqual(calculateLifeCheckReward({
    type: "tooth",
    period: "first",
    passedCount: 5,
    periodTotal: 5,
    firstPassedCount: 5,
    firstTotal: 5,
    secondPassedCount: 5,
    secondTotal: 5,
  }), { baseAmount: 100, bonusAmount: 0, amount: 100 });
  assert.deepEqual(calculateLifeCheckReward({
    type: "tooth",
    period: "second",
    passedCount: 5,
    periodTotal: 5,
    firstPassedCount: 5,
    firstTotal: 5,
    secondPassedCount: 5,
    secondTotal: 5,
  }), { baseAmount: 100, bonusAmount: 100, amount: 200 });
  assert.equal(calculateLifeCheckReward({
    type: "lunch",
    period: "second",
    passedCount: 5,
    periodTotal: 5,
    firstPassedCount: 4,
    firstTotal: 5,
    secondPassedCount: 5,
    secondTotal: 5,
  }).bonusAmount, 0);
  assert.equal(calculateLifeCheckReward({
    type: "milk",
    period: "second",
    passedCount: 0,
    periodTotal: 0,
    firstPassedCount: 0,
    firstTotal: 0,
    secondPassedCount: 0,
    secondTotal: 0,
  }).bonusAmount, 0);
  assert.equal(calculateLifeCheckReward({
    type: "lunch",
    period: "second",
    passedCount: 4,
    periodTotal: 4,
    firstPassedCount: 4,
    firstTotal: 4,
    secondPassedCount: 3,
    secondTotal: 4,
  }).bonusAmount, 0);
});
