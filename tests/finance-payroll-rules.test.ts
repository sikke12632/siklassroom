import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FINANCE_SALARY_SETTINGS,
  FinancePayrollRuleError,
  financePayrollPayload,
  normalizeFinancePayrollRequest,
  normalizeFinanceSalarySettingsUpdate,
  salaryAmountForGrade,
} from "../lib/finance-payroll-rules";

test("직업 등급별 기본급 기본값과 계산 규칙을 고정한다", () => {
  assert.deepEqual(DEFAULT_FINANCE_SALARY_SETTINGS, {
    gradeAAmount: 1_300,
    gradeBAmount: 1_000,
    gradeCAmount: 700,
  });
  assert.equal(salaryAmountForGrade("A", DEFAULT_FINANCE_SALARY_SETTINGS), 1_300);
  assert.equal(salaryAmountForGrade("B", DEFAULT_FINANCE_SALARY_SETTINGS), 1_000);
  assert.equal(salaryAmountForGrade("C", DEFAULT_FINANCE_SALARY_SETTINGS), 700);
  assert.throws(
    () => salaryAmountForGrade("D", DEFAULT_FINANCE_SALARY_SETTINGS),
    (error: unknown) => (
      error instanceof FinancePayrollRuleError
      && error.code === "FINANCE_PAYROLL_INVALID_GRADE"
    ),
  );
});

test("월급 설정은 양의 정수와 안정적인 저장 요청 번호만 허용한다", () => {
  assert.deepEqual(normalizeFinanceSalarySettingsUpdate({
    gradeAAmount: 1_500,
    gradeBAmount: 1_100,
    gradeCAmount: 800,
    expectedRevision: 2,
    idempotencyKey: "salary-settings:test-001",
    changeReason: "2학기 기본급 조정",
  }), {
    values: {
      gradeAAmount: 1_500,
      gradeBAmount: 1_100,
      gradeCAmount: 800,
    },
    expectedRevision: 2,
    idempotencyKey: "salary-settings:test-001",
    changeReason: "2학기 기본급 조정",
  });

  assert.throws(
    () => normalizeFinanceSalarySettingsUpdate({
      gradeAAmount: 0,
      gradeBAmount: 1_000,
      gradeCAmount: 700,
      expectedRevision: 0,
      idempotencyKey: "salary-settings:test-002",
      changeReason: "잘못된 값",
    }),
    (error: unknown) => (
      error instanceof FinancePayrollRuleError
      && error.code === "FINANCE_PAYROLL_INVALID_AMOUNT"
    ),
  );
  assert.throws(
    () => normalizeFinanceSalarySettingsUpdate({
      gradeAAmount: 700,
      gradeBAmount: 1_000,
      gradeCAmount: 1_300,
      expectedRevision: 0,
      idempotencyKey: "salary-settings:test-003",
      changeReason: "등급 순서 오류",
    }),
    (error: unknown) => (
      error instanceof FinancePayrollRuleError
      && error.code === "FINANCE_PAYROLL_INVALID_GRADE_ORDER"
    ),
  );
});

test("월급 지급 요청은 마감 기록·설정 revision·중복 방지 키를 함께 고정한다", () => {
  assert.deepEqual(normalizeFinancePayrollRequest({
    closureId: "closure-2026-07",
    expectedSettingsRevision: 3,
    idempotencyKey: "salary-pay:test-001",
  }), {
    closureId: "closure-2026-07",
    expectedSettingsRevision: 3,
    idempotencyKey: "salary-pay:test-001",
  });
  assert.throws(
    () => normalizeFinancePayrollRequest({
      closureId: "closure-2026-07",
      expectedSettingsRevision: -1,
      idempotencyKey: "salary-pay:test-002",
    }),
    (error: unknown) => (
      error instanceof FinancePayrollRuleError
      && error.code === "FINANCE_SALARY_SETTINGS_INVALID_REVISION"
    ),
  );
});

test("같은 월급 항목은 입력 순서가 달라도 같은 payload를 만든다", () => {
  const base = {
    classId: "class-a",
    closureId: "closure-a",
    sourcePeriodId: "period-a",
    sourceYear: 2026,
    sourceMonth: 7,
    settingsRevision: 1,
    settings: { gradeAAmount: 1_300, gradeBAmount: 1_000, gradeCAmount: 700 },
  };
  const first = {
    closureResultId: "result-1",
    studentId: "student-1",
    classJobId: "job-1",
    jobGrade: "A" as const,
    amount: 1_300,
  };
  const second = {
    closureResultId: "result-2",
    studentId: "student-2",
    classJobId: "job-2",
    jobGrade: "C" as const,
    amount: 700,
  };
  assert.equal(
    financePayrollPayload({ ...base, items: [first, second] }),
    financePayrollPayload({ ...base, items: [second, first] }),
  );
});
