import { sha256 } from "./crypto";
import { database } from "./database";
import {
  type FinanceContext,
  financeContextForRequest,
} from "./finance-access";
import {
  DEFAULT_FINANCE_SETTINGS,
  FinanceSettingsRuleError,
  type FinanceSettingsValues,
  financeAmountMatchesDenominations,
  financeDenominationStep,
  financeSettingsJson,
  financeSettingsPayload,
  normalizeFinanceSettingsUpdate,
} from "./finance-settings-rules";
import { ApiError } from "./responses";

type FinanceSettingsRow = {
  class_id: string;
  currency_name: string;
  currency_unit: string;
  denominations_json: string;
  bank_open: number;
  deposit_enabled: number;
  withdrawal_enabled: number;
  banker_processing_enabled: number;
  max_request_amount: number;
  revision: number;
  updated_at: number;
};

type FinanceSettingRevisionRow = {
  id: string;
  class_id: string;
  revision: number;
  idempotency_key: string;
  payload_hash: string;
  settings_json: string;
  created_at: number;
};

function settingsFromRevision(
  row: FinanceSettingRevisionRow,
): FinanceSettingsView {
  try {
    const values = JSON.parse(row.settings_json) as FinanceSettingsValues;
    if (
      !values
      || typeof values.currencyName !== "string"
      || typeof values.currencyUnit !== "string"
      || !Array.isArray(values.denominations)
      || values.denominations.length === 0
      || values.denominations.some(
        (amount) => !Number.isSafeInteger(amount) || amount <= 0,
      )
      || typeof values.bankOpen !== "boolean"
      || typeof values.depositEnabled !== "boolean"
      || typeof values.withdrawalEnabled !== "boolean"
      || typeof values.bankerProcessingEnabled !== "boolean"
      || !Number.isSafeInteger(values.maxRequestAmount)
      || values.maxRequestAmount <= 0
    ) {
      throw new Error("invalid settings revision");
    }
    return {
      ...values,
      denominations: [...values.denominations],
      revision: Number(row.revision),
      updatedAt: Number(row.created_at),
    };
  } catch {
    throw new ApiError(
      500,
      "저장된 금융 설정 기록을 확인하지 못했습니다.",
      "FINANCE_SETTINGS_AUDIT_INVALID",
    );
  }
}

export type FinanceSettingsView = FinanceSettingsValues & {
  revision: number;
  updatedAt: number;
};

function parseDenominations(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (
      Array.isArray(parsed)
      && parsed.length > 0
      && parsed.every((amount) => Number.isSafeInteger(amount) && amount > 0)
    ) {
      return parsed as number[];
    }
  } catch {
    // A malformed stored value falls back to safe defaults instead of
    // preventing the finance portal from opening.
  }
  return [...DEFAULT_FINANCE_SETTINGS.denominations];
}

function serializeSettings(row: FinanceSettingsRow): FinanceSettingsView {
  return {
    currencyName: row.currency_name,
    currencyUnit: row.currency_unit,
    denominations: parseDenominations(row.denominations_json),
    bankOpen: Boolean(row.bank_open),
    depositEnabled: Boolean(row.deposit_enabled),
    withdrawalEnabled: Boolean(row.withdrawal_enabled),
    bankerProcessingEnabled: Boolean(row.banker_processing_enabled),
    maxRequestAmount: Number(row.max_request_amount),
    revision: Number(row.revision),
    updatedAt: Number(row.updated_at),
  };
}

function valuesFromView(settings: FinanceSettingsView): FinanceSettingsValues {
  return {
    currencyName: settings.currencyName,
    currencyUnit: settings.currencyUnit,
    denominations: [...settings.denominations],
    bankOpen: settings.bankOpen,
    depositEnabled: settings.depositEnabled,
    withdrawalEnabled: settings.withdrawalEnabled,
    bankerProcessingEnabled: settings.bankerProcessingEnabled,
    maxRequestAmount: settings.maxRequestAmount,
  };
}

async function settingsRow(classId: string) {
  return database().prepare(
    `SELECT class_id, currency_name, currency_unit, denominations_json,
            bank_open, deposit_enabled, withdrawal_enabled,
            banker_processing_enabled, max_request_amount, revision, updated_at
     FROM finance_settings
     WHERE class_id = ?
     LIMIT 1`,
  ).bind(classId).first<FinanceSettingsRow>();
}

export async function financeSettingsForClass(classId: string) {
  const row = await settingsRow(classId);
  if (!row) {
    throw new ApiError(
      500,
      "학급 금융 설정을 준비하지 못했습니다.",
      "FINANCE_SETTINGS_UNAVAILABLE",
    );
  }
  return serializeSettings(row);
}

function settingsRuleError(error: unknown): never {
  if (error instanceof FinanceSettingsRuleError) {
    throw new ApiError(400, error.message, error.code);
  }
  throw error;
}

function mapSettingsDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("FINANCE_PAYROLL_PENDING_DENOMINATIONS")) {
    throw new ApiError(
      409,
      "지급 중인 직업 월급을 먼저 완료한 뒤 화폐 권종을 바꿔 주세요.",
      "FINANCE_PAYROLL_PENDING_DENOMINATIONS",
    );
  }
  if (message.includes("FINANCE_SETTINGS_STALE")) {
    throw new ApiError(
      409,
      "다른 화면에서 금융 설정을 먼저 바꿨어요. 최신 설정을 다시 불러왔습니다.",
      "FINANCE_SETTINGS_STALE",
    );
  }
  if (message.includes("FINANCE_SETTINGS_ACCESS_DENIED")) {
    throw new ApiError(
      403,
      "이 학급의 금융 설정을 바꿀 수 없습니다.",
      "FINANCE_SETTINGS_ACCESS_DENIED",
    );
  }
  if (message.includes("FINANCE_SETTINGS_INVALID_DENOMINATIONS")) {
    throw new ApiError(
      400,
      "권종을 다시 확인해 주세요.",
      "FINANCE_SETTINGS_INVALID_DENOMINATIONS",
    );
  }
  if (
    message.includes("finance_setting_revisions_class_revision_uq")
    || message.includes(
      "finance_setting_revisions.class_id, finance_setting_revisions.revision",
    )
  ) {
    throw new ApiError(
      409,
      "다른 화면에서 금융 설정을 먼저 바꿨어요. 최신 설정을 다시 불러왔습니다.",
      "FINANCE_SETTINGS_STALE",
    );
  }
  if (
    message.includes("finance_setting_revisions_class_idempotency_uq")
    || message.includes(
      "finance_setting_revisions.class_id, finance_setting_revisions.idempotency_key",
    )
  ) {
    throw new ApiError(
      409,
      "같은 저장 요청이 이미 다른 내용으로 사용되었습니다.",
      "FINANCE_SETTINGS_IDEMPOTENCY_CONFLICT",
    );
  }
  throw error;
}

async function revisionByIdempotency(
  classId: string,
  idempotencyKey: string,
) {
  return database().prepare(
    `SELECT id, class_id, revision, idempotency_key, payload_hash,
            settings_json, created_at
     FROM finance_setting_revisions
     WHERE class_id = ? AND idempotency_key = ?
     LIMIT 1`,
  ).bind(classId, idempotencyKey).first<FinanceSettingRevisionRow>();
}

function assertTeacherSettingsContext(context: FinanceContext) {
  if (context.financeRole !== "teacher" || context.actor.type !== "teacher") {
    throw new ApiError(
      403,
      "금융 설정은 담임 선생님만 바꿀 수 있습니다.",
      "FINANCE_SETTINGS_TEACHER_REQUIRED",
    );
  }
  if (context.classroom.status !== "active") {
    throw new ApiError(
      409,
      "보관된 학급의 금융 설정은 바꿀 수 없습니다.",
      "FINANCE_CLASS_ARCHIVED",
    );
  }
}

export async function financeSettingsForRequest(request: Request) {
  const context = await financeContextForRequest(request);
  return {
    context,
    settings: await financeSettingsForClass(context.classroom.id),
  };
}

export async function updateFinanceSettings(
  request: Request,
  input: {
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
  },
) {
  const context = await financeContextForRequest(request);
  assertTeacherSettingsContext(context);
  let normalized: ReturnType<typeof normalizeFinanceSettingsUpdate>;
  try {
    normalized = normalizeFinanceSettingsUpdate(input);
  } catch (error) {
    settingsRuleError(error);
  }

  const payloadHash = await sha256(financeSettingsPayload({
    values: normalized.values,
    expectedRevision: normalized.expectedRevision,
    changeReason: normalized.changeReason,
  }));
  const duplicate = await revisionByIdempotency(
    context.classroom.id,
    normalized.idempotencyKey,
  );
  if (duplicate) {
    if (duplicate.payload_hash !== payloadHash) {
      throw new ApiError(
        409,
        "같은 저장 요청이 이미 다른 내용으로 사용되었습니다.",
        "FINANCE_SETTINGS_IDEMPOTENCY_CONFLICT",
      );
    }
    return {
      settings: settingsFromRevision(duplicate),
      deduplicated: true,
    };
  }

  const current = await financeSettingsForClass(context.classroom.id);
  if (current.revision !== normalized.expectedRevision) {
    throw new ApiError(
      409,
      "다른 화면에서 금융 설정을 먼저 바꿨어요. 최신 설정을 다시 불러왔습니다.",
      "FINANCE_SETTINGS_STALE",
    );
  }

  const now = Date.now();
  const nextRevision = current.revision + 1;
  const revisionId = crypto.randomUUID();
  const denominationsJson = JSON.stringify(normalized.values.denominations);
  try {
    const db = database();
    await db.batch([
      db.prepare(
        `UPDATE finance_settings
         SET currency_name = ?, currency_unit = ?, denominations_json = ?,
             bank_open = ?, deposit_enabled = ?, withdrawal_enabled = ?,
             banker_processing_enabled = ?, max_request_amount = ?,
             revision = revision + 1, updated_by_teacher_id = ?, updated_at = ?
         WHERE class_id = ? AND revision = ?`,
      ).bind(
        normalized.values.currencyName,
        normalized.values.currencyUnit,
        denominationsJson,
        normalized.values.bankOpen ? 1 : 0,
        normalized.values.depositEnabled ? 1 : 0,
        normalized.values.withdrawalEnabled ? 1 : 0,
        normalized.values.bankerProcessingEnabled ? 1 : 0,
        normalized.values.maxRequestAmount,
        context.actor.id,
        now,
        context.classroom.id,
        normalized.expectedRevision,
      ),
      db.prepare(
        `INSERT INTO finance_setting_revisions (
           id, class_id, revision, idempotency_key, payload_hash,
           previous_settings_json, settings_json, change_reason,
           actor_teacher_id, actor_label, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '교사', ?)`,
      ).bind(
        revisionId,
        context.classroom.id,
        nextRevision,
        normalized.idempotencyKey,
        payloadHash,
        financeSettingsJson(valuesFromView(current)),
        financeSettingsJson(normalized.values),
        normalized.changeReason,
        context.actor.id,
        now,
      ),
    ]);
  } catch (error) {
    const concurrentDuplicate = await revisionByIdempotency(
      context.classroom.id,
      normalized.idempotencyKey,
    );
    if (concurrentDuplicate) {
      if (concurrentDuplicate.payload_hash !== payloadHash) {
        throw new ApiError(
          409,
          "같은 저장 요청이 이미 다른 내용으로 사용되었습니다.",
          "FINANCE_SETTINGS_IDEMPOTENCY_CONFLICT",
        );
      }
      return {
        settings: settingsFromRevision(concurrentDuplicate),
        deduplicated: true,
      };
    }
    mapSettingsDatabaseError(error);
  }

  return {
    settings: {
      ...normalized.values,
      denominations: [...normalized.values.denominations],
      revision: nextRevision,
      updatedAt: now,
    },
    deduplicated: false,
  };
}

export function assertFinanceRequestPolicy(
  settings: FinanceSettingsView,
  requestType: "deposit" | "withdrawal",
  amount: number,
) {
  if (!settings.bankOpen) {
    throw new ApiError(
      409,
      "지금은 학급 은행이 잠시 쉬는 중이에요.",
      "FINANCE_BANK_PAUSED",
    );
  }
  if (
    (requestType === "deposit" && !settings.depositEnabled)
    || (requestType === "withdrawal" && !settings.withdrawalEnabled)
  ) {
    throw new ApiError(
      409,
      `지금은 ${requestType === "deposit" ? "입금" : "출금"} 신청을 받지 않아요.`,
      "FINANCE_REQUEST_TYPE_PAUSED",
    );
  }
  if (amount > settings.maxRequestAmount) {
    throw new ApiError(
      400,
      `한 번에 신청할 수 있는 최대 금액은 ${settings.maxRequestAmount.toLocaleString("ko-KR")} ${settings.currencyUnit}입니다.`,
      "FINANCE_REQUEST_AMOUNT_LIMIT",
    );
  }
  const amountStep = financeDenominationStep(settings.denominations);
  if (!financeAmountMatchesDenominations(amount, settings.denominations)) {
    throw new ApiError(
      400,
      `신청 금액은 가장 작은 권종인 ${amountStep.toLocaleString("ko-KR")} ${settings.currencyUnit} 단위로 입력해 주세요.`,
      "FINANCE_REQUEST_DENOMINATION_MISMATCH",
    );
  }
}

export function assertBankerDecisionPolicy(
  settings: FinanceSettingsView,
  requestType: "deposit" | "withdrawal",
  amount: number,
  decision: "approved" | "rejected",
) {
  if (!settings.bankOpen) {
    throw new ApiError(
      409,
      "지금은 학급 은행이 잠시 쉬는 중이에요.",
      "FINANCE_BANK_PAUSED",
    );
  }
  if (!settings.bankerProcessingEnabled) {
    throw new ApiError(
      409,
      "은행원 처리가 잠시 멈춰 있어요. 선생님께 확인해 주세요.",
      "FINANCE_BANKER_PROCESSING_PAUSED",
    );
  }
  if (decision === "approved") {
    assertFinanceRequestPolicy(settings, requestType, amount);
  }
}
