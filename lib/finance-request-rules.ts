import {
  FINANCE_MAX_ABSOLUTE_AMOUNT,
  stableFinanceJson,
} from "./finance-ledger-rules";

export type FinanceCashRequestType = "deposit" | "withdrawal";
export type FinanceCashRequestDecision = "approve" | "reject";

export class FinanceRequestRuleError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

function optionalText(
  value: unknown,
  field: string,
  maxLength: number,
) {
  if (value === undefined || value === null) return null;
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new FinanceRequestRuleError(
      `${field} 내용이 너무 깁니다.`,
      "FINANCE_INPUT_TOO_LONG",
    );
  }
  return normalized;
}

function requiredText(
  value: unknown,
  field: string,
  maxLength: number,
) {
  const normalized = optionalText(value, field, maxLength);
  if (!normalized) {
    throw new FinanceRequestRuleError(
      `${field} 값을 입력해 주세요.`,
      "FINANCE_INPUT_REQUIRED",
    );
  }
  return normalized;
}

function idempotencyKey(value: unknown) {
  const normalized = requiredText(value, "요청 번호", 160);
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(normalized)) {
    throw new FinanceRequestRuleError(
      "요청 번호 형식이 올바르지 않습니다.",
      "FINANCE_INVALID_IDEMPOTENCY_KEY",
    );
  }
  return normalized;
}

function expectedRevision(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new FinanceRequestRuleError(
      "최신 요청 상태를 다시 확인해 주세요.",
      "FINANCE_INVALID_REVISION",
    );
  }
  return Number(value);
}

export function normalizeFinanceCashRequest(input: {
  requestType?: unknown;
  amount?: unknown;
  memo?: unknown;
  idempotencyKey?: unknown;
}) {
  if (input.requestType !== "deposit" && input.requestType !== "withdrawal") {
    throw new FinanceRequestRuleError(
      "입금 또는 출금 중 하나를 선택해 주세요.",
      "FINANCE_INVALID_REQUEST_TYPE",
    );
  }
  if (
    !Number.isSafeInteger(input.amount)
    || Number(input.amount) <= 0
    || Number(input.amount) > FINANCE_MAX_ABSOLUTE_AMOUNT
  ) {
    throw new FinanceRequestRuleError(
      "금액은 0보다 큰 정수로 입력해 주세요.",
      "FINANCE_INVALID_AMOUNT",
    );
  }
  return {
    requestType: input.requestType as FinanceCashRequestType,
    amount: Number(input.amount),
    memo: optionalText(input.memo, "메모", 200),
    idempotencyKey: idempotencyKey(input.idempotencyKey),
  };
}

export function financeCashRequestPayload(input: {
  requestType: FinanceCashRequestType;
  amount: number;
  memo: string | null;
}) {
  return stableFinanceJson({
    requestType: input.requestType,
    amount: input.amount,
    memo: input.memo,
  });
}

export function normalizeFinanceRequestCancel(input: {
  expectedRevision?: unknown;
  idempotencyKey?: unknown;
}) {
  return {
    expectedRevision: expectedRevision(input.expectedRevision),
    idempotencyKey: idempotencyKey(input.idempotencyKey),
  };
}

export function normalizeFinanceRequestDecision(
  input: {
    decision?: unknown;
    expectedRevision?: unknown;
    idempotencyKey?: unknown;
    reasonCode?: unknown;
    reasonNote?: unknown;
    interventionReason?: unknown;
  },
  options: { requireTeacherInterventionReason: boolean },
) {
  if (input.decision !== "approve" && input.decision !== "reject") {
    throw new FinanceRequestRuleError(
      "승인 또는 거절 중 하나를 선택해 주세요.",
      "FINANCE_INVALID_DECISION",
    );
  }
  const reasonCode = optionalText(input.reasonCode, "처리 사유 코드", 64);
  if (reasonCode && !/^[a-z][a-z0-9_]{1,63}$/.test(reasonCode)) {
    throw new FinanceRequestRuleError(
      "처리 사유 코드 형식이 올바르지 않습니다.",
      "FINANCE_INVALID_REASON_CODE",
    );
  }
  const reasonNote = optionalText(input.reasonNote, "처리 메모", 300);
  if (input.decision === "reject" && !reasonCode && !reasonNote) {
    throw new FinanceRequestRuleError(
      "거절 사유를 선택하거나 입력해 주세요.",
      "FINANCE_REJECTION_REASON_REQUIRED",
    );
  }
  const interventionReason = optionalText(
    input.interventionReason,
    "교사 개입 사유",
    500,
  );
  if (options.requireTeacherInterventionReason && !interventionReason) {
    throw new FinanceRequestRuleError(
      "교사가 대신 처리한 이유를 입력해 주세요.",
      "FINANCE_INTERVENTION_REASON_REQUIRED",
    );
  }
  return {
    decision: input.decision,
    expectedRevision: expectedRevision(input.expectedRevision),
    idempotencyKey: idempotencyKey(input.idempotencyKey),
    reasonCode,
    reasonNote,
    interventionReason,
  };
}

export function financeRequestDecisionPayload(input: {
  requestId: string;
  decision: FinanceCashRequestDecision;
  expectedRevision: number;
  reasonCode: string | null;
  reasonNote: string | null;
  interventionReason: string | null;
}) {
  return stableFinanceJson(input);
}

export function normalizeFinanceReversal(input: {
  reason?: unknown;
  idempotencyKey?: unknown;
}) {
  return {
    reason: requiredText(input.reason, "정정 사유", 500),
    idempotencyKey: idempotencyKey(input.idempotencyKey),
  };
}

export function normalizeFinanceResourceId(value: unknown, label: string) {
  const normalized = requiredText(value, label, 160);
  if (!/^[A-Za-z0-9:._-]{1,160}$/.test(normalized)) {
    throw new FinanceRequestRuleError(
      `${label} 형식이 올바르지 않습니다.`,
      "FINANCE_INVALID_RESOURCE_ID",
    );
  }
  return normalized;
}
