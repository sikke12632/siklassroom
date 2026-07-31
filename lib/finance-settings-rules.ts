import {
  FINANCE_MAX_ABSOLUTE_AMOUNT,
  stableFinanceJson,
} from "./finance-ledger-rules";

export const DEFAULT_FINANCE_SETTINGS = {
  currencyName: "우리 반 화폐",
  currencyUnit: "학급화폐",
  denominations: [100, 500, 1000, 5000],
  bankOpen: true,
  depositEnabled: true,
  withdrawalEnabled: true,
  bankerProcessingEnabled: true,
  maxRequestAmount: 100_000,
} as const;

export type FinanceSettingsValues = {
  currencyName: string;
  currencyUnit: string;
  denominations: number[];
  bankOpen: boolean;
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  bankerProcessingEnabled: boolean;
  maxRequestAmount: number;
};

export function financeDenominationStep(
  denominationsValue: readonly number[],
) {
  return Math.min(...denominationsValue);
}

export function financeAmountMatchesDenominations(
  amount: number,
  denominationsValue: readonly number[],
) {
  const step = financeDenominationStep(denominationsValue);
  return Number.isSafeInteger(step) && step > 0 && amount % step === 0;
}

export class FinanceSettingsRuleError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

function requiredText(
  value: unknown,
  field: string,
  maxLength: number,
) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new FinanceSettingsRuleError(
      `${field}을 입력해 주세요.`,
      "FINANCE_SETTINGS_INPUT_REQUIRED",
    );
  }
  if (normalized.length > maxLength || /[\r\n]/.test(normalized)) {
    throw new FinanceSettingsRuleError(
      `${field}은 ${maxLength}자 이내 한 줄로 입력해 주세요.`,
      "FINANCE_SETTINGS_INPUT_TOO_LONG",
    );
  }
  return normalized;
}

function requiredBoolean(value: unknown, field: string) {
  if (typeof value !== "boolean") {
    throw new FinanceSettingsRuleError(
      `${field} 설정을 다시 확인해 주세요.`,
      "FINANCE_SETTINGS_INVALID_BOOLEAN",
    );
  }
  return value;
}

function expectedRevision(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new FinanceSettingsRuleError(
      "최신 금융 설정을 다시 불러와 주세요.",
      "FINANCE_SETTINGS_INVALID_REVISION",
    );
  }
  return Number(value);
}

function idempotencyKey(value: unknown) {
  const normalized = requiredText(value, "저장 요청 번호", 160);
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(normalized)) {
    throw new FinanceSettingsRuleError(
      "저장 요청 번호 형식이 올바르지 않습니다.",
      "FINANCE_SETTINGS_INVALID_IDEMPOTENCY_KEY",
    );
  }
  return normalized;
}

function denominations(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    throw new FinanceSettingsRuleError(
      "권종은 1개 이상 8개 이하로 등록해 주세요.",
      "FINANCE_SETTINGS_INVALID_DENOMINATIONS",
    );
  }
  const normalized = value.map(Number);
  if (
    normalized.some((amount) => (
      !Number.isSafeInteger(amount)
      || amount <= 0
      || amount > FINANCE_MAX_ABSOLUTE_AMOUNT
    ))
  ) {
    throw new FinanceSettingsRuleError(
      "권종은 0보다 큰 정수로 입력해 주세요.",
      "FINANCE_SETTINGS_INVALID_DENOMINATIONS",
    );
  }
  const unique = [...new Set(normalized)].sort((left, right) => left - right);
  if (unique.length !== normalized.length) {
    throw new FinanceSettingsRuleError(
      "같은 권종은 한 번만 등록할 수 있어요.",
      "FINANCE_SETTINGS_DUPLICATE_DENOMINATION",
    );
  }
  const smallest = unique[0];
  if (unique.some((amount) => amount % smallest !== 0)) {
    throw new FinanceSettingsRuleError(
      "모든 권종은 가장 작은 권종의 배수로 입력해 주세요.",
      "FINANCE_SETTINGS_INVALID_DENOMINATIONS",
    );
  }
  return unique;
}

export function normalizeFinanceSettingsUpdate(input: {
  currencyName?: unknown;
  currencyUnit?: unknown;
  denominations?: unknown;
  bankOpen?: unknown;
  depositEnabled?: unknown;
  withdrawalEnabled?: unknown;
  bankerProcessingEnabled?: unknown;
  maxRequestAmount?: unknown;
  expectedRevision?: unknown;
  idempotencyKey?: unknown;
  changeReason?: unknown;
}) {
  const normalizedDenominations = denominations(input.denominations);
  const maxRequestAmount = Number(input.maxRequestAmount);
  if (
    !Number.isSafeInteger(maxRequestAmount)
    || maxRequestAmount <= 0
    || maxRequestAmount > FINANCE_MAX_ABSOLUTE_AMOUNT
  ) {
    throw new FinanceSettingsRuleError(
      "한 번에 신청할 수 있는 최대 금액은 0보다 큰 정수로 입력해 주세요.",
      "FINANCE_SETTINGS_INVALID_MAX_AMOUNT",
    );
  }
  if (maxRequestAmount < normalizedDenominations[0]) {
    throw new FinanceSettingsRuleError(
      "최대 신청액은 가장 작은 권종보다 크거나 같아야 합니다.",
      "FINANCE_SETTINGS_INVALID_MAX_AMOUNT",
    );
  }
  const changeReason = requiredText(input.changeReason, "변경 이유", 300);
  if (changeReason.length < 2) {
    throw new FinanceSettingsRuleError(
      "변경 이유를 두 글자 이상 입력해 주세요.",
      "FINANCE_SETTINGS_INPUT_REQUIRED",
    );
  }
  return {
    values: {
      currencyName: requiredText(input.currencyName, "화폐 이름", 30),
      currencyUnit: requiredText(input.currencyUnit, "화폐 단위", 10),
      denominations: normalizedDenominations,
      bankOpen: requiredBoolean(input.bankOpen, "은행 운영"),
      depositEnabled: requiredBoolean(input.depositEnabled, "입금"),
      withdrawalEnabled: requiredBoolean(input.withdrawalEnabled, "출금"),
      bankerProcessingEnabled: requiredBoolean(
        input.bankerProcessingEnabled,
        "은행원 처리",
      ),
      maxRequestAmount,
    } satisfies FinanceSettingsValues,
    expectedRevision: expectedRevision(input.expectedRevision),
    idempotencyKey: idempotencyKey(input.idempotencyKey),
    changeReason,
  };
}

export function financeSettingsPayload(input: {
  values: FinanceSettingsValues;
  expectedRevision: number;
  changeReason: string;
}) {
  return stableFinanceJson(input);
}

export function financeSettingsJson(values: FinanceSettingsValues) {
  return stableFinanceJson(values);
}
