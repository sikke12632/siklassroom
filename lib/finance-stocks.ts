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
  calculateFinanceStockExecutionPrice,
  calculateFinanceStockPositionAfterTrade,
  normalizeFinanceStockDefinition,
  normalizeFinanceStockMarketSettings,
  normalizeFinanceStockPrice,
  normalizeFinanceStockTradeRequest,
} from "./finance-stock-rules";
import { financeSettingsForClass } from "./finance-settings";
import { ApiError } from "./responses";

const STOCK_STATUSES = new Set(["active", "sell_only", "halted", "archived"]);
const MAX_FINANCE_AMOUNT = 1_000_000_000;

type StockMood = "surge" | "bull" | "mixed" | "bear" | "crash";
type StockStatus = "active" | "sell_only" | "halted" | "archived";

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

type StockEventRow = {
  id: string;
  class_id: string;
  stock_id: string;
  revision: number;
  action: string;
  reason: string;
  idempotency_key: string;
  payload_hash: string;
  stock_snapshot_json: string;
  actor_type: string;
  created_at: number;
};

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
  const marketValue = quantity * currentPrice;
  const averageCost = quantity > 0 ? Math.floor(totalCost / quantity) : 0;
  const unrealizedProfit = marketValue - totalCost;
  return {
    shares: quantity,
    quantity,
    totalCost,
    costBasis: totalCost,
    averageCost,
    averagePrice: averageCost,
    marketValue,
    unrealizedProfit,
    evaluationProfit: unrealizedProfit,
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

function serializeNews(row: NewsRow, now: number, lastTickAt = 0) {
  const status = row.status === "active" && Number(row.expires_at) <= now
    ? "expired"
    : row.status === "active" && Number(row.created_at) <= lastTickAt
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
    ["FINANCE_STOCK_LEDGER_MISMATCH", 409, "주식과 지갑 기록이 맞지 않아 거래를 멈췄습니다.", "FINANCE_STOCK_LEDGER_MISMATCH"],
    ["FINANCE_STOCK_PROJECTION_MISMATCH", 409, "주식 보유 기록이 달라져 거래를 멈췄습니다.", "FINANCE_STOCK_PROJECTION_MISMATCH"],
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
            idempotency_key, payload_hash, stock_snapshot_json,
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
    `SELECT id, class_id, title, content, impact_bps, status, revision,
            idempotency_key, payload_hash,
            cancellation_idempotency_key, cancellation_payload_hash,
            cancellation_reason, created_at, expires_at, cancelled_at, updated_at
     FROM finance_stock_news
     WHERE class_id = ?
     ORDER BY created_at DESC, id DESC LIMIT ?`,
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

function latestPriceTickAt(events: StockEventRow[]) {
  return events.reduce((latest, event) => (
    ["price_changed", "automatic_tick", "news_tick"].includes(event.action)
      ? Math.max(latest, Number(event.created_at))
      : latest
  ), 0);
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
      const [tradeResult, eventResult, holderResult] = await Promise.all([
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
      ]);
      trades = tradeResult.results;
      events = eventResult.results;
      holders = holderResult.results;
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
    trades: trades.map(serializeTrade),
    news: newsResult.results.map((row) => serializeNews(row, now, latestPriceTickAt(events))),
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
         WHERE class_id = ? AND revision = ?`,
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
  const [current, market, settings] = await Promise.all([
    stockById(db, context.classroom.id, stockId),
    marketForClass(db, context.classroom.id),
    financeSettingsForClass(context.classroom.id),
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
      ? { type: "teacher", teacherId: context.actor.id, reason: options.teacherLiquidation.reason }
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

  const [market, stock, settings, holding, accounts] = await Promise.all([
    marketForClass(db, context.classroom.id),
    stockById(db, context.classroom.id, stockId),
    financeSettingsForClass(context.classroom.id),
    holdingForStudent(db, context.classroom.id, stockId, tradingStudentId),
    accountRows(db, context.classroom.id, tradingStudentId),
  ]);
  if (!market || !stock) {
    throw new ApiError(404, "우리 반 주식을 찾지 못했습니다.", "FINANCE_STOCK_NOT_FOUND");
  }
  if (!market.is_open) {
    throw new ApiError(409, "지금은 주식시장이 쉬는 시간입니다.", "FINANCE_STOCK_MARKET_CLOSED");
  }
  if (stock.status === "halted" || stock.status === "archived") {
    throw new ApiError(409, "지금은 이 주식의 거래가 잠시 멈췄습니다.", "FINANCE_STOCK_TRADE_HALTED");
  }
  if (order.side === "buy" && stock.status !== "active") {
    throw new ApiError(409, "지금은 이 주식을 새로 살 수 없습니다.", "FINANCE_STOCK_BUY_CLOSED");
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

  const step = Math.min(...settings.denominations);
  const feeBps = order.side === "buy"
    ? Number(market.buy_fee_bps)
    : Number(market.sell_fee_bps);
  let unitPrice: number;
  let position: ReturnType<typeof calculateFinanceStockPositionAfterTrade>;
  try {
    unitPrice = calculateFinanceStockExecutionPrice({
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
  const spread = order.side === "buy"
    ? Number(market.buy_spread)
    : Number(market.sell_spread);
  const transaction = normalizeFinanceTransaction({
    classId: context.classroom.id,
    idempotencyKey: `stock-trade:${tradeId}:ledger`,
    transactionType: order.side === "buy" ? "stock_buy" : "stock_sell",
    description: options.teacherLiquidation
      ? `${stock.name} ${order.quantity.toLocaleString("ko-KR")}주 교사 비상 청산 · ${options.teacherLiquidation.reason}`.slice(0, 200)
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
      unitPrice,
      feeAmount: position.quote.feeAmount,
      ...(options.teacherLiquidation
        ? { interventionReason: options.teacherLiquidation.reason }
        : {}),
    },
  });
  const transactionPayloadHash = await sha256(financeTransactionPayload(transaction));
  const accountsById = new Map([
    [accounts.wallet.id, accounts.wallet],
    [accounts.issuance.id, accounts.issuance],
  ]);
  const statements: D1PreparedStatement[] = [
    db.prepare(
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
      stock.current_price,
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
    ),
    ...transactionStatements(db, {
      transactionId,
      transaction,
      transactionPayloadHash,
      accounts: accountsById,
      now,
    }),
  ];
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
  const expectedStock = expectedRevision(input.expectedStockRevision, "주식");
  const expectedMarket = expectedRevision(input.expectedMarketRevision, "주식시장");
  const expectedHolding = expectedRevision(input.expectedHoldingRevision, "학생 보유 주식");
  const db = database();

  const duplicate = await tradeByIdempotency(
    db,
    context.classroom.id,
    studentId,
    key,
  );
  if (duplicate) {
    return tradeFinanceStock(request, stockId, {
      side: "sell",
      quantity: Number(duplicate.quantity),
      expectedStockRevision: Number(duplicate.stock_revision),
      expectedMarketRevision: Number(duplicate.market_revision),
      expectedFinanceSettingsRevision: Number(duplicate.finance_settings_revision),
      expectedHoldingRevision: Number(duplicate.holding_revision_before),
      expectedWalletRevision: Number(duplicate.wallet_revision_before),
      idempotencyKey: key,
    }, {
      teacherLiquidation: { studentId, reason },
    });
  }

  const [market, stock, settings, holding, wallet] = await Promise.all([
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
  if (!market || !stock) {
    throw new ApiError(404, "우리 반 주식을 찾지 못했습니다.", "FINANCE_STOCK_NOT_FOUND");
  }
  if (!holding || Number(holding.quantity) <= 0) {
    throw new ApiError(409, "이 학생이 보유한 주식이 없습니다.", "FINANCE_STOCK_NO_HOLDINGS");
  }
  if (!wallet) {
    throw new ApiError(409, "학생 지갑을 찾지 못했습니다.", "FINANCE_ACCOUNT_NOT_FOUND");
  }
  if (
    Number(stock.revision) !== expectedStock
    || Number(market.revision) !== expectedMarket
    || Number(holding.revision) !== expectedHolding
  ) {
    throw new ApiError(
      409,
      "시세나 학생 보유량이 먼저 바뀌었습니다. 최신 정보를 다시 확인해 주세요.",
      "FINANCE_STOCK_TRADE_STALE",
    );
  }

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
    teacherLiquidation: { studentId, reason },
  });
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
  try {
    await db.prepare(
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
  } catch (error) {
    const concurrent = await newsByCancellationKey(db, context.classroom.id, key);
    if (concurrent && concurrent.id === newsId && concurrent.cancellation_payload_hash === payloadHash) {
      return { news: serializeNews(concurrent, Date.now()), deduplicated: true };
    }
    mapDatabaseError(error);
  }
  const saved = await newsById(db, context.classroom.id, newsId);
  if (!saved) throw new ApiError(500, "종료한 뉴스를 다시 확인하지 못했습니다.", "FINANCE_STOCK_NEWS_UNAVAILABLE");
  return { news: serializeNews(saved, now), deduplicated: false };
}

async function expireFinanceStockNews(db: D1Database, now: number, classId?: string) {
  const due = await db.prepare(
    `SELECT id, class_id, revision
     FROM finance_stock_news
     WHERE status = 'active' AND expires_at <= ?
       AND (? IS NULL OR class_id = ?)
     ORDER BY expires_at, id LIMIT 100`,
  ).bind(now, classId ?? null, classId ?? null).all<{
    id: string;
    class_id: string;
    revision: number;
  }>();
  let expired = 0;
  for (const row of due.results) {
    try {
      await db.prepare(
        `UPDATE finance_stock_news
         SET status = 'expired', revision = revision + 1,
             updated_by_actor_type = 'system', updated_by_teacher_id = NULL,
             updated_at = ?
         WHERE id = ? AND class_id = ? AND revision = ? AND status = 'active'`,
      ).bind(now, row.id, row.class_id, row.revision).run();
      expired += 1;
    } catch {
      // Another request may have expired or cancelled the same news first.
    }
  }
  return expired;
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

async function stockTickPayloadHash(input: {
  classId: string;
  stockId: string;
  stockRevision: number;
  marketRevision: number;
  actorType: "teacher" | "system";
  actorTeacherId: string | null;
  requestedAction: "price_changed" | "automatic_tick" | "news_tick";
}) {
  return sha256(stableFinanceJson(input));
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
  const payloadHash = await stockTickPayloadHash({
    classId: input.stock.class_id,
    stockId: input.stock.id,
    stockRevision: Number(input.stock.revision),
    marketRevision: Number(input.market.revision),
    actorType: input.actorType,
    actorTeacherId: input.actorTeacherId,
    requestedAction: input.action,
  });
  const duplicate = await stockEventByIdempotency(
    db,
    input.stock.class_id,
    input.idempotencyKey,
  );
  if (duplicate) {
    if (
      duplicate.stock_id !== input.stock.id
      || duplicate.payload_hash !== payloadHash
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
    return { stock: saved, deduplicated: true };
  }
  const step = await denominationStepForClass(db, input.stock.class_id);
  const [newsImpact, recentFlow] = await Promise.all([
    db.prepare(
      `SELECT COALESCE(SUM(impact_bps), 0) AS impact, COUNT(*) AS news_count
       FROM finance_stock_news
       WHERE class_id = ? AND status = 'active'
         AND created_at <= ? AND expires_at > ?
         AND created_at > COALESCE((
           SELECT MAX(event.created_at)
           FROM finance_stock_events event
           WHERE event.class_id = ? AND event.stock_id = ?
             AND event.action IN ('price_changed', 'automatic_tick', 'news_tick')
         ), 0)`,
    ).bind(
      input.stock.class_id,
      input.now,
      input.now,
      input.stock.class_id,
      input.stock.id,
    ).first<{
      impact: number;
      news_count: number;
    }>(),
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
  ]);
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
      + Math.max(-500, Math.min(500, Number(newsImpact?.impact ?? 0))),
  ));
  const nextPrice = roundedStockPrice(
    Number(input.stock.current_price),
    changeBps,
    step,
    Number(input.market.sell_spread),
    Number(input.market.buy_spread),
  );
  const effectivePrice = nextPrice;
  const nextTickAt = Math.max(
    input.now,
    Number(input.market.next_tick_at ?? input.now),
  ) + (Number(input.market.tick_interval_minutes) * 60_000);
  if (effectivePrice === Number(input.stock.current_price)) {
    if (input.market.is_open) {
      await db.prepare(
        `UPDATE finance_stock_markets
         SET next_tick_at = ?, updated_at = ?
         WHERE class_id = ? AND revision = ? AND is_open = 1`,
      ).bind(nextTickAt, input.now, input.market.class_id, input.market.revision).run();
      return { stock: input.stock, deduplicated: false, skipped: true };
    }
    throw new ApiError(409, "현재 가격 범위에서는 더 움직일 수 없습니다.", "FINANCE_STOCK_PRICE_LIMIT");
  }
  const appliedChangeBps = Math.round(
    ((effectivePrice - Number(input.stock.current_price)) * 10_000)
      / Number(input.stock.current_price),
  );
  const reason = `${input.reasonPrefix} · ${input.market.market_mood} · 계산 신호 ${(changeBps / 100).toFixed(2)}% · 실제 변동 ${(appliedChangeBps / 100).toFixed(2)}%`;
  const eventAction = Number(newsImpact?.news_count ?? 0) > 0
    ? "news_tick"
    : input.action;
  const nextStock: StockRow = {
    ...input.stock,
    previous_price: Number(input.stock.current_price),
    current_price: effectivePrice,
    revision: Number(input.stock.revision) + 1,
    updated_at: input.now,
  };
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE finance_stocks
       SET current_price = ?, previous_price = ?, revision = revision + 1,
           updated_by_actor_type = ?, updated_by_teacher_id = ?, updated_at = ?
       WHERE id = ? AND class_id = ? AND revision = ?`,
    ).bind(
      effectivePrice,
      input.stock.current_price,
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
      crypto.randomUUID(),
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
      && concurrent.payload_hash === payloadHash
      && concurrent.actor_type === input.actorType
      && (concurrent.action === input.action || concurrent.action === "news_tick")
    ) {
      const saved = await stockById(db, input.stock.class_id, input.stock.id);
      if (saved) return { stock: saved, deduplicated: true };
    }
    mapDatabaseError(error);
  }
  return { stock: nextStock, deduplicated: false };
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
  const payloadHash = await stockTickPayloadHash({
    classId: context.classroom.id,
    stockId: stock.id,
    stockRevision: expectedStock,
    marketRevision: expectedMarket,
    actorType: "teacher",
    actorTeacherId: context.actor.id,
    requestedAction: "price_changed",
  });
  const duplicate = await stockEventByIdempotency(db, context.classroom.id, key);
  if (duplicate) {
    if (
      duplicate.stock_id !== stock.id
      || duplicate.payload_hash !== payloadHash
      || duplicate.actor_type !== "teacher"
      || (duplicate.action !== "price_changed" && duplicate.action !== "news_tick")
    ) {
      throw new ApiError(
        409,
        "같은 시세 갱신 번호가 다른 작업에 사용되었습니다.",
        "FINANCE_STOCK_IDEMPOTENCY_CONFLICT",
      );
    }
    return { stock: serializeStock(stock), deduplicated: true };
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

export async function processFinanceStockMarketTicks(
  db: D1Database,
  options: { now?: number; limit?: number; classId?: string } = {},
) {
  const now = options.now ?? Date.now();
  const limit = Math.max(1, Math.min(100, options.limit ?? 50));
  const expiredNews = await expireFinanceStockNews(db, now, options.classId);
  const due = await db.prepare(
    `SELECT market.class_id
     FROM finance_stock_markets market
     JOIN finance_stocks stock ON stock.class_id = market.class_id
     JOIN classes classroom ON classroom.id = market.class_id
     WHERE market.is_open = 1 AND market.next_tick_at IS NOT NULL
       AND market.next_tick_at <= ?
       AND stock.status IN ('active', 'sell_only')
       AND classroom.status = 'active'
       AND (? IS NULL OR market.class_id = ?)
     ORDER BY market.next_tick_at, market.class_id LIMIT ?`,
  ).bind(now, options.classId ?? null, options.classId ?? null, limit).all<{
    class_id: string;
  }>();
  let ticked = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of due.results) {
    try {
      const [market, stock] = await Promise.all([
        marketForClass(db, row.class_id),
        stockForClass(db, row.class_id),
      ]);
      if (!market || !stock || !market.is_open || market.next_tick_at === null) continue;
      const bucket = Math.floor(
        Number(market.next_tick_at)
          / (Number(market.tick_interval_minutes) * 60_000),
      );
      const result = await tickStockWithDb(db, {
        market,
        stock,
        now,
        idempotencyKey: `stock-tick:${stock.id}:${bucket}`,
        actorType: "system",
        actorTeacherId: null,
        action: "automatic_tick",
        reasonPrefix: "예약된 자동 시세 갱신",
      });
      if (result.skipped) skipped += 1;
      else ticked += 1;
    } catch {
      failed += 1;
    }
  }
  return { due: due.results.length, ticked, skipped, failed, expiredNews };
}
