import { FINANCE_MAX_ABSOLUTE_AMOUNT, stableFinanceJson } from "./finance-ledger-rules";

export const DEFAULT_FINANCE_SALARY_SETTINGS = {
  gradeAAmount: 1_300,
  gradeBAmount: 1_000,
  gradeCAmount: 700,
} as const;

export type FinanceSalaryGrade = "A" | "B" | "C";

export type FinanceSalarySettingsValues = {
  gradeAAmount: number;
  gradeBAmount: number;
  gradeCAmount: number;
};

export class FinancePayrollRuleError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

function requiredText(value: unknown, field: string, maxLength: number) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new FinancePayrollRuleError(`${field}을(를) 입력해 주세요.`, "FINANCE_PAYROLL_INPUT_REQUIRED");
  }
  if (normalized.length > maxLength || /[\r\n]/u.test(normalized)) {
    throw new FinancePayrollRuleError(
      `${field}은(는) ${maxLength}자 이내로 입력해 주세요.`,
      "FINANCE_PAYROLL_INPUT_TOO_LONG",
    );
  }
  return normalized;
}

function resourceId(value: unknown, field: string) {
  const normalized = requiredText(value, field, 100);
  if (!/^[A-Za-z0-9:_-]{1,100}$/u.test(normalized)) {
    throw new FinancePayrollRuleError(
      `${field} 형식이 올바르지 않습니다.`,
      "FINANCE_PAYROLL_INVALID_RESOURCE_ID",
    );
  }
  return normalized;
}

function idempotencyKey(value: unknown) {
  const normalized = requiredText(value, "저장 요청 번호", 160);
  if (!/^[A-Za-z0-9:_-]{8,160}$/u.test(normalized)) {
    throw new FinancePayrollRuleError(
      "저장 요청 번호 형식이 올바르지 않습니다.",
      "FINANCE_PAYROLL_INVALID_IDEMPOTENCY_KEY",
    );
  }
  return normalized;
}

function expectedRevision(value: unknown, code: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new FinancePayrollRuleError(
      "최신 월급 설정을 다시 불러와 주세요.",
      code,
    );
  }
  return Number(value);
}

function salaryAmount(value: unknown, field: string) {
  const amount = Number(value);
  if (
    !Number.isSafeInteger(amount)
    || amount <= 0
    || amount > FINANCE_MAX_ABSOLUTE_AMOUNT
  ) {
    throw new FinancePayrollRuleError(
      `${field}은(는) 0보다 큰 정수로 입력해 주세요.`,
      "FINANCE_PAYROLL_INVALID_AMOUNT",
    );
  }
  return amount;
}

export function normalizeFinanceSalarySettingsUpdate(input: {
  gradeAAmount?: unknown;
  gradeBAmount?: unknown;
  gradeCAmount?: unknown;
  expectedRevision?: unknown;
  idempotencyKey?: unknown;
  changeReason?: unknown;
}) {
  const changeReason = requiredText(input.changeReason, "변경 이유", 300);
  if (changeReason.length < 2) {
    throw new FinancePayrollRuleError(
      "변경 이유를 두 글자 이상 적어 주세요.",
      "FINANCE_PAYROLL_INPUT_REQUIRED",
    );
  }
  const values = {
    gradeAAmount: salaryAmount(input.gradeAAmount, "A등급 기본급"),
    gradeBAmount: salaryAmount(input.gradeBAmount, "B등급 기본급"),
    gradeCAmount: salaryAmount(input.gradeCAmount, "C등급 기본급"),
  } satisfies FinanceSalarySettingsValues;
  if (
    values.gradeAAmount < values.gradeBAmount
    || values.gradeBAmount < values.gradeCAmount
  ) {
    throw new FinancePayrollRuleError(
      "기본급은 A등급이 B등급 이상, B등급이 C등급 이상이어야 합니다.",
      "FINANCE_PAYROLL_INVALID_GRADE_ORDER",
    );
  }
  return {
    values,
    expectedRevision: expectedRevision(
      input.expectedRevision,
      "FINANCE_SALARY_SETTINGS_INVALID_REVISION",
    ),
    idempotencyKey: idempotencyKey(input.idempotencyKey),
    changeReason,
  };
}

export function normalizeFinancePayrollRequest(input: {
  closureId?: unknown;
  expectedSettingsRevision?: unknown;
  idempotencyKey?: unknown;
}) {
  return {
    closureId: resourceId(input.closureId, "마감 기록 ID"),
    expectedSettingsRevision: expectedRevision(
      input.expectedSettingsRevision,
      "FINANCE_SALARY_SETTINGS_INVALID_REVISION",
    ),
    idempotencyKey: idempotencyKey(input.idempotencyKey),
  };
}

export function salaryAmountForGrade(
  grade: unknown,
  settings: FinanceSalarySettingsValues,
) {
  if (grade === "A") return settings.gradeAAmount;
  if (grade === "B") return settings.gradeBAmount;
  if (grade === "C") return settings.gradeCAmount;
  throw new FinancePayrollRuleError(
    "월 마감 기록의 직업 등급을 확인할 수 없습니다.",
    "FINANCE_PAYROLL_INVALID_GRADE",
  );
}

export function financeSalarySettingsPayload(input: {
  values: FinanceSalarySettingsValues;
  expectedRevision: number;
  changeReason: string;
}) {
  return stableFinanceJson(input);
}

export function financeSalarySettingsJson(values: FinanceSalarySettingsValues) {
  return stableFinanceJson(values);
}

export function financePayrollPayload(input: {
  classId: string;
  closureId: string;
  sourcePeriodId: string;
  sourceYear: number;
  sourceMonth: number;
  settingsRevision: number;
  settings: FinanceSalarySettingsValues;
  items: Array<{
    closureResultId: string;
    studentId: string;
    classJobId: string;
    jobGrade: FinanceSalaryGrade;
    amount: number;
  }>;
}) {
  return stableFinanceJson({
    ...input,
    items: [...input.items].sort((left, right) => (
      left.studentId.localeCompare(right.studentId)
    )),
  });
}
