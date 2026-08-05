import { sha256 } from "./crypto";
import { database } from "./database";
import { financeWalletAvailability } from "./finance-available-balance";
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
  FinanceStockRuleError,
  assertFinanceStockPositionMarketValue,
  calculateFinanceStockExecutionPrice,
  calculateFinanceStockLiquidationChunk,
  calculateFinanceStockLiquidationTotals,
  calculateFinanceStockPositionAfterTrade,
  limitFinanceStockPriceIncrease,
  normalizeFinanceStockDefinition,
  normalizeFinanceStockMarketSettings,
  normalizeFinanceStockPrice,
  normalizeFinanceStockTradeRequest,
} from "./finance-stock-rules";
import { financeSettingsForClass } from "./finance-settings";
import { ApiError } from "./responses";

const STOCK_STATUSES = new Set(["active", "sell_only", "halted", "archived"]);
const MAX_FINANCE_AMOUNT = 1_000_000_000;
const TEACHER_LIQUIDATION_STUDENT_STATUSES = new Set([
  "active",
  "locked",
  "reset_required",
  "pending",
]);
const TEACHER_LIQUIDATION_ORIGINS = new Set([
  "finance_center",
  "student_exclusion",
  "class_archive",
  "account_recovery",
]);

type StockMood = "surge" | "bull" | "mixed" | "bear" | "crash";
type StockStatus = "active" | "sell_only" | "halted" | "archived";
type TeacherLiquidationOrigin =
  | "finance_center"
  | "student_exclusion"
  | "class_archive"
  | "account_recovery";

type MarketRow = {
  class_id: string;
  is_open: number;
  buy_fee_bps: number;
  sell_fee_bps: number;
  buy_spread: number;
  sell_spread: number;
  market_mood: string;
  tick_interval_minutes: number;
  next_tick_at: number | null;
  revision: number;
  updated_at: number;
};

type StockRow = {
  id: string;
  class_id: string;
  name: string;
  symbol: string;
  description: string;
  initial_price: number;
  current_price: number;
  previous_price: number;
  total_shares: number;
  available_shares: number;
  max_shares_per_student: number;
  status: string;
  revision: number;
  inventory_revision: number;
  last_trade_id: string | null;
  created_at: number;
  updated_at: number;
  holder_count?: number;
  trade_volume?: number;
};

type HoldingRow = {
  id: string;
  class_id: string;
  stock_id: string;
  student_id: string;
  wallet_account_id: string;
  quantity: number;
  cost_basis: number;
  revision: number;
  last_trade_id: string;
  created_at: number;
  updated_at: number;
  student_number?: number;
  student_name?: string;
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

type StudentStatusRow = {
  id: string;
  status: string;
};

type TradeRow = {
  id: string;
  class_id: string;
  stock_id: string;
  stock_revision: number;
  inventory_revision_before: number;
  inventory_revision_after: number;
  market_revision: number;
  finance_settings_revision: number;
  student_id: string;
  wallet_account_id: string;
  side: string;
  quantity: number;
  reference_price: number;
  spread_snapshot: number;
  unit_price: number;
  gross_amount: number;
  fee_bps_snapshot: number;
  fee_amount: number;
  wallet_delta: number;
  available_shares_before: number;
  available_shares_after: number;
  holding_quantity_before: number;
  holding_quantity_after: number;
  holding_cost_basis_before: number;
  holding_cost_basis_after: number;
  holding_revision_before: number;
  holding_revision_after: number;
  wallet_revision_before: number;
  wallet_revision_after: number;
  cost_basis_removed: number;
  realized_gain: number;
  status: string;
  idempotency_key: string;
  payload_hash: string;
  posted_transaction_id: string | null;
  created_at: number;
  posted_at: number | null;
  student_number?: number;
  student_name?: string;
};

type StockLiquidationStatus = "running" | "completed" | "cancelled";

type StockLiquidationOperationRow = {
  id: string;
  class_id: string;
  stock_id: string;
  student_id: string;
  teacher_id: string;
  root_idempotency_key: string;
  payload_hash: string;
  origin: string;
  intervention_reason: string;
  status: string;
  snapshot_reference_price: number;
  snapshot_spread: number;
  snapshot_unit_price: number;
  snapshot_fee_bps: number;
  snapshot_denomination_step: number;
  snapshot_stock_revision: number;
  snapshot_market_revision: number;
  snapshot_finance_settings_revision: number;
  snapshot_holding_revision: number;
  snapshot_wallet_revision: number;
  snapshot_wallet_balance: number;
  snapshot_student_status: string;
  snapshot_stock_status: string;
  snapshot_market_was_open: number;
  initial_quantity: number;
  remaining_quantity: number;
  sold_quantity: number;
  initial_cost_basis: number;
  remaining_cost_basis: number;
  expected_gross_amount: number;
  expected_fee_amount: number;
  expected_wallet_delta: number;
  completed_chunk_count: number;
  total_gross_amount: number;
  total_fee_amount: number;
  total_wallet_delta: number;
  total_cost_basis_removed: number;
  total_realized_gain: number;
  next_chunk_index: number;
  last_trade_id: string | null;
  revision: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  cancelled_at: number | null;
  cancellation_reason: string | null;
  cancellation_idempotency_key: string | null;
  cancellation_payload_hash: string | null;
  student_number?: number;
  student_name?: string;
};

type StockLiquidationChunkRow = {
  id: string;
  operation_id: string;
  class_id: string;
  chunk_index: number;
  trade_id: string;
  quantity: number;
  gross_amount: number;
  fee_amount: number;
  wallet_delta: number;
  cost_basis_removed: number;
  realized_gain: number;
  holding_quantity_before: number;
  holding_quantity_after: number;
  holding_cost_basis_before: number;
  holding_cost_basis_after: number;
  created_at: number;
};

type StockEventRow = {
  id: string;
  class_id: string;
  stock_id: string;
  revision: number;
  action: string;
  reason: string;
  idempotency_key: string;
  payload_hash: string;
  previous_snapshot_json: string | null;
  stock_snapshot_json: string;
  actor_type: string;
  created_at: number;
};

function stockTickEventWasSkipped(event: StockEventRow) {
  if (!event.previous_snapshot_json) return false;
  try {
    const previous = JSON.parse(event.previous_snapshot_json) as {
      currentPrice?: unknown;
    };
    const current = JSON.parse(event.stock_snapshot_json) as {
      currentPrice?: unknown;
    };
    return typeof previous.currentPrice === "number"
      && Number.isSafeInteger(previous.currentPrice)
      && previous.currentPrice === current.currentPrice;
  } catch {
    return false;
  }
}

type MarketEventRow = {
  class_id: string;
  revision: number;
  idempotency_key: string;
  payload_hash: string;
};

type NewsRow = {
  id: string;
  class_id: string;
  title: string;
  content: string;
  impact_bps: number;
  status: string;
  revision: number;
  idempotency_key: string;
  payload_hash: string;
  cancellation_idempotency_key: string | null;
  cancellation_payload_hash: string | null;
  created_at: number;
  expires_at: number;
  cancelled_at: number | null;
  cancellation_reason: string | null;
  updated_at: number;
  application_link_status?: string | null;
  applied_stock_event_id?: string | null;
  application_applied_at?: number | null;
};

type TickNewsRow = {
  id: string;
  revision: number;
  impact_bps: number;
  payload_hash: string;
  link_status?: string;
};

function ruleError(error: unknown): never {
  if (error instanceof FinanceStockRuleError) {
    throw new ApiError(400, error.message, error.code);
  }
  throw error;
}

function requiredId(value: unknown, field: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 160 || !/^[A-Za-z0-9:_-]+$/.test(normalized)) {
    throw new ApiError(400, `${field}를 다시 확인해 주세요.`, "FINANCE_STOCK_INVALID_ID");
  }
  return normalized;
}

function idempotencyKey(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(normalized)) {
    throw new ApiError(
      400,
      "저장 요청 번호를 다시 확인해 주세요.",
      "FINANCE_STOCK_INVALID_IDEMPOTENCY_KEY",
    );
  }
  return normalized;
}

function expectedRevision(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new ApiError(
      400,
      `최신 ${label} 정보를 다시 불러와 주세요.`,
      "FINANCE_STOCK_INVALID_REVISION",
    );
  }
  return Number(value);
}

function integerInRange(value: unknown, label: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new ApiError(
      400,
      `${label}을(를) ${minimum.toLocaleString("ko-KR")}~${maximum.toLocaleString("ko-KR")} 사이의 정수로 입력해 주세요.`,
      "FINANCE_STOCK_INVALID_INPUT",
    );
  }
  return Number(value);
}

function normalizedText(value: unknown, label: string, maximum: number, required = true) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
  if (required && !text) {
    throw new ApiError(400, `${label}을(를) 입력해 주세요.`, "FINANCE_STOCK_INPUT_REQUIRED");
  }
  if (text.length > maximum) {
    throw new ApiError(400, `${label}은(는) ${maximum}자 이내로 입력해 주세요.`, "FINANCE_STOCK_INPUT_TOO_LONG");
  }
  return text;
}

function teacherLiquidationOrigin(value: unknown): TeacherLiquidationOrigin {
  const normalized = typeof value === "string" ? value.trim() : "finance_center";
  if (!TEACHER_LIQUIDATION_ORIGINS.has(normalized)) {
    throw new ApiError(
      400,
      "비상 청산을 시작한 화면을 다시 확인해 주세요.",
      "FINANCE_STOCK_INVALID_LIQUIDATION_ORIGIN",
    );
  }
  return normalized as TeacherLiquidationOrigin;
}

function assertTeacher(context: FinanceContext) {
  if (context.actor.type !== "teacher" || context.financeRole !== "teacher") {
    throw new ApiError(
      403,
      "주식시장 설정은 담임 선생님만 바꿀 수 있습니다.",
      "FINANCE_STOCK_TEACHER_REQUIRED",
    );
  }
  if (context.classroom.status !== "active") {
    throw new ApiError(409, "보관된 학급에서는 주식시장을 바꿀 수 없습니다.", "FINANCE_CLASS_ARCHIVED");
  }
}

function assertStudent(context: FinanceContext) {
  if (context.actor.type !== "student") {
    throw new ApiError(
      403,
      "주식 매수와 매도는 학생 본인 계정에서만 할 수 있습니다.",
      "FINANCE_STOCK_STUDENT_REQUIRED",
    );
  }
  if (context.classroom.status !== "active") {
    throw new ApiError(409, "보관된 학급에서는 주식을 거래할 수 없습니다.", "FINANCE_CLASS_ARCHIVED");
  }
}

function serializeMarket(row: MarketRow) {
  return {
    classId: row.class_id,
    isOpen: Boolean(row.is_open),
    buyFeeBps: Number(row.buy_fee_bps),
    sellFeeBps: Number(row.sell_fee_bps),
    buySpread: Number(row.buy_spread),
    sellSpread: Number(row.sell_spread),
    mood: row.market_mood as StockMood,
    tickIntervalMinutes: Number(row.tick_interval_minutes),
    nextTickAt: row.next_tick_at === null ? null : Number(row.next_tick_at),
    revision: Number(row.revision),
    updatedAt: Number(row.updated_at),
  };
}

function serializeStock(row: StockRow) {
  const currentPrice = Number(row.current_price);
  const previousPrice = Number(row.previous_price);
  const tradeVolume = Number(row.trade_volume ?? 0);
  return {
    id: row.id,
    name: row.name,
    symbol: row.symbol,
    description: row.description || null,
    initialPrice: Number(row.initial_price),
    currentPrice,
    previousPrice,
    priceChange: currentPrice - previousPrice,
    priceChangeRate: previousPrice > 0
      ? Math.round(((currentPrice - previousPrice) * 10_000) / previousPrice)
      : 0,
    totalSupply: Number(row.total_shares),
    availableSupply: Number(row.available_shares),
    issuedShares: Number(row.total_shares) - Number(row.available_shares),
    maxSharesPerStudent: Number(row.max_shares_per_student),
    status: row.status as StockStatus,
    revision: Number(row.revision),
    inventoryRevision: Number(row.inventory_revision),
    holderCount: Number(row.holder_count ?? 0),
    tradeVolume,
    volume: tradeVolume,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function serializeHolding(row: HoldingRow | null, currentPrice = 0) {
  const quantity = Number(row?.quantity ?? 0);
  const totalCost = Number(row?.cost_basis ?? 0);
  const marketValueExact = BigInt(quantity) * BigInt(currentPrice);
  const averageCost = quantity > 0 ? Math.floor(totalCost / quantity) : 0;
  const unrealizedProfitExact = marketValueExact - BigInt(totalCost);
  const exactJsonInteger = (value: bigint) => (
    value <= BigInt(Number.MAX_SAFE_INTEGER)
      && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString()
  );
  const marketValue = exactJsonInteger(marketValueExact);
  const unrealizedProfit = exactJsonInteger(unrealizedProfitExact);
  return {
    shares: quantity,
    quantity,
    totalCost,
    costBasis: totalCost,
    averageCost,
    averagePrice: averageCost,
    marketValue,
    marketValueExact: marketValueExact.toString(),
    unrealizedProfit,
    unrealizedProfitExact: unrealizedProfitExact.toString(),
    evaluationProfit: unrealizedProfit,
    evaluationProfitExact: unrealizedProfitExact.toString(),
    revision: Number(row?.revision ?? 0),
    updatedAt: row ? Number(row.updated_at) : null,
  };
}

function serializeTrade(row: TradeRow) {
  const unitPrice = Number(row.unit_price);
  const feeAmount = Number(row.fee_amount);
  const netAmount = Math.abs(Number(row.wallet_delta));
  const createdAt = Number(row.posted_at ?? row.created_at);
  return {
    id: row.id,
    stockId: row.stock_id,
    side: row.side as "buy" | "sell",
    quantity: Number(row.quantity),
    referencePrice: Number(row.reference_price),
    spread: Number(row.spread_snapshot),
    unitPrice,
    price: unitPrice,
    grossAmount: Number(row.gross_amount),
    feeBps: Number(row.fee_bps_snapshot),
    feeAmount,
    fee: feeAmount,
    walletDelta: Number(row.wallet_delta),
    netAmount,
    holdingQuantityBefore: Number(row.holding_quantity_before),
    holdingQuantityAfter: Number(row.holding_quantity_after),
    costBasisRemoved: Number(row.cost_basis_removed),
    realizedProfit: Number(row.realized_gain),
    status: row.status,
    transactionId: row.posted_transaction_id,
    idempotencyKey: row.idempotency_key,
    tradedAt: createdAt,
    createdAt,
    student: row.student_name
      ? {
          id: row.student_id,
          number: Number(row.student_number ?? 0),
          name: row.student_name,
        }
      : null,
  };
}

function serializeStockLiquidationOperation(row: StockLiquidationOperationRow) {
  return {
    id: row.id,
    stockId: row.stock_id,
    studentId: row.student_id,
    teacherId: row.teacher_id,
    rootIdempotencyKey: row.root_idempotency_key,
    origin: row.origin as TeacherLiquidationOrigin,
    interventionReason: row.intervention_reason,
    status: row.status as StockLiquidationStatus,
    initialQuantity: Number(row.initial_quantity),
    remainingQuantity: Number(row.remaining_quantity),
    soldQuantity: Number(row.sold_quantity),
    initialCostBasis: Number(row.initial_cost_basis),
    remainingCostBasis: Number(row.remaining_cost_basis),
    expectedGrossAmount: Number(row.expected_gross_amount),
    expectedFeeAmount: Number(row.expected_fee_amount),
    expectedPayoutAmount: Number(row.expected_wallet_delta),
    completedChunkCount: Number(row.completed_chunk_count),
    totalGrossAmount: Number(row.total_gross_amount),
    totalFeeAmount: Number(row.total_fee_amount),
    totalPayoutAmount: Number(row.total_wallet_delta),
    totalCostBasisRemoved: Number(row.total_cost_basis_removed),
    totalRealizedGain: Number(row.total_realized_gain),
    nextChunkIndex: Number(row.next_chunk_index),
    lastTradeId: row.last_trade_id,
    revision: Number(row.revision),
    frozenQuote: {
      referencePrice: Number(row.snapshot_reference_price),
      sellSpread: Number(row.snapshot_spread),
      unitPrice: Number(row.snapshot_unit_price),
      feeBps: Number(row.snapshot_fee_bps),
      denominationStep: Number(row.snapshot_denomination_step),
      stockRevision: Number(row.snapshot_stock_revision),
      marketRevision: Number(row.snapshot_market_revision),
      financeSettingsRevision: Number(row.snapshot_finance_settings_revision),
    },
    snapshot: {
      holdingRevision: Number(row.snapshot_holding_revision),
      walletRevision: Number(row.snapshot_wallet_revision),
      walletBalance: Number(row.snapshot_wallet_balance),
      studentStatus: row.snapshot_student_status,
      stockStatus: row.snapshot_stock_status,
      marketWasOpen: Boolean(row.snapshot_market_was_open),
    },
    student: row.student_name
      ? {
          id: row.student_id,
          number: Number(row.student_number ?? 0),
          name: row.student_name,
        }
      : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    completedAt: row.completed_at === null ? null : Number(row.completed_at),
    cancelledAt: row.cancelled_at === null ? null : Number(row.cancelled_at),
    cancellationReason: row.cancellation_reason,
    cancellationIdempotencyKey: row.cancellation_idempotency_key,
  };
}

function serializeNews(row: NewsRow, now: number) {
  const applicationLinkStatus = row.application_link_status ?? null;
  const status = row.status === "active" && Number(row.expires_at) <= now
    ? "expired"
    : row.status === "active" && applicationLinkStatus
      ? "applied"
      : row.status;
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    impactBps: Number(row.impact_bps),
    status,
    revision: Number(row.revision),
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    cancelledAt: row.cancelled_at === null ? null : Number(row.cancelled_at),
    cancellationReason: row.cancellation_reason,
    applicationLinkStatus,
    appliedStockEventId: row.applied_stock_event_id ?? null,
    appliedAt: row.application_applied_at == null
      ? null
      : Number(row.application_applied_at),
  };
}

function marketSnapshot(row: MarketRow) {
  return stableFinanceJson(serializeMarket(row));
}

function stockSnapshot(row: StockRow) {
  return stableFinanceJson(serializeStock(row));
}

function stockSnapshotWithMarket(row: StockRow, marketRevision: number) {
  return stableFinanceJson({
    ...serializeStock(row),
    marketRevision,
  });
}

async function marketForClass(db: D1Database, classId: string) {
  return db.prepare(
    `SELECT class_id, is_open, buy_fee_bps, sell_fee_bps,
            buy_spread, sell_spread, market_mood, tick_interval_minutes,
            next_tick_at, revision, updated_at
     FROM finance_stock_markets WHERE class_id = ? LIMIT 1`,
  ).bind(classId).first<MarketRow>();
}

async function stockForClass(db: D1Database, classId: string) {
  return db.prepare(
    `SELECT stock.*,
            (SELECT COUNT(*) FROM finance_stock_holdings holding
             WHERE holding.stock_id = stock.id AND holding.quantity > 0) AS holder_count,
            (SELECT COALESCE(SUM(trade.quantity), 0)
             FROM finance_stock_trades trade
             WHERE trade.stock_id = stock.id AND trade.status = 'posted') AS trade_volume
     FROM finance_stocks stock WHERE stock.class_id = ? LIMIT 1`,
  ).bind(classId).first<StockRow>();
}

async function stockById(db: D1Database, classId: string, stockId: string) {
  return db.prepare(
    `SELECT stock.*,
            (SELECT COUNT(*) FROM finance_stock_holdings holding
             WHERE holding.stock_id = stock.id AND holding.quantity > 0) AS holder_count,
            (SELECT COALESCE(SUM(trade.quantity), 0)
             FROM finance_stock_trades trade
             WHERE trade.stock_id = stock.id AND trade.status = 'posted') AS trade_volume
     FROM finance_stocks stock
     WHERE stock.class_id = ? AND stock.id = ? LIMIT 1`,
  ).bind(classId, stockId).first<StockRow>();
}

async function holdingForStudent(
  db: D1Database,
  classId: string,
  stockId: string,
  studentId: string,
) {
  return db.prepare(
    `SELECT id, class_id, stock_id, student_id, wallet_account_id,
            quantity, cost_basis, revision, last_trade_id,
            created_at, updated_at
     FROM finance_stock_holdings
     WHERE class_id = ? AND stock_id = ? AND student_id = ? LIMIT 1`,
  ).bind(classId, stockId, studentId).first<HoldingRow>();
}

async function maximumHoldingQuantity(
  db: D1Database,
  classId: string,
  stockId: string,
) {
  const row = await db.prepare(
    `SELECT COALESCE(MAX(quantity), 0) AS maximum_quantity
     FROM finance_stock_holdings
     WHERE class_id = ? AND stock_id = ? AND quantity > 0`,
  ).bind(classId, stockId).first<{ maximum_quantity: number }>();
  return Number(row?.maximum_quantity ?? 0);
}

async function accountRows(db: D1Database, classId: string, studentId: string) {
  const walletId = studentWalletAccountId(studentId);
  const issuanceId = classIssuanceAccountId(classId);
  const result = await db.prepare(
    `SELECT id, class_id, student_id, account_type, balance, revision, status
     FROM finance_accounts WHERE class_id = ? AND id IN (?, ?)`,
  ).bind(classId, walletId, issuanceId).all<AccountRow>();
  const wallet = result.results.find((row) => row.id === walletId) ?? null;
  const issuance = result.results.find((row) => row.id === issuanceId) ?? null;
  if (!wallet || !issuance) {
    throw new ApiError(409, "주식 거래에 사용할 지갑을 찾지 못했습니다.", "FINANCE_ACCOUNT_NOT_FOUND");
  }
  if (wallet.status !== "active" || issuance.status !== "active") {
    throw new ApiError(409, "현재 사용할 수 없는 지갑입니다.", "FINANCE_ACCOUNT_NOT_ACTIVE");
  }
  return { wallet, issuance };
}

async function denominationStepForClass(db: D1Database, classId: string) {
  const row = await db.prepare(
    `SELECT denominations_json FROM finance_settings WHERE class_id = ? LIMIT 1`,
  ).bind(classId).first<{ denominations_json: string }>();
  if (!row) {
    throw new ApiError(500, "학급 금융 설정을 찾지 못했습니다.", "FINANCE_SETTINGS_UNAVAILABLE");
  }
  try {
    const denominations = JSON.parse(row.denominations_json) as unknown;
    if (!Array.isArray(denominations)) throw new Error("invalid denominations");
    const values = denominations.filter((value): value is number => (
      Number.isSafeInteger(value) && Number(value) > 0
    ));
    if (values.length === 0) throw new Error("empty denominations");
    return Math.min(...values);
  } catch {
    throw new ApiError(500, "학급 화폐 권종을 확인할 수 없습니다.", "FINANCE_SETTINGS_UNAVAILABLE");
  }
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
      throw new ApiError(409, "주식 거래 지갑을 찾지 못했습니다.", "FINANCE_ACCOUNT_NOT_FOUND");
    }
    statements.push(
      db.prepare(
        `INSERT INTO finance_ledger_entries (
           id, transaction_id, class_id, account_id, amount, balance_after,
           account_revision_after, memo, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        `finance:stock:${input.transactionId}:${index}`,
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
      `UPDATE finance_transactions SET status = 'posted', posted_at = ?
       WHERE id = ? AND status = 'pending'`,
    ).bind(input.now, input.transactionId),
  );
  return statements;
}

function mapDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const mappings: Array<[string, number, string, string]> = [
    ["FINANCE_STOCK_MARKET_STALE", 409, "주식시장 설정이 다른 화면에서 바뀌었습니다. 최신 정보를 다시 불러와 주세요.", "FINANCE_STOCK_MARKET_STALE"],
    ["FINANCE_STOCK_MARKET_ACCESS_DENIED", 403, "이 학급의 주식시장 설정을 바꿀 수 없습니다.", "FINANCE_STOCK_ACCESS_DENIED"],
    ["FINANCE_STOCK_STALE", 409, "주가나 종목 상태가 바뀌었습니다. 최신 시세로 다시 확인해 주세요.", "FINANCE_STOCK_STALE"],
    ["FINANCE_STOCK_TRADE_STALE", 409, "다른 거래가 먼저 체결되었습니다. 최신 잔액과 보유량을 확인해 주세요.", "FINANCE_STOCK_TRADE_STALE"],
    ["FINANCE_STOCK_MARKET_CLOSED", 409, "지금은 주식시장이 쉬는 시간입니다.", "FINANCE_STOCK_MARKET_CLOSED"],
    ["FINANCE_STOCK_BUY_CLOSED", 409, "지금은 이 주식을 새로 살 수 없습니다.", "FINANCE_STOCK_BUY_CLOSED"],
    ["FINANCE_STOCK_TRADE_HALTED", 409, "지금은 이 주식의 거래가 잠시 멈췄습니다.", "FINANCE_STOCK_TRADE_HALTED"],
    ["FINANCE_STOCK_INSUFFICIENT_INVENTORY", 409, "시장에 남은 주식이 부족합니다.", "FINANCE_STOCK_INSUFFICIENT_INVENTORY"],
    ["FINANCE_STOCK_INSUFFICIENT_HOLDINGS", 409, "보유한 주식보다 많이 팔 수 없습니다.", "FINANCE_STOCK_INSUFFICIENT_HOLDINGS"],
    ["FINANCE_STOCK_HOLDING_LIMIT", 409, "한 학생이 보유할 수 있는 최대 수량을 넘습니다.", "FINANCE_STOCK_HOLDING_LIMIT"],
    ["FINANCE_STOCK_POSITION_VALUE_LIMIT", 409, "이 거래나 가격 인상을 반영하면 한 학생의 주식 평가액이 10억을 넘습니다.", "FINANCE_STOCK_POSITION_VALUE_LIMIT"],
    ["FINANCE_STOCK_LIQUIDATION_IN_PROGRESS", 409, "이 학생의 주식은 이미 비상 청산을 진행하고 있습니다.", "FINANCE_STOCK_LIQUIDATION_IN_PROGRESS"],
    ["FINANCE_STOCK_LIQUIDATION_OPERATION_STALE", 409, "비상 청산 진행 상태가 바뀌었습니다. 최신 진행률을 확인해 주세요.", "FINANCE_STOCK_LIQUIDATION_STALE"],
    ["FINANCE_STOCK_LIQUIDATION_CHUNK_STALE", 409, "비상 청산의 다음 처리 순서가 바뀌었습니다. 최신 진행률을 확인해 주세요.", "FINANCE_STOCK_LIQUIDATION_STALE"],
    ["FINANCE_STOCK_LIQUIDATION_OPERATION_IMMUTABLE", 409, "완료되었거나 취소된 비상 청산 기록은 바꿀 수 없습니다.", "FINANCE_STOCK_LIQUIDATION_IMMUTABLE"],
    ["FINANCE_STOCK_LEDGER_MISMATCH", 409, "주식과 지갑 기록이 맞지 않아 거래를 멈췄습니다.", "FINANCE_STOCK_LEDGER_MISMATCH"],
    ["FINANCE_STOCK_PROJECTION_MISMATCH", 409, "주식 보유 기록이 달라져 거래를 멈췄습니다.", "FINANCE_STOCK_PROJECTION_MISMATCH"],
    ["FINANCE_ISSUANCE_BALANCE_LIMIT", 409, "학급 발행계정의 안전 한도가 부족해 이번 청산 묶음을 반영하지 않았습니다. 최신 금융 기록을 확인해 주세요.", "FINANCE_STOCK_LIQUIDATION_ISSUANCE_LIMIT"],
    ["FINANCE_INSUFFICIENT_AVAILABLE_BALANCE", 409, "출금 신청 금액을 빼면 주식을 살 수 있는 금액이 부족합니다.", "FINANCE_INSUFFICIENT_AVAILABLE_BALANCE"],
    ["FINANCE_INSUFFICIENT_FUNDS", 409, "지갑 잔액이 부족합니다.", "FINANCE_INSUFFICIENT_FUNDS"],
    ["FINANCE_ACCOUNT_STALE", 409, "다른 거래가 먼저 반영되었습니다. 최신 잔액으로 다시 시도해 주세요.", "FINANCE_ACCOUNT_STALE"],
    ["FINANCE_ACCOUNT_NOT_ACTIVE", 409, "현재 사용할 수 없는 지갑입니다.", "FINANCE_ACCOUNT_NOT_ACTIVE"],
    ["FINANCE_CLASS_NOT_ACTIVE", 409, "현재 운영 중인 학급에서만 주식을 거래할 수 있습니다.", "FINANCE_CLASS_NOT_ACTIVE"],
  ];
  for (const [needle, status, userMessage, code] of mappings) {
    if (message.includes(needle)) throw new ApiError(status, userMessage, code);
  }
  if (
    message.includes("finance_stock_events_stock_revision_uq")
    || message.includes("finance_stock_events.stock_id, finance_stock_events.revision")
    || message.includes("FINANCE_STOCK_EVENT_INVALID")
  ) {
    throw new ApiError(
      409,
      "주가나 종목 상태가 다른 화면에서 먼저 바뀌었습니다. 최신 정보를 다시 불러와 주세요.",
      "FINANCE_STOCK_STALE",
    );
  }
  if (
    message.includes("finance_stock_liquidation_operations_running_uq")
    || message.includes(
      "finance_stock_liquidation_operations.class_id, finance_stock_liquidation_operations.stock_id, finance_stock_liquidation_operations.student_id",
    )
  ) {
    throw new ApiError(
      409,
      "이 학생의 주식은 이미 비상 청산을 진행하고 있습니다.",
      "FINANCE_STOCK_LIQUIDATION_IN_PROGRESS",
    );
  }
  if (
    message.includes("finance_stock_liquidation_operations_root_uq")
    || message.includes(
      "finance_stock_liquidation_operations.root_idempotency_key",
    )
    || message.includes("finance_stock_liquidation_operations_cancellation_uq")
  ) {
    throw new ApiError(
      409,
      "같은 저장 요청 번호가 다른 비상 청산 작업에 사용되었습니다.",
      "FINANCE_STOCK_IDEMPOTENCY_CONFLICT",
    );
  }
  if (
    message.includes("finance_stock_market_events_class_revision_uq")
    || message.includes("finance_stock_market_events.class_id, finance_stock_market_events.revision")
    || message.includes("FINANCE_STOCK_MARKET_EVENT_INVALID")
  ) {
    throw new ApiError(
      409,
      "주식시장 설정이 다른 화면에서 먼저 바뀌었습니다. 최신 정보를 다시 불러와 주세요.",
      "FINANCE_STOCK_MARKET_STALE",
    );
  }
  if (
    message.includes("finance_stocks_class_uq")
    || message.includes("finance_stocks.class_id")
  ) {
    throw new ApiError(409, "우리 반 주식은 이미 만들어져 있습니다.", "FINANCE_STOCK_ALREADY_EXISTS");
  }
  if (
    message.includes("finance_stock_trades_class_student_idempotency_uq")
    || message.includes("finance_stock_trades.class_id, finance_stock_trades.student_id")
    || message.includes("finance_stock_events_class_idempotency_uq")
    || message.includes("finance_stock_market_events_class_idempotency_uq")
  ) {
    throw new ApiError(409, "같은 저장 요청 번호가 다른 작업에 사용되었습니다.", "FINANCE_STOCK_IDEMPOTENCY_CONFLICT");
  }
  throw error;
}

async function stockEventByIdempotency(
  db: D1Database,
  classId: string,
  key: string,
) {
  return db.prepare(
    `SELECT id, class_id, stock_id, revision, action, reason,
            idempotency_key, payload_hash, previous_snapshot_json,
            stock_snapshot_json,
            actor_type, created_at
     FROM finance_stock_events
     WHERE class_id = ? AND idempotency_key = ? LIMIT 1`,
  ).bind(classId, key).first<StockEventRow>();
}

async function marketEventByIdempotency(
  db: D1Database,
  classId: string,
  key: string,
) {
  return db.prepare(
    `SELECT class_id, revision, idempotency_key, payload_hash
     FROM finance_stock_market_events
     WHERE class_id = ? AND idempotency_key = ? LIMIT 1`,
  ).bind(classId, key).first<MarketEventRow>();
}

async function tradeByIdempotency(
  db: D1Database,
  classId: string,
  studentId: string,
  key: string,
) {
  return db.prepare(
    `SELECT trade.*, student.student_number,
            student.official_name AS student_name
     FROM finance_stock_trades trade
     JOIN students student ON student.id = trade.student_id
       AND student.class_id = trade.class_id
     WHERE trade.class_id = ? AND trade.student_id = ?
       AND trade.idempotency_key = ? LIMIT 1`,
  ).bind(classId, studentId, key).first<TradeRow>();
}

async function stockLiquidationOperationByRootKey(
  db: D1Database,
  classId: string,
  rootIdempotencyKey: string,
) {
  return db.prepare(
    `SELECT operation.*, student.student_number,
            student.official_name AS student_name
     FROM finance_stock_liquidation_operations operation
     JOIN students student ON student.id = operation.student_id
       AND student.class_id = operation.class_id
     WHERE operation.class_id = ? AND operation.root_idempotency_key = ?
     LIMIT 1`,
  ).bind(classId, rootIdempotencyKey).first<StockLiquidationOperationRow>();
}

async function stockLiquidationOperationById(
  db: D1Database,
  classId: string,
  operationId: string,
) {
  return db.prepare(
    `SELECT operation.*, student.student_number,
            student.official_name AS student_name
     FROM finance_stock_liquidation_operations operation
     JOIN students student ON student.id = operation.student_id
       AND student.class_id = operation.class_id
     WHERE operation.class_id = ? AND operation.id = ? LIMIT 1`,
  ).bind(classId, operationId).first<StockLiquidationOperationRow>();
}

async function stockLiquidationOperationByCancellationKey(
  db: D1Database,
  classId: string,
  cancellationIdempotencyKey: string,
) {
  return db.prepare(
    `SELECT operation.*, student.student_number,
            student.official_name AS student_name
     FROM finance_stock_liquidation_operations operation
     JOIN students student ON student.id = operation.student_id
       AND student.class_id = operation.class_id
     WHERE operation.class_id = ?
       AND operation.cancellation_idempotency_key = ? LIMIT 1`,
  ).bind(classId, cancellationIdempotencyKey)
    .first<StockLiquidationOperationRow>();
}

async function stockLiquidationChunkByIndex(
  db: D1Database,
  classId: string,
  operationId: string,
  chunkIndex: number,
) {
  return db.prepare(
    `SELECT id, operation_id, class_id, chunk_index, trade_id, quantity,
            gross_amount, fee_amount, wallet_delta, cost_basis_removed,
            realized_gain, holding_quantity_before, holding_quantity_after,
            holding_cost_basis_before, holding_cost_basis_after, created_at
     FROM finance_stock_liquidation_chunks
     WHERE class_id = ? AND operation_id = ? AND chunk_index = ? LIMIT 1`,
  ).bind(classId, operationId, chunkIndex).first<StockLiquidationChunkRow>();
}

async function tradeById(db: D1Database, classId: string, tradeId: string) {
  return db.prepare(
    `SELECT trade.*, student.student_number,
            student.official_name AS student_name
     FROM finance_stock_trades trade
     JOIN students student ON student.id = trade.student_id
       AND student.class_id = trade.class_id
     WHERE trade.class_id = ? AND trade.id = ? LIMIT 1`,
  ).bind(classId, tradeId).first<TradeRow>();
}

async function reconcileStockLiquidationProgress(
  db: D1Database,
  classId: string,
  operationId: string,
  requestedRevision: number,
) {
  const operation = await stockLiquidationOperationById(
    db,
    classId,
    operationId,
  );
  if (!operation) {
    throw new ApiError(
      409,
      "이어갈 비상 청산 작업을 찾지 못했습니다.",
      "FINANCE_STOCK_LIQUIDATION_STALE",
    );
  }
  if (operation.status === "cancelled") {
    throw new ApiError(
      409,
      "취소된 비상 청산은 다시 이어서 처리할 수 없습니다.",
      "FINANCE_STOCK_LIQUIDATION_CANCELLED",
    );
  }
  const operationRevision = Number(operation.revision);
  if (requestedRevision > operationRevision) {
    throw new ApiError(
      409,
      "비상 청산 진행 상태가 바뀌었습니다. 최신 진행률을 확인해 주세요.",
      "FINANCE_STOCK_LIQUIDATION_STALE",
    );
  }
  if (requestedRevision < operationRevision) {
    const committedChunk = await stockLiquidationChunkByIndex(
      db,
      classId,
      operation.id,
      requestedRevision,
    );
    const committedTrade = committedChunk
      ? await tradeById(db, classId, committedChunk.trade_id)
      : null;
    if (committedTrade) {
      return {
        operation,
        result: {
          trade: serializeTrade(committedTrade),
          operation: serializeStockLiquidationOperation(operation),
          chunksProcessed: 0,
          deduplicated: true,
        },
      };
    }
    throw new ApiError(
      409,
      "비상 청산 진행 상태가 바뀌었습니다. 최신 진행률을 확인해 주세요.",
      "FINANCE_STOCK_LIQUIDATION_STALE",
    );
  }
  if (operation.status === "completed") {
    const completedTrade = operation.last_trade_id
      ? await tradeById(db, classId, operation.last_trade_id)
      : null;
    if (!completedTrade) {
      throw new ApiError(
        500,
        "완료된 비상 청산의 마지막 거래를 확인하지 못했습니다.",
        "FINANCE_STOCK_LIQUIDATION_UNAVAILABLE",
      );
    }
    return {
      operation,
      result: {
        trade: serializeTrade(completedTrade),
        operation: serializeStockLiquidationOperation(operation),
        chunksProcessed: 0,
        deduplicated: true,
      },
    };
  }
  return { operation, result: null };
}

async function recentStockLiquidationOperations(
  db: D1Database,
  classId: string,
  stockId: string,
  limit: number,
) {
  const select = `SELECT operation.*, student.student_number,
                          student.official_name AS student_name
                   FROM finance_stock_liquidation_operations operation
                   JOIN students student ON student.id = operation.student_id
                     AND student.class_id = operation.class_id`;
  const [running, recentFinished] = await Promise.all([
    db.prepare(
      `${select}
       WHERE operation.class_id = ? AND operation.stock_id = ?
         AND operation.status = 'running'
       ORDER BY operation.updated_at DESC, operation.id DESC`,
    ).bind(classId, stockId).all<StockLiquidationOperationRow>(),
    db.prepare(
      `${select}
       WHERE operation.class_id = ? AND operation.stock_id = ?
         AND operation.status <> 'running'
       ORDER BY operation.updated_at DESC, operation.id DESC
       LIMIT ?`,
    ).bind(classId, stockId, limit).all<StockLiquidationOperationRow>(),
  ]);
  return [...running.results, ...recentFinished.results];
}

async function latestTrades(
  db: D1Database,
  classId: string,
  studentId: string | null,
  limit: number,
) {
  return db.prepare(
    `SELECT trade.*, student.student_number,
            student.official_name AS student_name
     FROM finance_stock_trades trade
     JOIN students student ON student.id = trade.student_id
       AND student.class_id = trade.class_id
     WHERE trade.class_id = ? AND trade.status = 'posted'
       AND (? IS NULL OR trade.student_id = ?)
     ORDER BY trade.posted_at DESC, trade.id DESC LIMIT ?`,
  ).bind(classId, studentId, studentId, limit).all<TradeRow>();
}

async function latestStockEvents(
  db: D1Database,
  classId: string,
  limit: number,
) {
  return db.prepare(
    `SELECT id, class_id, stock_id, revision, action, reason,
            idempotency_key, payload_hash, stock_snapshot_json,
            actor_type, created_at
     FROM finance_stock_events
     WHERE class_id = ?
     ORDER BY created_at DESC, id DESC LIMIT ?`,
  ).bind(classId, limit).all<StockEventRow>();
}

async function latestNews(db: D1Database, classId: string, limit: number) {
  return db.prepare(
    `SELECT news.id, news.class_id, news.title, news.content,
            news.impact_bps, news.status, news.revision,
            news.idempotency_key, news.payload_hash,
            news.cancellation_idempotency_key,
            news.cancellation_payload_hash, news.cancellation_reason,
            news.created_at, news.expires_at, news.cancelled_at, news.updated_at,
            application.link_status AS application_link_status,
            application.stock_event_id AS applied_stock_event_id,
            application.applied_at AS application_applied_at
     FROM finance_stock_news news
     LEFT JOIN finance_stock_news_applications application
       ON application.class_id = news.class_id
      AND application.news_id = news.id
     WHERE news.class_id = ?
     ORDER BY news.created_at DESC, news.id DESC LIMIT ?`,
  ).bind(classId, limit).all<NewsRow>();
}

function priceHistory(events: StockEventRow[]) {
  return events.flatMap((event) => {
    try {
      const snapshot = JSON.parse(event.stock_snapshot_json) as {
        currentPrice?: unknown;
      };
      const price = Number(snapshot.currentPrice);
      return Number.isSafeInteger(price) && price > 0
        ? [{
            id: event.id,
            price,
            action: event.action,
            reason: event.reason,
            at: Number(event.created_at),
          }]
        : [];
    } catch {
      return [];
    }
  }).reverse();
}

export async function financeStocksForRequest(request: Request) {
  const context = await financeContextForRequest(request);
  const db = database();
  const now = Date.now();
  const [market, stock, settings, newsResult] = await Promise.all([
    marketForClass(db, context.classroom.id),
    stockForClass(db, context.classroom.id),
    financeSettingsForClass(context.classroom.id),
    latestNews(db, context.classroom.id, context.financeRole === "teacher" ? 40 : 12),
  ]);
  if (!market) {
    throw new ApiError(500, "주식시장 기본 설정을 준비하지 못했습니다.", "FINANCE_STOCK_MARKET_UNAVAILABLE");
  }

  let wallet: AccountRow | null = null;
  let holding: HoldingRow | null = null;
  let trades: TradeRow[] = [];
  let events: StockEventRow[] = [];
  let holders: HoldingRow[] = [];
  let liquidationOperations: StockLiquidationOperationRow[] = [];
  if (stock) {
    if (context.actor.type === "student") {
      [wallet, holding] = await Promise.all([
        db.prepare(
          `SELECT id, class_id, student_id, account_type, balance, revision, status
           FROM finance_accounts
           WHERE class_id = ? AND student_id = ?
             AND account_type = 'student_wallet' LIMIT 1`,
        ).bind(context.classroom.id, context.actor.id).first<AccountRow>(),
        holdingForStudent(db, context.classroom.id, stock.id, context.actor.id),
      ]);
      trades = (await latestTrades(db, context.classroom.id, context.actor.id, 30)).results;
    } else {
      const [tradeResult, eventResult, holderResult, liquidationResult] = await Promise.all([
        latestTrades(db, context.classroom.id, null, 100),
        latestStockEvents(db, context.classroom.id, 80),
        db.prepare(
          `SELECT holding.*, student.student_number,
                  student.official_name AS student_name
           FROM finance_stock_holdings holding
           JOIN students student ON student.id = holding.student_id
             AND student.class_id = holding.class_id
           WHERE holding.class_id = ? AND holding.stock_id = ?
             AND holding.quantity > 0
           ORDER BY holding.quantity DESC, student.student_number, student.id`,
        ).bind(context.classroom.id, stock.id).all<HoldingRow>(),
        recentStockLiquidationOperations(db, context.classroom.id, stock.id, 40),
      ]);
      trades = tradeResult.results;
      events = eventResult.results;
      holders = holderResult.results;
      liquidationOperations = liquidationResult;
    }
    if (events.length === 0) {
      events = (await latestStockEvents(db, context.classroom.id, 40)).results;
    }
  }
  const walletAvailability = wallet
    ? await financeWalletAvailability(db, {
      classId: context.classroom.id,
      walletAccountId: wallet.id,
      balance: Number(wallet.balance),
    })
    : null;

  return {
    serverTime: now,
    settingsRevision: settings.revision,
    denominationStep: Math.min(...settings.denominations),
    market: serializeMarket(market),
    stock: stock
      ? {
          ...serializeStock(stock),
          priceHistory: priceHistory(events),
        }
      : null,
    wallet: wallet
      ? {
          balance: Number(wallet.balance),
          pendingWithdrawalAmount: walletAvailability?.pendingWithdrawalAmount ?? 0,
          availableBalance: walletAvailability?.availableBalance ?? Number(wallet.balance),
          revision: Number(wallet.revision),
          status: wallet.status,
        }
      : null,
    holding: stock ? serializeHolding(holding, Number(stock.current_price)) : null,
    holdings: context.financeRole === "teacher" && stock
      ? holders.map((row) => ({
          student: {
            id: row.student_id,
            number: Number(row.student_number ?? 0),
            name: row.student_name ?? "학생",
          },
          ...serializeHolding(row, Number(stock.current_price)),
        }))
      : [],
    liquidations: context.financeRole === "teacher" && stock
      ? liquidationOperations.map(serializeStockLiquidationOperation)
      : [],
    trades: trades.map(serializeTrade),
    news: newsResult.results.map((row) => serializeNews(row, now)),
  };
}

export async function createFinanceStock(
  request: Request,
  input: Record<string, unknown>,
) {
  const context = await financeContextForRequest(request);
  assertTeacher(context);
  const db = database();
  const [market, settings] = await Promise.all([
    marketForClass(db, context.classroom.id),
    financeSettingsForClass(context.classroom.id),
  ]);
  if (!market) {
    throw new ApiError(500, "주식시장 기본 설정을 준비하지 못했습니다.", "FINANCE_STOCK_MARKET_UNAVAILABLE");
  }
  const step = Math.min(...settings.denominations);
  let definition: ReturnType<typeof normalizeFinanceStockDefinition>;
  let marketValues: ReturnType<typeof normalizeFinanceStockMarketSettings>;
  try {
    definition = normalizeFinanceStockDefinition({
      ...input,
      denominationStep: step,
    });
    marketValues = normalizeFinanceStockMarketSettings({
      isOpen: false,
      buyFeeBps: input.buyFeeBps ?? 500,
      sellFeeBps: input.sellFeeBps ?? 500,
      buySpread: input.buySpread ?? step,
      sellSpread: input.sellSpread ?? step,
      mood: input.mood ?? "mixed",
      tickIntervalMinutes: input.tickIntervalMinutes ?? 15,
      expectedRevision: market.revision,
      idempotencyKey: input.idempotencyKey,
    });
    calculateFinanceStockExecutionPrice({
      side: "buy",
      currentPrice: definition.initialPrice,
      buySpread: marketValues.buySpread,
      sellSpread: marketValues.sellSpread,
      denominationStep: step,
    });
    calculateFinanceStockExecutionPrice({
      side: "sell",
      currentPrice: definition.initialPrice,
      buySpread: marketValues.buySpread,
      sellSpread: marketValues.sellSpread,
      denominationStep: step,
    });
  } catch (error) {
    ruleError(error);
  }
  const key = marketValues.idempotencyKey;
  const payloadHash = await sha256(stableFinanceJson({
    classId: context.classroom.id,
    definition,
    market: {
      buyFeeBps: marketValues.buyFeeBps,
      sellFeeBps: marketValues.sellFeeBps,
      buySpread: marketValues.buySpread,
      sellSpread: marketValues.sellSpread,
      mood: marketValues.mood,
      tickIntervalMinutes: marketValues.tickIntervalMinutes,
    },
  }));
  const duplicate = await stockEventByIdempotency(db, context.classroom.id, key);
  if (duplicate) {
    if (duplicate.payload_hash !== payloadHash) {
      throw new ApiError(409, "같은 저장 요청이 다른 주식에 사용되었습니다.", "FINANCE_STOCK_IDEMPOTENCY_CONFLICT");
    }
    const existing = await stockById(db, context.classroom.id, duplicate.stock_id);
    if (!existing) {
      throw new ApiError(500, "만든 주식을 다시 확인하지 못했습니다.", "FINANCE_STOCK_UNAVAILABLE");
    }
    return { stock: serializeStock(existing), market: serializeMarket(market), deduplicated: true };
  }
  if (await stockForClass(db, context.classroom.id)) {
    throw new ApiError(409, "우리 반 주식은 이미 만들어져 있습니다.", "FINANCE_STOCK_ALREADY_EXISTS");
  }

  const now = Date.now();
  const stockId = crypto.randomUUID();
  const marketChanged = Number(market.buy_fee_bps) !== marketValues.buyFeeBps
    || Number(market.sell_fee_bps) !== marketValues.sellFeeBps
    || Number(market.buy_spread) !== marketValues.buySpread
    || Number(market.sell_spread) !== marketValues.sellSpread
    || market.market_mood !== marketValues.mood
    || Number(market.tick_interval_minutes) !== marketValues.tickIntervalMinutes;
  const nextMarket: MarketRow = {
    ...market,
    is_open: 0,
    buy_fee_bps: marketValues.buyFeeBps,
    sell_fee_bps: marketValues.sellFeeBps,
    buy_spread: marketValues.buySpread,
    sell_spread: marketValues.sellSpread,
    market_mood: marketValues.mood,
    tick_interval_minutes: marketValues.tickIntervalMinutes,
    next_tick_at: null,
    revision: Number(market.revision) + (marketChanged ? 1 : 0),
    updated_at: marketChanged ? now : Number(market.updated_at),
  };
  const row: StockRow = {
    id: stockId,
    class_id: context.classroom.id,
    name: definition.name,
    symbol: definition.symbol,
    description: definition.description ?? "",
    initial_price: definition.initialPrice,
    current_price: definition.initialPrice,
    previous_price: definition.initialPrice,
    total_shares: definition.totalSupply,
    available_shares: definition.totalSupply,
    max_shares_per_student: definition.maxSharesPerStudent,
    status: "active",
    revision: 0,
    inventory_revision: 0,
    last_trade_id: null,
    created_at: now,
    updated_at: now,
  };
  try {
    const statements: D1PreparedStatement[] = [];
    if (marketChanged) {
      statements.push(db.prepare(
        `UPDATE finance_stock_markets
         SET is_open = 0, buy_fee_bps = ?, sell_fee_bps = ?,
             buy_spread = ?, sell_spread = ?, market_mood = ?,
             tick_interval_minutes = ?, next_tick_at = NULL,
             revision = revision + 1, updated_by_teacher_id = ?, updated_at = ?
         WHERE class_id = ? AND revision = ?`,
      ).bind(
        nextMarket.buy_fee_bps,
        nextMarket.sell_fee_bps,
        nextMarket.buy_spread,
        nextMarket.sell_spread,
        nextMarket.market_mood,
        nextMarket.tick_interval_minutes,
        context.actor.id,
        now,
        context.classroom.id,
        market.revision,
      ), db.prepare(
        `INSERT INTO finance_stock_market_events (
           id, class_id, revision, action, idempotency_key, payload_hash,
           previous_snapshot_json, market_snapshot_json,
           actor_teacher_id, created_at
         ) VALUES (?, ?, ?, 'configured', ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        context.classroom.id,
        nextMarket.revision,
        `stock-market:${stockId}`,
        payloadHash,
        marketSnapshot(market),
        marketSnapshot(nextMarket),
        context.actor.id,
        now,
      ));
    }
    statements.push(
      db.prepare(
        `INSERT INTO finance_stocks (
           id, class_id, name, symbol, description, initial_price,
           current_price, previous_price, total_shares, available_shares,
           max_shares_per_student, status, revision, inventory_revision,
           last_trade_id, created_by_teacher_id, updated_by_actor_type,
           updated_by_teacher_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, 0,
                   NULL, ?, 'teacher', ?, ?, ?)`,
      ).bind(
        stockId,
        context.classroom.id,
        row.name,
        row.symbol,
        row.description,
        row.initial_price,
        row.current_price,
        row.previous_price,
        row.total_shares,
        row.available_shares,
        row.max_shares_per_student,
        context.actor.id,
        context.actor.id,
        now,
        now,
      ),
      db.prepare(
        `INSERT INTO finance_stock_events (
           id, class_id, stock_id, revision, action, reason,
           idempotency_key, payload_hash, previous_snapshot_json,
           stock_snapshot_json, actor_type, actor_teacher_id, created_at
         ) VALUES (?, ?, ?, 0, 'issued', ?, ?, ?, NULL, ?,
                   'teacher', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        context.classroom.id,
        stockId,
        "우리 반 주식을 처음 발행했습니다.",
        key,
        payloadHash,
        stockSnapshot(row),
        context.actor.id,
        now,
      ),
    );
    await db.batch(statements);
  } catch (error) {
    const concurrent = await stockEventByIdempotency(db, context.classroom.id, key);
    if (
      concurrent
      && concurrent.payload_hash === payloadHash
      && concurrent.actor_type === "teacher"
      && concurrent.action === "issued"
    ) {
      const saved = await stockById(db, context.classroom.id, concurrent.stock_id);
      const savedMarket = await marketForClass(db, context.classroom.id);
      if (saved && savedMarket) {
        return { stock: serializeStock(saved), market: serializeMarket(savedMarket), deduplicated: true };
      }
    }
    mapDatabaseError(error);
  }
  return {
    stock: serializeStock(row),
    market: serializeMarket(nextMarket),
    deduplicated: false,
  };
}

export async function updateFinanceStockMarket(
  request: Request,
  input: Record<string, unknown>,
) {
  const context = await financeContextForRequest(request);
  assertTeacher(context);
  const db = database();
  const [market, stock, settings] = await Promise.all([
    marketForClass(db, context.classroom.id),
    stockForClass(db, context.classroom.id),
    financeSettingsForClass(context.classroom.id),
  ]);
  if (!market) throw new ApiError(500, "주식시장 설정을 찾지 못했습니다.", "FINANCE_STOCK_MARKET_UNAVAILABLE");
  if (!stock) throw new ApiError(409, "우리 반 주식을 먼저 만들어 주세요.", "FINANCE_STOCK_NOT_CREATED");
  const step = Math.min(...settings.denominations);
  let values: ReturnType<typeof normalizeFinanceStockMarketSettings>;
  try {
    values = normalizeFinanceStockMarketSettings({
      ...input,
      tickIntervalMinutes: input.tickIntervalMinutes ?? market.tick_interval_minutes,
    });
    calculateFinanceStockExecutionPrice({
      side: "buy",
      currentPrice: stock.current_price,
      buySpread: values.buySpread,
      sellSpread: values.sellSpread,
      denominationStep: step,
    });
    calculateFinanceStockExecutionPrice({
      side: "sell",
      currentPrice: stock.current_price,
      buySpread: values.buySpread,
      sellSpread: values.sellSpread,
      denominationStep: step,
    });
  } catch (error) {
    ruleError(error);
  }
  const payloadHash = await sha256(stableFinanceJson({
    classId: context.classroom.id,
    expectedRevision: values.expectedRevision,
    isOpen: values.isOpen,
    buyFeeBps: values.buyFeeBps,
    sellFeeBps: values.sellFeeBps,
    buySpread: values.buySpread,
    sellSpread: values.sellSpread,
    mood: values.mood,
    tickIntervalMinutes: values.tickIntervalMinutes,
  }));
  const duplicate = await marketEventByIdempotency(db, context.classroom.id, values.idempotencyKey);
  if (duplicate) {
    if (duplicate.payload_hash !== payloadHash) {
      throw new ApiError(409, "같은 저장 요청이 다른 시장 설정에 사용되었습니다.", "FINANCE_STOCK_IDEMPOTENCY_CONFLICT");
    }
    const saved = await marketForClass(db, context.classroom.id);
    if (!saved) throw new ApiError(500, "저장한 시장 설정을 찾지 못했습니다.", "FINANCE_STOCK_MARKET_UNAVAILABLE");
    return { market: serializeMarket(saved), deduplicated: true };
  }
  if (Number(market.revision) !== values.expectedRevision) {
    throw new ApiError(409, "주식시장 설정이 다른 화면에서 바뀌었습니다.", "FINANCE_STOCK_MARKET_STALE");
  }
  if (values.isOpen && (stock.status === "halted" || stock.status === "archived")) {
    throw new ApiError(409, "종목 거래 상태를 먼저 허용으로 바꿔 주세요.", "FINANCE_STOCK_TRADE_HALTED");
  }
  const unchanged = Boolean(market.is_open) === values.isOpen
    && Number(market.buy_fee_bps) === values.buyFeeBps
    && Number(market.sell_fee_bps) === values.sellFeeBps
    && Number(market.buy_spread) === values.buySpread
    && Number(market.sell_spread) === values.sellSpread
    && market.market_mood === values.mood
    && Number(market.tick_interval_minutes) === values.tickIntervalMinutes;
  if (unchanged) {
    return { market: serializeMarket(market), deduplicated: true };
  }
  const now = Date.now();
  const nextTickAt = values.isOpen
    ? (!market.is_open || market.next_tick_at === null
        ? now + (values.tickIntervalMinutes * 60_000)
        : Number(market.next_tick_at))
    : null;
  const next: MarketRow = {
    ...market,
    is_open: values.isOpen ? 1 : 0,
    buy_fee_bps: values.buyFeeBps,
    sell_fee_bps: values.sellFeeBps,
    buy_spread: values.buySpread,
    sell_spread: values.sellSpread,
    market_mood: values.mood,
    tick_interval_minutes: values.tickIntervalMinutes,
    next_tick_at: nextTickAt,
    revision: values.expectedRevision + 1,
    updated_at: now,
  };
  const action = Boolean(market.is_open) !== values.isOpen
    ? values.isOpen ? "opened" : "closed"
    : "updated";
  try {
    await db.batch([
      db.prepare(
        `UPDATE finance_stock_markets
         SET is_open = ?, buy_fee_bps = ?, sell_fee_bps = ?,
             buy_spread = ?, sell_spread = ?, market_mood = ?,
             tick_interval_minutes = ?, next_tick_at = ?,
             revision = revision + 1, updated_by_teacher_id = ?, updated_at = ?
         WHERE class_id = ? AND revision = ? AND next_tick_at IS ?`,
      ).bind(
        next.is_open,
        next.buy_fee_bps,
        next.sell_fee_bps,
        next.buy_spread,
        next.sell_spread,
        next.market_mood,
        next.tick_interval_minutes,
        next.next_tick_at,
        context.actor.id,
        now,
        context.classroom.id,
        values.expectedRevision,
        market.next_tick_at,
      ),
      db.prepare(
        `INSERT INTO finance_stock_market_events (
           id, class_id, revision, action, idempotency_key, payload_hash,
           previous_snapshot_json, market_snapshot_json,
           actor_teacher_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        context.classroom.id,
        next.revision,
        action,
        values.idempotencyKey,
        payloadHash,
        marketSnapshot(market),
        marketSnapshot(next),
        context.actor.id,
        now,
      ),
    ]);
  } catch (error) {
    const concurrent = await marketEventByIdempotency(db, context.classroom.id, values.idempotencyKey);
    if (concurrent && concurrent.payload_hash === payloadHash) {
      const saved = await marketForClass(db, context.classroom.id);
      if (saved) return { market: serializeMarket(saved), deduplicated: true };
    }
    mapDatabaseError(error);
  }
  return { market: serializeMarket(next), deduplicated: false };
}

export async function updateFinanceStock(
  request: Request,
  stockIdValue: unknown,
  input: Record<string, unknown>,
) {
  const context = await financeContextForRequest(request);
  assertTeacher(context);
  const stockId = requiredId(stockIdValue, "주식 ID");
  const revision = expectedRevision(input.expectedRevision, "주식");
  const key = idempotencyKey(input.idempotencyKey);
  const db = database();
  const [current, market, settings, maximumQuantity] = await Promise.all([
    stockById(db, context.classroom.id, stockId),
    marketForClass(db, context.classroom.id),
    financeSettingsForClass(context.classroom.id),
    maximumHoldingQuantity(db, context.classroom.id, stockId),
  ]);
  if (!current || !market) throw new ApiError(404, "우리 반 주식을 찾지 못했습니다.", "FINANCE_STOCK_NOT_FOUND");
  const statusInput = input.status === "paused" ? "halted" : input.status ?? current.status;
  if (typeof statusInput !== "string" || !STOCK_STATUSES.has(statusInput)) {
    throw new ApiError(400, "주식 거래 상태를 다시 선택해 주세요.", "FINANCE_STOCK_INVALID_STATUS");
  }
  const status = statusInput as StockStatus;
  const step = Math.min(...settings.denominations);
  let currentPrice: number;
  try {
    currentPrice = normalizeFinanceStockPrice(input.currentPrice ?? current.current_price, step);
    calculateFinanceStockExecutionPrice({
      side: "buy",
      currentPrice,
      buySpread: market.buy_spread,
      sellSpread: market.sell_spread,
      denominationStep: step,
    });
    calculateFinanceStockExecutionPrice({
      side: "sell",
      currentPrice,
      buySpread: market.buy_spread,
      sellSpread: market.sell_spread,
      denominationStep: step,
    });
    if (current && currentPrice > Number(current.current_price)) {
      assertFinanceStockPositionMarketValue({
        quantity: maximumQuantity,
        currentPrice,
      });
    }
  } catch (error) {
    ruleError(error);
  }
  if (status === "archived" && Number(current.available_shares) !== Number(current.total_shares)) {
    throw new ApiError(409, "학생이 가진 주식이 남아 있어 종목을 보관할 수 없습니다.", "FINANCE_STOCK_ACTIVE_HOLDINGS");
  }
  if (status === "archived" && current.status !== "archived") {
    throw new ApiError(
      409,
      "종목 보관은 되돌릴 수 있어야 하므로 아직 제공하지 않습니다. 거래 중지를 사용해 주세요.",
      "FINANCE_STOCK_ARCHIVE_UNAVAILABLE",
    );
  }
  if (current.status === "archived" && (
    status !== "archived" || currentPrice !== Number(current.current_price)
  )) {
    throw new ApiError(409, "보관된 종목은 바꿀 수 없습니다.", "FINANCE_STOCK_IMMUTABLE");
  }
  const reason = normalizedText(
    input.reason ?? "교사가 현재가 또는 거래 상태를 변경했습니다.",
    "변경 이유",
    300,
  );
  const payloadHash = await sha256(stableFinanceJson({
    classId: context.classroom.id,
    stockId,
    expectedRevision: revision,
    currentPrice,
    status,
    reason,
  }));
  const duplicate = await stockEventByIdempotency(db, context.classroom.id, key);
  if (duplicate) {
    if (duplicate.stock_id !== stockId || duplicate.payload_hash !== payloadHash) {
      throw new ApiError(409, "같은 저장 요청이 다른 종목 변경에 사용되었습니다.", "FINANCE_STOCK_IDEMPOTENCY_CONFLICT");
    }
    const saved = await stockById(db, context.classroom.id, stockId);
    if (!saved) throw new ApiError(404, "우리 반 주식을 찾지 못했습니다.", "FINANCE_STOCK_NOT_FOUND");
    return { stock: serializeStock(saved), deduplicated: true };
  }
  if (Number(current.revision) !== revision) {
    throw new ApiError(409, "주가나 종목 상태가 다른 화면에서 바뀌었습니다.", "FINANCE_STOCK_STALE");
  }
  if (currentPrice === Number(current.current_price) && status === current.status) {
    return { stock: serializeStock(current), deduplicated: true };
  }
  const now = Date.now();
  const next: StockRow = {
    ...current,
    previous_price: currentPrice === Number(current.current_price)
      ? Number(current.previous_price)
      : Number(current.current_price),
    current_price: currentPrice,
    status,
    revision: revision + 1,
    updated_at: now,
  };
  const action = currentPrice !== Number(current.current_price)
    ? "price_changed"
    : "status_changed";
  try {
    await db.batch([
      db.prepare(
        `UPDATE finance_stocks
         SET current_price = ?, previous_price = ?, status = ?,
             revision = revision + 1, updated_by_actor_type = 'teacher',
             updated_by_teacher_id = ?, updated_at = ?
         WHERE id = ? AND class_id = ? AND revision = ?`,
      ).bind(
        next.current_price,
        next.previous_price,
        next.status,
        context.actor.id,
        now,
        stockId,
        context.classroom.id,
        revision,
      ),
      db.prepare(
        `INSERT INTO finance_stock_events (
           id, class_id, stock_id, revision, action, reason,
           idempotency_key, payload_hash, previous_snapshot_json,
           stock_snapshot_json, actor_type, actor_teacher_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'teacher', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        context.classroom.id,
        stockId,
        next.revision,
        action,
        reason,
        key,
        payloadHash,
        stockSnapshot(current),
        stockSnapshotWithMarket(next, Number(market.revision)),
        context.actor.id,
        now,
      ),
    ]);
  } catch (error) {
    const concurrent = await stockEventByIdempotency(db, context.classroom.id, key);
    if (concurrent && concurrent.stock_id === stockId && concurrent.payload_hash === payloadHash) {
      const saved = await stockById(db, context.classroom.id, stockId);
      if (saved) return { stock: serializeStock(saved), deduplicated: true };
    }
    mapDatabaseError(error);
  }
  return { stock: serializeStock(next), deduplicated: false };
}

export async function tradeFinanceStock(
  request: Request,
  stockIdValue: unknown,
  input: Record<string, unknown>,
  options: {
    teacherLiquidation?: {
      studentId: string;
      reason: string;
      origin: TeacherLiquidationOrigin;
      operationId: string;
      chunk?: {
        operation: StockLiquidationOperationRow;
        chunkIndex: number;
      };
    };
  } = {},
) {
  const context = await financeContextForRequest(request);
  if (options.teacherLiquidation) assertTeacher(context);
  else assertStudent(context);
  const tradingStudentId = options.teacherLiquidation?.studentId ?? context.actor.id;
  const stockId = requiredId(stockIdValue, "주식 ID");
  let order: ReturnType<typeof normalizeFinanceStockTradeRequest>;
  try {
    order = normalizeFinanceStockTradeRequest(input);
  } catch (error) {
    ruleError(error);
  }
  const payloadHash = await sha256(stableFinanceJson({
    classId: context.classroom.id,
    studentId: tradingStudentId,
    stockId,
    side: order.side,
    quantity: order.quantity,
    initiatedBy: options.teacherLiquidation
      ? {
          type: "teacher",
          teacherId: context.actor.id,
          reason: options.teacherLiquidation.reason,
          origin: options.teacherLiquidation.origin,
           operationId: options.teacherLiquidation.operationId,
           ...(options.teacherLiquidation.chunk
             ? {
                 rootIdempotencyKey:
                   options.teacherLiquidation.chunk.operation.root_idempotency_key,
                 chunkIndex: options.teacherLiquidation.chunk.chunkIndex,
                 operationRevisionBefore:
                   Number(options.teacherLiquidation.chunk.operation.revision),
               }
             : {}),
           confirmedSnapshot: {
            stockRevision: order.expectedStockRevision,
            marketRevision: order.expectedMarketRevision,
            financeSettingsRevision: order.expectedFinanceSettingsRevision,
            holdingRevision: order.expectedHoldingRevision,
          },
        }
      : { type: "student", studentId: context.actor.id },
  }));
  const db = database();
  const duplicate = await tradeByIdempotency(
    db,
    context.classroom.id,
    tradingStudentId,
    order.idempotencyKey,
  );
  if (duplicate) {
    if (duplicate.stock_id !== stockId || duplicate.payload_hash !== payloadHash) {
      throw new ApiError(409, "같은 거래 요청 번호가 다른 주문에 사용되었습니다.", "FINANCE_STOCK_IDEMPOTENCY_CONFLICT");
    }
    return { trade: serializeTrade(duplicate), deduplicated: true };
  }

  const [market, stock, settings, holding, accounts, targetStudent] = await Promise.all([
    marketForClass(db, context.classroom.id),
    stockById(db, context.classroom.id, stockId),
    financeSettingsForClass(context.classroom.id),
    holdingForStudent(db, context.classroom.id, stockId, tradingStudentId),
    accountRows(db, context.classroom.id, tradingStudentId),
    options.teacherLiquidation
      ? db.prepare(
          `SELECT id, status FROM students
           WHERE id = ? AND class_id = ? LIMIT 1`,
        ).bind(tradingStudentId, context.classroom.id).first<StudentStatusRow>()
      : Promise.resolve(null),
  ]);
  if (!market || !stock) {
    throw new ApiError(404, "우리 반 주식을 찾지 못했습니다.", "FINANCE_STOCK_NOT_FOUND");
  }
  if (options.teacherLiquidation) {
    if (order.side !== "sell") {
      throw new ApiError(
        403,
        "교사 비상 처리는 학생이 보유한 주식의 전량 청산에만 사용할 수 있습니다.",
        "FINANCE_STOCK_LIQUIDATION_SELL_ONLY",
      );
    }
    if (stock.status === "archived") {
      throw new ApiError(
        409,
        "보관된 종목은 비상 청산할 수 없습니다.",
        "FINANCE_STOCK_IMMUTABLE",
      );
    }
    if (!targetStudent || !TEACHER_LIQUIDATION_STUDENT_STATUSES.has(targetStudent.status)) {
      throw new ApiError(
        409,
        "이미 명단에서 제외되었거나 이 학급에 없는 학생은 비상 청산할 수 없습니다.",
        "FINANCE_STOCK_LIQUIDATION_STUDENT_UNAVAILABLE",
      );
    }
    if (options.teacherLiquidation.chunk && (
      options.teacherLiquidation.chunk.operation.status !== "running"
      || Number(options.teacherLiquidation.chunk.operation.next_chunk_index)
        !== options.teacherLiquidation.chunk.chunkIndex
    )) {
      throw new ApiError(
        409,
        "비상 청산 진행 상태가 바뀌었습니다. 최신 진행률을 다시 확인해 주세요.",
        "FINANCE_STOCK_LIQUIDATION_STALE",
      );
    }
  } else {
    if (!market.is_open) {
      throw new ApiError(409, "지금은 주식시장이 쉬는 시간입니다.", "FINANCE_STOCK_MARKET_CLOSED");
    }
    if (stock.status === "halted" || stock.status === "archived") {
      throw new ApiError(409, "지금은 이 주식의 거래가 잠시 멈췄습니다.", "FINANCE_STOCK_TRADE_HALTED");
    }
    if (order.side === "buy" && stock.status !== "active") {
      throw new ApiError(409, "지금은 이 주식을 새로 살 수 없습니다.", "FINANCE_STOCK_BUY_CLOSED");
    }
  }
  if (Number(stock.revision) !== order.expectedStockRevision) {
    throw new ApiError(409, "주가가 바뀌었습니다. 최신 시세를 다시 확인해 주세요.", "FINANCE_STOCK_STALE");
  }
  if (Number(market.revision) !== order.expectedMarketRevision) {
    throw new ApiError(409, "시장 설정이 바뀌었습니다. 최신 수수료를 다시 확인해 주세요.", "FINANCE_STOCK_MARKET_STALE");
  }
  if (settings.revision !== order.expectedFinanceSettingsRevision) {
    throw new ApiError(409, "학급화폐 설정이 바뀌었습니다. 최신 정보를 다시 확인해 주세요.", "FINANCE_SETTINGS_STALE");
  }
  const holdingRevision = Number(holding?.revision ?? 0);
  if (holdingRevision !== order.expectedHoldingRevision) {
    throw new ApiError(409, "보유 주식 수가 바뀌었습니다. 최신 정보를 다시 확인해 주세요.", "FINANCE_STOCK_TRADE_STALE");
  }
  if (Number(accounts.wallet.revision) !== order.expectedWalletRevision) {
    throw new ApiError(409, "지갑 잔액이 바뀌었습니다. 최신 정보를 다시 확인해 주세요.", "FINANCE_ACCOUNT_STALE");
  }

  const liquidationChunk = options.teacherLiquidation?.chunk;
  const step = liquidationChunk
    ? Number(liquidationChunk.operation.snapshot_denomination_step)
    : Math.min(...settings.denominations);
  const feeBps = liquidationChunk
    ? Number(liquidationChunk.operation.snapshot_fee_bps)
    : order.side === "buy"
      ? Number(market.buy_fee_bps)
      : Number(market.sell_fee_bps);
  const referencePrice = liquidationChunk
    ? Number(liquidationChunk.operation.snapshot_reference_price)
    : Number(stock.current_price);
  const spread = liquidationChunk
    ? Number(liquidationChunk.operation.snapshot_spread)
    : order.side === "buy"
      ? Number(market.buy_spread)
      : Number(market.sell_spread);
  let unitPrice: number;
  let position: ReturnType<typeof calculateFinanceStockPositionAfterTrade>;
  try {
    unitPrice = liquidationChunk
      ? Number(liquidationChunk.operation.snapshot_unit_price)
      : calculateFinanceStockExecutionPrice({
          side: order.side,
          currentPrice: stock.current_price,
          buySpread: market.buy_spread,
          sellSpread: market.sell_spread,
          denominationStep: step,
        }).unitPrice;
    position = calculateFinanceStockPositionAfterTrade({
      side: order.side,
      unitPrice,
      quantity: order.quantity,
      feeBps,
      denominationStep: step,
      quantityBefore: holding?.quantity ?? 0,
      totalCostBefore: holding?.cost_basis ?? 0,
    });
    if (order.side === "buy") {
      assertFinanceStockPositionMarketValue({
        quantity: position.quantityAfter,
        currentPrice: stock.current_price,
      });
    }
  } catch (error) {
    ruleError(error);
  }
  if (position.quantityAfter > Number(stock.max_shares_per_student)) {
    throw new ApiError(409, "한 학생이 보유할 수 있는 최대 주식 수를 넘습니다.", "FINANCE_STOCK_HOLDING_LIMIT");
  }
  const availableAfter = order.side === "buy"
    ? Number(stock.available_shares) - order.quantity
    : Number(stock.available_shares) + order.quantity;
  if (availableAfter < 0) {
    throw new ApiError(409, "시장에 남은 주식이 부족합니다.", "FINANCE_STOCK_INSUFFICIENT_INVENTORY");
  }
  if (availableAfter > Number(stock.total_shares)) {
    throw new ApiError(409, "시장 재고를 확인해 주세요.", "FINANCE_STOCK_INVENTORY_MISMATCH");
  }
  if (position.quote.walletChange < 0 && Number(accounts.wallet.balance) < -position.quote.walletChange) {
    throw new ApiError(409, "수수료를 포함한 결제금액보다 지갑 잔액이 적습니다.", "FINANCE_INSUFFICIENT_FUNDS");
  }
  if (position.quote.walletChange < 0) {
    const walletAvailability = await financeWalletAvailability(db, {
      classId: context.classroom.id,
      walletAccountId: accounts.wallet.id,
      balance: Number(accounts.wallet.balance),
    });
    if (walletAvailability.availableBalance < -position.quote.walletChange) {
      throw new ApiError(
        409,
        "출금 신청 금액을 빼면 주식을 살 수 있는 금액이 부족합니다.",
        "FINANCE_INSUFFICIENT_AVAILABLE_BALANCE",
      );
    }
  }

  const now = Date.now();
  const tradeId = crypto.randomUUID();
  const transactionId = crypto.randomUUID();
  const holdingRevisionAfter = holdingRevision + 1;
  const inventoryRevisionAfter = Number(stock.inventory_revision) + 1;
  const walletRevisionAfter = Number(accounts.wallet.revision) + 1;
  const transaction = normalizeFinanceTransaction({
    classId: context.classroom.id,
    idempotencyKey: `stock-trade:${tradeId}:ledger`,
    transactionType: order.side === "buy" ? "stock_buy" : "stock_sell",
    description: options.teacherLiquidation
      ? `${stock.name} ${order.quantity.toLocaleString("ko-KR")}주 담임교사 비상 청산`.slice(0, 200)
      : `${stock.name} ${order.quantity.toLocaleString("ko-KR")}주 ${order.side === "buy" ? "매수" : "매도"}`,
    actor: options.teacherLiquidation
      ? {
          type: "teacher",
          teacherId: context.actor.id,
          label: "담임교사 비상 청산",
        }
      : { type: "system", label: "주식 자동 체결" },
    sourceType: "stock_trade",
    sourceId: tradeId,
    lines: [
      {
        accountId: accounts.wallet.id,
        amount: position.quote.walletChange,
        memo: `${stock.symbol} ${order.side === "buy" ? "매수" : "매도"}`,
      },
      {
        accountId: accounts.issuance.id,
        amount: position.quote.issuanceChange,
        memo: `${stock.symbol} 거래 상대 계정`,
      },
    ],
    metadata: {
      tradeId,
      stockId,
      symbol: stock.symbol,
      studentId: tradingStudentId,
      side: order.side,
      quantity: order.quantity,
      referencePrice,
      spreadSnapshot: spread,
      unitPrice,
      grossAmount: position.quote.grossAmount,
      feeBpsSnapshot: feeBps,
      feeAmount: position.quote.feeAmount,
      walletDelta: position.quote.walletChange,
      stockRevision: Number(stock.revision),
      inventoryRevisionBefore: Number(stock.inventory_revision),
      marketRevision: Number(market.revision),
      financeSettingsRevision: settings.revision,
      walletRevisionBefore: Number(accounts.wallet.revision),
      holdingRevisionBefore: holdingRevision,
      availableSharesBefore: Number(stock.available_shares),
      availableSharesAfter: availableAfter,
      holdingQuantityBefore: position.quantityBefore,
      holdingQuantityAfter: position.quantityAfter,
      holdingCostBasisBefore: position.totalCostBefore,
      holdingCostBasisAfter: position.totalCostAfter,
      costBasisRemoved: position.costBasisRemoved,
      realizedGain: position.realizedProfit,
      ...(options.teacherLiquidation
        ? {
            isEmergency: true,
            operationId: options.teacherLiquidation.operationId,
            origin: options.teacherLiquidation.origin,
            interventionReason: options.teacherLiquidation.reason,
            studentStatusSnapshot: targetStudent?.status,
            marketWasOpen: Boolean(market.is_open),
            stockStatusSnapshot: stock.status,
            liquidationPolicy: liquidationChunk
              ? "frozen_quote_resumable"
              : "current_market_terms_at_liquidation",
            ...(liquidationChunk
              ? {
                  rootIdempotencyKey:
                    liquidationChunk.operation.root_idempotency_key,
                  chunkIndex: liquidationChunk.chunkIndex,
                  operationRevisionBefore:
                    Number(liquidationChunk.operation.revision),
                  frozenStockRevision:
                    Number(liquidationChunk.operation.snapshot_stock_revision),
                  frozenMarketRevision:
                    Number(liquidationChunk.operation.snapshot_market_revision),
                  frozenFinanceSettingsRevision: Number(
                    liquidationChunk.operation.snapshot_finance_settings_revision,
                  ),
                  frozenDenominationStep: Number(
                    liquidationChunk.operation.snapshot_denomination_step,
                  ),
                }
              : {}),
          }
        : {}),
    },
  });
  const transactionPayloadHash = await sha256(financeTransactionPayload(transaction));
  const accountsById = new Map([
    [accounts.wallet.id, accounts.wallet],
    [accounts.issuance.id, accounts.issuance],
  ]);
  const tradeInsertStatement = db.prepare(
      `INSERT INTO finance_stock_trades (
         id, class_id, stock_id, stock_revision,
         inventory_revision_before, inventory_revision_after,
         market_revision, finance_settings_revision,
         student_id, wallet_account_id,
         wallet_revision_before, wallet_revision_after,
         side, quantity, reference_price, spread_snapshot, unit_price,
         gross_amount, fee_bps_snapshot, fee_amount, wallet_delta,
         available_shares_before, available_shares_after,
         holding_quantity_before, holding_quantity_after,
         holding_cost_basis_before, holding_cost_basis_after,
         holding_revision_before, holding_revision_after,
         cost_basis_removed, realized_gain, status,
         idempotency_key, payload_hash, posted_transaction_id,
         transaction_payload_hash, created_at, posted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, ?, NULL)`,
    ).bind(
      tradeId,
      context.classroom.id,
      stockId,
      stock.revision,
      stock.inventory_revision,
      inventoryRevisionAfter,
      market.revision,
      settings.revision,
      tradingStudentId,
      accounts.wallet.id,
      accounts.wallet.revision,
      walletRevisionAfter,
      order.side,
      order.quantity,
      referencePrice,
      spread,
      unitPrice,
      position.quote.grossAmount,
      feeBps,
      position.quote.feeAmount,
      position.quote.walletChange,
      stock.available_shares,
      availableAfter,
      position.quantityBefore,
      position.quantityAfter,
      position.totalCostBefore,
      position.totalCostAfter,
      holdingRevision,
      holdingRevisionAfter,
      position.costBasisRemoved,
      position.realizedProfit,
      order.idempotencyKey,
      payloadHash,
      now,
    );
  const ledgerStatements = transactionStatements(db, {
    transactionId,
    transaction,
    transactionPayloadHash,
    accounts: accountsById,
    now,
  });
  const transactionHeader = ledgerStatements[0];
  if (!transactionHeader) {
    throw new ApiError(500, "주식 원장 기록을 준비하지 못했습니다.", "FINANCE_STOCK_LEDGER_UNAVAILABLE");
  }
  const statements: D1PreparedStatement[] = options.teacherLiquidation
    ? [transactionHeader, tradeInsertStatement, ...ledgerStatements.slice(1)]
    : [tradeInsertStatement, ...ledgerStatements];
  if (holding) {
    statements.push(
      db.prepare(
        `UPDATE finance_stock_holdings
         SET quantity = ?, cost_basis = ?, revision = revision + 1,
             last_trade_id = ?, updated_at = ?
         WHERE id = ? AND class_id = ? AND revision = ?`,
      ).bind(
        position.quantityAfter,
        position.totalCostAfter,
        tradeId,
        now,
        holding.id,
        context.classroom.id,
        holdingRevision,
      ),
    );
  } else {
    statements.push(
      db.prepare(
        `INSERT INTO finance_stock_holdings (
           id, class_id, stock_id, student_id, wallet_account_id,
           quantity, cost_basis, revision, last_trade_id,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        context.classroom.id,
        stockId,
        tradingStudentId,
        accounts.wallet.id,
        position.quantityAfter,
        position.totalCostAfter,
        tradeId,
        now,
        now,
      ),
    );
  }
  statements.push(
    db.prepare(
      `UPDATE finance_stocks
       SET available_shares = ?, inventory_revision = inventory_revision + 1,
           last_trade_id = ?, updated_at = ?
       WHERE id = ? AND class_id = ? AND inventory_revision = ?`,
    ).bind(
      availableAfter,
      tradeId,
      now,
      stockId,
      context.classroom.id,
      stock.inventory_revision,
    ),
    db.prepare(
      `UPDATE finance_stock_trades
       SET status = 'posted', posted_transaction_id = ?,
           transaction_payload_hash = ?, posted_at = ?
       WHERE id = ? AND class_id = ? AND status = 'pending'`,
    ).bind(
      transactionId,
      transactionPayloadHash,
      now,
      tradeId,
      context.classroom.id,
    ),
  );
  if (liquidationChunk) {
    statements.push(
      db.prepare(
        `INSERT INTO finance_stock_liquidation_chunks (
           id, operation_id, class_id, chunk_index, trade_id,
           quantity, gross_amount, fee_amount, wallet_delta,
           cost_basis_removed, realized_gain,
           holding_quantity_before, holding_quantity_after,
           holding_cost_basis_before, holding_cost_basis_after, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        `${liquidationChunk.operation.id}:chunk:${liquidationChunk.chunkIndex}`,
        liquidationChunk.operation.id,
        context.classroom.id,
        liquidationChunk.chunkIndex,
        tradeId,
        order.quantity,
        position.quote.grossAmount,
        position.quote.feeAmount,
        position.quote.walletChange,
        position.costBasisRemoved,
        position.realizedProfit,
        position.quantityBefore,
        position.quantityAfter,
        position.totalCostBefore,
        position.totalCostAfter,
        now,
      ),
    );
  }
  try {
    await db.batch(statements);
  } catch (error) {
    const concurrent = await tradeByIdempotency(
      db,
      context.classroom.id,
      tradingStudentId,
      order.idempotencyKey,
    );
    if (concurrent) {
      if (concurrent.stock_id !== stockId || concurrent.payload_hash !== payloadHash) {
        throw new ApiError(409, "같은 거래 요청 번호가 다른 주문에 사용되었습니다.", "FINANCE_STOCK_IDEMPOTENCY_CONFLICT");
      }
      return { trade: serializeTrade(concurrent), deduplicated: true };
    }
    mapDatabaseError(error);
  }
  const saved = await tradeByIdempotency(
    db,
    context.classroom.id,
    tradingStudentId,
    order.idempotencyKey,
  );
  if (!saved) throw new ApiError(500, "체결한 주식 거래를 다시 확인하지 못했습니다.", "FINANCE_STOCK_TRADE_UNAVAILABLE");
  return { trade: serializeTrade(saved), deduplicated: false };
}

export async function liquidateFinanceStockHolding(
  request: Request,
  stockIdValue: unknown,
  input: Record<string, unknown>,
) {
  const context = await financeContextForRequest(request);
  assertTeacher(context);
  const stockId = requiredId(stockIdValue, "주식 ID");
  const studentId = requiredId(input.studentId, "학생 ID");
  const key = idempotencyKey(input.idempotencyKey);
  const reason = normalizedText(input.reason, "비상 청산 이유", 300);
  if (reason.length < 2) {
    throw new ApiError(
      400,
      "비상 청산 이유를 2자 이상 적어 주세요.",
      "FINANCE_STOCK_LIQUIDATION_REASON_REQUIRED",
    );
  }
  const origin = teacherLiquidationOrigin(input.origin);
  const expectedStock = expectedRevision(input.expectedStockRevision, "주식");
  const expectedMarket = expectedRevision(input.expectedMarketRevision, "주식시장");
  const expectedSettings = expectedRevision(
    input.expectedFinanceSettingsRevision,
    "학급화폐 설정",
  );
  const expectedHolding = expectedRevision(input.expectedHoldingRevision, "학생 보유 주식");
  const operationId = `stock-liquidation:${(await sha256(stableFinanceJson({
    classId: context.classroom.id,
    studentId,
    stockId,
    teacherId: context.actor.id,
    idempotencyKey: key,
  }))).slice(0, 48)}`;
  const db = database();
  const requestedOperationId = input.operationId === undefined
    ? null
    : requiredId(input.operationId, "비상 청산 작업 ID");
  const requestedOperationRevision = input.expectedOperationRevision === undefined
    ? 0
    : expectedRevision(input.expectedOperationRevision, "비상 청산 진행 상태");
  const operationPayloadHash = await sha256(stableFinanceJson({
    classId: context.classroom.id,
    stockId,
    studentId,
    teacherId: context.actor.id,
    rootIdempotencyKey: key,
    reason,
    origin,
  }));

  let operation = await stockLiquidationOperationByRootKey(
    db,
    context.classroom.id,
    key,
  );
  if (operation) {
    if (
      operation.payload_hash !== operationPayloadHash
      || operation.stock_id !== stockId
      || operation.student_id !== studentId
      || operation.teacher_id !== context.actor.id
    ) {
      throw new ApiError(
        409,
        "같은 비상 청산 요청 번호가 다른 작업에 사용되었습니다.",
        "FINANCE_STOCK_IDEMPOTENCY_CONFLICT",
      );
    }
    if (requestedOperationId && requestedOperationId !== operation.id) {
      throw new ApiError(
        409,
        "비상 청산 작업 번호가 현재 진행 중인 작업과 다릅니다.",
        "FINANCE_STOCK_LIQUIDATION_STALE",
      );
    }
    if (operation.status === "cancelled") {
      throw new ApiError(
        409,
        "취소된 비상 청산은 다시 이어서 처리할 수 없습니다.",
        "FINANCE_STOCK_LIQUIDATION_CANCELLED",
      );
    }
    if (requestedOperationRevision > Number(operation.revision)) {
      throw new ApiError(
        409,
        "비상 청산 진행 상태가 바뀌었습니다. 최신 진행률을 확인해 주세요.",
        "FINANCE_STOCK_LIQUIDATION_STALE",
      );
    }
    if (requestedOperationRevision < Number(operation.revision)) {
      const committedChunk = await stockLiquidationChunkByIndex(
        db,
        context.classroom.id,
        operation.id,
        requestedOperationRevision,
      );
      const committedTrade = committedChunk
        ? await tradeById(db, context.classroom.id, committedChunk.trade_id)
        : null;
      if (committedTrade) {
        return {
          trade: serializeTrade(committedTrade),
          operation: serializeStockLiquidationOperation(operation),
          chunksProcessed: 0,
          deduplicated: true,
        };
      }
      throw new ApiError(
        409,
        "비상 청산 진행 상태가 바뀌었습니다. 최신 진행률을 확인해 주세요.",
        "FINANCE_STOCK_LIQUIDATION_STALE",
      );
    }
    if (operation.status === "completed") {
      const completedTrade = operation.last_trade_id
        ? await tradeById(db, context.classroom.id, operation.last_trade_id)
        : null;
      if (!completedTrade) {
        throw new ApiError(
          500,
          "완료된 비상 청산의 마지막 거래를 확인하지 못했습니다.",
          "FINANCE_STOCK_LIQUIDATION_UNAVAILABLE",
        );
      }
      return {
        trade: serializeTrade(completedTrade),
        operation: serializeStockLiquidationOperation(operation),
        chunksProcessed: 0,
        deduplicated: true,
      };
    }
  } else {
    if (requestedOperationId || requestedOperationRevision !== 0) {
      throw new ApiError(
        409,
        "이어갈 비상 청산 작업을 찾지 못했습니다.",
        "FINANCE_STOCK_LIQUIDATION_STALE",
      );
    }

    // Preserve the original one-transaction behavior for positions whose gross
    // proceeds already fit within a single ledger-safe trade.
    const replaySmallLiquidation = (trade: TradeRow) => tradeFinanceStock(
      request,
      stockId,
      {
        side: "sell",
        quantity: Number(trade.quantity),
        expectedStockRevision: expectedStock,
        expectedMarketRevision: expectedMarket,
        expectedFinanceSettingsRevision: expectedSettings,
        expectedHoldingRevision: expectedHolding,
        expectedWalletRevision: Number(trade.wallet_revision_before),
        idempotencyKey: key,
      },
      {
        teacherLiquidation: { studentId, reason, origin, operationId },
      },
    );
    const duplicate = await tradeByIdempotency(
      db,
      context.classroom.id,
      studentId,
      key,
    );
    if (duplicate) {
      return replaySmallLiquidation(duplicate);
    }

    const [market, stock, settings, holding, accounts, targetStudent] = await Promise.all([
      marketForClass(db, context.classroom.id),
      stockById(db, context.classroom.id, stockId),
      financeSettingsForClass(context.classroom.id),
      holdingForStudent(db, context.classroom.id, stockId, studentId),
      accountRows(db, context.classroom.id, studentId),
      db.prepare(
        `SELECT id, status FROM students
         WHERE id = ? AND class_id = ? LIMIT 1`,
      ).bind(studentId, context.classroom.id).first<StudentStatusRow>(),
    ]);
    const concurrentDuplicate = await tradeByIdempotency(
      db,
      context.classroom.id,
      studentId,
      key,
    );
    if (concurrentDuplicate) {
      return replaySmallLiquidation(concurrentDuplicate);
    }
    if (!market || !stock) {
      throw new ApiError(404, "우리 반 주식을 찾지 못했습니다.", "FINANCE_STOCK_NOT_FOUND");
    }
    if (!holding || Number(holding.quantity) <= 0) {
      throw new ApiError(409, "이 학생이 보유한 주식이 없습니다.", "FINANCE_STOCK_NO_HOLDINGS");
    }
    const wallet = accounts.wallet;
    if (
      wallet.status !== "active"
      || !targetStudent
      || !TEACHER_LIQUIDATION_STUDENT_STATUSES.has(targetStudent.status)
    ) {
      throw new ApiError(
        409,
        "현재 이 학생의 지갑이나 계정 상태로는 비상 청산을 시작할 수 없습니다.",
        "FINANCE_STOCK_LIQUIDATION_STUDENT_UNAVAILABLE",
      );
    }
    if (stock.status === "archived") {
      throw new ApiError(
        409,
        "보관된 종목은 비상 청산할 수 없습니다.",
        "FINANCE_STOCK_IMMUTABLE",
      );
    }
    if (
      Number(stock.revision) !== expectedStock
      || Number(market.revision) !== expectedMarket
      || settings.revision !== expectedSettings
      || Number(holding.revision) !== expectedHolding
    ) {
      throw new ApiError(
        409,
        "시세·수수료·학급화폐 설정 또는 학생 보유량이 바뀌었습니다. 최신 지급 예정액을 다시 확인해 주세요.",
        "FINANCE_STOCK_TRADE_STALE",
      );
    }

    const denominationStep = Math.min(...settings.denominations);
    const referencePrice = Number(stock.current_price);
    const sellSpread = Number(market.sell_spread);
    let unitPrice: number;
    let totals: ReturnType<typeof calculateFinanceStockLiquidationTotals>;
    try {
      unitPrice = calculateFinanceStockExecutionPrice({
        side: "sell",
        currentPrice: referencePrice,
        buySpread: market.buy_spread,
        sellSpread,
        denominationStep,
      }).unitPrice;
      totals = calculateFinanceStockLiquidationTotals({
        quantity: holding.quantity,
        unitPrice,
        feeBps: market.sell_fee_bps,
        denominationStep,
      });
    } catch (error) {
      ruleError(error);
    }

    const payoutHeadroom = BigInt(MAX_FINANCE_AMOUNT - Number(wallet.balance));
    if (totals.payoutAmount > payoutHeadroom) {
      throw new ApiError(
        409,
        "청산 예정액을 모두 지급하면 학생 지갑 한도를 넘습니다. 지갑 여유를 만들거나 주가를 낮춘 뒤 다시 확인해 주세요.",
        "FINANCE_STOCK_LIQUIDATION_PAYOUT_LIMIT",
      );
    }
    const issuanceHeadroom = BigInt(
      MAX_FINANCE_AMOUNT + Number(accounts.issuance.balance),
    );
    if (totals.payoutAmount > issuanceHeadroom) {
      throw new ApiError(
        409,
        "학급 금융 원장의 안전 한도 때문에 이 청산액을 한 번에 예약할 수 없습니다. 주가를 낮춘 뒤 다시 확인해 주세요.",
        "FINANCE_STOCK_LIQUIDATION_ISSUANCE_LIMIT",
      );
    }
    if (totals.grossAmount <= BigInt(MAX_FINANCE_AMOUNT)) {
      return tradeFinanceStock(request, stockId, {
        side: "sell",
        quantity: Number(holding.quantity),
        expectedStockRevision: expectedStock,
        expectedMarketRevision: expectedMarket,
        expectedFinanceSettingsRevision: settings.revision,
        expectedHoldingRevision: expectedHolding,
        expectedWalletRevision: Number(wallet.revision),
        idempotencyKey: key,
      }, {
        teacherLiquidation: { studentId, reason, origin, operationId },
      });
    }
    if (
      totals.chunkCount > 2
      || totals.grossAmount > BigInt(Number.MAX_SAFE_INTEGER)
      || totals.feeAmount > BigInt(Number.MAX_SAFE_INTEGER)
      || totals.payoutAmount > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new ApiError(
        409,
        "이 보유량은 한 번의 비상 청산 작업으로 안전하게 처리할 수 없습니다. 주가를 낮춘 뒤 다시 시도해 주세요.",
        "FINANCE_STOCK_LIQUIDATION_TOO_LARGE",
      );
    }

    const now = Date.now();
    try {
      await db.prepare(
        `INSERT INTO finance_stock_liquidation_operations (
           id, class_id, stock_id, student_id, teacher_id,
           root_idempotency_key, payload_hash, origin, intervention_reason,
           status, snapshot_reference_price, snapshot_spread,
           snapshot_unit_price, snapshot_fee_bps,
           snapshot_denomination_step, snapshot_stock_revision,
           snapshot_market_revision, snapshot_finance_settings_revision,
           snapshot_holding_revision, snapshot_wallet_revision,
           snapshot_wallet_balance, snapshot_student_status,
           snapshot_stock_status, snapshot_market_was_open,
           initial_quantity, remaining_quantity, sold_quantity,
           initial_cost_basis, remaining_cost_basis,
           expected_gross_amount, expected_fee_amount, expected_wallet_delta,
           completed_chunk_count, total_gross_amount, total_fee_amount,
           total_wallet_delta, total_cost_basis_removed, total_realized_gain,
           next_chunk_index, last_trade_id, revision,
           created_at, updated_at, completed_at, cancelled_at,
           cancellation_reason, cancellation_idempotency_key,
           cancellation_payload_hash
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?,
                   ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0, 0, 0, 0,
                   0, 0, 0, NULL, 0, ?, ?, NULL, NULL, NULL, NULL, NULL)`,
      ).bind(
        operationId,
        context.classroom.id,
        stockId,
        studentId,
        context.actor.id,
        key,
        operationPayloadHash,
        origin,
        reason,
        referencePrice,
        sellSpread,
        unitPrice,
        Number(market.sell_fee_bps),
        denominationStep,
        Number(stock.revision),
        Number(market.revision),
        settings.revision,
        Number(holding.revision),
        Number(wallet.revision),
        Number(wallet.balance),
        targetStudent.status,
        stock.status,
        Number(Boolean(market.is_open)),
        Number(holding.quantity),
        Number(holding.quantity),
        Number(holding.cost_basis),
        Number(holding.cost_basis),
        Number(totals.grossAmount),
        Number(totals.feeAmount),
        Number(totals.payoutAmount),
        now,
        now,
      ).run();
    } catch (error) {
      const concurrent = await stockLiquidationOperationByRootKey(
        db,
        context.classroom.id,
        key,
      );
      if (!concurrent || concurrent.payload_hash !== operationPayloadHash) {
        mapDatabaseError(error);
      }
    }
    operation = await stockLiquidationOperationByRootKey(
      db,
      context.classroom.id,
      key,
    );
    if (!operation) {
      throw new ApiError(
        500,
        "비상 청산 진행 기록을 준비하지 못했습니다.",
        "FINANCE_STOCK_LIQUIDATION_UNAVAILABLE",
      );
    }
  }

  const reconciledProgress = await reconcileStockLiquidationProgress(
    db,
    context.classroom.id,
    operation.id,
    requestedOperationRevision,
  );
  operation = reconciledProgress.operation;
  if (reconciledProgress.result) return reconciledProgress.result;

  const [liveMarket, liveStock, liveSettings, liveHolding, liveWallet] = await Promise.all([
    marketForClass(db, context.classroom.id),
    stockById(db, context.classroom.id, stockId),
    financeSettingsForClass(context.classroom.id),
    holdingForStudent(db, context.classroom.id, stockId, studentId),
    db.prepare(
      `SELECT id, class_id, student_id, account_type, balance, revision, status
       FROM finance_accounts
       WHERE class_id = ? AND student_id = ? AND account_type = 'student_wallet'
       LIMIT 1`,
    ).bind(context.classroom.id, studentId).first<AccountRow>(),
  ]);
  if (!liveMarket || !liveStock || !liveHolding || !liveWallet) {
    const latestProgress = await reconcileStockLiquidationProgress(
      db,
      context.classroom.id,
      operation.id,
      requestedOperationRevision,
    );
    if (latestProgress.result) return latestProgress.result;
    throw new ApiError(
      409,
      "비상 청산에 필요한 현재 주식 또는 지갑 기록을 찾지 못했습니다.",
      "FINANCE_STOCK_LIQUIDATION_STALE",
    );
  }
  if (
    Number(liveHolding.quantity) !== Number(operation.remaining_quantity)
    || Number(liveHolding.cost_basis) !== Number(operation.remaining_cost_basis)
    || Number(liveWallet.balance)
      !== Number(operation.snapshot_wallet_balance) + Number(operation.total_wallet_delta)
  ) {
    const latestProgress = await reconcileStockLiquidationProgress(
      db,
      context.classroom.id,
      operation.id,
      requestedOperationRevision,
    );
    if (latestProgress.result) return latestProgress.result;
    throw new ApiError(
      409,
      "비상 청산 중인 보유 주식 또는 지갑 기록이 예상과 다릅니다. 작업을 취소하고 기록을 확인해 주세요.",
      "FINANCE_STOCK_LIQUIDATION_PROJECTION_MISMATCH",
    );
  }

  let nextChunk: ReturnType<typeof calculateFinanceStockLiquidationChunk>;
  try {
    nextChunk = calculateFinanceStockLiquidationChunk({
      remainingQuantity: operation.remaining_quantity,
      remainingCostBasis: operation.remaining_cost_basis,
      unitPrice: operation.snapshot_unit_price,
      feeBps: operation.snapshot_fee_bps,
      denominationStep: operation.snapshot_denomination_step,
    });
  } catch (error) {
    ruleError(error);
  }
  const chunkIndex = Number(operation.next_chunk_index);
  const chunkIdempotencyKey = `${operation.id}:chunk:${chunkIndex}`;
  try {
    const tradeResult = await tradeFinanceStock(request, stockId, {
      side: "sell",
      quantity: nextChunk.quantity,
      expectedStockRevision: Number(liveStock.revision),
      expectedMarketRevision: Number(liveMarket.revision),
      expectedFinanceSettingsRevision: liveSettings.revision,
      expectedHoldingRevision: Number(liveHolding.revision),
      expectedWalletRevision: Number(liveWallet.revision),
      idempotencyKey: chunkIdempotencyKey,
    }, {
      teacherLiquidation: {
        studentId,
        reason: operation.intervention_reason,
        origin: operation.origin as TeacherLiquidationOrigin,
        operationId: operation.id,
        chunk: { operation, chunkIndex },
      },
    });
    const savedOperation = await stockLiquidationOperationById(
      db,
      context.classroom.id,
      operation.id,
    );
    const savedChunk = await stockLiquidationChunkByIndex(
      db,
      context.classroom.id,
      operation.id,
      chunkIndex,
    );
    if (!savedOperation || !savedChunk) {
      throw new ApiError(
        503,
        "거래는 완료되지 않았습니다. 최신 진행률을 불러온 뒤 같은 작업을 다시 이어 주세요.",
        "FINANCE_STOCK_LIQUIDATION_RETRY_REQUIRED",
      );
    }
    return {
      trade: tradeResult.trade,
      operation: serializeStockLiquidationOperation(savedOperation),
      chunksProcessed: tradeResult.deduplicated ? 0 : 1,
      deduplicated: tradeResult.deduplicated,
    };
  } catch (error) {
    const [committedChunk, savedOperation] = await Promise.all([
      stockLiquidationChunkByIndex(
        db,
        context.classroom.id,
        operation.id,
        chunkIndex,
      ),
      stockLiquidationOperationById(db, context.classroom.id, operation.id),
    ]);
    if (committedChunk && savedOperation) {
      const committedTrade = await tradeById(
        db,
        context.classroom.id,
        committedChunk.trade_id,
      );
      if (committedTrade) {
        return {
          trade: serializeTrade(committedTrade),
          operation: serializeStockLiquidationOperation(savedOperation),
          chunksProcessed: 0,
          deduplicated: true,
        };
      }
    }
    if (savedOperation?.status === "cancelled") {
      throw new ApiError(
        409,
        "이 비상 청산 작업은 다른 화면에서 취소되었습니다.",
        "FINANCE_STOCK_LIQUIDATION_CANCELLED",
      );
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      503,
      "청산 거래가 반영되지 않았습니다. 최신 진행률을 불러온 뒤 같은 작업을 다시 이어 주세요.",
      "FINANCE_STOCK_LIQUIDATION_RETRY_REQUIRED",
    );
  }
}

export async function cancelFinanceStockLiquidation(
  request: Request,
  operationIdValue: unknown,
  input: Record<string, unknown>,
) {
  const context = await financeContextForRequest(request);
  assertTeacher(context);
  const operationId = requiredId(operationIdValue, "비상 청산 작업 ID");
  const revision = expectedRevision(
    input.expectedOperationRevision,
    "비상 청산 진행 상태",
  );
  const reason = normalizedText(input.reason, "취소 이유", 300);
  if (reason.length < 2) {
    throw new ApiError(
      400,
      "취소 이유를 2자 이상 적어 주세요.",
      "FINANCE_STOCK_LIQUIDATION_REASON_REQUIRED",
    );
  }
  const key = idempotencyKey(input.idempotencyKey);
  const payloadHash = await sha256(stableFinanceJson({
    classId: context.classroom.id,
    operationId,
    expectedOperationRevision: revision,
    reason,
  }));
  const db = database();
  const duplicate = await stockLiquidationOperationByCancellationKey(
    db,
    context.classroom.id,
    key,
  );
  if (duplicate) {
    if (
      duplicate.id !== operationId
      || duplicate.cancellation_payload_hash !== payloadHash
    ) {
      throw new ApiError(
        409,
        "같은 취소 요청 번호가 다른 작업에 사용되었습니다.",
        "FINANCE_STOCK_IDEMPOTENCY_CONFLICT",
      );
    }
    return {
      operation: serializeStockLiquidationOperation(duplicate),
      deduplicated: true,
    };
  }
  const operation = await stockLiquidationOperationById(
    db,
    context.classroom.id,
    operationId,
  );
  if (!operation) {
    throw new ApiError(
      404,
      "비상 청산 작업을 찾지 못했습니다.",
      "FINANCE_STOCK_LIQUIDATION_NOT_FOUND",
    );
  }
  if (operation.status === "completed") {
    throw new ApiError(
      409,
      "이미 완료된 비상 청산은 취소할 수 없습니다.",
      "FINANCE_STOCK_LIQUIDATION_COMPLETED",
    );
  }
  if (operation.status === "cancelled") {
    throw new ApiError(
      409,
      "이미 취소된 비상 청산입니다.",
      "FINANCE_STOCK_LIQUIDATION_CANCELLED",
    );
  }
  if (Number(operation.revision) !== revision) {
    throw new ApiError(
      409,
      "비상 청산 진행 상태가 바뀌었습니다. 최신 진행률을 확인해 주세요.",
      "FINANCE_STOCK_LIQUIDATION_STALE",
    );
  }
  const now = Date.now();
  let cancelledByThisRequest = false;
  try {
    const result = await db.prepare(
      `UPDATE finance_stock_liquidation_operations
       SET status = 'cancelled', revision = revision + 1,
           cancellation_reason = ?, cancellation_idempotency_key = ?,
           cancellation_payload_hash = ?, cancelled_at = ?, updated_at = ?
       WHERE id = ? AND class_id = ? AND status = 'running' AND revision = ?`,
    ).bind(
      reason,
      key,
      payloadHash,
      now,
      now,
      operationId,
      context.classroom.id,
      revision,
    ).run();
    cancelledByThisRequest = Boolean(result.meta.changes);
  } catch (error) {
    const concurrent = await stockLiquidationOperationByCancellationKey(
      db,
      context.classroom.id,
      key,
    );
    if (
      concurrent
      && concurrent.id === operationId
      && concurrent.cancellation_payload_hash === payloadHash
    ) {
      return {
        operation: serializeStockLiquidationOperation(concurrent),
        deduplicated: true,
      };
    }
    mapDatabaseError(error);
  }
  if (!cancelledByThisRequest) {
    const concurrent = await stockLiquidationOperationByCancellationKey(
      db,
      context.classroom.id,
      key,
    );
    if (
      concurrent
      && concurrent.id === operationId
      && concurrent.cancellation_payload_hash === payloadHash
    ) {
      return {
        operation: serializeStockLiquidationOperation(concurrent),
        deduplicated: true,
      };
    }
    throw new ApiError(
      409,
      "비상 청산 진행 상태가 바뀌었습니다. 최신 진행률을 확인해 주세요.",
      "FINANCE_STOCK_LIQUIDATION_STALE",
    );
  }
  const saved = await stockLiquidationOperationById(
    db,
    context.classroom.id,
    operationId,
  );
  if (
    !saved
    || saved.status !== "cancelled"
    || saved.cancellation_idempotency_key !== key
    || saved.cancellation_payload_hash !== payloadHash
  ) {
    throw new ApiError(
      409,
      "비상 청산 진행 상태가 바뀌었습니다. 최신 진행률을 확인해 주세요.",
      "FINANCE_STOCK_LIQUIDATION_STALE",
    );
  }
  return {
    operation: serializeStockLiquidationOperation(saved),
    deduplicated: false,
  };
}

async function newsById(db: D1Database, classId: string, newsId: string) {
  return db.prepare(
    `SELECT id, class_id, title, content, impact_bps, status, revision,
            idempotency_key, payload_hash,
            cancellation_idempotency_key, cancellation_payload_hash,
            cancellation_reason, created_at, expires_at, cancelled_at, updated_at
     FROM finance_stock_news
     WHERE class_id = ? AND id = ? LIMIT 1`,
  ).bind(classId, newsId).first<NewsRow>();
}

async function newsByCreateKey(db: D1Database, classId: string, key: string) {
  return db.prepare(
    `SELECT id, class_id, title, content, impact_bps, status, revision,
            idempotency_key, payload_hash,
            cancellation_idempotency_key, cancellation_payload_hash,
            cancellation_reason, created_at, expires_at, cancelled_at, updated_at
     FROM finance_stock_news
     WHERE class_id = ? AND idempotency_key = ? LIMIT 1`,
  ).bind(classId, key).first<NewsRow>();
}

async function newsByCancellationKey(db: D1Database, classId: string, key: string) {
  return db.prepare(
    `SELECT id, class_id, title, content, impact_bps, status, revision,
            idempotency_key, payload_hash,
            cancellation_idempotency_key, cancellation_payload_hash,
            cancellation_reason, created_at, expires_at, cancelled_at, updated_at
     FROM finance_stock_news
     WHERE class_id = ? AND cancellation_idempotency_key = ? LIMIT 1`,
  ).bind(classId, key).first<NewsRow>();
}

export async function createFinanceStockNews(
  request: Request,
  input: Record<string, unknown>,
) {
  const context = await financeContextForRequest(request);
  assertTeacher(context);
  const title = normalizedText(input.title, "뉴스 제목", 80);
  const content = normalizedText(input.content, "뉴스 내용", 500);
  const impactBps = integerInRange(input.impactBps ?? 0, "가격 영향", -1_000, 1_000);
  const durationMinutes = integerInRange(
    input.durationMinutes ?? 120,
    "뉴스 유지 시간",
    5,
    1_440,
  );
  const key = idempotencyKey(input.idempotencyKey);
  const payloadHash = await sha256(stableFinanceJson({
    classId: context.classroom.id,
    title,
    content,
    impactBps,
    durationMinutes,
  }));
  const db = database();
  const duplicate = await newsByCreateKey(db, context.classroom.id, key);
  if (duplicate) {
    if (duplicate.payload_hash !== payloadHash) {
      throw new ApiError(409, "같은 저장 요청이 다른 뉴스에 사용되었습니다.", "FINANCE_STOCK_IDEMPOTENCY_CONFLICT");
    }
    return { news: serializeNews(duplicate, Date.now()), deduplicated: true };
  }
  const now = Date.now();
  const expiresAt = now + (durationMinutes * 60_000);
  const newsId = crypto.randomUUID();
  try {
    await db.prepare(
      `INSERT INTO finance_stock_news (
         id, class_id, title, content, impact_bps, status, revision,
         idempotency_key, payload_hash, created_by_teacher_id,
         updated_by_actor_type, updated_by_teacher_id,
         cancellation_reason, cancellation_idempotency_key,
         cancellation_payload_hash, created_at, expires_at,
         cancelled_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?, ?,
                 'teacher', ?, NULL, NULL, NULL, ?, ?, NULL, ?)`,
    ).bind(
      newsId,
      context.classroom.id,
      title,
      content,
      impactBps,
      key,
      payloadHash,
      context.actor.id,
      context.actor.id,
      now,
      expiresAt,
      now,
    ).run();
  } catch (error) {
    const concurrent = await newsByCreateKey(db, context.classroom.id, key);
    if (concurrent && concurrent.payload_hash === payloadHash) {
      return { news: serializeNews(concurrent, Date.now()), deduplicated: true };
    }
    mapDatabaseError(error);
  }
  const saved = await newsById(db, context.classroom.id, newsId);
  if (!saved) throw new ApiError(500, "저장한 주식 뉴스를 찾지 못했습니다.", "FINANCE_STOCK_NEWS_UNAVAILABLE");
  return { news: serializeNews(saved, now), deduplicated: false };
}

export async function closeFinanceStockNews(
  request: Request,
  input: Record<string, unknown>,
) {
  const context = await financeContextForRequest(request);
  assertTeacher(context);
  const newsId = requiredId(input.newsId, "뉴스 ID");
  const revision = expectedRevision(input.expectedRevision, "뉴스");
  const reason = normalizedText(input.reason ?? "교사가 뉴스를 내렸습니다.", "취소 이유", 300);
  const key = idempotencyKey(input.idempotencyKey);
  const payloadHash = await sha256(stableFinanceJson({
    classId: context.classroom.id,
    newsId,
    expectedRevision: revision,
    reason,
  }));
  const db = database();
  const duplicate = await newsByCancellationKey(db, context.classroom.id, key);
  if (duplicate) {
    if (duplicate.id !== newsId || duplicate.cancellation_payload_hash !== payloadHash) {
      throw new ApiError(409, "같은 저장 요청이 다른 뉴스 취소에 사용되었습니다.", "FINANCE_STOCK_IDEMPOTENCY_CONFLICT");
    }
    return { news: serializeNews(duplicate, Date.now()), deduplicated: true };
  }
  const current = await newsById(db, context.classroom.id, newsId);
  if (!current) throw new ApiError(404, "주식 뉴스를 찾지 못했습니다.", "FINANCE_STOCK_NEWS_NOT_FOUND");
  if (current.status !== "active") {
    throw new ApiError(409, "이미 종료된 뉴스입니다.", "FINANCE_STOCK_NEWS_CLOSED");
  }
  if (Number(current.revision) !== revision) {
    throw new ApiError(409, "뉴스 상태가 다른 화면에서 바뀌었습니다.", "FINANCE_STOCK_NEWS_STALE");
  }
  const now = Date.now();
  let changed = false;
  try {
    const update = await db.prepare(
      `UPDATE finance_stock_news
       SET status = 'cancelled', revision = revision + 1,
           updated_by_actor_type = 'teacher', updated_by_teacher_id = ?,
           cancellation_reason = ?, cancellation_idempotency_key = ?,
           cancellation_payload_hash = ?, cancelled_at = ?, updated_at = ?
       WHERE id = ? AND class_id = ? AND revision = ? AND status = 'active'`,
    ).bind(
      context.actor.id,
      reason,
      key,
      payloadHash,
      now,
      now,
      newsId,
      context.classroom.id,
      revision,
    ).run();
    changed = Number(update.meta.changes ?? 0) === 1;
  } catch (error) {
    const concurrent = await newsByCancellationKey(db, context.classroom.id, key);
    if (concurrent && concurrent.id === newsId && concurrent.cancellation_payload_hash === payloadHash) {
      return { news: serializeNews(concurrent, Date.now()), deduplicated: true };
    }
    mapDatabaseError(error);
  }
  if (!changed) {
    const concurrent = await newsByCancellationKey(db, context.classroom.id, key);
    if (
      concurrent
      && concurrent.id === newsId
      && concurrent.cancellation_payload_hash === payloadHash
    ) {
      return { news: serializeNews(concurrent, Date.now()), deduplicated: true };
    }
    const latest = await newsById(db, context.classroom.id, newsId);
    if (!latest) {
      throw new ApiError(404, "주식 뉴스를 찾지 못했습니다.", "FINANCE_STOCK_NEWS_NOT_FOUND");
    }
    if (latest.status !== "active") {
      throw new ApiError(409, "이미 종료된 뉴스입니다.", "FINANCE_STOCK_NEWS_CLOSED");
    }
    throw new ApiError(
      409,
      "뉴스 상태가 다른 화면에서 바뀌었습니다.",
      "FINANCE_STOCK_NEWS_STALE",
    );
  }
  const saved = await newsById(db, context.classroom.id, newsId);
  if (
    !saved
    || saved.status !== "cancelled"
    || saved.cancellation_idempotency_key !== key
    || saved.cancellation_payload_hash !== payloadHash
  ) {
    throw new ApiError(
      409,
      "뉴스 상태가 다른 화면에서 바뀌었습니다.",
      "FINANCE_STOCK_NEWS_STALE",
    );
  }
  return { news: serializeNews(saved, now), deduplicated: false };
}

async function expireFinanceStockNews(
  db: D1Database,
  now: number,
  classId: string | undefined,
  limit: number,
) {
  // Expire the bounded set in one D1 call. The outer status check makes a
  // concurrent cancellation harmless even if it runs after the subquery.
  const update = await db.prepare(
    `UPDATE finance_stock_news
     SET status = 'expired', revision = revision + 1,
         updated_by_actor_type = 'system', updated_by_teacher_id = NULL,
         updated_at = ?
     WHERE status = 'active' AND id IN (
       SELECT id
       FROM finance_stock_news
       WHERE status = 'active' AND expires_at <= ?
         AND (? IS NULL OR class_id = ?)
       ORDER BY expires_at, id
       LIMIT ?
     )`,
  ).bind(
    now,
    now,
    classId ?? null,
    classId ?? null,
    limit,
  ).run();
  return Number(update.meta.changes ?? 0);
}

function moodBiasBps(mood: string) {
  if (mood === "surge") return 450;
  if (mood === "bull") return 180;
  if (mood === "bear") return -180;
  if (mood === "crash") return -450;
  return 0;
}

async function deterministicNoiseBps(seed: string) {
  const digest = await sha256(seed);
  let value = 0;
  for (let index = 0; index < Math.min(8, digest.length); index += 1) {
    value = ((value * 37) + digest.charCodeAt(index)) >>> 0;
  }
  return (value % 301) - 150;
}

type StockTickPayloadInput = {
  classId: string;
  stockId: string;
  stockRevision: number;
  marketRevision: number;
  actorType: "teacher" | "system";
  actorTeacherId: string | null;
  requestedAction: "price_changed" | "automatic_tick" | "news_tick";
};

function stockTickNewsFingerprint(news: TickNewsRow[]) {
  return news
    .map((item) => ({
      newsId: item.id,
      newsRevision: Number(item.revision),
      impactBps: Number(item.impact_bps),
      payloadHash: item.payload_hash,
    }))
    .sort((left, right) => (
      left.newsId === right.newsId ? 0 : left.newsId < right.newsId ? -1 : 1
    ));
}

async function stockTickPayloadHash(
  input: StockTickPayloadInput,
  news: TickNewsRow[] = [],
) {
  const fingerprint = stockTickNewsFingerprint(news);
  return sha256(stableFinanceJson(
    fingerprint.length > 0 ? { ...input, news: fingerprint } : input,
  ));
}

async function newsAppliedToStockEvent(
  db: D1Database,
  stockEventId: string,
) {
  return db.prepare(
    `SELECT news_id AS id, news_revision AS revision,
            impact_bps, news_payload_hash AS payload_hash, link_status
     FROM finance_stock_news_applications
     WHERE stock_event_id = ?
     ORDER BY news_id`,
  ).bind(stockEventId).all<TickNewsRow>();
}

async function stockTickEventMatchesPayload(
  db: D1Database,
  event: StockEventRow,
  input: StockTickPayloadInput,
) {
  const linkedNews = (await newsAppliedToStockEvent(db, event.id)).results;
  if (event.payload_hash === await stockTickPayloadHash(input, linkedNews)) {
    return true;
  }
  return linkedNews.every((news) => news.link_status === "legacy_inferred")
    && event.payload_hash === await stockTickPayloadHash(input);
}

export const FINANCE_STOCK_NEWS_PER_TICK_LIMIT = 20;

async function unappliedNewsForStockTick(
  db: D1Database,
  input: { classId: string; stockId: string; now: number },
) {
  return db.prepare(
    `SELECT news.id, news.revision, news.impact_bps, news.payload_hash
     FROM finance_stock_news news
     WHERE news.class_id = ? AND news.status = 'active'
       AND news.created_at <= ? AND news.expires_at > ?
       AND NOT EXISTS (
         SELECT 1 FROM finance_stock_news_applications application
         WHERE application.stock_id = ? AND application.news_id = news.id
       )
     ORDER BY news.created_at, news.id
     LIMIT ?`,
  ).bind(
    input.classId,
    input.now,
    input.now,
    input.stockId,
    FINANCE_STOCK_NEWS_PER_TICK_LIMIT,
  ).all<TickNewsRow>();
}

function roundedStockPrice(
  currentPrice: number,
  changeBps: number,
  step: number,
  sellSpread: number,
  buySpread: number,
) {
  const raw = currentPrice + Math.trunc((currentPrice * changeBps) / 10_000);
  const next = Math.round(raw / step) * step;
  const minimum = Math.ceil((sellSpread + step) / step) * step;
  const maximum = Math.floor((MAX_FINANCE_AMOUNT - buySpread) / step) * step;
  return Math.max(minimum, Math.min(maximum, next));
}

async function tickStockWithDb(
  db: D1Database,
  input: {
    market: MarketRow;
    stock: StockRow;
    now: number;
    idempotencyKey: string;
    actorType: "teacher" | "system";
    actorTeacherId: string | null;
    action: "price_changed" | "automatic_tick" | "news_tick";
    reasonPrefix: string;
  },
) {
  const tickPayloadInput: StockTickPayloadInput = {
    classId: input.stock.class_id,
    stockId: input.stock.id,
    stockRevision: Number(input.stock.revision),
    marketRevision: Number(input.market.revision),
    actorType: input.actorType,
    actorTeacherId: input.actorTeacherId,
    requestedAction: input.action,
  };
  const duplicate = await stockEventByIdempotency(
    db,
    input.stock.class_id,
    input.idempotencyKey,
  );
  if (duplicate) {
    if (
      duplicate.stock_id !== input.stock.id
      || !(await stockTickEventMatchesPayload(db, duplicate, tickPayloadInput))
      || duplicate.actor_type !== input.actorType
      || (duplicate.action !== input.action && duplicate.action !== "news_tick")
    ) {
      throw new ApiError(
        409,
        "같은 시세 갱신 번호가 다른 작업에 사용되었습니다.",
        "FINANCE_STOCK_IDEMPOTENCY_CONFLICT",
      );
    }
    const saved = await stockById(db, input.stock.class_id, input.stock.id);
    if (!saved) throw new ApiError(500, "갱신한 주가를 찾지 못했습니다.", "FINANCE_STOCK_UNAVAILABLE");
    return {
      stock: saved,
      deduplicated: true,
      skipped: stockTickEventWasSkipped(duplicate),
    };
  }
  const step = await denominationStepForClass(db, input.stock.class_id);
  const [newsResult, recentFlow, maximumHolding] = await Promise.all([
    unappliedNewsForStockTick(db, {
      classId: input.stock.class_id,
      stockId: input.stock.id,
      now: input.now,
    }),
    db.prepare(
      `SELECT COALESCE(SUM(CASE side WHEN 'buy' THEN quantity ELSE -quantity END), 0) AS flow,
              COALESCE(SUM(quantity), 0) AS volume
       FROM finance_stock_trades
       WHERE class_id = ? AND stock_id = ? AND status = 'posted'
         AND posted_at >= ?`,
    ).bind(
      input.stock.class_id,
      input.stock.id,
      input.now - (Number(input.market.tick_interval_minutes) * 60_000),
    ).first<{ flow: number; volume: number }>(),
    db.prepare(
      `SELECT COALESCE(MAX(quantity), 0) AS maximum_quantity
       FROM finance_stock_holdings
       WHERE class_id = ? AND stock_id = ? AND quantity > 0`,
    ).bind(
      input.stock.class_id,
      input.stock.id,
    ).first<{ maximum_quantity: number }>(),
  ]);
  const applicableNews = newsResult.results;
  const payloadHash = await stockTickPayloadHash(tickPayloadInput, applicableNews);
  const newsImpactBps = applicableNews.reduce(
    (sum, news) => sum + Number(news.impact_bps),
    0,
  );
  const volume = Number(recentFlow?.volume ?? 0);
  const flowBps = volume > 0
    ? Math.max(-200, Math.min(200, Math.round((Number(recentFlow?.flow ?? 0) * 200) / volume)))
    : 0;
  const noiseBps = await deterministicNoiseBps(
    `${input.stock.class_id}:${input.stock.id}:${input.market.next_tick_at ?? input.now}:${input.stock.revision}:${input.idempotencyKey}`,
  );
  const changeBps = Math.max(-1_000, Math.min(1_000,
    moodBiasBps(input.market.market_mood)
      + noiseBps
      + flowBps
      + Math.max(-500, Math.min(500, newsImpactBps)),
  ));
  const nextPrice = roundedStockPrice(
    Number(input.stock.current_price),
    changeBps,
    step,
    Number(input.market.sell_spread),
    Number(input.market.buy_spread),
  );
  const effectivePrice = limitFinanceStockPriceIncrease({
    currentPrice: input.stock.current_price,
    candidatePrice: nextPrice,
    maximumHoldingQuantity: Number(maximumHolding?.maximum_quantity ?? 0),
    denominationStep: step,
  });
  const nextTickAt = Math.max(
    input.now,
    Number(input.market.next_tick_at ?? input.now),
  ) + (Number(input.market.tick_interval_minutes) * 60_000);
  const skipped = effectivePrice === Number(input.stock.current_price);
  const appliedChangeBps = Math.round(
    ((effectivePrice - Number(input.stock.current_price)) * 10_000)
      / Number(input.stock.current_price),
  );
  const reason = `${input.reasonPrefix} · ${input.market.market_mood} · 계산 신호 ${(changeBps / 100).toFixed(2)}% · 실제 변동 ${(appliedChangeBps / 100).toFixed(2)}%`;
  const eventAction = applicableNews.length > 0
    ? "news_tick"
    : input.action;
  const nextStock: StockRow = {
    ...input.stock,
    previous_price: skipped
      ? Number(input.stock.previous_price)
      : Number(input.stock.current_price),
    current_price: effectivePrice,
    revision: Number(input.stock.revision) + 1,
    updated_at: input.now,
  };
  const stockEventId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE finance_stocks
       SET current_price = ?, previous_price = ?, revision = revision + 1,
           updated_by_actor_type = ?, updated_by_teacher_id = ?, updated_at = ?
       WHERE id = ? AND class_id = ? AND revision = ?`,
    ).bind(
      effectivePrice,
      nextStock.previous_price,
      input.actorType,
      input.actorTeacherId,
      input.now,
      input.stock.id,
      input.stock.class_id,
      input.stock.revision,
    ),
    db.prepare(
      `INSERT INTO finance_stock_events (
         id, class_id, stock_id, revision, action, reason,
         idempotency_key, payload_hash, previous_snapshot_json,
         stock_snapshot_json, actor_type, actor_teacher_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      stockEventId,
      input.stock.class_id,
      input.stock.id,
      nextStock.revision,
      eventAction,
      reason,
      input.idempotencyKey,
      payloadHash,
      stockSnapshot(input.stock),
      stockSnapshotWithMarket(nextStock, Number(input.market.revision)),
      input.actorType,
      input.actorTeacherId,
      input.now,
    ),
    ...(applicableNews.length > 0 ? [db.prepare(
      `INSERT INTO finance_stock_news_applications (
         id, class_id, stock_id, stock_event_id, stock_event_revision,
         news_id, news_revision, link_status, impact_bps,
         news_payload_hash, applied_at, recorded_at
       )
       SELECT 'finance:stock-news-application:' || ? || ':'
                || json_extract(selected.value, '$.newsId'),
              ?, ?, ?, ?, json_extract(selected.value, '$.newsId'),
              CAST(json_extract(selected.value, '$.newsRevision') AS INTEGER),
              'exact',
              CAST(json_extract(selected.value, '$.impactBps') AS INTEGER),
              json_extract(selected.value, '$.payloadHash'), ?, ?
       FROM json_each(?) selected`,
    ).bind(
      input.stock.id,
      input.stock.class_id,
      input.stock.id,
      stockEventId,
      nextStock.revision,
      input.now,
      input.now,
      stableFinanceJson(stockTickNewsFingerprint(applicableNews)),
    )] : []),
  ];
  if (input.market.is_open) {
    statements.push(
      db.prepare(
        `UPDATE finance_stock_markets
         SET next_tick_at = ?, updated_at = ?
         WHERE class_id = ? AND revision = ? AND is_open = 1`,
      ).bind(nextTickAt, input.now, input.market.class_id, input.market.revision),
    );
  }
  try {
    await db.batch(statements);
  } catch (error) {
    const concurrent = await stockEventByIdempotency(
      db,
      input.stock.class_id,
      input.idempotencyKey,
    );
    if (
      concurrent
      && concurrent.stock_id === input.stock.id
      && await stockTickEventMatchesPayload(db, concurrent, tickPayloadInput)
      && concurrent.actor_type === input.actorType
      && (concurrent.action === input.action || concurrent.action === "news_tick")
    ) {
      const saved = await stockById(db, input.stock.class_id, input.stock.id);
      if (saved) {
        return {
          stock: saved,
          deduplicated: true,
          skipped: stockTickEventWasSkipped(concurrent),
        };
      }
    }
    mapDatabaseError(error);
  }
  return { stock: nextStock, deduplicated: false, skipped };
}

export async function tickFinanceStockForRequest(
  request: Request,
  input: Record<string, unknown>,
) {
  const context = await financeContextForRequest(request);
  assertTeacher(context);
  const expectedStock = expectedRevision(input.expectedStockRevision, "주식");
  const expectedMarket = expectedRevision(input.expectedMarketRevision, "주식시장");
  const key = idempotencyKey(input.idempotencyKey);
  const db = database();
  const [market, stock] = await Promise.all([
    marketForClass(db, context.classroom.id),
    stockForClass(db, context.classroom.id),
  ]);
  if (!market || !stock) throw new ApiError(404, "우리 반 주식을 찾지 못했습니다.", "FINANCE_STOCK_NOT_FOUND");
  const tickPayloadInput: StockTickPayloadInput = {
    classId: context.classroom.id,
    stockId: stock.id,
    stockRevision: expectedStock,
    marketRevision: expectedMarket,
    actorType: "teacher",
    actorTeacherId: context.actor.id,
    requestedAction: "price_changed",
  };
  const duplicate = await stockEventByIdempotency(db, context.classroom.id, key);
  if (duplicate) {
    if (
      duplicate.stock_id !== stock.id
      || !(await stockTickEventMatchesPayload(db, duplicate, tickPayloadInput))
      || duplicate.actor_type !== "teacher"
      || (duplicate.action !== "price_changed" && duplicate.action !== "news_tick")
    ) {
      throw new ApiError(
        409,
        "같은 시세 갱신 번호가 다른 작업에 사용되었습니다.",
        "FINANCE_STOCK_IDEMPOTENCY_CONFLICT",
      );
    }
    return {
      stock: serializeStock(stock),
      deduplicated: true,
      skipped: stockTickEventWasSkipped(duplicate),
    };
  }
  if (!market.is_open) throw new ApiError(409, "장을 연 뒤 시세를 갱신해 주세요.", "FINANCE_STOCK_MARKET_CLOSED");
  if (Number(market.revision) !== expectedMarket || Number(stock.revision) !== expectedStock) {
    throw new ApiError(409, "시세나 시장 설정이 먼저 바뀌었습니다.", "FINANCE_STOCK_STALE");
  }
  const result = await tickStockWithDb(db, {
    market,
    stock,
    now: Date.now(),
    idempotencyKey: key,
    actorType: "teacher",
    actorTeacherId: context.actor.id,
    action: "price_changed",
    reasonPrefix: "교사가 시세를 즉시 갱신했습니다.",
  });
  return {
    stock: serializeStock(result.stock),
    deduplicated: result.deduplicated,
    skipped: Boolean(result.skipped),
  };
}

const FINANCE_STOCK_TICK_RETRY_BASE_DELAY_MS = 2 * 60_000;
const FINANCE_STOCK_TICK_RETRY_MAX_DELAY_MS = 60 * 60_000;

function financeStockTickFailureCode(error: unknown) {
  const code = error instanceof ApiError
    ? error.code
    : String(error).match(/FINANCE_[A-Z0-9_]+/)?.[0];
  return code && /^[A-Z0-9_]{1,100}$/.test(code)
    ? code
    : "FINANCE_STOCK_TICK_AUTOMATION_FAILED";
}

async function deferFailedFinanceStockTick(
  db: D1Database,
  input: {
    market: MarketRow;
    stock: StockRow;
    now: number;
    error: unknown;
  },
) {
  const scheduledTickAt = Number(input.market.next_tick_at);
  await db.prepare(
    `INSERT INTO finance_stock_tick_retries (
       id, class_id, stock_id, stock_revision, market_revision,
       scheduled_tick_at, attempt_count, next_attempt_at,
       last_error_code, last_failed_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
     ON CONFLICT(
       class_id, stock_id, stock_revision, market_revision, scheduled_tick_at
     ) DO UPDATE SET
       attempt_count = MIN(1000000,
         finance_stock_tick_retries.attempt_count + 1),
       next_attempt_at = excluded.last_failed_at + CASE
         WHEN finance_stock_tick_retries.attempt_count >= 5
           THEN ?
         ELSE ? * (1 << finance_stock_tick_retries.attempt_count)
       END,
       last_error_code = excluded.last_error_code,
       last_failed_at = excluded.last_failed_at,
       updated_at = excluded.updated_at
     WHERE finance_stock_tick_retries.next_attempt_at
       <= excluded.last_failed_at`,
  ).bind(
    crypto.randomUUID(),
    input.stock.class_id,
    input.stock.id,
    input.stock.revision,
    input.market.revision,
    scheduledTickAt,
    input.now + FINANCE_STOCK_TICK_RETRY_BASE_DELAY_MS,
    financeStockTickFailureCode(input.error),
    input.now,
    input.now,
    input.now,
    FINANCE_STOCK_TICK_RETRY_MAX_DELAY_MS,
    FINANCE_STOCK_TICK_RETRY_BASE_DELAY_MS,
  ).run();
}

export async function processFinanceStockMarketTicks(
  db: D1Database,
  options: { now?: number; limit?: number; newsLimit?: number; classId?: string } = {},
) {
  const now = options.now ?? Date.now();
  const limit = Math.max(1, Math.min(100, options.limit ?? 50));
  const newsLimit = Math.max(1, Math.min(100, options.newsLimit ?? limit));
  const expiredNews = await expireFinanceStockNews(db, now, options.classId, newsLimit);
  const deferred = await db.prepare(
    `SELECT COUNT(*) AS count
     FROM finance_stock_markets market
     JOIN finance_stocks stock ON stock.class_id = market.class_id
     JOIN classes classroom ON classroom.id = market.class_id
     JOIN finance_stock_tick_retries retry
       ON retry.class_id = market.class_id
       AND retry.stock_id = stock.id
       AND retry.stock_revision = stock.revision
       AND retry.market_revision = market.revision
       AND retry.scheduled_tick_at = market.next_tick_at
     WHERE market.is_open = 1 AND market.next_tick_at IS NOT NULL
       AND market.next_tick_at <= ? AND retry.next_attempt_at > ?
       AND stock.status IN ('active', 'sell_only')
       AND classroom.status = 'active'
       AND (? IS NULL OR market.class_id = ?)`,
  ).bind(
    now,
    now,
    options.classId ?? null,
    options.classId ?? null,
  ).first<{ count: number }>();
  const due = await db.prepare(
    `SELECT market.class_id
     FROM finance_stock_markets market
     JOIN finance_stocks stock ON stock.class_id = market.class_id
     JOIN classes classroom ON classroom.id = market.class_id
     LEFT JOIN finance_stock_tick_retries retry
       ON retry.class_id = market.class_id
       AND retry.stock_id = stock.id
       AND retry.stock_revision = stock.revision
       AND retry.market_revision = market.revision
       AND retry.scheduled_tick_at = market.next_tick_at
     WHERE market.is_open = 1 AND market.next_tick_at IS NOT NULL
       AND market.next_tick_at <= ?
       AND stock.status IN ('active', 'sell_only')
       AND classroom.status = 'active'
       AND (? IS NULL OR market.class_id = ?)
       AND (retry.id IS NULL OR retry.next_attempt_at <= ?)
     ORDER BY CASE WHEN retry.id IS NULL
                THEN market.next_tick_at ELSE retry.next_attempt_at END,
              market.next_tick_at, market.class_id
     LIMIT ?`,
  ).bind(
    now,
    options.classId ?? null,
    options.classId ?? null,
    now,
    limit,
  ).all<{
    class_id: string;
  }>();
  let ticked = 0;
  let skipped = 0;
  let failed = 0;
  let retrySchedulingFailed = 0;
  for (const row of due.results) {
    let market: MarketRow | null = null;
    let stock: StockRow | null = null;
    try {
      const [currentMarket, currentStock, activeClass] = await Promise.all([
        marketForClass(db, row.class_id),
        stockForClass(db, row.class_id),
        db.prepare(
          `SELECT id FROM classes
           WHERE id = ? AND status = 'active'
           LIMIT 1`,
        ).bind(row.class_id).first<{ id: string }>(),
      ]);
      market = currentMarket;
      stock = currentStock;
      if (
        !activeClass
        || !market
        || !stock
        || !market.is_open
        || market.next_tick_at === null
        || Number(market.next_tick_at) > now
      ) continue;
      const result = await tickStockWithDb(db, {
        market,
        stock,
        now,
        idempotencyKey: [
          "stock-tick:v2",
          stock.id,
          market.revision,
          market.next_tick_at,
        ].join(":"),
        actorType: "system",
        actorTeacherId: null,
        action: "automatic_tick",
        reasonPrefix: "예약된 자동 시세 갱신",
      });
      if (result.skipped) skipped += 1;
      else ticked += 1;
    } catch (error) {
      try {
        const activeClass = await db.prepare(
          `SELECT id FROM classes
           WHERE id = ? AND status = 'active'
           LIMIT 1`,
        ).bind(row.class_id).first<{ id: string }>();
        if (!activeClass) continue;
      } catch {
        // Preserve the original tick failure when the status recheck also fails.
      }
      failed += 1;
      if (market && stock && market.next_tick_at !== null) {
        try {
          await deferFailedFinanceStockTick(db, { market, stock, now, error });
        } catch {
          retrySchedulingFailed += 1;
        }
      } else {
        retrySchedulingFailed += 1;
      }
    }
  }
  return {
    due: due.results.length + Number(deferred?.count ?? 0),
    ticked,
    skipped,
    failed,
    deferred: Number(deferred?.count ?? 0),
    retrySchedulingFailed,
    expiredNews,
  };
}
