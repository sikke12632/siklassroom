import { sha256 } from "./crypto";
import { database, ensureSchema } from "./database";
import { financeWalletAvailability } from "./finance-available-balance";
import {
  FinanceDepositRuleError,
  FINANCE_DEPOSIT_SETTLEMENT_BATCH_SIZE,
  calculateFinanceDepositQuote,
  financeDepositMaturityAt,
  financeDepositSettlementEnabled,
  normalizeFinanceDepositPrincipal,
  normalizeFinanceDepositProduct,
} from "./finance-deposit-rules";
import {
  type FinanceContext,
  financeContextForRequest,
} from "./finance-access";
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
import {
  financeAmountMatchesDenominations,
} from "./finance-settings-rules";
import { financeSettingsForClass } from "./finance-settings";
import { ApiError } from "./responses";

type ProductRow = {
  id: string;
  class_id: string;
  name: string;
  description: string;
  term_weeks: number;
  maturity_interest_bps: number;
  early_interest_bps: number;
  min_amount: number;
  max_amount: number;
  is_open: number;
  revision: number;
  created_at: number;
  updated_at: number;
  subscriber_count?: number;
  active_count?: number;
  total_principal?: number;
  next_maturity_at?: number | null;
};

type ProductEventRow = {
  product_id: string;
  payload_hash: string;
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

type ContractRow = {
  id: string;
  class_id: string;
  product_id: string;
  product_revision: number;
  student_id: string;
  wallet_account_id: string;
  principal: number;
  product_name_snapshot: string;
  term_weeks_snapshot: number;
  maturity_interest_bps_snapshot: number;
  early_interest_bps_snapshot: number;
  maturity_interest: number;
  early_interest: number;
  maturity_payout: number;
  early_payout: number;
  opened_at: number;
  matures_at: number;
  idempotency_key: string;
  payload_hash: string;
  posted_transaction_id: string;
  created_at: number;
  student_number: number;
  student_name: string;
  settlement_id: string | null;
  settlement_type: string | null;
  settlement_interest: number | null;
  settlement_payout: number | null;
  settled_at: number | null;
};

type SettlementRow = {
  id: string;
  class_id: string;
  contract_id: string;
  student_id: string;
  settlement_type: string;
  principal: number;
  interest: number;
  payout: number;
  idempotency_key: string;
  payload_hash: string;
  posted_transaction_id: string;
  settled_at: number;
};

type ContractForSettlementRow = ContractRow & {
  wallet_status: string;
  wallet_balance: number;
  wallet_revision: number;
  class_status: string;
};

const PRODUCT_SELECT = `
  product.id, product.class_id, product.name, product.description,
  product.term_weeks, product.maturity_interest_bps,
  product.early_interest_bps, product.min_amount, product.max_amount,
  product.is_open, product.revision, product.created_at, product.updated_at`;

const CONTRACT_SELECT = `
  contract.id, contract.class_id, contract.product_id,
  contract.product_revision, contract.student_id, contract.wallet_account_id,
  contract.principal, contract.product_name_snapshot,
  contract.term_weeks_snapshot, contract.maturity_interest_bps_snapshot,
  contract.early_interest_bps_snapshot, contract.maturity_interest,
  contract.early_interest, contract.maturity_payout, contract.early_payout,
  contract.opened_at, contract.matures_at, contract.idempotency_key,
  contract.payload_hash, contract.posted_transaction_id, contract.created_at,
  student.student_number, student.official_name AS student_name,
  settlement.id AS settlement_id, settlement.settlement_type,
  settlement.interest AS settlement_interest,
  settlement.payout AS settlement_payout, settlement.settled_at`;

function ruleError(error: unknown): never {
  if (error instanceof FinanceDepositRuleError) {
    throw new ApiError(400, error.message, error.code);
  }
  throw error;
}

function requiredId(value: unknown, field: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 160 || !/^[A-Za-z0-9:_-]+$/.test(normalized)) {
    throw new ApiError(400, `${field}를 다시 확인해 주세요.`, "FINANCE_DEPOSIT_INVALID_ID");
  }
  return normalized;
}

function idempotencyKey(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(normalized)) {
    throw new ApiError(
      400,
      "저장 요청 번호를 다시 확인해 주세요.",
      "FINANCE_DEPOSIT_INVALID_IDEMPOTENCY_KEY",
    );
  }
  return normalized;
}

function expectedRevision(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new ApiError(
      400,
      `최신 ${label} 정보를 다시 불러와 주세요.`,
      "FINANCE_DEPOSIT_INVALID_REVISION",
    );
  }
  return Number(value);
}

function assertTeacher(context: FinanceContext) {
  if (context.actor.type !== "teacher" || context.financeRole !== "teacher") {
    throw new ApiError(
      403,
      "예금상품은 담임 선생님만 발행하고 판매를 관리할 수 있습니다.",
      "FINANCE_DEPOSIT_TEACHER_REQUIRED",
    );
  }
  if (context.classroom.status !== "active") {
    throw new ApiError(
      409,
      "보관된 학급에서는 예금상품을 바꿀 수 없습니다.",
      "FINANCE_CLASS_ARCHIVED",
    );
  }
}

function assertStudent(context: FinanceContext) {
  if (context.actor.type !== "student") {
    throw new ApiError(
      403,
      "예금 가입과 해지는 학생 본인만 할 수 있습니다.",
      "FINANCE_DEPOSIT_STUDENT_REQUIRED",
    );
  }
}

function productSnapshot(row: ProductRow) {
  return stableFinanceJson({
    description: row.description,
    earlyInterestBps: Number(row.early_interest_bps),
    isOpen: Boolean(row.is_open),
    maturityInterestBps: Number(row.maturity_interest_bps),
    maxAmount: Number(row.max_amount),
    minAmount: Number(row.min_amount),
    name: row.name,
    revision: Number(row.revision),
    termWeeks: Number(row.term_weeks),
  });
}

function serializeProduct(row: ProductRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    termWeeks: Number(row.term_weeks),
    maturityInterestBps: Number(row.maturity_interest_bps),
    earlyInterestBps: Number(row.early_interest_bps),
    minAmount: Number(row.min_amount),
    maxAmount: Number(row.max_amount),
    isOpen: Boolean(row.is_open),
    revision: Number(row.revision),
    subscriberCount: Number(row.subscriber_count ?? 0),
    activeCount: Number(row.active_count ?? 0),
    activeSubscriberCount: Number(row.active_count ?? 0),
    totalPrincipal: Number(row.total_principal ?? 0),
    nextMaturityAt: row.next_maturity_at == null
      ? null
      : Number(row.next_maturity_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function serializeSettlement(row: SettlementRow) {
  return {
    id: row.id,
    contractId: row.contract_id,
    settlementType: row.settlement_type as "early_termination" | "maturity",
    principal: Number(row.principal),
    interest: Number(row.interest),
    payout: Number(row.payout),
    settledAt: Number(row.settled_at),
    transactionId: row.posted_transaction_id,
  };
}

function serializeContract(row: ContractRow, now = Date.now()) {
  const settlementType = row.settlement_type === "maturity"
    ? "maturity" as const
    : row.settlement_type === "early_termination"
      ? "early_termination" as const
      : null;
  const status = settlementType === "maturity"
    ? "maturity_paid" as const
    : settlementType === "early_termination"
      ? "early_terminated" as const
      : now >= Number(row.matures_at)
        ? "matured" as const
        : "active" as const;
  return {
    id: row.id,
    productId: row.product_id,
    productRevision: Number(row.product_revision),
    productName: row.product_name_snapshot,
    principal: Number(row.principal),
    termWeeks: Number(row.term_weeks_snapshot),
    maturityInterestBps: Number(row.maturity_interest_bps_snapshot),
    earlyInterestBps: Number(row.early_interest_bps_snapshot),
    maturityInterest: Number(row.maturity_interest),
    earlyInterest: Number(row.early_interest),
    maturityPayout: Number(row.maturity_payout),
    earlyPayout: Number(row.early_payout),
    openedAt: Number(row.opened_at),
    maturesAt: Number(row.matures_at),
    status,
    settlementType,
    settledAt: row.settled_at === null ? null : Number(row.settled_at),
    payout: row.settlement_payout === null
      ? null
      : Number(row.settlement_payout),
    interest: row.settlement_interest === null
      ? null
      : Number(row.settlement_interest),
    transactionId: row.posted_transaction_id,
    student: {
      id: row.student_id,
      number: Number(row.student_number),
      name: row.student_name,
    },
  };
}

async function productById(db: D1Database, classId: string, productId: string) {
  return db.prepare(
    `SELECT ${PRODUCT_SELECT}
     FROM finance_deposit_products product
     WHERE product.class_id = ? AND product.id = ?
     LIMIT 1`,
  ).bind(classId, productId).first<ProductRow>();
}

async function productEventByIdempotency(
  db: D1Database,
  classId: string,
  key: string,
) {
  return db.prepare(
    `SELECT product_id, payload_hash
     FROM finance_deposit_product_events
     WHERE class_id = ? AND idempotency_key = ?
     LIMIT 1`,
  ).bind(classId, key).first<ProductEventRow>();
}

async function contractRowById(
  db: D1Database,
  classId: string,
  contractId: string,
) {
  return db.prepare(
    `SELECT ${CONTRACT_SELECT}
     FROM finance_deposit_contracts contract
     JOIN students student ON student.id = contract.student_id
       AND student.class_id = contract.class_id
     LEFT JOIN finance_deposit_settlements settlement
       ON settlement.contract_id = contract.id
       AND settlement.class_id = contract.class_id
     WHERE contract.class_id = ? AND contract.id = ?
     LIMIT 1`,
  ).bind(classId, contractId).first<ContractRow>();
}

async function contractByIdempotency(
  db: D1Database,
  classId: string,
  studentId: string,
  key: string,
) {
  return db.prepare(
    `SELECT ${CONTRACT_SELECT}
     FROM finance_deposit_contracts contract
     JOIN students student ON student.id = contract.student_id
       AND student.class_id = contract.class_id
     LEFT JOIN finance_deposit_settlements settlement
       ON settlement.contract_id = contract.id
       AND settlement.class_id = contract.class_id
     WHERE contract.class_id = ? AND contract.student_id = ?
       AND contract.idempotency_key = ?
     LIMIT 1`,
  ).bind(classId, studentId, key).first<ContractRow>();
}

async function settlementForContract(db: D1Database, contractId: string) {
  return db.prepare(
    `SELECT id, class_id, contract_id, student_id, settlement_type,
            principal, interest, payout, idempotency_key, payload_hash,
            posted_transaction_id, settled_at
     FROM finance_deposit_settlements
     WHERE contract_id = ?
     LIMIT 1`,
  ).bind(contractId).first<SettlementRow>();
}

async function accountRows(
  db: D1Database,
  classId: string,
  studentId: string,
) {
  const walletId = studentWalletAccountId(studentId);
  const issuanceId = classIssuanceAccountId(classId);
  const rows = await db.prepare(
    `SELECT id, class_id, student_id, account_type, balance, revision, status
     FROM finance_accounts
     WHERE class_id = ? AND id IN (?, ?)`,
  ).bind(classId, walletId, issuanceId).all<AccountRow>();
  const wallet = rows.results.find((row) => row.id === walletId) ?? null;
  const issuance = rows.results.find((row) => row.id === issuanceId) ?? null;
  if (!wallet || !issuance) {
    throw new ApiError(
      409,
      "예금에 사용할 지갑 정보를 찾지 못했습니다.",
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
                 'system', NULL, NULL, NULL, ?, ?, ?, NULL)`,
    ).bind(
      input.transactionId,
      input.transaction.classId,
      input.transaction.transactionType,
      input.transaction.description,
      input.transaction.idempotencyKey,
      input.transactionPayloadHash,
      input.transaction.sourceType,
      input.transaction.sourceId,
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
        "예금에 사용할 지갑 정보를 찾지 못했습니다.",
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
        `finance:deposit:${input.transactionId}:${index}`,
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

function mapDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const mappings: Array<[string, number, string, string]> = [
    ["FINANCE_DEPOSIT_PRODUCT_STALE", 409, "다른 화면에서 상품 상태를 먼저 바꿨어요. 최신 정보를 다시 불러와 주세요.", "FINANCE_DEPOSIT_PRODUCT_STALE"],
    ["FINANCE_DEPOSIT_PRODUCT_EVENT_INVALID", 409, "다른 화면에서 상품 상태를 먼저 바꿨어요. 최신 정보를 다시 불러와 주세요.", "FINANCE_DEPOSIT_PRODUCT_STALE"],
    ["FINANCE_DEPOSIT_PRODUCT_ACCESS_DENIED", 403, "이 학급의 예금상품을 관리할 수 없습니다.", "FINANCE_DEPOSIT_PRODUCT_ACCESS_DENIED"],
    ["FINANCE_DEPOSIT_SUBSCRIPTION_STALE", 409, "상품 조건이나 학생 지갑이 달라졌어요. 최신 정보를 확인해 주세요.", "FINANCE_DEPOSIT_SUBSCRIPTION_STALE"],
    ["FINANCE_DEPOSIT_ACTIVE_EXISTS", 409, "이 상품에 이미 가입한 예금이 있어요.", "FINANCE_DEPOSIT_ACTIVE_EXISTS"],
    ["FINANCE_DEPOSIT_SETTLEMENT_STALE", 409, "예금이 이미 처리되었거나 만기 상태가 바뀌었어요.", "FINANCE_DEPOSIT_SETTLEMENT_STALE"],
    ["FINANCE_DEPOSIT_LEDGER_MISMATCH", 409, "예금 기록과 지갑 기록이 맞지 않아 처리를 멈췄습니다.", "FINANCE_DEPOSIT_LEDGER_MISMATCH"],
    ["FINANCE_DEPOSIT_CALCULATION_MISMATCH", 409, "예금 이자 계산을 다시 확인해야 합니다.", "FINANCE_DEPOSIT_CALCULATION_MISMATCH"],
    ["FINANCE_INSUFFICIENT_AVAILABLE_BALANCE", 409, "출금 신청 금액을 빼면 예금에 맡길 수 있는 금액이 부족해요.", "FINANCE_INSUFFICIENT_AVAILABLE_BALANCE"],
    ["FINANCE_INSUFFICIENT_FUNDS", 409, "지갑 잔액이 부족해 예금에 가입하지 못했어요.", "FINANCE_INSUFFICIENT_FUNDS"],
    ["FINANCE_ACCOUNT_NOT_ACTIVE", 409, "현재 사용할 수 없는 지갑입니다.", "FINANCE_ACCOUNT_NOT_ACTIVE"],
    ["FINANCE_ACCOUNT_STALE", 409, "다른 거래가 먼저 반영됐어요. 최신 잔액으로 다시 시도해 주세요.", "FINANCE_ACCOUNT_STALE"],
    ["FINANCE_CLASS_NOT_ACTIVE", 409, "현재 운영 중인 학급에서만 예금을 처리할 수 있습니다.", "FINANCE_CLASS_NOT_ACTIVE"],
  ];
  for (const [needle, status, userMessage, code] of mappings) {
    if (message.includes(needle)) throw new ApiError(status, userMessage, code);
  }
  if (
    message.includes("finance_deposit_product_events_class_idempotency_uq")
    || message.includes("finance_deposit_product_events.class_id, finance_deposit_product_events.idempotency_key")
  ) {
    throw new ApiError(409, "같은 저장 요청이 다른 상품 변경에 사용됐어요.", "FINANCE_DEPOSIT_IDEMPOTENCY_CONFLICT");
  }
  if (
    message.includes("finance_deposit_product_events_product_revision_uq")
    || message.includes("finance_deposit_product_events.product_id, finance_deposit_product_events.revision")
  ) {
    throw new ApiError(409, "다른 화면에서 상품 상태를 먼저 바꿨어요. 최신 정보를 다시 불러와 주세요.", "FINANCE_DEPOSIT_PRODUCT_STALE");
  }
  if (
    message.includes("finance_deposit_contracts_class_student_idempotency_uq")
    || message.includes("finance_deposit_contracts.class_id, finance_deposit_contracts.student_id, finance_deposit_contracts.idempotency_key")
  ) {
    throw new ApiError(409, "같은 가입 요청이 다른 내용에 사용됐어요.", "FINANCE_DEPOSIT_IDEMPOTENCY_CONFLICT");
  }
  if (
    message.includes("finance_deposit_settlements_contract_uq")
    || message.includes("finance_deposit_settlements.contract_id")
  ) {
    throw new ApiError(409, "이 예금은 이미 정산되었습니다.", "FINANCE_DEPOSIT_ALREADY_SETTLED");
  }
  if (
    message.includes("finance_deposit_settlements_class_student_idempotency_uq")
    || message.includes("finance_deposit_settlements.class_id, finance_deposit_settlements.student_id, finance_deposit_settlements.idempotency_key")
  ) {
    throw new ApiError(409, "같은 정산 요청이 다른 내용에 사용됐어요.", "FINANCE_DEPOSIT_IDEMPOTENCY_CONFLICT");
  }
  throw error;
}

export async function createFinanceDepositProduct(
  request: Request,
  input: {
    name?: unknown;
    description?: unknown;
    termWeeks?: unknown;
    maturityInterestBps?: unknown;
    earlyInterestBps?: unknown;
    minAmount?: unknown;
    maxAmount?: unknown;
    idempotencyKey?: unknown;
  },
) {
  const context = await financeContextForRequest(request);
  assertTeacher(context);
  let values: ReturnType<typeof normalizeFinanceDepositProduct>;
  try {
    values = normalizeFinanceDepositProduct({
      ...input,
      earlyInterestShareBps: input.earlyInterestBps,
    });
  } catch (error) {
    ruleError(error);
  }
  const key = idempotencyKey(input.idempotencyKey);
  const payloadHash = await sha256(stableFinanceJson({
    classId: context.classroom.id,
    ...values,
  }));
  const db = database();
  const duplicate = await productEventByIdempotency(db, context.classroom.id, key);
  if (duplicate) {
    if (duplicate.payload_hash !== payloadHash) {
      throw new ApiError(409, "같은 저장 요청이 다른 상품에 사용됐어요.", "FINANCE_DEPOSIT_IDEMPOTENCY_CONFLICT");
    }
    const product = await productById(db, context.classroom.id, duplicate.product_id);
    if (!product) throw new ApiError(500, "발행한 상품을 다시 확인하지 못했습니다.", "FINANCE_DEPOSIT_PRODUCT_UNAVAILABLE");
    return { product: serializeProduct(product), deduplicated: true };
  }
  const settings = await financeSettingsForClass(context.classroom.id);
  if (
    !financeAmountMatchesDenominations(values.minAmount, settings.denominations)
    || !financeAmountMatchesDenominations(values.maxAmount, settings.denominations)
  ) {
    throw new ApiError(
      400,
      `최소·최대 가입액은 ${Math.min(...settings.denominations).toLocaleString("ko-KR")} ${settings.currencyUnit} 단위로 정해 주세요.`,
      "FINANCE_DEPOSIT_DENOMINATION_MISMATCH",
    );
  }

  const now = Date.now();
  const productId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const row: ProductRow = {
    id: productId,
    class_id: context.classroom.id,
    name: values.name,
    description: values.description ?? "",
    term_weeks: values.termWeeks,
    maturity_interest_bps: values.maturityInterestBps,
    early_interest_bps: values.earlyInterestShareBps,
    min_amount: values.minAmount,
    max_amount: values.maxAmount,
    is_open: 1,
    revision: 0,
    created_at: now,
    updated_at: now,
  };
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO finance_deposit_products (
           id, class_id, name, description, term_weeks,
           maturity_interest_bps, early_interest_bps, min_amount, max_amount,
           is_open, revision, created_by_teacher_id, updated_by_teacher_id,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?)`,
      ).bind(
        productId,
        context.classroom.id,
        row.name,
        row.description,
        row.term_weeks,
        row.maturity_interest_bps,
        row.early_interest_bps,
        row.min_amount,
        row.max_amount,
        context.actor.id,
        context.actor.id,
        now,
        now,
      ),
      db.prepare(
        `INSERT INTO finance_deposit_product_events (
           id, class_id, product_id, revision, action, idempotency_key,
           payload_hash, product_snapshot_json, actor_teacher_id, created_at
         ) VALUES (?, ?, ?, 0, 'issued', ?, ?, ?, ?, ?)`,
      ).bind(
        eventId,
        context.classroom.id,
        productId,
        key,
        payloadHash,
        productSnapshot(row),
        context.actor.id,
        now,
      ),
    ]);
  } catch (error) {
    const concurrent = await productEventByIdempotency(db, context.classroom.id, key);
    if (concurrent) {
      if (concurrent.payload_hash !== payloadHash) {
        throw new ApiError(409, "같은 저장 요청이 다른 상품에 사용됐어요.", "FINANCE_DEPOSIT_IDEMPOTENCY_CONFLICT");
      }
      const product = await productById(db, context.classroom.id, concurrent.product_id);
      if (product) return { product: serializeProduct(product), deduplicated: true };
    }
    mapDatabaseError(error);
  }
  return { product: serializeProduct(row), deduplicated: false };
}

export async function updateFinanceDepositProductState(
  request: Request,
  productIdValue: unknown,
  input: {
    isOpen?: unknown;
    expectedRevision?: unknown;
    idempotencyKey?: unknown;
  },
) {
  const context = await financeContextForRequest(request);
  assertTeacher(context);
  const productId = requiredId(productIdValue, "상품 ID");
  if (typeof input.isOpen !== "boolean") {
    throw new ApiError(400, "판매 상태를 다시 선택해 주세요.", "FINANCE_DEPOSIT_INVALID_STATE");
  }
  const revision = expectedRevision(input.expectedRevision, "상품");
  const key = idempotencyKey(input.idempotencyKey);
  const payloadHash = await sha256(stableFinanceJson({
    classId: context.classroom.id,
    productId,
    isOpen: input.isOpen,
    expectedRevision: revision,
  }));
  const db = database();
  const duplicate = await productEventByIdempotency(db, context.classroom.id, key);
  if (duplicate) {
    if (duplicate.product_id !== productId || duplicate.payload_hash !== payloadHash) {
      throw new ApiError(409, "같은 저장 요청이 다른 상품 변경에 사용됐어요.", "FINANCE_DEPOSIT_IDEMPOTENCY_CONFLICT");
    }
    const product = await productById(db, context.classroom.id, productId);
    if (!product) throw new ApiError(404, "예금상품을 찾지 못했습니다.", "FINANCE_DEPOSIT_PRODUCT_NOT_FOUND");
    return { product: serializeProduct(product), deduplicated: true };
  }
  const current = await productById(db, context.classroom.id, productId);
  if (!current) {
    throw new ApiError(404, "예금상품을 찾지 못했습니다.", "FINANCE_DEPOSIT_PRODUCT_NOT_FOUND");
  }
  if (Number(current.revision) !== revision) {
    throw new ApiError(409, "다른 화면에서 상품 상태를 먼저 바꿨어요. 최신 정보를 다시 불러와 주세요.", "FINANCE_DEPOSIT_PRODUCT_STALE");
  }
  if (Boolean(current.is_open) === input.isOpen) {
    return { product: serializeProduct(current), deduplicated: true };
  }
  const now = Date.now();
  const next: ProductRow = {
    ...current,
    is_open: input.isOpen ? 1 : 0,
    revision: revision + 1,
    updated_at: now,
  };
  try {
    await db.batch([
      db.prepare(
        `UPDATE finance_deposit_products
         SET is_open = ?, revision = revision + 1,
             updated_by_teacher_id = ?, updated_at = ?
         WHERE id = ? AND class_id = ? AND revision = ?`,
      ).bind(
        input.isOpen ? 1 : 0,
        context.actor.id,
        now,
        productId,
        context.classroom.id,
        revision,
      ),
      db.prepare(
        `INSERT INTO finance_deposit_product_events (
           id, class_id, product_id, revision, action, idempotency_key,
           payload_hash, product_snapshot_json, actor_teacher_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        context.classroom.id,
        productId,
        next.revision,
        input.isOpen ? "opened" : "paused",
        key,
        payloadHash,
        productSnapshot(next),
        context.actor.id,
        now,
      ),
    ]);
  } catch (error) {
    const concurrent = await productEventByIdempotency(db, context.classroom.id, key);
    if (concurrent && concurrent.product_id === productId && concurrent.payload_hash === payloadHash) {
      const product = await productById(db, context.classroom.id, productId);
      if (product) return { product: serializeProduct(product), deduplicated: true };
    }
    mapDatabaseError(error);
  }
  return { product: serializeProduct(next), deduplicated: false };
}

export async function subscribeFinanceDeposit(
  request: Request,
  productIdValue: unknown,
  input: {
    amount?: unknown;
    expectedProductRevision?: unknown;
    idempotencyKey?: unknown;
  },
) {
  const context = await financeContextForRequest(request);
  assertStudent(context);
  await settleDueDepositContracts(database(), {
    now: Date.now(),
    limit: 5,
    classId: context.classroom.id,
    studentId: context.actor.id,
  });
  const productId = requiredId(productIdValue, "상품 ID");
  const revision = expectedRevision(input.expectedProductRevision, "상품");
  const key = idempotencyKey(input.idempotencyKey);
  const db = database();
  const rawAmount = Number(input.amount);
  if (!Number.isSafeInteger(rawAmount) || rawAmount <= 0) {
    throw new ApiError(400, "가입 금액을 0보다 큰 정수로 입력해 주세요.", "FINANCE_DEPOSIT_INVALID_AMOUNT");
  }
  const payloadHash = await sha256(stableFinanceJson({
    amount: rawAmount,
    classId: context.classroom.id,
    productId,
    productRevision: revision,
    studentId: context.actor.id,
  }));
  const duplicate = await contractByIdempotency(db, context.classroom.id, context.actor.id, key);
  if (duplicate) {
    if (duplicate.payload_hash !== payloadHash) {
      throw new ApiError(409, "같은 가입 요청이 다른 내용에 사용됐어요.", "FINANCE_DEPOSIT_IDEMPOTENCY_CONFLICT");
    }
    return { contract: serializeContract(duplicate), deduplicated: true };
  }
  const product = await productById(db, context.classroom.id, productId);
  if (!product) {
    throw new ApiError(404, "예금상품을 찾지 못했습니다.", "FINANCE_DEPOSIT_PRODUCT_NOT_FOUND");
  }
  if (!Boolean(product.is_open)) {
    throw new ApiError(409, "이 상품은 지금 가입을 받지 않아요.", "FINANCE_DEPOSIT_PRODUCT_CLOSED");
  }
  if (Number(product.revision) !== revision) {
    throw new ApiError(409, "상품 상태가 바뀌었어요. 최신 정보를 다시 확인해 주세요.", "FINANCE_DEPOSIT_PRODUCT_STALE");
  }
  let principal: number;
  let quote: ReturnType<typeof calculateFinanceDepositQuote>;
  try {
    principal = normalizeFinanceDepositPrincipal(rawAmount, {
      minAmount: Number(product.min_amount),
      maxAmount: Number(product.max_amount),
    });
    quote = calculateFinanceDepositQuote({
      principal,
      maturityInterestBps: Number(product.maturity_interest_bps),
      earlyInterestShareBps: Number(product.early_interest_bps),
    });
  } catch (error) {
    ruleError(error);
  }
  const settings = await financeSettingsForClass(context.classroom.id);
  if (!financeAmountMatchesDenominations(principal, settings.denominations)) {
    throw new ApiError(
      400,
      `가입 금액은 ${Math.min(...settings.denominations).toLocaleString("ko-KR")} ${settings.currencyUnit} 단위로 입력해 주세요.`,
      "FINANCE_DEPOSIT_DENOMINATION_MISMATCH",
    );
  }
  const { wallet, issuance } = await accountRows(db, context.classroom.id, context.actor.id);
  if (Number(wallet.balance) < principal) {
    throw new ApiError(409, "지갑 잔액이 부족해 예금에 가입하지 못했어요.", "FINANCE_INSUFFICIENT_FUNDS");
  }
  const walletAvailability = await financeWalletAvailability(db, {
    classId: context.classroom.id,
    walletAccountId: wallet.id,
    balance: Number(wallet.balance),
  });
  if (walletAvailability.availableBalance < principal) {
    throw new ApiError(
      409,
      "출금 신청 금액을 빼면 예금에 맡길 수 있는 금액이 부족해요.",
      "FINANCE_INSUFFICIENT_AVAILABLE_BALANCE",
    );
  }
  const active = await db.prepare(
    `SELECT contract.id
     FROM finance_deposit_contracts contract
     WHERE contract.class_id = ? AND contract.student_id = ?
       AND contract.product_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM finance_deposit_settlements settlement
         WHERE settlement.contract_id = contract.id
       )
     LIMIT 1`,
  ).bind(context.classroom.id, context.actor.id, productId).first<{ id: string }>();
  if (active) {
    throw new ApiError(409, "이 상품에 이미 가입한 예금이 있어요.", "FINANCE_DEPOSIT_ACTIVE_EXISTS");
  }

  const now = Date.now();
  const contractId = crypto.randomUUID();
  const transactionId = crypto.randomUUID();
  let maturesAt: number;
  try {
    maturesAt = financeDepositMaturityAt(now, Number(product.term_weeks));
  } catch (error) {
    ruleError(error);
  }
  const transaction = normalizeFinanceTransaction({
    classId: context.classroom.id,
    idempotencyKey: `deposit-contract:${contractId}:open`,
    transactionType: "deposit_open",
    description: `${product.name} 가입`,
    actor: { type: "system", label: "예금 자동화" },
    sourceType: "deposit_contract",
    sourceId: contractId,
    lines: [
      { accountId: wallet.id, amount: -principal, memo: "예금 원금 맡김" },
      { accountId: issuance.id, amount: principal, memo: "예금 원금 보관" },
    ],
    metadata: {
      contractId,
      productId,
      productName: product.name,
      studentId: context.actor.id,
      principal,
      maturesAt,
    },
  });
  const transactionPayloadHash = await sha256(financeTransactionPayload(transaction));
  const accounts = new Map([[wallet.id, wallet], [issuance.id, issuance]]);
  const statements = transactionStatements(db, {
    transactionId,
    transaction,
    transactionPayloadHash,
    accounts,
    now,
  });
  statements.push(
    db.prepare(
      `INSERT INTO finance_deposit_contracts (
         id, class_id, product_id, product_revision, student_id,
         wallet_account_id, principal, product_name_snapshot,
         term_weeks_snapshot, maturity_interest_bps_snapshot,
         early_interest_bps_snapshot, maturity_interest, early_interest,
         maturity_payout, early_payout, opened_at, matures_at,
         idempotency_key, payload_hash, posted_transaction_id,
         transaction_payload_hash, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      contractId,
      context.classroom.id,
      productId,
      revision,
      context.actor.id,
      wallet.id,
      principal,
      product.name,
      Number(product.term_weeks),
      Number(product.maturity_interest_bps),
      Number(product.early_interest_bps),
      quote.maturityInterest,
      quote.earlyInterest,
      quote.maturityPayout,
      quote.earlyPayout,
      now,
      maturesAt,
      key,
      payloadHash,
      transactionId,
      transactionPayloadHash,
      now,
    ),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    const concurrent = await contractByIdempotency(db, context.classroom.id, context.actor.id, key);
    if (concurrent) {
      if (concurrent.payload_hash !== payloadHash) {
        throw new ApiError(409, "같은 가입 요청이 다른 내용에 사용됐어요.", "FINANCE_DEPOSIT_IDEMPOTENCY_CONFLICT");
      }
      return { contract: serializeContract(concurrent), deduplicated: true };
    }
    mapDatabaseError(error);
  }
  const saved = await contractRowById(db, context.classroom.id, contractId);
  if (!saved) throw new ApiError(500, "가입한 예금을 다시 확인하지 못했습니다.", "FINANCE_DEPOSIT_CONTRACT_UNAVAILABLE");
  return { contract: serializeContract(saved), deduplicated: false };
}

async function contractForSettlement(db: D1Database, contractId: string) {
  return db.prepare(
    `SELECT ${CONTRACT_SELECT},
            wallet.status AS wallet_status, wallet.balance AS wallet_balance,
            wallet.revision AS wallet_revision,
            classroom.status AS class_status
     FROM finance_deposit_contracts contract
     JOIN students student ON student.id = contract.student_id
       AND student.class_id = contract.class_id
     JOIN classes classroom ON classroom.id = contract.class_id
     JOIN finance_accounts wallet ON wallet.id = contract.wallet_account_id
       AND wallet.class_id = contract.class_id
     LEFT JOIN finance_deposit_settlements settlement
       ON settlement.contract_id = contract.id
       AND settlement.class_id = contract.class_id
     WHERE contract.id = ?
     LIMIT 1`,
  ).bind(contractId).first<ContractForSettlementRow>();
}

async function settleContractWithDb(
  db: D1Database,
  input: {
    contractId: string;
    now: number;
    requestedAction: "early_termination" | "maturity";
    idempotencyKey: string;
    expectedStudentId?: string;
  },
) {
  const current = await contractForSettlement(db, input.contractId);
  if (!current) {
    throw new ApiError(404, "예금 기록을 찾지 못했습니다.", "FINANCE_DEPOSIT_CONTRACT_NOT_FOUND");
  }
  if (input.expectedStudentId && current.student_id !== input.expectedStudentId) {
    throw new ApiError(403, "다른 학생의 예금은 처리할 수 없어요.", "FINANCE_DEPOSIT_CONTRACT_ACCESS_DENIED");
  }
  if (current.settlement_id) {
    const existing = await settlementForContract(db, current.id);
    if (!existing) throw new ApiError(500, "처리된 예금 기록을 다시 확인하지 못했습니다.", "FINANCE_DEPOSIT_SETTLEMENT_UNAVAILABLE");
    return { settlement: serializeSettlement(existing), deduplicated: true };
  }
  const matured = input.now >= Number(current.matures_at);
  if (input.requestedAction === "maturity" && !matured) {
    throw new ApiError(409, "아직 만기일이 되지 않았어요.", "FINANCE_DEPOSIT_NOT_MATURED");
  }
  const settlementType = matured ? "maturity" as const : "early_termination" as const;
  if (current.class_status !== "active" || current.wallet_status !== "active") {
    throw new ApiError(409, "지갑이 잠겨 있어 자동 지급을 잠시 기다리고 있어요.", "FINANCE_ACCOUNT_NOT_ACTIVE");
  }
  const payout = settlementType === "maturity"
    ? Number(current.maturity_payout)
    : Number(current.early_payout);
  const interest = settlementType === "maturity"
    ? Number(current.maturity_interest)
    : Number(current.early_interest);
  const payloadHash = await sha256(stableFinanceJson({
    classId: current.class_id,
    contractId: current.id,
    payout,
    settlementType,
    studentId: current.student_id,
  }));
  const duplicateByKey = await db.prepare(
    `SELECT id, class_id, contract_id, student_id, settlement_type,
            principal, interest, payout, idempotency_key, payload_hash,
            posted_transaction_id, settled_at
     FROM finance_deposit_settlements
     WHERE class_id = ? AND student_id = ? AND idempotency_key = ?
     LIMIT 1`,
  ).bind(current.class_id, current.student_id, input.idempotencyKey).first<SettlementRow>();
  if (duplicateByKey) {
    if (duplicateByKey.contract_id !== current.id || duplicateByKey.payload_hash !== payloadHash) {
      throw new ApiError(409, "같은 정산 요청이 다른 내용에 사용됐어요.", "FINANCE_DEPOSIT_IDEMPOTENCY_CONFLICT");
    }
    return { settlement: serializeSettlement(duplicateByKey), deduplicated: true };
  }
  const { wallet, issuance } = await accountRows(db, current.class_id, current.student_id);
  const settlementId = crypto.randomUUID();
  const transactionId = crypto.randomUUID();
  const transaction = normalizeFinanceTransaction({
    classId: current.class_id,
    idempotencyKey: `deposit-contract:${current.id}:settlement`,
    transactionType: settlementType === "maturity"
      ? "deposit_maturity"
      : "deposit_early_termination",
    description: settlementType === "maturity"
      ? `${current.product_name_snapshot} 만기 자동 지급`
      : `${current.product_name_snapshot} 중도해지`,
    actor: { type: "system", label: "예금 자동화" },
    sourceType: "deposit_settlement",
    sourceId: current.id,
    lines: [
      { accountId: wallet.id, amount: payout, memo: "예금 원금과 이자 지급" },
      { accountId: issuance.id, amount: -payout, memo: "예금 원금과 이자 지급" },
    ],
    metadata: {
      contractId: current.id,
      settlementType,
      studentId: current.student_id,
      principal: Number(current.principal),
      interest,
      payout,
    },
  });
  const transactionPayloadHash = await sha256(financeTransactionPayload(transaction));
  const statements = transactionStatements(db, {
    transactionId,
    transaction,
    transactionPayloadHash,
    accounts: new Map([[wallet.id, wallet], [issuance.id, issuance]]),
    now: input.now,
  });
  statements.push(
    db.prepare(
      `INSERT INTO finance_deposit_settlements (
         id, class_id, contract_id, student_id, settlement_type,
         principal, interest, payout, idempotency_key, payload_hash,
         posted_transaction_id, transaction_payload_hash, settled_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      settlementId,
      current.class_id,
      current.id,
      current.student_id,
      settlementType,
      Number(current.principal),
      interest,
      payout,
      input.idempotencyKey,
      payloadHash,
      transactionId,
      transactionPayloadHash,
      input.now,
      input.now,
    ),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    const concurrent = await settlementForContract(db, current.id);
    if (concurrent) return { settlement: serializeSettlement(concurrent), deduplicated: true };
    mapDatabaseError(error);
  }
  const saved = await settlementForContract(db, current.id);
  if (!saved) throw new ApiError(500, "예금 지급 기록을 다시 확인하지 못했습니다.", "FINANCE_DEPOSIT_SETTLEMENT_UNAVAILABLE");
  return { settlement: serializeSettlement(saved), deduplicated: false };
}

export async function settleFinanceDepositForRequest(
  request: Request,
  contractIdValue: unknown,
  input: {
    action?: unknown;
    idempotencyKey?: unknown;
  },
) {
  const context = await financeContextForRequest(request);
  assertStudent(context);
  const contractId = requiredId(contractIdValue, "예금 ID");
  if (input.action !== "early_termination" && input.action !== "maturity") {
    throw new ApiError(400, "예금 처리 방법을 다시 선택해 주세요.", "FINANCE_DEPOSIT_INVALID_ACTION");
  }
  return settleContractWithDb(database(), {
    contractId,
    now: Date.now(),
    requestedAction: input.action,
    idempotencyKey: idempotencyKey(input.idempotencyKey),
    expectedStudentId: context.actor.id,
  });
}

export async function settleDueDepositContracts(
  db: D1Database,
  options: {
    now?: number;
    limit?: number;
    classId?: string;
    studentId?: string;
  } = {},
) {
  const now = Number.isSafeInteger(options.now) ? Number(options.now) : Date.now();
  const limit = Math.min(200, Math.max(1, Number(options.limit) || 100));
  const conditions = [
    "contract.matures_at <= ?",
    "settlement.id IS NULL",
    "classroom.status = 'active'",
  ];
  const bindings: Array<string | number> = [now];
  if (options.classId) {
    conditions.push("contract.class_id = ?");
    bindings.push(options.classId);
  }
  if (options.studentId) {
    conditions.push("contract.student_id = ?");
    bindings.push(options.studentId);
  }
  const blocked = await db.prepare(
    `SELECT COUNT(*) AS count
     FROM finance_deposit_contracts contract
     JOIN classes classroom ON classroom.id = contract.class_id
     JOIN finance_accounts wallet ON wallet.id = contract.wallet_account_id
       AND wallet.class_id = contract.class_id
     JOIN finance_accounts issuance ON issuance.class_id = contract.class_id
       AND issuance.account_type = 'class_issuance'
     LEFT JOIN finance_deposit_settlements settlement
       ON settlement.contract_id = contract.id
     WHERE ${conditions.join(" AND ")}
       AND (wallet.status <> 'active' OR issuance.status <> 'active')`,
  ).bind(...bindings).first<{ count: number }>();
  bindings.push(limit);
  const rows = await db.prepare(
    `SELECT contract.id
     FROM finance_deposit_contracts contract
     JOIN classes classroom ON classroom.id = contract.class_id
     JOIN finance_accounts wallet ON wallet.id = contract.wallet_account_id
       AND wallet.class_id = contract.class_id AND wallet.status = 'active'
     JOIN finance_accounts issuance ON issuance.class_id = contract.class_id
       AND issuance.account_type = 'class_issuance' AND issuance.status = 'active'
     LEFT JOIN finance_deposit_settlements settlement
       ON settlement.contract_id = contract.id
     WHERE ${conditions.join(" AND ")}
     ORDER BY contract.matures_at, contract.id
     LIMIT ?`,
  ).bind(...bindings).all<{ id: string }>();
  let settled = 0;
  let failed = Number(blocked?.count ?? 0);
  for (const row of rows.results) {
    try {
      await settleContractWithDb(db, {
        contractId: row.id,
        now,
        requestedAction: "maturity",
        idempotencyKey: `deposit-auto:${row.id}:maturity`,
      });
      settled += 1;
    } catch (error) {
      if (error instanceof ApiError && error.code === "FINANCE_DEPOSIT_ALREADY_SETTLED") {
        settled += 1;
      } else {
        failed += 1;
      }
    }
  }
  return {
    due: rows.results.length + Number(blocked?.count ?? 0),
    settled,
    failed,
  };
}

export async function processMaturedFinanceDeposits(options: {
  now?: number;
  limit?: number;
} = {}) {
  await ensureSchema();
  return settleDueDepositContracts(database(), options);
}

export async function financeDepositsForRequest(request: Request) {
  const context = await financeContextForRequest(request);
  const db = database();
  const now = Date.now();
  const automation = financeDepositSettlementEnabled(request.url)
    ? await settleDueDepositContracts(db, {
      now,
      limit: FINANCE_DEPOSIT_SETTLEMENT_BATCH_SIZE,
      classId: context.classroom.id,
      studentId: context.actor.type === "student" ? context.actor.id : undefined,
    })
    : { due: 0, settled: 0, failed: 0 };
  const productWhere = context.actor.type === "teacher"
    ? "product.class_id = ?"
    : `product.class_id = ? AND (
         product.is_open = 1 OR EXISTS (
           SELECT 1 FROM finance_deposit_contracts own_contract
           WHERE own_contract.product_id = product.id
             AND own_contract.student_id = ?
         )
       )`;
  const productContractScope = context.actor.type === "student"
    ? "AND contract.student_id = ?"
    : "";
  const productBindings = context.actor.type === "teacher"
    ? [context.classroom.id]
    : [context.actor.id, context.classroom.id, context.actor.id];
  const products = await db.prepare(
    `SELECT ${PRODUCT_SELECT},
            COUNT(DISTINCT contract.student_id) AS subscriber_count,
            COALESCE(SUM(CASE WHEN contract.id IS NOT NULL
              AND settlement.id IS NULL THEN 1 ELSE 0 END), 0)
              AS active_count,
            COALESCE(SUM(CASE WHEN settlement.id IS NULL THEN contract.principal ELSE 0 END), 0)
              AS total_principal,
            MIN(CASE WHEN settlement.id IS NULL THEN contract.matures_at ELSE NULL END)
              AS next_maturity_at
     FROM finance_deposit_products product
     LEFT JOIN finance_deposit_contracts contract
       ON contract.product_id = product.id AND contract.class_id = product.class_id
       ${productContractScope}
     LEFT JOIN finance_deposit_settlements settlement
       ON settlement.contract_id = contract.id
     WHERE ${productWhere}
     GROUP BY product.id
     ORDER BY product.is_open DESC, product.created_at DESC, product.id`,
  ).bind(...productBindings).all<ProductRow>();
  const contractWhere = context.actor.type === "teacher"
    ? "contract.class_id = ?"
    : "contract.class_id = ? AND contract.student_id = ?";
  const contractBindings = context.actor.type === "teacher"
    ? [context.classroom.id]
    : [context.classroom.id, context.actor.id];
  const contracts = await db.prepare(
    `SELECT ${CONTRACT_SELECT}
     FROM finance_deposit_contracts contract
     JOIN students student ON student.id = contract.student_id
       AND student.class_id = contract.class_id
     LEFT JOIN finance_deposit_settlements settlement
       ON settlement.contract_id = contract.id
       AND settlement.class_id = contract.class_id
     WHERE ${contractWhere}
     ORDER BY CASE WHEN settlement.id IS NULL THEN 0 ELSE 1 END,
              contract.matures_at, contract.created_at DESC
     LIMIT 500`,
  ).bind(...contractBindings).all<ContractRow>();
  const serializedContracts = contracts.results.map((row) => serializeContract(row, now));
  const wallet = context.actor.type === "student"
    ? await db.prepare(
      `SELECT id, balance, status, revision, updated_at
       FROM finance_accounts
       WHERE class_id = ? AND student_id = ? AND account_type = 'student_wallet'
       LIMIT 1`,
    ).bind(context.classroom.id, context.actor.id).first<{
      id: string;
      balance: number;
      status: string;
      revision: number;
      updated_at: number;
    }>()
    : null;
  const walletAvailability = wallet
    ? await financeWalletAvailability(db, {
      classId: context.classroom.id,
      walletAccountId: wallet.id,
      balance: Number(wallet.balance),
    })
    : null;
  const activeContracts = serializedContracts.filter((contract) => (
    contract.status === "active" || contract.status === "matured"
  ));
  return {
    context: {
      actorType: context.actor.type,
      financeRole: context.financeRole,
      classIsActive: context.classroom.status === "active",
    },
    products: products.results.map(serializeProduct),
    contracts: serializedContracts,
    wallet: wallet ? {
      balance: Number(wallet.balance),
      pendingWithdrawalAmount: walletAvailability?.pendingWithdrawalAmount ?? 0,
      availableBalance: walletAvailability?.availableBalance ?? Number(wallet.balance),
      status: wallet.status,
      revision: Number(wallet.revision),
      updatedAt: Number(wallet.updated_at),
    } : null,
    summary: {
      activeContractCount: activeContracts.length,
      activePrincipal: activeContracts.reduce((sum, contract) => sum + contract.principal, 0),
      expectedMaturityPayout: activeContracts.reduce((sum, contract) => sum + contract.maturityPayout, 0),
      settledContractCount: serializedContracts.length - activeContracts.length,
    },
    automation,
    serverTime: now,
  };
}
