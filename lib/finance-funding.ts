import { sha256 } from "./crypto";
import { database } from "./database";
import {
  type FinanceContext,
  financeContextForRequest,
} from "./finance-access";
import { financeWalletAvailability } from "./finance-available-balance";
import {
  FINANCE_FUNDING_PROCESS_BATCH_SIZE,
  FinanceFundingRuleError,
  type FinanceFundingStatus,
  assertFinanceFundingTransition,
  financeFundingActionRequest,
  financeFundingProgress,
  financeFundingTerminalStatus,
  normalizeFinanceFundingAction,
  normalizeFinanceFundingCampaign,
  normalizeFinanceFundingCampaignEdit,
  normalizeFinanceFundingCampaignFields,
  normalizeFinanceFundingContribution,
} from "./finance-funding-rules";
import {
  classIssuanceAccountId,
  studentWalletAccountId,
} from "./finance-ledger";
import {
  type NormalizedFinanceTransaction,
  financeTransactionPayload,
  normalizeFinanceTransaction,
  stableFinanceJson,
} from "./finance-ledger-rules";
import { financeSettingsForClass } from "./finance-settings";
import { financeAmountMatchesDenominations } from "./finance-settings-rules";
import { ApiError } from "./responses";

type CampaignRow = {
  id: string;
  class_id: string;
  creator_student_id: string;
  recipient_wallet_account_id: string;
  creator_student_number_snapshot: number;
  creator_student_name_snapshot: string;
  title: string;
  description: string;
  target_amount: number;
  pledged_amount: number;
  refunded_amount: number;
  status: FinanceFundingStatus;
  terminal_reason: string | null;
  deadline_at: number;
  revision: number;
  idempotency_key: string;
  payload_hash: string;
  payout_transaction_id: string | null;
  created_at: number;
  updated_at: number;
  funded_at: number | null;
  settled_at: number | null;
  cancelled_at: number | null;
};

type CampaignViewRow = CampaignRow & {
  participant_count: number;
  contribution_count: number;
  my_contribution_amount: number;
};

type ContributionRow = {
  id: string;
  class_id: string;
  campaign_id: string;
  contributor_student_id: string;
  wallet_account_id: string;
  student_number_snapshot: number;
  student_name_snapshot: string;
  amount: number;
  campaign_revision_before: number;
  idempotency_key: string;
  payload_hash: string;
  posted_transaction_id: string;
  transaction_payload_hash: string;
  created_at: number;
};

type SettlementRow = {
  id: string;
  class_id: string;
  campaign_id: string;
  recipient_student_id: string;
  amount: number;
  idempotency_key: string;
  payload_hash: string;
  posted_transaction_id: string;
  transaction_payload_hash: string;
  settled_at: number;
};

type AccountRow = {
  id: string;
  class_id: string;
  student_id: string | null;
  account_type: string;
  balance: number;
  revision: number;
  status: string;
};

type StudentRow = {
  id: string;
  student_number: number;
  official_name: string;
};

const CAMPAIGN_COLUMNS = `campaign.id, campaign.class_id,
  campaign.creator_student_id, campaign.recipient_wallet_account_id,
  campaign.creator_student_number_snapshot,
  campaign.creator_student_name_snapshot, campaign.title,
  campaign.description, campaign.target_amount, campaign.pledged_amount,
  campaign.refunded_amount, campaign.status, campaign.terminal_reason,
  campaign.deadline_at, campaign.revision, campaign.idempotency_key,
  campaign.payload_hash, campaign.payout_transaction_id,
  campaign.created_at, campaign.updated_at, campaign.funded_at,
  campaign.settled_at, campaign.cancelled_at`;

function ruleError(error: unknown): never {
  if (error instanceof FinanceFundingRuleError) {
    throw new ApiError(400, error.message, error.code);
  }
  throw error;
}

function requiredId(value: unknown, label: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 160 || !/^[A-Za-z0-9:_-]+$/.test(normalized)) {
    throw new ApiError(
      400,
      `${label}를 다시 확인해 주세요.`,
      "FINANCE_FUNDING_INVALID_ID",
    );
  }
  return normalized;
}

function idempotencyKey(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(normalized)) {
    throw new ApiError(
      400,
      "요청 번호를 다시 확인해 주세요.",
      "FINANCE_FUNDING_INVALID_IDEMPOTENCY_KEY",
    );
  }
  return normalized;
}

function expectedRevision(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new ApiError(
      400,
      "최신 펀딩 정보를 다시 불러와 주세요.",
      "FINANCE_FUNDING_INVALID_REVISION",
    );
  }
  return Number(value);
}

function interventionReason(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.length < 2) {
    throw new ApiError(
      400,
      "비상 취소 사유를 2자 이상 적어 주세요.",
      "FINANCE_FUNDING_INTERVENTION_REASON_REQUIRED",
    );
  }
  if (normalized.length > 300) {
    throw new ApiError(
      400,
      "비상 취소 사유는 300자 이내로 적어 주세요.",
      "FINANCE_FUNDING_INTERVENTION_REASON_TOO_LONG",
    );
  }
  return normalized;
}

function assertActiveClass(context: FinanceContext) {
  if (context.classroom.status !== "active") {
    throw new ApiError(
      409,
      "보관된 학급에서는 펀딩을 변경할 수 없습니다.",
      "FINANCE_CLASS_NOT_ACTIVE",
    );
  }
}

function assertStudent(context: FinanceContext) {
  if (context.actor.type !== "student") {
    throw new ApiError(
      403,
      "학생 계정으로 로그인해야 펀딩을 만들거나 참여할 수 있습니다.",
      "FINANCE_FUNDING_STUDENT_REQUIRED",
    );
  }
  assertActiveClass(context);
}

function mapDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const mappings: Array<[string, number, string, string]> = [
    ["FINANCE_FUNDING_CAMPAIGN_STALE", 409, "다른 화면에서 펀딩 상태가 먼저 바뀌었습니다. 최신 내용을 다시 확인해 주세요.", "FINANCE_FUNDING_STALE"],
    ["FINANCE_FUNDING_CONTRIBUTION_STALE", 409, "다른 친구의 참여가 먼저 반영되었습니다. 남은 금액을 다시 확인해 주세요.", "FINANCE_FUNDING_STALE"],
    ["FINANCE_FUNDING_ACTIVE_EXISTS", 409, "진행 중인 내 펀딩을 먼저 마무리해 주세요.", "FINANCE_FUNDING_ACTIVE_EXISTS"],
    ["FINANCE_FUNDING_LEDGER_MISMATCH", 409, "펀딩 기록과 지갑 기록이 맞지 않아 처리를 멈췄습니다.", "FINANCE_FUNDING_LEDGER_MISMATCH"],
    ["FINANCE_ISSUANCE_BALANCE_LIMIT", 409, "학급 발행 계정의 안전 한도를 확인해야 합니다.", "FINANCE_ISSUANCE_BALANCE_LIMIT"],
    ["FINANCE_INSUFFICIENT_AVAILABLE_BALANCE", 409, "출금 신청 금액을 빼면 펀딩에 참여할 잔액이 부족합니다.", "FINANCE_INSUFFICIENT_AVAILABLE_BALANCE"],
    ["FINANCE_INSUFFICIENT_FUNDS", 409, "지갑 잔액이 부족합니다.", "FINANCE_INSUFFICIENT_FUNDS"],
    ["FINANCE_ACCOUNT_NOT_ACTIVE", 409, "현재 사용할 수 없는 지갑입니다.", "FINANCE_ACCOUNT_NOT_ACTIVE"],
    ["FINANCE_ACCOUNT_STALE", 409, "다른 거래가 먼저 반영되었습니다. 최신 잔액으로 다시 시도해 주세요.", "FINANCE_ACCOUNT_STALE"],
    ["FINANCE_CLASS_NOT_ACTIVE", 409, "운영 중인 학급에서만 펀딩을 처리할 수 있습니다.", "FINANCE_CLASS_NOT_ACTIVE"],
  ];
  for (const [needle, status, userMessage, code] of mappings) {
    if (message.includes(needle)) throw new ApiError(status, userMessage, code);
  }
  if (
    message.includes("finance_funding_campaigns_creator_nonterminal_uq")
    || message.includes("finance_funding_campaigns.class_id, finance_funding_campaigns.creator_student_id")
  ) {
    throw new ApiError(
      409,
      "진행 중인 내 펀딩을 먼저 마무리해 주세요.",
      "FINANCE_FUNDING_ACTIVE_EXISTS",
    );
  }
  if (
    message.includes("finance_funding_contributions.amount")
    || message.includes("finance_funding_settlements.amount")
    || message.includes("finance_funding_refunds.amount")
  ) {
    throw new ApiError(
      409,
      "펀딩 상태나 남은 금액이 바뀌었습니다. 최신 내용을 다시 확인해 주세요.",
      "FINANCE_FUNDING_STALE",
    );
  }
  if (
    message.includes("finance_funding_campaign_events_class_idempotency_uq")
    || message.includes("finance_funding_contributions_student_idempotency_uq")
    || message.includes("finance_funding_refunds_class_idempotency_uq")
    || message.includes("finance_funding_settlements_class_idempotency_uq")
  ) {
    throw new ApiError(
      409,
      "같은 요청 번호가 다른 펀딩 작업에 사용되었습니다.",
      "FINANCE_FUNDING_IDEMPOTENCY_CONFLICT",
    );
  }
  throw error;
}

function campaignSnapshot(row: CampaignRow) {
  return stableFinanceJson({
    id: row.id,
    classId: row.class_id,
    creatorStudentId: row.creator_student_id,
    title: row.title,
    description: row.description,
    targetAmount: Number(row.target_amount),
    pledgedAmount: Number(row.pledged_amount),
    refundedAmount: Number(row.refunded_amount),
    status: row.status,
    terminalReason: row.terminal_reason,
    deadlineAt: Number(row.deadline_at),
    revision: Number(row.revision),
    fundedAt: row.funded_at === null ? null : Number(row.funded_at),
    settledAt: row.settled_at === null ? null : Number(row.settled_at),
    cancelledAt: row.cancelled_at === null ? null : Number(row.cancelled_at),
  });
}

function serializeCampaign(
  row: CampaignRow | CampaignViewRow,
  context?: FinanceContext,
) {
  const participantCount = "participant_count" in row
    ? Number(row.participant_count)
    : 0;
  const contributionCount = "contribution_count" in row
    ? Number(row.contribution_count)
    : 0;
  const myContributionAmount = "my_contribution_amount" in row
    ? Number(row.my_contribution_amount)
    : 0;
  const isCreator = context?.actor.type === "student"
    && context.actor.id === row.creator_student_id;
  const isTeacher = context?.actor.type === "teacher";
  const status = row.status;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    targetAmount: Number(row.target_amount),
    pledgedAmount: Number(row.pledged_amount),
    refundedAmount: Number(row.refunded_amount),
    remainingAmount: Math.max(0, Number(row.target_amount) - Number(row.pledged_amount)),
    progress: financeFundingProgress(Number(row.pledged_amount), Number(row.target_amount)),
    status,
    terminalReason: row.terminal_reason,
    deadlineAt: Number(row.deadline_at),
    revision: Number(row.revision),
    fundedAt: row.funded_at === null ? null : Number(row.funded_at),
    settledAt: row.settled_at === null ? null : Number(row.settled_at),
    cancelledAt: row.cancelled_at === null ? null : Number(row.cancelled_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    creator: {
      id: row.creator_student_id,
      number: Number(row.creator_student_number_snapshot),
      name: row.creator_student_name_snapshot,
    },
    participantCount,
    contributionCount,
    myContributionAmount,
    isCreator: Boolean(isCreator),
    canContribute: context?.actor.type === "student"
      && status === "active"
      && Number(row.deadline_at) > Date.now(),
    canEdit: Boolean(isCreator)
      && Number(row.pledged_amount) === 0
      && (status === "active" || status === "paused"),
    canPause: Boolean(isCreator) && status === "active",
    canResume: Boolean(isCreator) && status === "paused",
    canCancel: Boolean(isCreator) && (status === "active" || status === "paused"),
    canEmergencyCancel: Boolean(isTeacher)
      && (status === "active" || status === "paused"),
    processing: status === "funded" || status === "refunding",
  };
}

async function campaignById(db: D1Database, classId: string, campaignId: string) {
  return db.prepare(
    `SELECT ${CAMPAIGN_COLUMNS}
     FROM finance_funding_campaigns campaign
     WHERE campaign.class_id = ? AND campaign.id = ?
     LIMIT 1`,
  ).bind(classId, campaignId).first<CampaignRow>();
}

async function campaignByCreateKey(
  db: D1Database,
  classId: string,
  studentId: string,
  key: string,
) {
  return db.prepare(
    `SELECT ${CAMPAIGN_COLUMNS}
     FROM finance_funding_campaigns campaign
     WHERE campaign.class_id = ? AND campaign.creator_student_id = ?
       AND campaign.idempotency_key = ?
     LIMIT 1`,
  ).bind(classId, studentId, key).first<CampaignRow>();
}

async function contributionByKey(
  db: D1Database,
  classId: string,
  studentId: string,
  key: string,
) {
  return db.prepare(
    `SELECT id, class_id, campaign_id, contributor_student_id,
            wallet_account_id, student_number_snapshot,
            student_name_snapshot, amount, campaign_revision_before,
            idempotency_key, payload_hash, posted_transaction_id,
            transaction_payload_hash, created_at
     FROM finance_funding_contributions
     WHERE class_id = ? AND contributor_student_id = ?
       AND idempotency_key = ?
     LIMIT 1`,
  ).bind(classId, studentId, key).first<ContributionRow>();
}

async function eventByKey(db: D1Database, classId: string, key: string) {
  return db.prepare(
    `SELECT campaign_id, payload_hash
     FROM finance_funding_campaign_events
     WHERE class_id = ? AND idempotency_key = ?
     LIMIT 1`,
  ).bind(classId, key).first<{ campaign_id: string; payload_hash: string }>();
}

async function settlementForCampaign(db: D1Database, campaignId: string) {
  return db.prepare(
    `SELECT id, class_id, campaign_id, recipient_student_id, amount,
            idempotency_key, payload_hash, posted_transaction_id,
            transaction_payload_hash, settled_at
     FROM finance_funding_settlements
     WHERE campaign_id = ? LIMIT 1`,
  ).bind(campaignId).first<SettlementRow>();
}

async function studentForClass(db: D1Database, classId: string, studentId: string) {
  return db.prepare(
    `SELECT id, student_number, official_name
     FROM students
     WHERE id = ? AND class_id = ? AND status = 'active'
     LIMIT 1`,
  ).bind(studentId, classId).first<StudentRow>();
}

async function accountRows(db: D1Database, classId: string, studentId: string) {
  const walletId = studentWalletAccountId(studentId);
  const issuanceId = classIssuanceAccountId(classId);
  const result = await db.prepare(
    `SELECT id, class_id, student_id, account_type, balance, revision, status
     FROM finance_accounts
     WHERE class_id = ? AND id IN (?, ?)`,
  ).bind(classId, walletId, issuanceId).all<AccountRow>();
  const wallet = result.results.find((row) => row.id === walletId) ?? null;
  const issuance = result.results.find((row) => row.id === issuanceId) ?? null;
  if (!wallet || !issuance) {
    throw new ApiError(
      409,
      "펀딩에 사용할 지갑을 찾을 수 없습니다.",
      "FINANCE_ACCOUNT_NOT_FOUND",
    );
  }
  if (wallet.status !== "active" || issuance.status !== "active") {
    throw new ApiError(
      409,
      "현재 사용할 수 없는 지갑입니다.",
      "FINANCE_ACCOUNT_NOT_ACTIVE",
    );
  }
  return { wallet, issuance };
}

function transactionStatements(
  db: D1Database,
  input: {
    transactionId: string;
    transaction: NormalizedFinanceTransaction;
    transactionPayloadHash: string;
    accounts: Map<string, AccountRow>;
    now: number;
  },
) {
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO finance_transactions (
         id, class_id, status, transaction_type, description,
         idempotency_key, payload_hash, source_type, source_id,
         reversal_of_transaction_id, actor_type, actor_teacher_id,
         actor_student_id, actor_job_period_id, actor_label, metadata_json,
         created_at, posted_at
       ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, NULL,
                 ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(
      input.transactionId,
      input.transaction.classId,
      input.transaction.transactionType,
      input.transaction.description,
      input.transaction.idempotencyKey,
      input.transactionPayloadHash,
      input.transaction.sourceType,
      input.transaction.sourceId,
      input.transaction.actor.type,
      input.transaction.actor.teacherId,
      input.transaction.actor.studentId,
      input.transaction.actor.bankerPeriodId,
      input.transaction.actor.label,
      input.transaction.metadataJson,
      input.now,
    ),
  ];
  for (const [index, line] of input.transaction.lines.entries()) {
    const account = input.accounts.get(line.accountId);
    if (!account) {
      throw new ApiError(
        409,
        "펀딩에 사용할 지갑을 찾을 수 없습니다.",
        "FINANCE_ACCOUNT_NOT_FOUND",
      );
    }
    statements.push(
      db.prepare(
        `INSERT INTO finance_ledger_entries (
           id, transaction_id, class_id, account_id, amount, balance_after,
           account_revision_after, memo, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        `finance:funding:${input.transactionId}:${index}`,
        input.transactionId,
        input.transaction.classId,
        line.accountId,
        line.amount,
        Number(account.balance) + line.amount,
        Number(account.revision) + 1,
        line.memo,
        input.now,
      ),
    );
  }
  statements.push(
    db.prepare(
      `UPDATE finance_transactions
       SET status = 'posted', posted_at = ?
       WHERE id = ? AND status = 'pending'`,
    ).bind(input.now, input.transactionId),
  );
  return statements;
}

export async function createFinanceFundingCampaign(
  request: Request,
  input: {
    title?: unknown;
    description?: unknown;
    targetAmount?: unknown;
    deadlineAt?: unknown;
    idempotencyKey?: unknown;
  },
) {
  const context = await financeContextForRequest(request);
  assertStudent(context);
  const now = Date.now();
  let values: ReturnType<typeof normalizeFinanceFundingCampaign>;
  try {
    values = normalizeFinanceFundingCampaign({ ...input, now });
  } catch (error) {
    ruleError(error);
  }
  const key = idempotencyKey(input.idempotencyKey);
  const payloadHash = await sha256(stableFinanceJson({
    classId: context.classroom.id,
    creatorStudentId: context.actor.id,
    ...values,
  }));
  const db = database();
  const duplicate = await campaignByCreateKey(
    db,
    context.classroom.id,
    context.actor.id,
    key,
  );
  if (duplicate) {
    if (duplicate.payload_hash !== payloadHash) {
      throw new ApiError(409, "같은 요청 번호가 다른 펀딩에 사용되었습니다.", "FINANCE_FUNDING_IDEMPOTENCY_CONFLICT");
    }
    return { campaign: serializeCampaign(duplicate, context), deduplicated: true };
  }
  const settings = await financeSettingsForClass(context.classroom.id);
  if (!financeAmountMatchesDenominations(values.targetAmount, settings.denominations)) {
    throw new ApiError(
      400,
      `목표 금액은 ${Math.min(...settings.denominations).toLocaleString("ko-KR")} ${settings.currencyUnit} 단위로 정해 주세요.`,
      "FINANCE_FUNDING_DENOMINATION_MISMATCH",
    );
  }
  const student = await studentForClass(db, context.classroom.id, context.actor.id);
  const wallet = await db.prepare(
    `SELECT id, status FROM finance_accounts
     WHERE id = ? AND class_id = ? AND student_id = ?
       AND account_type = 'student_wallet' LIMIT 1`,
  ).bind(
    studentWalletAccountId(context.actor.id),
    context.classroom.id,
    context.actor.id,
  ).first<{ id: string; status: string }>();
  if (!student || !wallet || wallet.status !== "active") {
    throw new ApiError(409, "활성 학생 지갑이 있어야 펀딩을 만들 수 있습니다.", "FINANCE_ACCOUNT_NOT_ACTIVE");
  }
  const existing = await db.prepare(
    `SELECT id FROM finance_funding_campaigns
     WHERE class_id = ? AND creator_student_id = ?
       AND status IN ('active', 'paused', 'funded', 'refunding')
     LIMIT 1`,
  ).bind(context.classroom.id, context.actor.id).first<{ id: string }>();
  if (existing) {
    throw new ApiError(409, "진행 중인 내 펀딩을 먼저 마무리해 주세요.", "FINANCE_FUNDING_ACTIVE_EXISTS");
  }

  const campaignId = crypto.randomUUID();
  const row: CampaignRow = {
    id: campaignId,
    class_id: context.classroom.id,
    creator_student_id: context.actor.id,
    recipient_wallet_account_id: wallet.id,
    creator_student_number_snapshot: Number(student.student_number),
    creator_student_name_snapshot: student.official_name,
    title: values.title,
    description: values.description,
    target_amount: values.targetAmount,
    pledged_amount: 0,
    refunded_amount: 0,
    status: "active",
    terminal_reason: null,
    deadline_at: values.deadlineAt,
    revision: 0,
    idempotency_key: key,
    payload_hash: payloadHash,
    payout_transaction_id: null,
    created_at: now,
    updated_at: now,
    funded_at: null,
    settled_at: null,
    cancelled_at: null,
  };
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO finance_funding_campaigns (
           id, class_id, creator_student_id, recipient_wallet_account_id,
           creator_student_number_snapshot, creator_student_name_snapshot,
           title, description, target_amount, pledged_amount, refunded_amount,
           status, terminal_reason, deadline_at, revision, idempotency_key,
           payload_hash, payout_transaction_id, created_at, updated_at,
           funded_at, settled_at, cancelled_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'active', NULL, ?, 0,
                   ?, ?, NULL, ?, ?, NULL, NULL, NULL)`,
      ).bind(
        row.id,
        row.class_id,
        row.creator_student_id,
        row.recipient_wallet_account_id,
        row.creator_student_number_snapshot,
        row.creator_student_name_snapshot,
        row.title,
        row.description,
        row.target_amount,
        row.deadline_at,
        row.idempotency_key,
        row.payload_hash,
        now,
        now,
      ),
      db.prepare(
        `INSERT INTO finance_funding_campaign_events (
           id, class_id, campaign_id, revision, action, actor_type,
           actor_teacher_id, actor_student_id, actor_label,
           intervention_reason, idempotency_key, payload_hash,
           campaign_snapshot_json, created_at
         ) VALUES (?, ?, ?, 0, 'created', 'student', NULL, ?, ?, NULL,
                   ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        row.class_id,
        row.id,
        context.actor.id,
        context.actor.name,
        key,
        payloadHash,
        campaignSnapshot(row),
        now,
      ),
    ]);
  } catch (error) {
    const concurrent = await campaignByCreateKey(db, row.class_id, context.actor.id, key);
    if (concurrent) {
      if (concurrent.payload_hash !== payloadHash) {
        throw new ApiError(409, "같은 요청 번호가 다른 펀딩에 사용되었습니다.", "FINANCE_FUNDING_IDEMPOTENCY_CONFLICT");
      }
      return { campaign: serializeCampaign(concurrent, context), deduplicated: true };
    }
    mapDatabaseError(error);
  }
  return { campaign: serializeCampaign(row, context), deduplicated: false };
}

export async function updateFinanceFundingCampaign(
  request: Request,
  campaignIdValue: unknown,
  input: {
    action?: unknown;
    title?: unknown;
    description?: unknown;
    targetAmount?: unknown;
    deadlineAt?: unknown;
    expectedRevision?: unknown;
    idempotencyKey?: unknown;
    interventionReason?: unknown;
  },
) {
  const context = await financeContextForRequest(request);
  assertActiveClass(context);
  const campaignId = requiredId(campaignIdValue, "펀딩 ID");
  const revision = expectedRevision(input.expectedRevision);
  const key = idempotencyKey(input.idempotencyKey);
  let action: ReturnType<typeof normalizeFinanceFundingAction>;
  try {
    action = normalizeFinanceFundingAction(input.action);
  } catch (error) {
    ruleError(error);
  }
  const db = database();
  const isTeacher = context.actor.type === "teacher";
  const reason = isTeacher && action === "cancel"
    ? interventionReason(input.interventionReason)
    : null;
  let requestedEditValues: ReturnType<typeof normalizeFinanceFundingCampaignFields> | null = null;
  if (action === "edit") {
    try {
      requestedEditValues = normalizeFinanceFundingCampaignFields(input);
    } catch (error) {
      ruleError(error);
    }
  }
  const payloadHash = await sha256(stableFinanceJson(financeFundingActionRequest({
    action,
    campaignId,
    classId: context.classroom.id,
    expectedRevision: revision,
    actorType: context.actor.type,
    actorId: context.actor.id,
    interventionReason: reason,
    editValues: requestedEditValues,
  })));
  const duplicate = await eventByKey(db, context.classroom.id, key);
  if (duplicate) {
    if (duplicate.campaign_id !== campaignId || duplicate.payload_hash !== payloadHash) {
      throw new ApiError(409, "같은 요청 번호가 다른 펀딩 작업에 사용되었습니다.", "FINANCE_FUNDING_IDEMPOTENCY_CONFLICT");
    }
    const saved = await campaignById(db, context.classroom.id, campaignId);
    if (!saved) throw new ApiError(500, "변경된 펀딩을 확인할 수 없습니다.", "FINANCE_FUNDING_UNAVAILABLE");
    return { campaign: serializeCampaign(saved, context), deduplicated: true };
  }
  const campaign = await campaignById(db, context.classroom.id, campaignId);
  if (!campaign) {
    throw new ApiError(404, "펀딩을 찾을 수 없습니다.", "FINANCE_FUNDING_NOT_FOUND");
  }
  const isCreator = context.actor.type === "student"
    && context.actor.id === campaign.creator_student_id;
  try {
    assertFinanceFundingTransition({
      action,
      status: campaign.status,
      pledgedAmount: Number(campaign.pledged_amount),
      isCreator,
      isTeacher,
    });
  } catch (error) {
    ruleError(error);
  }
  if (Number(campaign.revision) !== revision) {
    throw new ApiError(409, "펀딩 상태가 바뀌었습니다. 최신 내용을 다시 확인해 주세요.", "FINANCE_FUNDING_STALE");
  }
  const now = Date.now();
  if (action !== "cancel" && Number(campaign.deadline_at) <= now) {
    throw new ApiError(409, "이미 마감된 펀딩입니다.", "FINANCE_FUNDING_DEADLINE_PASSED");
  }
  let editValues: ReturnType<typeof normalizeFinanceFundingCampaign> | null = null;
  if (action === "edit") {
    try {
      editValues = normalizeFinanceFundingCampaignEdit(
        { ...requestedEditValues, now },
        { deadlineAt: Number(campaign.deadline_at) },
      );
    } catch (error) {
      ruleError(error);
    }
    const settings = await financeSettingsForClass(context.classroom.id);
    if (!financeAmountMatchesDenominations(editValues.targetAmount, settings.denominations)) {
      throw new ApiError(400, "목표 금액이 학급 화폐 권종 단위와 맞지 않습니다.", "FINANCE_FUNDING_DENOMINATION_MISMATCH");
    }
  }

  const nextStatus: FinanceFundingStatus = action === "pause"
    ? "paused"
    : action === "resume"
      ? "active"
      : action === "cancel"
        ? Number(campaign.pledged_amount) > Number(campaign.refunded_amount)
          ? "refunding"
          : "cancelled"
        : campaign.status;
  const nextRevision = revision + 1;
  const next: CampaignRow = {
    ...campaign,
    title: editValues?.title ?? campaign.title,
    description: editValues?.description ?? campaign.description,
    target_amount: editValues?.targetAmount ?? Number(campaign.target_amount),
    deadline_at: editValues?.deadlineAt ?? Number(campaign.deadline_at),
    status: nextStatus,
    terminal_reason: action === "cancel"
      ? isTeacher ? "teacher_cancelled" : "creator_cancelled"
      : campaign.terminal_reason,
    revision: nextRevision,
    updated_at: now,
    cancelled_at: nextStatus === "cancelled" ? now : campaign.cancelled_at,
  };
  const eventAction = action === "cancel"
    ? nextStatus === "refunding" ? "refund_started" : "cancelled"
    : action === "edit" ? "edited" : action === "pause" ? "paused" : "resumed";
  try {
    await db.batch([
      db.prepare(
        `UPDATE finance_funding_campaigns
         SET title = ?, description = ?, target_amount = ?, deadline_at = ?,
             status = ?, terminal_reason = ?, revision = revision + 1,
             updated_at = ?, cancelled_at = ?
         WHERE id = ? AND class_id = ? AND revision = ? AND status = ?`,
      ).bind(
        next.title,
        next.description,
        next.target_amount,
        next.deadline_at,
        next.status,
        next.terminal_reason,
        now,
        next.cancelled_at,
        campaignId,
        context.classroom.id,
        revision,
        campaign.status,
      ),
      db.prepare(
        `INSERT INTO finance_funding_campaign_events (
           id, class_id, campaign_id, revision, action, actor_type,
           actor_teacher_id, actor_student_id, actor_label,
           intervention_reason, idempotency_key, payload_hash,
           campaign_snapshot_json, created_at
         )
         SELECT ?, campaign.class_id, campaign.id, campaign.revision, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?
         FROM finance_funding_campaigns campaign
         WHERE campaign.id = ? AND campaign.class_id = ?
           AND campaign.revision = ? AND campaign.status = ?`,
      ).bind(
        crypto.randomUUID(),
        eventAction,
        isTeacher ? "teacher" : "student",
        isTeacher ? context.actor.id : null,
        isCreator ? context.actor.id : null,
        context.actor.name,
        reason,
        key,
        payloadHash,
        campaignSnapshot(next),
        now,
        campaignId,
        context.classroom.id,
        nextRevision,
        nextStatus,
      ),
    ]);
  } catch (error) {
    const concurrent = await eventByKey(db, context.classroom.id, key);
    if (concurrent && concurrent.campaign_id === campaignId && concurrent.payload_hash === payloadHash) {
      const saved = await campaignById(db, context.classroom.id, campaignId);
      if (saved) return { campaign: serializeCampaign(saved, context), deduplicated: true };
    }
    mapDatabaseError(error);
  }
  const recorded = await eventByKey(db, context.classroom.id, key);
  if (!recorded) {
    throw new ApiError(409, "펀딩 상태가 바뀌었습니다. 최신 내용을 다시 확인해 주세요.", "FINANCE_FUNDING_STALE");
  }
  if (nextStatus === "refunding") {
    await refundFundingCampaign(db, campaignId, now, FINANCE_FUNDING_PROCESS_BATCH_SIZE);
  }
  const saved = await campaignById(db, context.classroom.id, campaignId);
  if (!saved) throw new ApiError(500, "변경된 펀딩을 확인할 수 없습니다.", "FINANCE_FUNDING_UNAVAILABLE");
  return { campaign: serializeCampaign(saved, context), deduplicated: false };
}

export async function contributeFinanceFundingCampaign(
  request: Request,
  campaignIdValue: unknown,
  input: {
    amount?: unknown;
    expectedCampaignRevision?: unknown;
    idempotencyKey?: unknown;
  },
) {
  const context = await financeContextForRequest(request);
  assertStudent(context);
  const now = Date.now();
  const campaignId = requiredId(campaignIdValue, "펀딩 ID");
  const revision = expectedRevision(input.expectedCampaignRevision);
  const key = idempotencyKey(input.idempotencyKey);
  const db = database();
  const duplicate = await contributionByKey(db, context.classroom.id, context.actor.id, key);
  if (duplicate) {
    const duplicateHash = await sha256(stableFinanceJson({
      amount: Number(input.amount),
      campaignId,
      classId: context.classroom.id,
      expectedCampaignRevision: revision,
      studentId: context.actor.id,
    }));
    if (duplicate.campaign_id !== campaignId || duplicate.payload_hash !== duplicateHash) {
      throw new ApiError(409, "같은 요청 번호가 다른 참여에 사용되었습니다.", "FINANCE_FUNDING_IDEMPOTENCY_CONFLICT");
    }
    const saved = await campaignById(db, context.classroom.id, campaignId);
    return {
      campaign: saved ? serializeCampaign(saved, context) : null,
      contribution: serializeContribution(duplicate),
      deduplicated: true,
    };
  }
  const campaign = await campaignById(db, context.classroom.id, campaignId);
  if (!campaign) throw new ApiError(404, "펀딩을 찾을 수 없습니다.", "FINANCE_FUNDING_NOT_FOUND");
  if (campaign.status !== "active") {
    throw new ApiError(409, "현재 참여할 수 없는 펀딩입니다.", "FINANCE_FUNDING_NOT_ACTIVE");
  }
  if (Number(campaign.deadline_at) <= now) {
    await startFundingRefund(db, campaign, "deadline", now);
    throw new ApiError(409, "마감된 펀딩입니다. 참여 금액은 자동 환불됩니다.", "FINANCE_FUNDING_DEADLINE_PASSED");
  }
  if (Number(campaign.revision) !== revision) {
    throw new ApiError(409, "다른 친구의 참여가 먼저 반영되었습니다. 남은 금액을 다시 확인해 주세요.", "FINANCE_FUNDING_STALE");
  }
  let contributionValues: ReturnType<typeof normalizeFinanceFundingContribution>;
  try {
    contributionValues = normalizeFinanceFundingContribution({
      amount: input.amount,
      remainingAmount: Number(campaign.target_amount) - Number(campaign.pledged_amount),
    });
  } catch (error) {
    ruleError(error);
  }
  const settings = await financeSettingsForClass(context.classroom.id);
  if (!financeAmountMatchesDenominations(contributionValues.amount, settings.denominations)) {
    throw new ApiError(
      400,
      `참여 금액은 ${Math.min(...settings.denominations).toLocaleString("ko-KR")} ${settings.currencyUnit} 단위로 입력해 주세요.`,
      "FINANCE_FUNDING_DENOMINATION_MISMATCH",
    );
  }
  const student = await studentForClass(db, context.classroom.id, context.actor.id);
  if (!student) throw new ApiError(403, "활성 학생만 펀딩에 참여할 수 있습니다.", "FINANCE_FUNDING_STUDENT_REQUIRED");
  const { wallet, issuance } = await accountRows(db, context.classroom.id, context.actor.id);
  const availability = await financeWalletAvailability(db, {
    classId: context.classroom.id,
    walletAccountId: wallet.id,
    balance: Number(wallet.balance),
  });
  if (availability.availableBalance < contributionValues.amount) {
    throw new ApiError(
      409,
      "출금 신청 금액을 빼면 펀딩에 참여할 잔액이 부족합니다.",
      "FINANCE_INSUFFICIENT_AVAILABLE_BALANCE",
    );
  }

  const contributionId = crypto.randomUUID();
  const transactionId = crypto.randomUUID();
  const payloadHash = await sha256(stableFinanceJson({
    amount: contributionValues.amount,
    campaignId,
    classId: context.classroom.id,
    expectedCampaignRevision: revision,
    studentId: context.actor.id,
  }));
  const transaction = normalizeFinanceTransaction({
    classId: context.classroom.id,
    idempotencyKey: `funding-contribution:${contributionId}`,
    transactionType: "funding_contribution",
    description: `${campaign.title} 펀딩 참여`,
    actor: { type: "system", label: "펀딩 자동화" },
    sourceType: "funding_contribution",
    sourceId: contributionId,
    lines: [
      { accountId: wallet.id, amount: -contributionValues.amount, memo: "펀딩 참여금 보관" },
      { accountId: issuance.id, amount: contributionValues.amount, memo: "펀딩 참여금 보관" },
    ],
    metadata: {
      campaignId,
      contributionId,
      contributorStudentId: context.actor.id,
      amount: contributionValues.amount,
    },
  });
  const transactionPayloadHash = await sha256(financeTransactionPayload(transaction));
  const next: CampaignRow = {
    ...campaign,
    pledged_amount: Number(campaign.pledged_amount) + contributionValues.amount,
    status: contributionValues.reachesTarget ? "funded" : "active",
    revision: revision + 1,
    updated_at: now,
    funded_at: contributionValues.reachesTarget ? now : null,
  };
  const statements = transactionStatements(db, {
    transactionId,
    transaction,
    transactionPayloadHash,
    accounts: new Map([[wallet.id, wallet], [issuance.id, issuance]]),
    now,
  });
  statements.push(
    db.prepare(
      `INSERT INTO finance_funding_contributions (
         id, class_id, campaign_id, contributor_student_id,
         wallet_account_id, student_number_snapshot, student_name_snapshot,
         amount, campaign_revision_before, idempotency_key, payload_hash,
         posted_transaction_id, transaction_payload_hash, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?,
         CASE WHEN EXISTS (
           SELECT 1 FROM finance_funding_campaigns campaign
           WHERE campaign.id = ? AND campaign.class_id = ?
             AND campaign.status = 'active' AND campaign.revision = ?
             AND campaign.deadline_at > ?
             AND campaign.pledged_amount + ? <= campaign.target_amount
         ) THEN ? ELSE NULL END,
         ?, ?, ?, ?, ?, ?)`,
    ).bind(
      contributionId,
      context.classroom.id,
      campaignId,
      context.actor.id,
      wallet.id,
      student.student_number,
      student.official_name,
      campaignId,
      context.classroom.id,
      revision,
      now,
      contributionValues.amount,
      contributionValues.amount,
      revision,
      key,
      payloadHash,
      transactionId,
      transactionPayloadHash,
      now,
    ),
    db.prepare(
      `UPDATE finance_funding_campaigns
       SET pledged_amount = pledged_amount + ?,
           status = CASE WHEN pledged_amount + ? = target_amount
                         THEN 'funded' ELSE 'active' END,
           funded_at = CASE WHEN pledged_amount + ? = target_amount
                            THEN ? ELSE funded_at END,
           revision = revision + 1, updated_at = ?
       WHERE id = ? AND class_id = ? AND status = 'active'
         AND revision = ? AND deadline_at > ?
         AND pledged_amount + ? <= target_amount`,
    ).bind(
      contributionValues.amount,
      contributionValues.amount,
      contributionValues.amount,
      now,
      now,
      campaignId,
      context.classroom.id,
      revision,
      now,
      contributionValues.amount,
    ),
  );
  if (contributionValues.reachesTarget) {
    const eventKey = `funding-event:${campaignId}:funded`;
    const eventHash = await sha256(stableFinanceJson({
      action: "funded",
      campaignId,
      pledgedAmount: next.pledged_amount,
      revision: next.revision,
    }));
    statements.push(
      db.prepare(
        `INSERT INTO finance_funding_campaign_events (
           id, class_id, campaign_id, revision, action, actor_type,
           actor_teacher_id, actor_student_id, actor_label,
           intervention_reason, idempotency_key, payload_hash,
           campaign_snapshot_json, created_at
         )
         SELECT ?, campaign.class_id, campaign.id, campaign.revision,
                'funded', 'system', NULL, NULL, '펀딩 자동화', NULL,
                ?, ?, ?, ?
         FROM finance_funding_campaigns campaign
         WHERE campaign.id = ? AND campaign.class_id = ?
           AND campaign.status = 'funded' AND campaign.revision = ?`,
      ).bind(
        crypto.randomUUID(),
        eventKey,
        eventHash,
        campaignSnapshot(next),
        now,
        campaignId,
        context.classroom.id,
        next.revision,
      ),
    );
  }
  try {
    await db.batch(statements);
  } catch (error) {
    const concurrent = await contributionByKey(db, context.classroom.id, context.actor.id, key);
    if (concurrent) {
      if (concurrent.campaign_id !== campaignId || concurrent.payload_hash !== payloadHash) {
        throw new ApiError(409, "같은 요청 번호가 다른 참여에 사용되었습니다.", "FINANCE_FUNDING_IDEMPOTENCY_CONFLICT");
      }
      const saved = await campaignById(db, context.classroom.id, campaignId);
      return {
        campaign: saved ? serializeCampaign(saved, context) : null,
        contribution: serializeContribution(concurrent),
        deduplicated: true,
      };
    }
    mapDatabaseError(error);
  }
  const savedContribution = await contributionByKey(db, context.classroom.id, context.actor.id, key);
  if (!savedContribution) {
    throw new ApiError(500, "펀딩 참여 기록을 확인할 수 없습니다.", "FINANCE_FUNDING_CONTRIBUTION_UNAVAILABLE");
  }
  let settlementPending = contributionValues.reachesTarget;
  if (contributionValues.reachesTarget) {
    try {
      await settleFundedCampaign(db, campaignId, now);
      settlementPending = false;
    } catch (error) {
      console.error("funding payout deferred", { campaignId, error });
    }
  }
  const saved = await campaignById(db, context.classroom.id, campaignId);
  return {
    campaign: saved ? serializeCampaign(saved, context) : null,
    contribution: serializeContribution(savedContribution),
    settlementPending,
    deduplicated: false,
  };
}

function serializeContribution(row: ContributionRow) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    amount: Number(row.amount),
    student: {
      id: row.contributor_student_id,
      number: Number(row.student_number_snapshot),
      name: row.student_name_snapshot,
    },
    createdAt: Number(row.created_at),
    transactionId: row.posted_transaction_id,
  };
}

async function settleFundedCampaign(db: D1Database, campaignId: string, now: number) {
  let campaign = await db.prepare(
    `SELECT ${CAMPAIGN_COLUMNS}
     FROM finance_funding_campaigns campaign
     WHERE campaign.id = ? AND campaign.status IN ('funded', 'succeeded')
     LIMIT 1`,
  ).bind(campaignId).first<CampaignRow>();
  if (!campaign) return { settled: false, skipped: true };
  const existing = await settlementForCampaign(db, campaignId);
  if (existing) {
    if (campaign.status !== "succeeded") {
      await db.prepare(
        `UPDATE finance_funding_campaigns
         SET status = 'succeeded', payout_transaction_id = ?, settled_at = ?,
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND status = 'funded'`,
      ).bind(existing.posted_transaction_id, existing.settled_at, now, campaignId).run();
    }
    return { settled: true, deduplicated: true };
  }
  const { wallet, issuance } = await accountRows(db, campaign.class_id, campaign.creator_student_id);
  if (wallet.id !== campaign.recipient_wallet_account_id) {
    throw new ApiError(409, "펀딩 수령 지갑이 바뀌어 자동 지급을 멈췄습니다.", "FINANCE_FUNDING_RECIPIENT_MISMATCH");
  }
  const amount = Number(campaign.target_amount);
  const settlementId = crypto.randomUUID();
  const transactionId = crypto.randomUUID();
  const key = `funding-settlement:${campaignId}`;
  const payloadHash = await sha256(stableFinanceJson({
    amount,
    campaignId,
    classId: campaign.class_id,
    recipientStudentId: campaign.creator_student_id,
  }));
  const transaction = normalizeFinanceTransaction({
    classId: campaign.class_id,
    idempotencyKey: key,
    transactionType: "funding_payout",
    description: `${campaign.title} 펀딩 성공 지급`,
    actor: { type: "system", label: "펀딩 자동화" },
    sourceType: "funding_settlement",
    sourceId: campaignId,
    lines: [
      { accountId: wallet.id, amount, memo: "펀딩 목표 달성금 지급" },
      { accountId: issuance.id, amount: -amount, memo: "보관 중인 펀딩 참여금 지급" },
    ],
    metadata: { campaignId, recipientStudentId: campaign.creator_student_id, amount },
  });
  const transactionPayloadHash = await sha256(financeTransactionPayload(transaction));
  const next: CampaignRow = {
    ...campaign,
    status: "succeeded",
    payout_transaction_id: transactionId,
    revision: Number(campaign.revision) + 1,
    updated_at: now,
    settled_at: now,
  };
  const eventKey = `funding-event:${campaignId}:succeeded`;
  const eventHash = await sha256(stableFinanceJson({
    action: "succeeded",
    campaignId,
    payoutTransactionId: transactionId,
    revision: next.revision,
  }));
  const statements = transactionStatements(db, {
    transactionId,
    transaction,
    transactionPayloadHash,
    accounts: new Map([[wallet.id, wallet], [issuance.id, issuance]]),
    now,
  });
  statements.push(
    db.prepare(
      `INSERT INTO finance_funding_settlements (
         id, class_id, campaign_id, recipient_student_id, amount,
         idempotency_key, payload_hash, posted_transaction_id,
         transaction_payload_hash, settled_at, created_at
       ) VALUES (?, ?, ?, ?,
         CASE WHEN EXISTS (
           SELECT 1 FROM finance_funding_campaigns campaign
           WHERE campaign.id = ? AND campaign.class_id = ?
             AND campaign.status = 'funded'
             AND campaign.pledged_amount = campaign.target_amount
         ) THEN ? ELSE NULL END,
         ?, ?, ?, ?, ?, ?)`,
    ).bind(
      settlementId,
      campaign.class_id,
      campaignId,
      campaign.creator_student_id,
      campaignId,
      campaign.class_id,
      amount,
      key,
      payloadHash,
      transactionId,
      transactionPayloadHash,
      now,
      now,
    ),
    db.prepare(
      `UPDATE finance_funding_campaigns
       SET status = 'succeeded', payout_transaction_id = ?, settled_at = ?,
           revision = revision + 1, updated_at = ?
       WHERE id = ? AND class_id = ? AND status = 'funded'
         AND pledged_amount = target_amount`,
    ).bind(transactionId, now, now, campaignId, campaign.class_id),
    db.prepare(
      `INSERT INTO finance_funding_campaign_events (
         id, class_id, campaign_id, revision, action, actor_type,
         actor_teacher_id, actor_student_id, actor_label,
         intervention_reason, idempotency_key, payload_hash,
         campaign_snapshot_json, created_at
       )
       SELECT ?, campaign.class_id, campaign.id, campaign.revision,
              'succeeded', 'system', NULL, NULL, '펀딩 자동화', NULL,
              ?, ?, ?, ?
       FROM finance_funding_campaigns campaign
       WHERE campaign.id = ? AND campaign.class_id = ?
         AND campaign.status = 'succeeded'`,
    ).bind(
      crypto.randomUUID(),
      eventKey,
      eventHash,
      campaignSnapshot(next),
      now,
      campaignId,
      campaign.class_id,
    ),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    const concurrent = await settlementForCampaign(db, campaignId);
    if (concurrent) return { settled: true, deduplicated: true };
    mapDatabaseError(error);
  }
  campaign = await campaignById(db, campaign.class_id, campaignId);
  return { settled: campaign?.status === "succeeded", deduplicated: false };
}

async function startFundingRefund(
  db: D1Database,
  campaign: CampaignRow,
  reason: "deadline" | "creator_cancelled" | "teacher_cancelled",
  now: number,
) {
  if (campaign.status === "refunding" || campaign.status === "failed" || campaign.status === "cancelled") {
    return campaign;
  }
  if (campaign.status !== "active" && campaign.status !== "paused") return campaign;
  const hasFunds = Number(campaign.pledged_amount) > Number(campaign.refunded_amount);
  const nextStatus: FinanceFundingStatus = hasFunds
    ? "refunding"
    : financeFundingTerminalStatus(reason);
  const next: CampaignRow = {
    ...campaign,
    status: nextStatus,
    terminal_reason: reason,
    revision: Number(campaign.revision) + 1,
    updated_at: now,
    cancelled_at: nextStatus === "cancelled" ? now : campaign.cancelled_at,
  };
  const action = hasFunds ? "refund_started" : nextStatus;
  const key = `funding-event:${campaign.id}:${action}`;
  const payloadHash = await sha256(stableFinanceJson({ action, campaignId: campaign.id, reason }));
  try {
    await db.batch([
      db.prepare(
        `UPDATE finance_funding_campaigns
         SET status = ?, terminal_reason = ?, revision = revision + 1,
             updated_at = ?, cancelled_at = ?
         WHERE id = ? AND class_id = ? AND revision = ?
           AND status IN ('active', 'paused')`,
      ).bind(
        nextStatus,
        reason,
        now,
        next.cancelled_at,
        campaign.id,
        campaign.class_id,
        campaign.revision,
      ),
      db.prepare(
        `INSERT INTO finance_funding_campaign_events (
           id, class_id, campaign_id, revision, action, actor_type,
           actor_teacher_id, actor_student_id, actor_label,
           intervention_reason, idempotency_key, payload_hash,
           campaign_snapshot_json, created_at
         )
         SELECT ?, campaign.class_id, campaign.id, campaign.revision, ?,
                'system', NULL, NULL, '펀딩 자동화', NULL, ?, ?, ?, ?
         FROM finance_funding_campaigns campaign
         WHERE campaign.id = ? AND campaign.class_id = ?
           AND campaign.revision = ? AND campaign.status = ?`,
      ).bind(
        crypto.randomUUID(),
        action,
        key,
        payloadHash,
        campaignSnapshot(next),
        now,
        campaign.id,
        campaign.class_id,
        next.revision,
        nextStatus,
      ),
    ]);
  } catch (error) {
    const duplicate = await eventByKey(db, campaign.class_id, key);
    if (!duplicate) mapDatabaseError(error);
  }
  return await campaignById(db, campaign.class_id, campaign.id) ?? campaign;
}

async function nextContributionToRefund(db: D1Database, campaignId: string) {
  return db.prepare(
    `SELECT contribution.id, contribution.class_id, contribution.campaign_id,
            contribution.contributor_student_id, contribution.wallet_account_id,
            contribution.student_number_snapshot,
            contribution.student_name_snapshot, contribution.amount,
            contribution.campaign_revision_before, contribution.idempotency_key,
            contribution.payload_hash, contribution.posted_transaction_id,
            contribution.transaction_payload_hash, contribution.created_at
     FROM finance_funding_contributions contribution
     WHERE contribution.campaign_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM finance_funding_refunds refund
         WHERE refund.contribution_id = contribution.id
       )
     ORDER BY contribution.created_at, contribution.id
     LIMIT 1`,
  ).bind(campaignId).first<ContributionRow>();
}

async function refundContribution(
  db: D1Database,
  campaign: CampaignRow,
  contribution: ContributionRow,
  now: number,
) {
  const existing = await db.prepare(
    `SELECT id FROM finance_funding_refunds WHERE contribution_id = ? LIMIT 1`,
  ).bind(contribution.id).first<{ id: string }>();
  if (existing) return { refunded: true, deduplicated: true };
  const { wallet, issuance } = await accountRows(
    db,
    campaign.class_id,
    contribution.contributor_student_id,
  );
  if (wallet.id !== contribution.wallet_account_id) {
    throw new ApiError(409, "환불 받을 지갑이 바뀌어 자동 환불을 멈췄습니다.", "FINANCE_FUNDING_RECIPIENT_MISMATCH");
  }
  const amount = Number(contribution.amount);
  const refundId = crypto.randomUUID();
  const transactionId = crypto.randomUUID();
  const key = `funding-refund:${contribution.id}`;
  const payloadHash = await sha256(stableFinanceJson({
    amount,
    campaignId: campaign.id,
    classId: campaign.class_id,
    contributionId: contribution.id,
    studentId: contribution.contributor_student_id,
  }));
  const transaction = normalizeFinanceTransaction({
    classId: campaign.class_id,
    idempotencyKey: key,
    transactionType: "funding_refund",
    description: `${campaign.title} 펀딩 환불`,
    actor: { type: "system", label: "펀딩 자동화" },
    sourceType: "funding_refund",
    sourceId: contribution.id,
    lines: [
      { accountId: wallet.id, amount, memo: "펀딩 참여금 환불" },
      { accountId: issuance.id, amount: -amount, memo: "보관 중인 펀딩 참여금 환불" },
    ],
    metadata: {
      campaignId: campaign.id,
      contributionId: contribution.id,
      studentId: contribution.contributor_student_id,
      amount,
      terminalReason: campaign.terminal_reason,
    },
  });
  const transactionPayloadHash = await sha256(financeTransactionPayload(transaction));
  const terminalStatus = financeFundingTerminalStatus(campaign.terminal_reason);
  const terminalEventKey = `funding-event:${campaign.id}:${terminalStatus}`;
  const terminalEventHash = await sha256(stableFinanceJson({
    action: terminalStatus,
    campaignId: campaign.id,
    reason: campaign.terminal_reason,
  }));
  const statements = transactionStatements(db, {
    transactionId,
    transaction,
    transactionPayloadHash,
    accounts: new Map([[wallet.id, wallet], [issuance.id, issuance]]),
    now,
  });
  statements.push(
    db.prepare(
      `INSERT INTO finance_funding_refunds (
         id, class_id, campaign_id, contribution_id, student_id, amount,
         idempotency_key, payload_hash, posted_transaction_id,
         transaction_payload_hash, refunded_at, created_at
       ) VALUES (?, ?, ?, ?, ?,
         CASE WHEN EXISTS (
           SELECT 1 FROM finance_funding_campaigns campaign
           WHERE campaign.id = ? AND campaign.class_id = ?
             AND campaign.status = 'refunding'
         ) AND NOT EXISTS (
           SELECT 1 FROM finance_funding_refunds existing
           WHERE existing.contribution_id = ?
         ) THEN ? ELSE NULL END,
         ?, ?, ?, ?, ?, ?)`,
    ).bind(
      refundId,
      campaign.class_id,
      campaign.id,
      contribution.id,
      contribution.contributor_student_id,
      campaign.id,
      campaign.class_id,
      contribution.id,
      amount,
      key,
      payloadHash,
      transactionId,
      transactionPayloadHash,
      now,
      now,
    ),
    db.prepare(
      `UPDATE finance_funding_campaigns
       SET refunded_amount = (
             SELECT COALESCE(SUM(refund.amount), 0)
             FROM finance_funding_refunds refund
             WHERE refund.campaign_id = finance_funding_campaigns.id
           ),
           status = CASE WHEN (
             SELECT COALESCE(SUM(refund.amount), 0)
             FROM finance_funding_refunds refund
             WHERE refund.campaign_id = finance_funding_campaigns.id
           ) >= pledged_amount THEN ? ELSE 'refunding' END,
           cancelled_at = CASE WHEN ? = 'cancelled' AND (
             SELECT COALESCE(SUM(refund.amount), 0)
             FROM finance_funding_refunds refund
             WHERE refund.campaign_id = finance_funding_campaigns.id
           ) >= pledged_amount THEN ? ELSE cancelled_at END,
           revision = revision + 1, updated_at = ?
       WHERE id = ? AND class_id = ? AND status = 'refunding'`,
    ).bind(
      terminalStatus,
      terminalStatus,
      now,
      now,
      campaign.id,
      campaign.class_id,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO finance_funding_campaign_events (
         id, class_id, campaign_id, revision, action, actor_type,
         actor_teacher_id, actor_student_id, actor_label,
         intervention_reason, idempotency_key, payload_hash,
         campaign_snapshot_json, created_at
       )
       SELECT ?, campaign.class_id, campaign.id, campaign.revision,
              campaign.status, 'system', NULL, NULL, '펀딩 자동화', NULL,
              ?, ?, json_object(
                'id', campaign.id,
                'classId', campaign.class_id,
                'creatorStudentId', campaign.creator_student_id,
                'title', campaign.title,
                'description', campaign.description,
                'targetAmount', campaign.target_amount,
                'pledgedAmount', campaign.pledged_amount,
                'refundedAmount', campaign.refunded_amount,
                'status', campaign.status,
                'terminalReason', campaign.terminal_reason,
                'deadlineAt', campaign.deadline_at,
                'revision', campaign.revision
              ), ?
       FROM finance_funding_campaigns campaign
       WHERE campaign.id = ? AND campaign.class_id = ?
         AND campaign.status IN ('failed', 'cancelled')`,
    ).bind(
      crypto.randomUUID(),
      terminalEventKey,
      terminalEventHash,
      now,
      campaign.id,
      campaign.class_id,
    ),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    const concurrent = await db.prepare(
      `SELECT id FROM finance_funding_refunds WHERE contribution_id = ? LIMIT 1`,
    ).bind(contribution.id).first<{ id: string }>();
    if (concurrent) return { refunded: true, deduplicated: true };
    mapDatabaseError(error);
  }
  return { refunded: true, deduplicated: false };
}

async function refundFundingCampaign(
  db: D1Database,
  campaignId: string,
  now: number,
  limit: number,
) {
  let refunded = 0;
  let failed = 0;
  for (let index = 0; index < limit; index += 1) {
    const campaign = await db.prepare(
      `SELECT ${CAMPAIGN_COLUMNS}
       FROM finance_funding_campaigns campaign
       WHERE campaign.id = ? AND campaign.status = 'refunding'
       LIMIT 1`,
    ).bind(campaignId).first<CampaignRow>();
    if (!campaign) break;
    const contribution = await nextContributionToRefund(db, campaignId);
    if (!contribution) {
      const terminalStatus = financeFundingTerminalStatus(campaign.terminal_reason);
      await db.prepare(
        `UPDATE finance_funding_campaigns
         SET status = ?, refunded_amount = pledged_amount,
             cancelled_at = CASE WHEN ? = 'cancelled' THEN ? ELSE cancelled_at END,
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND status = 'refunding'`,
      ).bind(terminalStatus, terminalStatus, now, now, campaignId).run();
      break;
    }
    try {
      await refundContribution(db, campaign, contribution, now);
      refunded += 1;
    } catch (error) {
      failed += 1;
      console.error("funding refund deferred", { campaignId, contributionId: contribution.id, error });
      break;
    }
  }
  const campaign = await db.prepare(
    `SELECT status FROM finance_funding_campaigns WHERE id = ? LIMIT 1`,
  ).bind(campaignId).first<{ status: FinanceFundingStatus }>();
  return {
    refunded,
    failed,
    completed: campaign?.status === "failed" || campaign?.status === "cancelled",
  };
}

export async function processDueFundingCampaigns(
  db: D1Database,
  options: {
    now?: number;
    limit?: number;
    classId?: string;
  } = {},
) {
  const now = Number(options.now ?? Date.now());
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit ?? 20)));
  const classId = options.classId?.trim() || null;
  const dueRows = await db.prepare(
    `SELECT ${CAMPAIGN_COLUMNS}
     FROM finance_funding_campaigns campaign
     WHERE campaign.status IN ('active', 'paused')
       AND campaign.deadline_at <= ?
       AND (? IS NULL OR campaign.class_id = ?)
     ORDER BY campaign.deadline_at, campaign.id
     LIMIT ?`,
  ).bind(now, classId, classId, limit).all<CampaignRow>();
  let transitioned = 0;
  let settled = 0;
  let refunded = 0;
  let completed = 0;
  let failed = 0;
  for (const campaign of dueRows.results) {
    try {
      await startFundingRefund(db, campaign, "deadline", now);
      transitioned += 1;
    } catch (error) {
      failed += 1;
      console.error("funding deadline transition deferred", { campaignId: campaign.id, error });
    }
  }
  const fundedRows = await db.prepare(
    `SELECT id FROM finance_funding_campaigns
     WHERE status = 'funded' AND (? IS NULL OR class_id = ?)
     ORDER BY funded_at, id LIMIT ?`,
  ).bind(classId, classId, limit).all<{ id: string }>();
  for (const row of fundedRows.results) {
    try {
      const result = await settleFundedCampaign(db, row.id, now);
      if (result.settled) settled += 1;
    } catch (error) {
      failed += 1;
      console.error("funding payout deferred", { campaignId: row.id, error });
    }
  }
  const refundingRows = await db.prepare(
    `SELECT id FROM finance_funding_campaigns
     WHERE status = 'refunding' AND (? IS NULL OR class_id = ?)
     ORDER BY updated_at, id LIMIT ?`,
  ).bind(classId, classId, limit).all<{ id: string }>();
  for (const row of refundingRows.results) {
    const result = await refundFundingCampaign(
      db,
      row.id,
      now,
      FINANCE_FUNDING_PROCESS_BATCH_SIZE,
    );
    refunded += result.refunded;
    failed += result.failed;
    if (result.completed) completed += 1;
  }
  return {
    due: dueRows.results.length,
    transitioned,
    funded: fundedRows.results.length,
    settled,
    refunding: refundingRows.results.length,
    refunded,
    completed,
    failed,
  };
}

export async function financeFundingForRequest(request: Request) {
  const context = await financeContextForRequest(request);
  const db = database();
  const actorStudentId = context.actor.type === "student" ? context.actor.id : "";
  const rows = await db.prepare(
    `SELECT ${CAMPAIGN_COLUMNS},
            COUNT(DISTINCT contribution.contributor_student_id) AS participant_count,
            COUNT(contribution.id) AS contribution_count,
            COALESCE(SUM(CASE WHEN contribution.contributor_student_id = ?
                              THEN contribution.amount ELSE 0 END), 0)
              AS my_contribution_amount
     FROM finance_funding_campaigns campaign
     LEFT JOIN finance_funding_contributions contribution
       ON contribution.campaign_id = campaign.id
      AND contribution.class_id = campaign.class_id
     WHERE campaign.class_id = ?
     GROUP BY campaign.id
     ORDER BY
       CASE campaign.status
         WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'funded' THEN 2
         WHEN 'refunding' THEN 3 ELSE 4 END,
       campaign.updated_at DESC, campaign.id DESC
     LIMIT 100`,
  ).bind(actorStudentId, context.classroom.id).all<CampaignViewRow>();
  const settings = await financeSettingsForClass(context.classroom.id);
  const hasOpenCampaign = context.actor.type === "student"
    && rows.results.some((campaign) => (
      campaign.creator_student_id === context.actor.id
      && ["active", "paused", "funded", "refunding"].includes(campaign.status)
    ));
  return {
    context: {
      actorType: context.actor.type,
      actorId: context.actor.id,
      financeRole: context.financeRole,
      classId: context.classroom.id,
      classIsActive: context.classroom.status === "active",
    },
    currencyUnit: settings.currencyUnit,
    denominationStep: Math.min(...settings.denominations),
    canCreate: context.actor.type === "student"
      && context.classroom.status === "active"
      && !hasOpenCampaign,
    campaigns: rows.results.map((row) => serializeCampaign(row, context)),
  };
}
