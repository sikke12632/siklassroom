import { FINANCE_MAX_ABSOLUTE_AMOUNT } from "./finance-ledger-rules";

export const FINANCE_FUNDING_MIN_DURATION_DAYS = 1;
export const FINANCE_FUNDING_MAX_DURATION_DAYS = 31;
export const FINANCE_FUNDING_DAY_MS = 24 * 60 * 60 * 1_000;
export const FINANCE_FUNDING_PROCESS_BATCH_SIZE = 8;
const FINANCE_FUNDING_SEOUL_OFFSET_MS = 9 * 60 * 60 * 1_000;

export const FINANCE_FUNDING_STATUSES = [
  "active",
  "paused",
  "funded",
  "refunding",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type FinanceFundingStatus = typeof FINANCE_FUNDING_STATUSES[number];
export type FinanceFundingAction = "edit" | "pause" | "resume" | "cancel";

export class FinanceFundingRuleError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "FinanceFundingRuleError";
  }
}

function normalizedText(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/gu, " ")
    : "";
}

function requiredText(value: unknown, label: string, maxLength: number) {
  const normalized = normalizedText(value);
  if (!normalized) {
    throw new FinanceFundingRuleError(
      `${label}을 입력해 주세요.`,
      "FINANCE_FUNDING_INPUT_REQUIRED",
    );
  }
  if (normalized.length > maxLength) {
    throw new FinanceFundingRuleError(
      `${label}은 ${maxLength}자 이내로 입력해 주세요.`,
      "FINANCE_FUNDING_INPUT_TOO_LONG",
    );
  }
  return normalized;
}

function optionalText(value: unknown, label: string, maxLength: number) {
  if (value === undefined || value === null) return "";
  const normalized = normalizedText(value);
  if (normalized.length > maxLength) {
    throw new FinanceFundingRuleError(
      `${label}은 ${maxLength}자 이내로 입력해 주세요.`,
      "FINANCE_FUNDING_INPUT_TOO_LONG",
    );
  }
  return normalized;
}

function positiveAmount(value: unknown, label: string) {
  if (
    !Number.isSafeInteger(value)
    || Number(value) <= 0
    || Number(value) > FINANCE_MAX_ABSOLUTE_AMOUNT
  ) {
    throw new FinanceFundingRuleError(
      `${label}은 0보다 크고 ${FINANCE_MAX_ABSOLUTE_AMOUNT.toLocaleString("ko-KR")} 이하인 정수여야 합니다.`,
      "FINANCE_FUNDING_INVALID_AMOUNT",
    );
  }
  return Number(value);
}

function deadlineValue(value: unknown) {
  const deadlineAt = Number(value);
  if (!Number.isSafeInteger(deadlineAt) || deadlineAt < 0) {
    throw new FinanceFundingRuleError(
      "마감일을 다시 선택해 주세요.",
      "FINANCE_FUNDING_INVALID_DEADLINE",
    );
  }
  return deadlineAt;
}

function assertDeadlineWindow(deadlineAt: number, nowValue: unknown) {
  const now = Number(nowValue ?? Date.now());
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new FinanceFundingRuleError(
      "마감일을 다시 선택해 주세요.",
      "FINANCE_FUNDING_INVALID_DEADLINE",
    );
  }
  const duration = deadlineAt - now;
  if (
    duration < FINANCE_FUNDING_MIN_DURATION_DAYS * FINANCE_FUNDING_DAY_MS
    || duration > FINANCE_FUNDING_MAX_DURATION_DAYS * FINANCE_FUNDING_DAY_MS
  ) {
    throw new FinanceFundingRuleError(
      `마감일은 지금부터 ${FINANCE_FUNDING_MIN_DURATION_DAYS}일 이후, ${FINANCE_FUNDING_MAX_DURATION_DAYS}일 이내로 정해 주세요.`,
      "FINANCE_FUNDING_INVALID_DEADLINE",
    );
  }
}

export function normalizeFinanceFundingCampaignFields(input: {
  title?: unknown;
  description?: unknown;
  targetAmount?: unknown;
  deadlineAt?: unknown;
}) {
  return {
    title: requiredText(input.title, "펀딩 제목", 50),
    description: optionalText(input.description, "펀딩 설명", 300),
    targetAmount: positiveAmount(input.targetAmount, "목표 금액"),
    deadlineAt: deadlineValue(input.deadlineAt),
  };
}

export function normalizeFinanceFundingCampaign(input: {
  title?: unknown;
  description?: unknown;
  targetAmount?: unknown;
  deadlineAt?: unknown;
  now?: unknown;
}) {
  const values = normalizeFinanceFundingCampaignFields(input);
  assertDeadlineWindow(values.deadlineAt, input.now);
  return values;
}

export function normalizeFinanceFundingCampaignEdit(
  input: {
    title?: unknown;
    description?: unknown;
    targetAmount?: unknown;
    deadlineAt?: unknown;
    now?: unknown;
  },
  current: { deadlineAt: number },
) {
  const values = normalizeFinanceFundingCampaignFields(input);
  if (values.deadlineAt !== Number(current.deadlineAt)) {
    assertDeadlineWindow(values.deadlineAt, input.now);
  }
  return values;
}

function seoulDateInput(epochMs: number) {
  return new Date(epochMs + FINANCE_FUNDING_SEOUL_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

export function financeFundingDeadlineInputRange(nowValue: unknown) {
  const now = Number(nowValue);
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new FinanceFundingRuleError(
      "마감일을 다시 선택해 주세요.",
      "FINANCE_FUNDING_INVALID_DEADLINE",
    );
  }
  return {
    minDate: seoulDateInput(now + FINANCE_FUNDING_DAY_MS),
    maxDate: seoulDateInput(
      now + ((FINANCE_FUNDING_MAX_DURATION_DAYS - 1) * FINANCE_FUNDING_DAY_MS),
    ),
    defaultDate: seoulDateInput(now + (7 * FINANCE_FUNDING_DAY_MS)),
  };
}

export function financeFundingDeadlineAtEndOfSeoulDay(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) {
    throw new FinanceFundingRuleError(
      "마감일을 다시 선택해 주세요.",
      "FINANCE_FUNDING_INVALID_DEADLINE",
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const deadlineAt = Date.UTC(year, month - 1, day + 1)
    - FINANCE_FUNDING_SEOUL_OFFSET_MS
    - 1;
  if (seoulDateInput(deadlineAt) !== normalized) {
    throw new FinanceFundingRuleError(
      "마감일을 다시 선택해 주세요.",
      "FINANCE_FUNDING_INVALID_DEADLINE",
    );
  }
  return deadlineAt;
}

export function financeFundingActionRequest(input: {
  action: FinanceFundingAction;
  campaignId: string;
  classId: string;
  expectedRevision: number;
  actorType: "teacher" | "student";
  actorId: string;
  interventionReason: string | null;
  editValues: ReturnType<typeof normalizeFinanceFundingCampaignFields> | null;
}) {
  return {
    action: input.action,
    actor: { id: input.actorId, type: input.actorType },
    campaignId: input.campaignId,
    classId: input.classId,
    editValues: input.action === "edit" ? input.editValues : null,
    expectedRevision: input.expectedRevision,
    interventionReason: input.interventionReason,
  };
}

export function normalizeFinanceFundingContribution(input: {
  amount?: unknown;
  remainingAmount: unknown;
}) {
  const amount = positiveAmount(input.amount, "참여 금액");
  const remainingAmount = positiveAmount(input.remainingAmount, "남은 목표 금액");
  if (amount > remainingAmount) {
    throw new FinanceFundingRuleError(
      `남은 목표 금액 ${remainingAmount.toLocaleString("ko-KR")}을 넘게 참여할 수 없습니다.`,
      "FINANCE_FUNDING_OVER_TARGET",
    );
  }
  return {
    amount,
    remainingAmount,
    reachesTarget: amount === remainingAmount,
  };
}

export function normalizeFinanceFundingAction(value: unknown): FinanceFundingAction {
  if (value === "edit" || value === "pause" || value === "resume" || value === "cancel") {
    return value;
  }
  throw new FinanceFundingRuleError(
    "펀딩 작업을 다시 선택해 주세요.",
    "FINANCE_FUNDING_INVALID_ACTION",
  );
}

export function assertFinanceFundingTransition(input: {
  action: FinanceFundingAction;
  status: FinanceFundingStatus;
  pledgedAmount: number;
  isCreator: boolean;
  isTeacher: boolean;
}) {
  if (input.isTeacher) {
    if (input.action !== "cancel") {
      throw new FinanceFundingRuleError(
        "선생님은 문제 발생 시 펀딩 취소와 환불만 처리할 수 있습니다.",
        "FINANCE_FUNDING_TEACHER_ACTION_DENIED",
      );
    }
  } else if (!input.isCreator) {
    throw new FinanceFundingRuleError(
      "이 펀딩을 만든 학생만 관리할 수 있습니다.",
      "FINANCE_FUNDING_CREATOR_REQUIRED",
    );
  }

  if (input.action === "edit") {
    if (!input.isCreator || !["active", "paused"].includes(input.status)) {
      throw new FinanceFundingRuleError(
        "현재 상태에서는 펀딩 내용을 수정할 수 없습니다.",
        "FINANCE_FUNDING_INVALID_TRANSITION",
      );
    }
    if (input.pledgedAmount > 0) {
      throw new FinanceFundingRuleError(
        "참여가 시작된 뒤에는 목표 금액과 마감일을 바꿀 수 없습니다.",
        "FINANCE_FUNDING_EDIT_LOCKED",
      );
    }
    return;
  }
  if (input.action === "pause" && input.status !== "active") {
    throw new FinanceFundingRuleError(
      "모금 중인 펀딩만 잠시 멈출 수 있습니다.",
      "FINANCE_FUNDING_INVALID_TRANSITION",
    );
  }
  if (input.action === "resume" && input.status !== "paused") {
    throw new FinanceFundingRuleError(
      "일시정지한 펀딩만 다시 시작할 수 있습니다.",
      "FINANCE_FUNDING_INVALID_TRANSITION",
    );
  }
  if (input.action === "cancel" && !["active", "paused"].includes(input.status)) {
    throw new FinanceFundingRuleError(
      "이미 마감됐거나 정산 중인 펀딩은 취소할 수 없습니다.",
      "FINANCE_FUNDING_INVALID_TRANSITION",
    );
  }
}

export function financeFundingTerminalStatus(
  terminalReason: string | null,
): "failed" | "cancelled" {
  return terminalReason === "deadline" ? "failed" : "cancelled";
}

export function financeFundingProgress(pledgedAmount: number, targetAmount: number) {
  if (!Number.isFinite(targetAmount) || targetAmount <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((pledgedAmount / targetAmount) * 100)));
}
