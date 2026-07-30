export const FINANCE_MAX_ABSOLUTE_AMOUNT = 1_000_000_000;
export const FINANCE_MAX_TRANSACTION_LINES = 20;

export type FinancePostingActor = {
  type: "teacher" | "banker" | "system";
  teacherId?: string | null;
  studentId?: string | null;
  bankerPeriodId?: string | null;
  label: string;
};

export type FinancePostingLine = {
  accountId: string;
  amount: number;
  memo?: string | null;
};

export type FinanceTransactionInput = {
  classId: string;
  idempotencyKey: string;
  transactionType: string;
  description: string;
  actor: FinancePostingActor;
  lines: FinancePostingLine[];
  sourceType?: string | null;
  sourceId?: string | null;
  reversalOfTransactionId?: string | null;
  metadata?: unknown;
};

export type NormalizedFinanceTransaction = {
  classId: string;
  idempotencyKey: string;
  transactionType: string;
  description: string;
  actor: Required<Omit<FinancePostingActor, "type">> & {
    type: FinancePostingActor["type"];
  };
  lines: Array<{
    accountId: string;
    amount: number;
    memo: string | null;
  }>;
  sourceType: string | null;
  sourceId: string | null;
  reversalOfTransactionId: string | null;
  metadataJson: string | null;
};

export class FinanceRuleError extends Error {
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
    throw new FinanceRuleError(`${field} 값이 필요합니다.`, "FINANCE_INPUT_REQUIRED");
  }
  if (normalized.length > maxLength) {
    throw new FinanceRuleError(`${field} 값이 너무 깁니다.`, "FINANCE_INPUT_TOO_LONG");
  }
  return normalized;
}

function optionalText(value: unknown, field: string, maxLength: number) {
  if (value === undefined || value === null) return null;
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new FinanceRuleError(`${field} 값이 너무 깁니다.`, "FINANCE_INPUT_TOO_LONG");
  }
  return normalized;
}

function stableValue(value: unknown, seen: WeakSet<object>): unknown {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new FinanceRuleError("숫자 정보가 올바르지 않습니다.", "FINANCE_INVALID_METADATA");
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new FinanceRuleError("반복되는 메타데이터 구조는 저장할 수 없습니다.", "FINANCE_INVALID_METADATA");
    }
    seen.add(value);
    const normalized = value.map((item) => stableValue(item, seen));
    seen.delete(value);
    return normalized;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (seen.has(object)) {
      throw new FinanceRuleError("반복되는 메타데이터 구조는 저장할 수 없습니다.", "FINANCE_INVALID_METADATA");
    }
    seen.add(object);
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(object).sort()) {
      const item = object[key];
      if (item !== undefined) normalized[key] = stableValue(item, seen);
    }
    seen.delete(object);
    return normalized;
  }
  throw new FinanceRuleError("저장할 수 없는 메타데이터 형식입니다.", "FINANCE_INVALID_METADATA");
}

export function stableFinanceJson(value: unknown) {
  return JSON.stringify(stableValue(value, new WeakSet()));
}

function normalizeActor(actor: FinancePostingActor) {
  const label = requiredText(actor.label, "처리자 이름", 80);
  const teacherId = optionalText(actor.teacherId, "교사 ID", 100);
  const studentId = optionalText(actor.studentId, "학생 ID", 100);
  const bankerPeriodId = optionalText(actor.bankerPeriodId, "은행원 직업 기간 ID", 100);

  if (actor.type === "teacher" && (!teacherId || studentId || bankerPeriodId)) {
    throw new FinanceRuleError("교사 처리자 정보가 올바르지 않습니다.", "FINANCE_INVALID_ACTOR");
  }
  if (actor.type === "banker" && (!studentId || teacherId || !bankerPeriodId)) {
    throw new FinanceRuleError("은행원 처리자 정보가 올바르지 않습니다.", "FINANCE_INVALID_ACTOR");
  }
  if (actor.type === "system" && (teacherId || studentId || bankerPeriodId)) {
    throw new FinanceRuleError("시스템 처리자 정보가 올바르지 않습니다.", "FINANCE_INVALID_ACTOR");
  }

  return {
    type: actor.type,
    teacherId,
    studentId,
    bankerPeriodId,
    label,
  };
}

export function normalizeFinanceTransaction(
  input: FinanceTransactionInput,
): NormalizedFinanceTransaction {
  const classId = requiredText(input.classId, "학급 ID", 100);
  const idempotencyKey = requiredText(input.idempotencyKey, "중복 방지 키", 160);
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(idempotencyKey)) {
    throw new FinanceRuleError("중복 방지 키 형식이 올바르지 않습니다.", "FINANCE_INVALID_IDEMPOTENCY_KEY");
  }

  const transactionType = requiredText(input.transactionType, "거래 종류", 64);
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(transactionType)) {
    throw new FinanceRuleError("거래 종류 형식이 올바르지 않습니다.", "FINANCE_INVALID_TRANSACTION_TYPE");
  }

  const sourceType = optionalText(input.sourceType, "출처 종류", 64);
  const sourceId = optionalText(input.sourceId, "출처 ID", 160);
  if ((sourceType === null) !== (sourceId === null)) {
    throw new FinanceRuleError("거래 출처 종류와 ID를 함께 입력해야 합니다.", "FINANCE_INVALID_SOURCE");
  }
  if (sourceType && !/^[a-z][a-z0-9_]{1,63}$/.test(sourceType)) {
    throw new FinanceRuleError("거래 출처 형식이 올바르지 않습니다.", "FINANCE_INVALID_SOURCE");
  }

  const reversalOfTransactionId = optionalText(
    input.reversalOfTransactionId,
    "원거래 ID",
    100,
  );
  if ((transactionType === "reversal") !== Boolean(reversalOfTransactionId)) {
    throw new FinanceRuleError(
      "취소 거래에는 원거래 ID가 필요합니다.",
      "FINANCE_INVALID_REVERSAL",
    );
  }

  if (!Array.isArray(input.lines) || input.lines.length < 2) {
    throw new FinanceRuleError(
      "거래에는 서로 반대되는 원장 항목이 두 개 이상 필요합니다.",
      "FINANCE_UNBALANCED_TRANSACTION",
    );
  }
  if (input.lines.length > FINANCE_MAX_TRANSACTION_LINES) {
    throw new FinanceRuleError(
      "한 번에 처리할 수 있는 원장 항목 수를 넘었습니다.",
      "FINANCE_TOO_MANY_LINES",
    );
  }

  const accountIds = new Set<string>();
  let total = 0;
  const lines = input.lines.map((line) => {
    const accountId = requiredText(line.accountId, "계좌 ID", 180);
    if (accountIds.has(accountId)) {
      throw new FinanceRuleError(
        "한 거래에서 같은 계좌를 두 번 사용할 수 없습니다.",
        "FINANCE_DUPLICATE_ACCOUNT",
      );
    }
    accountIds.add(accountId);
    if (
      !Number.isSafeInteger(line.amount)
      || line.amount === 0
      || Math.abs(line.amount) > FINANCE_MAX_ABSOLUTE_AMOUNT
    ) {
      throw new FinanceRuleError(
        "금액은 허용 범위 안의 0이 아닌 정수여야 합니다.",
        "FINANCE_INVALID_AMOUNT",
      );
    }
    total += line.amount;
    return {
      accountId,
      amount: line.amount,
      memo: optionalText(line.memo, "원장 메모", 200),
    };
  }).sort((left, right) => left.accountId.localeCompare(right.accountId));

  if (!Number.isSafeInteger(total) || total !== 0) {
    throw new FinanceRuleError(
      "거래의 전체 증감 합계는 반드시 0이어야 합니다.",
      "FINANCE_UNBALANCED_TRANSACTION",
    );
  }

  const metadataJson = input.metadata === undefined
    ? null
    : stableFinanceJson(input.metadata);
  if (metadataJson && metadataJson.length > 4000) {
    throw new FinanceRuleError(
      "거래 부가정보가 너무 깁니다.",
      "FINANCE_METADATA_TOO_LONG",
    );
  }

  return {
    classId,
    idempotencyKey,
    transactionType,
    description: requiredText(input.description, "거래 사유", 200),
    actor: normalizeActor(input.actor),
    lines,
    sourceType,
    sourceId,
    reversalOfTransactionId,
    metadataJson,
  };
}

export function financeTransactionPayload(
  transaction: NormalizedFinanceTransaction,
) {
  return stableFinanceJson({
    classId: transaction.classId,
    transactionType: transaction.transactionType,
    description: transaction.description,
    actor: transaction.actor,
    lines: transaction.lines,
    sourceType: transaction.sourceType,
    sourceId: transaction.sourceId,
    reversalOfTransactionId: transaction.reversalOfTransactionId,
    metadataJson: transaction.metadataJson,
  });
}
