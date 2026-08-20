import { sha256 } from "./crypto";
import { database } from "./database";
import {
  type FinanceContext,
  financeContextForRequest,
} from "./finance-access";
import {
  classIssuanceAccountId,
  financeReconciliation,
  financeTransactionById,
  reverseFinanceTransaction,
  studentWalletAccountId,
} from "./finance-ledger";
import {
  type FinancePostingActor,
  financeTransactionPayload,
  normalizeFinanceTransaction,
  stableFinanceJson,
} from "./finance-ledger-rules";
import {
  FinanceRequestRuleError,
  financeCashRequestPayload,
  normalizeFinanceCashRequest,
  normalizeFinanceRequestCancel,
  normalizeFinanceRequestDecision,
  normalizeFinanceResourceId,
  normalizeFinanceReversal,
} from "./finance-request-rules";
import {
  assertBankerDecisionPolicy,
  assertFinanceRequestPolicy,
  financeSettingsForClass,
} from "./finance-settings";
import { ApiError } from "./responses";

type CashRequestRow = {
  id: string;
  class_id: string;
  requester_student_id: string;
  wallet_account_id: string;
  request_type: "deposit" | "withdrawal";
  amount: number;
  memo: string | null;
  idempotency_key: string;
  payload_hash: string;
  student_number_snapshot: number;
  student_name_snapshot: string;
  wallet_balance_snapshot: number;
  wallet_revision_snapshot: number;
  revision: number;
  created_at: number;
  resolution_id: string | null;
  resolution_decision: "approved" | "rejected" | "cancelled" | null;
  resolution_idempotency_key: string | null;
  resolution_payload_hash: string | null;
  expected_request_revision: number | null;
  actor_type: "teacher" | "banker" | "student" | null;
  actor_teacher_id: string | null;
  actor_student_id: string | null;
  actor_job_period_id: string | null;
  actor_label: string | null;
  reason_code: string | null;
  reason_note: string | null;
  intervention_reason: string | null;
  is_emergency: number | null;
  posted_transaction_id: string | null;
  transaction_payload_hash: string | null;
  resolved_at: number | null;
};

type WalletSnapshotRow = {
  account_id: string;
  balance: number;
  revision: number;
  student_number: number;
  student_name: string;
};

export type FinanceCashRequestView = {
  id: string;
  classId: string;
  requesterStudentId: string;
  requestType: "deposit" | "withdrawal";
  amount: number;
  memo: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  revision: number;
  studentNumber: number;
  studentName: string;
  walletBalanceSnapshot: number;
  walletRevisionSnapshot: number;
  createdAt: number;
  resolution: null | {
    id: string;
    decision: "approved" | "rejected" | "cancelled";
    actorType: "teacher" | "banker" | "student";
    actorLabel: string;
    reasonCode: string | null;
    reasonNote: string | null;
    interventionReason: string | null;
    isEmergency: boolean;
    postedTransactionId: string | null;
    resolvedAt: number;
  };
};

function ruleError(error: unknown): never {
  if (error instanceof FinanceRequestRuleError) {
    throw new ApiError(400, error.message, error.code);
  }
  throw error;
}

function requestStatus(row: CashRequestRow): FinanceCashRequestView["status"] {
  if (row.resolution_decision === "approved") return "approved";
  if (row.resolution_decision === "rejected") return "rejected";
  if (row.resolution_decision === "cancelled") return "cancelled";
  return "pending";
}

function serializeCashRequest(row: CashRequestRow): FinanceCashRequestView {
  return {
    id: row.id,
    classId: row.class_id,
    requesterStudentId: row.requester_student_id,
    requestType: row.request_type,
    amount: Number(row.amount),
    memo: row.memo,
    status: requestStatus(row),
    revision: Number(row.revision) + (row.resolution_id ? 1 : 0),
    studentNumber: Number(row.student_number_snapshot),
    studentName: row.student_name_snapshot,
    walletBalanceSnapshot: Number(row.wallet_balance_snapshot),
    walletRevisionSnapshot: Number(row.wallet_revision_snapshot),
    createdAt: Number(row.created_at),
    resolution: row.resolution_id
      && row.resolution_decision
      && row.actor_type
      && row.actor_label
      && row.resolved_at !== null
      ? {
          id: row.resolution_id,
          decision: row.resolution_decision,
          actorType: row.actor_type,
          actorLabel: row.actor_label,
          reasonCode: row.reason_code,
          reasonNote: row.reason_note,
          interventionReason: row.intervention_reason,
          isEmergency: Boolean(row.is_emergency),
          postedTransactionId: row.posted_transaction_id,
          resolvedAt: Number(row.resolved_at),
        }
      : null,
  };
}

const REQUEST_SELECT = `
  SELECT cash_request.id, cash_request.class_id,
         cash_request.requester_student_id, cash_request.wallet_account_id,
         cash_request.request_type, cash_request.amount, cash_request.memo,
         cash_request.idempotency_key, cash_request.payload_hash,
         cash_request.student_number_snapshot,
         cash_request.student_name_snapshot,
         cash_request.wallet_balance_snapshot,
         cash_request.wallet_revision_snapshot,
         cash_request.revision, cash_request.created_at,
         resolution.id AS resolution_id,
         resolution.decision AS resolution_decision,
         resolution.idempotency_key AS resolution_idempotency_key,
         resolution.payload_hash AS resolution_payload_hash,
         resolution.expected_request_revision,
         resolution.actor_type, resolution.actor_teacher_id,
         resolution.actor_student_id, resolution.actor_job_period_id,
         resolution.actor_label, resolution.reason_code,
         resolution.reason_note, resolution.intervention_reason,
         resolution.is_emergency, resolution.posted_transaction_id,
         resolution.transaction_payload_hash, resolution.resolved_at
  FROM finance_cash_requests cash_request
  LEFT JOIN finance_request_resolutions resolution
    ON resolution.request_id = cash_request.id
   AND resolution.class_id = cash_request.class_id`;

async function cashRequestById(
  classId: string,
  requestId: string,
  requesterStudentId?: string,
) {
  return database().prepare(
    `${REQUEST_SELECT}
     WHERE cash_request.id = ?
       AND cash_request.class_id = ?
       ${requesterStudentId ? "AND cash_request.requester_student_id = ?" : ""}
     LIMIT 1`,
  ).bind(
    requestId,
    classId,
    ...(requesterStudentId ? [requesterStudentId] : []),
  ).first<CashRequestRow>();
}

async function cashRequestByIdempotency(
  classId: string,
  requesterStudentId: string,
  idempotencyKey: string,
) {
  return database().prepare(
    `${REQUEST_SELECT}
     WHERE cash_request.class_id = ?
       AND cash_request.requester_student_id = ?
       AND cash_request.idempotency_key = ?
     LIMIT 1`,
  ).bind(
    classId,
    requesterStudentId,
    idempotencyKey,
  ).first<CashRequestRow>();
}

async function resolutionByIdempotency(
  classId: string,
  idempotencyKey: string,
) {
  return database().prepare(
    `SELECT request_id, idempotency_key, payload_hash
     FROM finance_request_resolutions
     WHERE class_id = ? AND idempotency_key = ?
     LIMIT 1`,
  ).bind(classId, idempotencyKey).first<{
    request_id: string;
    idempotency_key: string;
    payload_hash: string;
  }>();
}

function idempotencyConflict(): never {
  throw new ApiError(
    409,
    "같은 요청 번호가 다른 내용에 이미 사용되었습니다.",
    "FINANCE_IDEMPOTENCY_CONFLICT",
  );
}

function alreadyResolved(): never {
  throw new ApiError(
    409,
    "이 요청은 이미 처리되었습니다. 최신 내역을 확인해 주세요.",
    "FINANCE_REQUEST_ALREADY_RESOLVED",
  );
}

function staleRequest(): never {
  throw new ApiError(
    409,
    "요청 상태가 다른 화면에서 바뀌었습니다. 최신 내역을 확인해 주세요.",
    "FINANCE_REQUEST_STALE",
  );
}

function mapDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const mappings: Array<[string, number, string, string]> = [
    [
      "FINANCE_ISSUANCE_BALANCE_LIMIT",
      409,
      "학급 발행계정의 안전 한도가 부족해 신청을 반영하지 않았습니다. 최신 금융 기록을 확인해 주세요.",
      "FINANCE_ISSUANCE_BALANCE_LIMIT",
    ],
    [
      "FINANCE_INSUFFICIENT_AVAILABLE_BALANCE",
      409,
      "다른 출금 신청으로 보관 중인 금액을 빼면 사용할 수 있는 잔액이 부족합니다.",
      "FINANCE_INSUFFICIENT_AVAILABLE_BALANCE",
    ],
    [
      "FINANCE_WITHDRAWAL_AVAILABLE_BALANCE",
      409,
      "이미 신청한 출금액을 빼면 출금할 수 있는 잔액이 부족합니다.",
      "FINANCE_INSUFFICIENT_AVAILABLE_BALANCE",
    ],
    [
      "FINANCE_REQUEST_PENDING_EXISTS",
      409,
      "이미 확인 중인 신청이 있습니다. 먼저 그 신청의 처리를 기다려 주세요.",
      "FINANCE_REQUEST_PENDING_EXISTS",
    ],
    [
      "FINANCE_REQUEST_CONTEXT_STALE",
      409,
      "지갑이나 학생 정보가 바뀌었습니다. 최신 화면에서 다시 신청해 주세요.",
      "FINANCE_REQUEST_STALE",
    ],
    [
      "FINANCE_INSUFFICIENT_FUNDS",
      409,
      "승인 시점의 잔액이 부족해 출금을 처리하지 못했습니다.",
      "FINANCE_INSUFFICIENT_FUNDS",
    ],
    [
      "FINANCE_REQUEST_ALREADY_RESOLVED",
      409,
      "이 요청은 이미 처리되었습니다. 최신 내역을 확인해 주세요.",
      "FINANCE_REQUEST_ALREADY_RESOLVED",
    ],
    [
      "FINANCE_REQUEST_STALE",
      409,
      "요청 상태가 다른 화면에서 바뀌었습니다. 최신 내역을 확인해 주세요.",
      "FINANCE_REQUEST_STALE",
    ],
    [
      "FINANCE_REQUEST_SELF_APPROVAL_DENIED",
      403,
      "은행원은 자신의 신청을 직접 처리할 수 없습니다.",
      "FINANCE_REQUEST_SELF_APPROVAL",
    ],
    [
      "FINANCE_REQUEST_CANCEL_DENIED",
      403,
      "본인의 금융 신청만 취소할 수 있습니다.",
      "FINANCE_REQUEST_ACCESS_DENIED",
    ],
    [
      "FINANCE_REQUEST_DECISION_DENIED",
      403,
      "이 신청을 승인하거나 거절할 권한이 없습니다.",
      "FINANCE_REQUEST_DECISION_DENIED",
    ],
    [
      "FINANCE_BANKER_SCOPE_DENIED",
      403,
      "은행원은 친구들의 입출금 신청만 처리할 수 있습니다.",
      "FINANCE_BANKER_ACCESS_DENIED",
    ],
    [
      "FINANCE_BANKER_ACCESS_DENIED",
      403,
      "현재 은행원 직업을 맡은 학생만 이 신청을 처리할 수 있습니다.",
      "FINANCE_BANKER_ACCESS_DENIED",
    ],
    [
      "FINANCE_CLASS_ACCESS_DENIED",
      403,
      "이 학급의 금융 업무를 처리할 권한이 없습니다.",
      "FINANCE_CLASS_ACCESS_DENIED",
    ],
    [
      "FINANCE_ACCOUNT_NOT_ACTIVE",
      409,
      "현재 사용할 수 없는 지갑입니다.",
      "FINANCE_ACCOUNT_NOT_ACTIVE",
    ],
    [
      "FINANCE_ACCOUNT_STALE",
      409,
      "다른 금융 처리가 먼저 반영되었습니다. 최신 잔액으로 다시 시도해 주세요.",
      "FINANCE_ACCOUNT_STALE",
    ],
    [
      "FINANCE_BANK_CLOSED",
      409,
      "지금은 학급 은행이 잠시 쉬는 중이에요.",
      "FINANCE_BANK_PAUSED",
    ],
    [
      "FINANCE_DEPOSIT_DISABLED",
      409,
      "지금은 입금 신청을 받지 않아요.",
      "FINANCE_REQUEST_TYPE_PAUSED",
    ],
    [
      "FINANCE_WITHDRAWAL_DISABLED",
      409,
      "지금은 출금 신청을 받지 않아요.",
      "FINANCE_REQUEST_TYPE_PAUSED",
    ],
    [
      "FINANCE_BANKER_PROCESSING_DISABLED",
      409,
      "은행원 처리가 잠시 멈춰 있어요. 선생님께 확인해 주세요.",
      "FINANCE_BANKER_PROCESSING_PAUSED",
    ],
    [
      "FINANCE_REQUEST_AMOUNT_LIMIT",
      409,
      "현재 학급의 한 번 신청 한도를 넘었습니다.",
      "FINANCE_REQUEST_AMOUNT_LIMIT",
    ],
  ];
  for (const [needle, status, userMessage, code] of mappings) {
    if (message.includes(needle)) {
      throw new ApiError(status, userMessage, code);
    }
  }
  throw error;
}

function resolutionPayload(input: {
  requestId: string;
  decision: "approved" | "rejected" | "cancelled";
  expectedRequestRevision: number;
  actorType: "teacher" | "banker" | "student";
  actorId: string;
  reasonCode: string | null;
  reasonNote: string | null;
  interventionReason: string | null;
}) {
  return stableFinanceJson(input);
}

async function deduplicatedResolution(
  row: CashRequestRow,
  input: {
    idempotencyKey: string;
    payloadHash: string;
  },
) {
  if (!row.resolution_id) return null;
  if (
    row.resolution_idempotency_key === input.idempotencyKey
    && row.resolution_payload_hash === input.payloadHash
  ) {
    return {
      request: serializeCashRequest(row),
      resolution: serializeCashRequest(row).resolution,
      transaction: row.posted_transaction_id
        ? await financeTransactionById(row.posted_transaction_id)
        : null,
      deduplicated: true,
    };
  }
  if (row.resolution_idempotency_key === input.idempotencyKey) {
    idempotencyConflict();
  }
  alreadyResolved();
}

async function assertResolutionIdempotencyAvailable(input: {
  classId: string;
  requestId: string;
  idempotencyKey: string;
  payloadHash: string;
}) {
  const existing = await resolutionByIdempotency(
    input.classId,
    input.idempotencyKey,
  );
  if (!existing) return;
  if (
    existing.request_id !== input.requestId
    || existing.payload_hash !== input.payloadHash
  ) {
    idempotencyConflict();
  }
}

function normalizedResourceId(value: unknown, label: string) {
  try {
    return normalizeFinanceResourceId(value, label);
  } catch (error) {
    ruleError(error);
  }
}

function teacherActor(context: FinanceContext): FinancePostingActor {
  return {
    type: "teacher",
    teacherId: context.actor.id,
    label: "교사",
  };
}

function resolutionActor(context: FinanceContext) {
  if (context.financeRole === "teacher") {
    return {
      actorType: "teacher" as const,
      actorTeacherId: context.actor.id,
      actorStudentId: null,
      actorJobPeriodId: null,
      actorLabel: "교사",
      isEmergency: 1,
      postingActor: teacherActor(context),
    };
  }
  if (
    context.financeRole === "banker"
    && context.actor.type === "student"
    && context.authorizationPeriodId
  ) {
    return {
      actorType: "banker" as const,
      actorTeacherId: null,
      actorStudentId: context.actor.id,
      actorJobPeriodId: context.authorizationPeriodId,
      actorLabel: context.actor.name,
      isEmergency: 0,
      postingActor: {
        type: "banker" as const,
        studentId: context.actor.id,
        bankerPeriodId: context.authorizationPeriodId,
        label: context.actor.name,
      },
    };
  }
  throw new ApiError(
    403,
    "현재 은행원 직업을 맡은 학생이나 담임 교사만 신청을 처리할 수 있습니다.",
    "FINANCE_REQUEST_DECISION_DENIED",
  );
}

export async function createFinanceCashRequest(
  request: Request,
  input: {
    requestType?: unknown;
    amount?: unknown;
    memo?: unknown;
    idempotencyKey?: unknown;
  },
) {
  let normalized: ReturnType<typeof normalizeFinanceCashRequest>;
  try {
    normalized = normalizeFinanceCashRequest(input);
  } catch (error) {
    ruleError(error);
  }
  const context = await financeContextForRequest(request);
  if (context.actor.type !== "student") {
    throw new ApiError(
      403,
      "입금·출금 신청은 학생 계정에서 작성해 주세요.",
      "FINANCE_STUDENT_REQUEST_REQUIRED",
    );
  }

  const payloadHash = await sha256(financeCashRequestPayload(normalized));
  const duplicate = await cashRequestByIdempotency(
    context.classroom.id,
    context.actor.id,
    normalized.idempotencyKey,
  );
  if (duplicate) {
    if (duplicate.payload_hash !== payloadHash) idempotencyConflict();
    return {
      request: serializeCashRequest(duplicate),
      deduplicated: true,
    };
  }

  const settings = await financeSettingsForClass(context.classroom.id);
  assertFinanceRequestPolicy(
    settings,
    normalized.requestType,
    normalized.amount,
  );

  const wallet = await database().prepare(
    `SELECT account.id AS account_id, account.balance, account.revision,
            student.student_number, student.official_name AS student_name
     FROM finance_accounts account
     JOIN students student
       ON student.id = account.student_id
      AND student.class_id = account.class_id
     WHERE account.id = ?
       AND account.class_id = ?
       AND account.student_id = ?
       AND account.account_type = 'student_wallet'
       AND account.status = 'active'
       AND student.status = 'active'
     LIMIT 1`,
  ).bind(
    studentWalletAccountId(context.actor.id),
    context.classroom.id,
    context.actor.id,
  ).first<WalletSnapshotRow>();
  if (!wallet) {
    throw new ApiError(
      409,
      "현재 사용할 수 있는 학생 지갑을 찾지 못했습니다.",
      "FINANCE_ACCOUNT_NOT_ACTIVE",
    );
  }

  const requestId = crypto.randomUUID();
  const now = Date.now();
  try {
    await database().prepare(
      `INSERT INTO finance_cash_requests (
         id, class_id, requester_student_id, wallet_account_id,
         request_type, amount, memo, idempotency_key, payload_hash,
         student_number_snapshot, student_name_snapshot,
         wallet_balance_snapshot, wallet_revision_snapshot, revision, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    ).bind(
      requestId,
      context.classroom.id,
      context.actor.id,
      wallet.account_id,
      normalized.requestType,
      normalized.amount,
      normalized.memo,
      normalized.idempotencyKey,
      payloadHash,
      wallet.student_number,
      wallet.student_name,
      wallet.balance,
      wallet.revision,
      now,
    ).run();
  } catch (error) {
    const concurrentDuplicate = await cashRequestByIdempotency(
      context.classroom.id,
      context.actor.id,
      normalized.idempotencyKey,
    );
    if (concurrentDuplicate) {
      if (concurrentDuplicate.payload_hash !== payloadHash) {
        idempotencyConflict();
      }
      return {
        request: serializeCashRequest(concurrentDuplicate),
        deduplicated: true,
      };
    }
    mapDatabaseError(error);
  }

  const created = await cashRequestById(
    context.classroom.id,
    requestId,
    context.actor.id,
  );
  if (!created) {
    throw new ApiError(
      500,
      "신청은 접수되었지만 결과를 다시 확인하지 못했습니다.",
      "FINANCE_REQUEST_UNAVAILABLE",
    );
  }
  return {
    request: serializeCashRequest(created),
    deduplicated: false,
  };
}

export async function cancelFinanceCashRequest(
  request: Request,
  requestIdValue: unknown,
  input: {
    expectedRevision?: unknown;
    idempotencyKey?: unknown;
  },
) {
  const requestId = normalizedResourceId(requestIdValue, "신청 ID");
  let normalized: ReturnType<typeof normalizeFinanceRequestCancel>;
  try {
    normalized = normalizeFinanceRequestCancel(input);
  } catch (error) {
    ruleError(error);
  }
  const context = await financeContextForRequest(request);
  if (context.actor.type !== "student") {
    throw new ApiError(
      403,
      "학생 본인만 자신의 대기 중인 신청을 취소할 수 있습니다.",
      "FINANCE_REQUEST_CANCEL_DENIED",
    );
  }
  const row = await cashRequestById(
    context.classroom.id,
    requestId,
    context.actor.id,
  );
  if (!row) {
    throw new ApiError(
      404,
      "취소할 신청을 찾을 수 없습니다.",
      "FINANCE_REQUEST_NOT_FOUND",
    );
  }

  const payloadHash = await sha256(resolutionPayload({
    requestId,
    decision: "cancelled",
    expectedRequestRevision: normalized.expectedRevision,
    actorType: "student",
    actorId: context.actor.id,
    reasonCode: null,
    reasonNote: null,
    interventionReason: null,
  }));
  const duplicate = await deduplicatedResolution(row, {
    idempotencyKey: normalized.idempotencyKey,
    payloadHash,
  });
  if (duplicate) return duplicate;
  if (normalized.expectedRevision !== Number(row.revision)) staleRequest();
  await assertResolutionIdempotencyAvailable({
    classId: context.classroom.id,
    requestId,
    idempotencyKey: normalized.idempotencyKey,
    payloadHash,
  });

  const resolutionId = crypto.randomUUID();
  const now = Date.now();
  try {
    await database().prepare(
      `INSERT INTO finance_request_resolutions (
         id, request_id, class_id, decision, idempotency_key, payload_hash,
         expected_request_revision, actor_type, actor_teacher_id,
         actor_student_id, actor_job_period_id, actor_label,
         reason_code, reason_note, intervention_reason, is_emergency,
         posted_transaction_id, transaction_payload_hash, resolved_at, created_at
       ) VALUES (
         ?, ?, ?, 'cancelled', ?, ?, ?, 'student', NULL, ?, NULL, ?,
         NULL, NULL, NULL, 0, NULL, NULL, ?, ?
       )`,
    ).bind(
      resolutionId,
      requestId,
      context.classroom.id,
      normalized.idempotencyKey,
      payloadHash,
      normalized.expectedRevision,
      context.actor.id,
      context.actor.name,
      now,
      now,
    ).run();
  } catch (error) {
    const concurrent = await cashRequestById(
      context.classroom.id,
      requestId,
      context.actor.id,
    );
    if (concurrent) {
      const resolved = await deduplicatedResolution(concurrent, {
        idempotencyKey: normalized.idempotencyKey,
        payloadHash,
      });
      if (resolved) return resolved;
    }
    mapDatabaseError(error);
  }

  const cancelled = await cashRequestById(
    context.classroom.id,
    requestId,
    context.actor.id,
  );
  if (!cancelled?.resolution_id) {
    throw new ApiError(
      500,
      "취소 결과를 다시 확인하지 못했습니다.",
      "FINANCE_REQUEST_UNAVAILABLE",
    );
  }
  const view = serializeCashRequest(cancelled);
  return {
    request: view,
    resolution: view.resolution,
    transaction: null,
    deduplicated: false,
  };
}

export async function decideFinanceCashRequest(
  request: Request,
  requestIdValue: unknown,
  input: {
    decision?: unknown;
    expectedRevision?: unknown;
    idempotencyKey?: unknown;
    reasonCode?: unknown;
    reasonNote?: unknown;
    interventionReason?: unknown;
  },
) {
  const requestId = normalizedResourceId(requestIdValue, "신청 ID");
  const context = await financeContextForRequest(request);
  const actor = resolutionActor(context);
  let normalized: ReturnType<typeof normalizeFinanceRequestDecision>;
  try {
    normalized = normalizeFinanceRequestDecision(input, {
      requireTeacherInterventionReason: actor.actorType === "teacher",
    });
  } catch (error) {
    ruleError(error);
  }

  const row = await cashRequestById(context.classroom.id, requestId);
  if (!row) {
    throw new ApiError(
      404,
      "처리할 금융 신청을 찾을 수 없습니다.",
      "FINANCE_REQUEST_NOT_FOUND",
    );
  }
  if (
    actor.actorType === "banker"
    && row.requester_student_id === actor.actorStudentId
  ) {
    throw new ApiError(
      403,
      "은행원은 자신의 신청을 직접 처리할 수 없습니다. 다른 은행원이나 선생님께 부탁해 주세요.",
      "FINANCE_REQUEST_SELF_APPROVAL",
    );
  }

  const databaseDecision = normalized.decision === "approve"
    ? "approved" as const
    : "rejected" as const;
  const actorId = actor.actorTeacherId ?? actor.actorStudentId;
  if (!actorId) {
    throw new ApiError(
      403,
      "처리자 정보를 확인할 수 없습니다.",
      "FINANCE_REQUEST_DECISION_DENIED",
    );
  }
  const payloadHash = await sha256(resolutionPayload({
    requestId,
    decision: databaseDecision,
    expectedRequestRevision: normalized.expectedRevision,
    actorType: actor.actorType,
    actorId,
    reasonCode: normalized.reasonCode,
    reasonNote: normalized.reasonNote,
    interventionReason: normalized.interventionReason,
  }));
  const duplicate = await deduplicatedResolution(row, {
    idempotencyKey: normalized.idempotencyKey,
    payloadHash,
  });
  if (duplicate) return duplicate;
  if (normalized.expectedRevision !== Number(row.revision)) staleRequest();
  if (actor.actorType === "banker") {
    const settings = await financeSettingsForClass(context.classroom.id);
    assertBankerDecisionPolicy(
      settings,
      row.request_type,
      Number(row.amount),
      databaseDecision,
    );
  }
  if (databaseDecision === "approved") {
    const reconciliation = await financeReconciliation(context.classroom.id);
    if (
      reconciliation.mismatches.length > 0
      || reconciliation.pendingTransactionCount > 0
    ) {
      throw new ApiError(
        409,
        "잔액과 원장을 먼저 확인해야 해서 금융 처리를 잠시 멈췄습니다.",
        "FINANCE_LEDGER_ATTENTION",
      );
    }
  }
  await assertResolutionIdempotencyAvailable({
    classId: context.classroom.id,
    requestId,
    idempotencyKey: normalized.idempotencyKey,
    payloadHash,
  });

  let postedTransactionId: string | null = null;
  let transactionPayloadHash: string | null = null;
  if (databaseDecision === "approved") {
    postedTransactionId = crypto.randomUUID();
    const walletDelta = row.request_type === "deposit"
      ? Number(row.amount)
      : -Number(row.amount);
    const transaction = normalizeFinanceTransaction({
      classId: context.classroom.id,
      idempotencyKey: `cash-request:${row.id}:approved`,
      transactionType: row.request_type === "deposit"
        ? "cash_deposit"
        : "cash_withdrawal",
      description: row.request_type === "deposit"
        ? "입금 신청 승인"
        : "출금 신청 승인",
      actor: actor.postingActor,
      sourceType: "cash_request",
      sourceId: row.id,
      lines: [
        {
          accountId: row.wallet_account_id,
          amount: walletDelta,
        },
        {
          accountId: classIssuanceAccountId(context.classroom.id),
          amount: -walletDelta,
        },
      ],
    });
    transactionPayloadHash = await sha256(
      financeTransactionPayload(transaction),
    );
  }

  const resolutionId = crypto.randomUUID();
  const now = Date.now();
  try {
    await database().prepare(
      `INSERT INTO finance_request_resolutions (
         id, request_id, class_id, decision, idempotency_key, payload_hash,
         expected_request_revision, actor_type, actor_teacher_id,
         actor_student_id, actor_job_period_id, actor_label,
         reason_code, reason_note, intervention_reason, is_emergency,
         posted_transaction_id, transaction_payload_hash, resolved_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      resolutionId,
      requestId,
      context.classroom.id,
      databaseDecision,
      normalized.idempotencyKey,
      payloadHash,
      normalized.expectedRevision,
      actor.actorType,
      actor.actorTeacherId,
      actor.actorStudentId,
      actor.actorJobPeriodId,
      actor.actorLabel,
      normalized.reasonCode,
      normalized.reasonNote,
      normalized.interventionReason,
      actor.isEmergency,
      postedTransactionId,
      transactionPayloadHash,
      now,
      now,
    ).run();
  } catch (error) {
    const concurrent = await cashRequestById(
      context.classroom.id,
      requestId,
    );
    if (concurrent) {
      const resolved = await deduplicatedResolution(concurrent, {
        idempotencyKey: normalized.idempotencyKey,
        payloadHash,
      });
      if (resolved) return resolved;
    }
    mapDatabaseError(error);
  }

  const decided = await cashRequestById(context.classroom.id, requestId);
  if (!decided?.resolution_id) {
    throw new ApiError(
      500,
      "처리 결과를 다시 확인하지 못했습니다.",
      "FINANCE_REQUEST_UNAVAILABLE",
    );
  }
  const view = serializeCashRequest(decided);
  const transaction = decided.posted_transaction_id
    ? await financeTransactionById(decided.posted_transaction_id)
    : null;
  if (databaseDecision === "approved" && !transaction) {
    throw new ApiError(
      500,
      "승인 거래를 다시 확인하지 못했습니다.",
      "FINANCE_TRANSACTION_UNAVAILABLE",
    );
  }
  return {
    request: view,
    resolution: view.resolution,
    transaction,
    deduplicated: false,
  };
}

export async function reverseFinanceTransactionForRequest(
  request: Request,
  transactionIdValue: unknown,
  input: {
    reason?: unknown;
    idempotencyKey?: unknown;
  },
) {
  const transactionId = normalizedResourceId(transactionIdValue, "거래 ID");
  let normalized: ReturnType<typeof normalizeFinanceReversal>;
  try {
    normalized = normalizeFinanceReversal(input);
  } catch (error) {
    ruleError(error);
  }
  const context = await financeContextForRequest(request);
  if (context.financeRole !== "teacher") {
    throw new ApiError(
      403,
      "거래 정정은 담임 교사만 처리할 수 있습니다.",
      "FINANCE_REVERSAL_TEACHER_REQUIRED",
    );
  }
  const reconciliation = await financeReconciliation(context.classroom.id);
  if (
    reconciliation.mismatches.length > 0
    || reconciliation.pendingTransactionCount > 0
  ) {
    throw new ApiError(
      409,
      "잔액과 원장을 먼저 확인해야 해서 거래 정정을 잠시 멈췄습니다.",
      "FINANCE_LEDGER_ATTENTION",
    );
  }
  return reverseFinanceTransaction({
    classId: context.classroom.id,
    originalTransactionId: transactionId,
    idempotencyKey: normalized.idempotencyKey,
    description: `교사 정정: ${normalized.reason}`,
    actor: teacherActor(context),
  });
}
