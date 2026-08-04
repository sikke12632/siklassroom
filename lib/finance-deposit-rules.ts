import { FINANCE_MAX_ABSOLUTE_AMOUNT } from "./finance-ledger-rules";

export const FINANCE_DEPOSIT_MIN_TERM_WEEKS = 1;
export const FINANCE_DEPOSIT_MAX_TERM_WEEKS = 52;
export const FINANCE_DEPOSIT_MAX_RATE_BPS = 10_000;
export const FINANCE_DEPOSIT_WEEK_MS = 7 * 24 * 60 * 60 * 1_000;
export const FINANCE_DEPOSIT_SETTLEMENT_BATCH_SIZE = 3;

const MAX_JAVASCRIPT_DATE_MS = 8_640_000_000_000_000;

export type FinanceDepositRuleErrorCode =
  | "FINANCE_DEPOSIT_INPUT_REQUIRED"
  | "FINANCE_DEPOSIT_INPUT_TOO_LONG"
  | "FINANCE_DEPOSIT_INVALID_AMOUNT"
  | "FINANCE_DEPOSIT_INVALID_AMOUNT_RANGE"
  | "FINANCE_DEPOSIT_AMOUNT_OUT_OF_RANGE"
  | "FINANCE_DEPOSIT_INVALID_TERM"
  | "FINANCE_DEPOSIT_INVALID_RATE"
  | "FINANCE_DEPOSIT_INVALID_TIME"
  | "FINANCE_DEPOSIT_PAYOUT_LIMIT";

export class FinanceDepositRuleError extends Error {
  constructor(
    message: string,
    public code: FinanceDepositRuleErrorCode,
  ) {
    super(message);
    this.name = "FinanceDepositRuleError";
  }
}

export function financeDepositSettlementEnabled(url: string | URL) {
  return new URL(url).searchParams.get("settleMatured") !== "0";
}

export type FinanceDepositProductInput = {
  name?: unknown;
  description?: unknown;
  termWeeks?: unknown;
  maturityInterestBps?: unknown;
  earlyInterestShareBps?: unknown;
  minAmount?: unknown;
  maxAmount?: unknown;
};

export type FinanceDepositProductValues = {
  name: string;
  description: string | null;
  termWeeks: number;
  maturityInterestBps: number;
  earlyInterestShareBps: number;
  minAmount: number;
  maxAmount: number;
};

export type FinanceDepositQuote = {
  principal: number;
  maturityInterestBps: number;
  earlyInterestShareBps: number;
  maturityInterest: number;
  earlyInterest: number;
  maturityPayout: number;
  earlyPayout: number;
};

function normalizedText(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/gu, " ")
    : "";
}

function requiredText(value: unknown, field: string, maxLength: number) {
  const normalized = normalizedText(value);
  if (!normalized) {
    throw new FinanceDepositRuleError(
      `${field}을 입력해 주세요.`,
      "FINANCE_DEPOSIT_INPUT_REQUIRED",
    );
  }
  if (normalized.length > maxLength) {
    throw new FinanceDepositRuleError(
      `${field}은 ${maxLength}자 이내로 입력해 주세요.`,
      "FINANCE_DEPOSIT_INPUT_TOO_LONG",
    );
  }
  return normalized;
}

function optionalText(value: unknown, field: string, maxLength: number) {
  if (value === undefined || value === null) return null;
  const normalized = normalizedText(value);
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new FinanceDepositRuleError(
      `${field}은 ${maxLength}자 이내로 입력해 주세요.`,
      "FINANCE_DEPOSIT_INPUT_TOO_LONG",
    );
  }
  return normalized;
}

function amount(value: unknown, field: string) {
  if (
    !Number.isSafeInteger(value)
    || Number(value) <= 0
    || Number(value) > FINANCE_MAX_ABSOLUTE_AMOUNT
  ) {
    throw new FinanceDepositRuleError(
      `${field}은 ${FINANCE_MAX_ABSOLUTE_AMOUNT.toLocaleString("ko-KR")} 이하의 0보다 큰 정수여야 합니다.`,
      "FINANCE_DEPOSIT_INVALID_AMOUNT",
    );
  }
  return Number(value);
}

function termWeeks(value: unknown) {
  if (
    !Number.isSafeInteger(value)
    || Number(value) < FINANCE_DEPOSIT_MIN_TERM_WEEKS
    || Number(value) > FINANCE_DEPOSIT_MAX_TERM_WEEKS
  ) {
    throw new FinanceDepositRuleError(
      `예금 기간은 ${FINANCE_DEPOSIT_MIN_TERM_WEEKS}주부터 ${FINANCE_DEPOSIT_MAX_TERM_WEEKS}주 사이의 정수여야 합니다.`,
      "FINANCE_DEPOSIT_INVALID_TERM",
    );
  }
  return Number(value);
}

function rateBps(value: unknown, field: string) {
  if (
    !Number.isSafeInteger(value)
    || Number(value) < 0
    || Number(value) > FINANCE_DEPOSIT_MAX_RATE_BPS
  ) {
    throw new FinanceDepositRuleError(
      `${field}은 0%부터 100% 사이로 입력해 주세요.`,
      "FINANCE_DEPOSIT_INVALID_RATE",
    );
  }
  return Number(value);
}

/**
 * Calculates the amounts stored on a deposit contract.
 *
 * Rates use basis points (100 bps = 1%). The maturity rate applies once to
 * the full principal. Early interest is the configured share of that already
 * rounded-down maturity interest, so every stored amount is an integer.
 */
export function calculateFinanceDepositQuote(input: {
  principal: unknown;
  maturityInterestBps: unknown;
  earlyInterestShareBps: unknown;
}): FinanceDepositQuote {
  const principal = amount(input.principal, "가입 금액");
  const maturityInterestBps = rateBps(
    input.maturityInterestBps,
    "만기 이자율",
  );
  const earlyInterestShareBps = rateBps(
    input.earlyInterestShareBps,
    "중도해지 이자 지급률",
  );
  const maturityInterest = Math.floor(
    (principal * maturityInterestBps) / FINANCE_DEPOSIT_MAX_RATE_BPS,
  );
  const earlyInterest = Math.floor(
    (maturityInterest * earlyInterestShareBps)
      / FINANCE_DEPOSIT_MAX_RATE_BPS,
  );
  const maturityPayout = principal + maturityInterest;
  const earlyPayout = principal + earlyInterest;

  if (
    !Number.isSafeInteger(maturityPayout)
    || !Number.isSafeInteger(earlyPayout)
    || maturityPayout > FINANCE_MAX_ABSOLUTE_AMOUNT
    || earlyPayout > FINANCE_MAX_ABSOLUTE_AMOUNT
  ) {
    throw new FinanceDepositRuleError(
      "이자를 더한 지급액이 한 번에 처리할 수 있는 금액을 넘습니다.",
      "FINANCE_DEPOSIT_PAYOUT_LIMIT",
    );
  }

  return {
    principal,
    maturityInterestBps,
    earlyInterestShareBps,
    maturityInterest,
    earlyInterest,
    maturityPayout,
    earlyPayout,
  };
}

export function normalizeFinanceDepositProduct(
  input: FinanceDepositProductInput,
): FinanceDepositProductValues {
  const minAmount = amount(input.minAmount, "최소 가입 금액");
  const maxAmount = amount(input.maxAmount, "최대 가입 금액");
  if (minAmount > maxAmount) {
    throw new FinanceDepositRuleError(
      "최소 가입 금액은 최대 가입 금액보다 클 수 없습니다.",
      "FINANCE_DEPOSIT_INVALID_AMOUNT_RANGE",
    );
  }

  const maturityInterestBps = rateBps(
    input.maturityInterestBps,
    "만기 이자율",
  );
  const earlyInterestShareBps = rateBps(
    input.earlyInterestShareBps,
    "중도해지 이자 지급률",
  );

  // A product must be safe even when a student joins for its maximum amount.
  calculateFinanceDepositQuote({
    principal: maxAmount,
    maturityInterestBps,
    earlyInterestShareBps,
  });

  return {
    name: requiredText(input.name, "예금상품 이름", 40),
    description: optionalText(input.description, "상품 설명", 200),
    termWeeks: termWeeks(input.termWeeks),
    maturityInterestBps,
    earlyInterestShareBps,
    minAmount,
    maxAmount,
  };
}

export function normalizeFinanceDepositPrincipal(
  value: unknown,
  limits: Pick<FinanceDepositProductValues, "minAmount" | "maxAmount">,
) {
  const principal = amount(value, "가입 금액");
  if (principal < limits.minAmount || principal > limits.maxAmount) {
    throw new FinanceDepositRuleError(
      "가입 금액이 상품의 가입 가능 범위를 벗어났습니다.",
      "FINANCE_DEPOSIT_AMOUNT_OUT_OF_RANGE",
    );
  }
  return principal;
}

/** Returns the UTC epoch-millisecond maturity instant after whole weeks. */
export function financeDepositMaturityAt(
  openedAt: unknown,
  weeks: unknown,
) {
  const normalizedWeeks = termWeeks(weeks);
  if (
    !Number.isSafeInteger(openedAt)
    || Number(openedAt) < 0
    || Number(openedAt) > MAX_JAVASCRIPT_DATE_MS
  ) {
    throw new FinanceDepositRuleError(
      "예금 시작 시각이 올바르지 않습니다.",
      "FINANCE_DEPOSIT_INVALID_TIME",
    );
  }
  const maturityAt = Number(openedAt)
    + (normalizedWeeks * FINANCE_DEPOSIT_WEEK_MS);
  if (
    !Number.isSafeInteger(maturityAt)
    || maturityAt > MAX_JAVASCRIPT_DATE_MS
  ) {
    throw new FinanceDepositRuleError(
      "예금 만기 시각을 계산할 수 없습니다.",
      "FINANCE_DEPOSIT_INVALID_TIME",
    );
  }
  return maturityAt;
}
