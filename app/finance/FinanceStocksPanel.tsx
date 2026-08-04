"use client";

import {
  BadgeCheck,
  BarChart3,
  Building2,
  CircleAlert,
  Clock3,
  Coins,
  LoaderCircle,
  LockKeyhole,
  Megaphone,
  Newspaper,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Save,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Users,
  WalletCards,
} from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type FinanceStockRole = "teacher" | "banker" | "student";

export type FinanceStocksPanelProps = {
  classId: string;
  financeRole: FinanceStockRole;
  actorType?: "teacher" | "student";
  classIsActive?: boolean;
  currencyLabel?: string;
  denominations?: number[];
  refreshRevision?: number;
  onRefresh?: () => Promise<void>;
};

type StockMood = "surge" | "bull" | "mixed" | "bear" | "crash";
type StockSide = "buy" | "sell";
type StockStatus = "active" | "sell_only" | "halted" | "archived";

type FinanceStockMarket = {
  isOpen: boolean;
  mood: StockMood;
  buyFeeBps: number;
  sellFeeBps: number;
  buySpread: number;
  sellSpread: number;
  tickIntervalMinutes: number;
  nextTickAt: number | null;
  revision: number;
};

type FinanceStockNews = {
  id: string;
  title: string;
  content: string;
  impactBps: number;
  status: "active" | "applied" | "cancelled" | "expired";
  revision: number;
  createdAt: number;
  expiresAt: number;
  cancelledAt: number | null;
};

type FinanceStockAsset = {
  id: string;
  name: string;
  symbol: string;
  description: string | null;
  currentPrice: number;
  previousPrice: number | null;
  status: StockStatus;
  totalSupply: number;
  availableShares: number;
  maxSharesPerStudent: number;
  revision: number;
  holderCount: number;
  issuedShares: number;
  volume: number;
  priceHistory: number[];
  updatedAt: number | null;
};

type FinanceStockHolding = {
  shares: number;
  averagePrice: number;
  costBasis: number;
  marketValue: number;
  marketValueExact: bigint;
  evaluationProfit: number;
  evaluationProfitExact: bigint;
  revision: number;
};

type FinanceStockHolder = FinanceStockHolding & {
  student: {
    id: string;
    number: number;
    name: string;
  };
};

type FinanceStockWallet = {
  balance: number;
  pendingWithdrawalAmount: number;
  availableBalance: number;
  status: "active" | "frozen" | "closed";
  revision: number;
};

type FinanceStockTrade = {
  id: string;
  side: StockSide;
  quantity: number;
  price: number;
  grossAmount: number;
  fee: number;
  netAmount: number;
  idempotencyKey: string;
  createdAt: number;
  student: null | {
    id: string;
    number: number;
    name: string;
  };
};

type FinanceStockLiquidation = {
  id: string;
  stockId: string;
  studentId: string;
  rootIdempotencyKey: string;
  interventionReason: string;
  status: "running" | "completed" | "cancelled";
  initialQuantity: number;
  remainingQuantity: number;
  soldQuantity: number;
  expectedPayoutAmount: number;
  completedChunkCount: number;
  totalPayoutAmount: number;
  revision: number;
  frozenQuote: {
    referencePrice: number;
    sellSpread: number;
    unitPrice: number;
    feeBps: number;
    denominationStep: number;
    stockRevision: number;
    marketRevision: number;
    financeSettingsRevision: number;
  };
  snapshot: {
    holdingRevision: number;
  };
  student: null | {
    id: string;
    number: number;
    name: string;
  };
  cancellationReason: string | null;
  cancellationIdempotencyKey: string | null;
};

type FinanceStocksData = {
  serverTime: number;
  settingsRevision: number;
  denominationStep: number;
  market: FinanceStockMarket;
  stock: FinanceStockAsset | null;
  holding: FinanceStockHolding;
  wallet: FinanceStockWallet | null;
  holdings: FinanceStockHolder[];
  trades: FinanceStockTrade[];
  news: FinanceStockNews[];
  liquidations: FinanceStockLiquidation[];
};

type Notice = {
  tone: "success" | "error" | "info";
  message: string;
} | null;

type LooseRecord = Record<string, unknown>;

type CreateDraft = {
  name: string;
  symbol: string;
  description: string;
  initialPrice: string;
  totalSupply: string;
  maxSharesPerStudent: string;
  buyFeePercent: string;
  sellFeePercent: string;
  buySpread: string;
  sellSpread: string;
};

type MarketDraft = {
  mood: StockMood;
  buyFeePercent: string;
  sellFeePercent: string;
  buySpread: string;
  sellSpread: string;
};

type AssetDraft = {
  currentPrice: string;
  status: StockStatus;
};

type NewsDraft = {
  title: string;
  content: string;
  impactBps: string;
  durationMinutes: string;
};

const MAX_AMOUNT = 1_000_000_000;
const MAX_SUPPLY = 1_000_000;

const MOODS: Array<{ value: StockMood; label: string; description: string }> = [
  { value: "surge", label: "급등장", description: "상승 힘이 매우 강해요" },
  { value: "bull", label: "강세장", description: "상승 흐름이 우세해요" },
  { value: "mixed", label: "혼조세", description: "오르내림이 섞여 있어요" },
  { value: "bear", label: "약세장", description: "하락 흐름이 우세해요" },
  { value: "crash", label: "급락장", description: "하락 힘이 매우 강해요" },
];

const styles: Record<string, CSSProperties> = {
  cardTop: { borderTop: "4px solid var(--color-info)" },
  headerIcon: {
    width: 38,
    height: 38,
    padding: 7,
    borderRadius: "var(--radius-md)",
    color: "var(--color-info)",
    background: "var(--color-info-soft)",
    flex: "0 0 auto",
  },
  hero: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
    gap: 10,
    marginTop: 16,
  },
  summaryCard: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    gap: 10,
    alignItems: "center",
    minWidth: 0,
    padding: 14,
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    background: "var(--color-surface-raised)",
  },
  summaryIcon: {
    width: 36,
    height: 36,
    padding: 8,
    borderRadius: "var(--radius-sm)",
    color: "var(--color-info)",
    background: "var(--color-info-soft)",
  },
  section: {
    marginTop: 20,
    paddingTop: 20,
    borderTop: "1px solid var(--color-border)",
  },
  sectionHeading: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 14,
  },
  sectionTitle: { margin: "2px 0 0", fontSize: "var(--text-xl)" },
  muted: { margin: "3px 0 0", color: "var(--color-text-muted)", fontSize: "var(--text-sm)" },
  form: {
    display: "grid",
    gap: 16,
    padding: 18,
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-lg)",
    background: "var(--color-surface-raised)",
  },
  fieldGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 210px), 1fr))",
    gap: 12,
  },
  label: {
    display: "grid",
    gap: 6,
    minWidth: 0,
    color: "var(--color-text)",
    fontSize: "var(--text-sm)",
    fontWeight: 750,
  },
  fieldHelp: { color: "var(--color-text-muted)", fontSize: "var(--text-xs)", fontWeight: 500 },
  inputWithSuffix: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    border: "1px solid var(--color-border-strong)",
    borderRadius: "var(--radius-md)",
    background: "var(--color-surface)",
  },
  inputBare: { minWidth: 0, border: 0, boxShadow: "none" },
  suffix: { paddingRight: 12, color: "var(--color-text-muted)", fontSize: "var(--text-sm)" },
  actions: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  fullAction: { flex: "1 1 180px", justifyContent: "center" },
  moodGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 130px), 1fr))",
    gap: 8,
  },
  moodButton: {
    display: "grid",
    justifyItems: "start",
    gap: 2,
    minHeight: 66,
    padding: 12,
    textAlign: "left",
  },
  activeMood: {
    color: "var(--color-info)",
    borderColor: "var(--color-info)",
    background: "var(--color-info-soft)",
  },
  companyCard: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    gap: 13,
    alignItems: "center",
    padding: 17,
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-lg)",
    background: "var(--color-surface-raised)",
  },
  companyIcon: {
    width: 44,
    height: 44,
    padding: 9,
    borderRadius: "var(--radius-md)",
    color: "var(--color-info)",
    background: "var(--color-info-soft)",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 9px",
    borderRadius: "var(--radius-pill)",
    fontSize: "var(--text-xs)",
    fontWeight: 850,
    whiteSpace: "nowrap",
  },
  chartCard: {
    minWidth: 0,
    padding: 16,
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-lg)",
    background: "var(--color-surface-raised)",
  },
  chart: { display: "block", width: "100%", height: "auto", minHeight: 150 },
  tradeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
    gap: 12,
  },
  tradeCard: {
    display: "grid",
    alignContent: "start",
    gap: 14,
    minWidth: 0,
    padding: 18,
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-lg)",
    background: "var(--color-surface-raised)",
  },
  quote: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 8,
  },
  quoteItem: {
    minWidth: 0,
    padding: 12,
    borderRadius: "var(--radius-md)",
    background: "var(--color-surface-subtle)",
  },
  preview: {
    display: "grid",
    gap: 7,
    padding: 13,
    borderRadius: "var(--radius-md)",
    color: "var(--color-info)",
    background: "var(--color-info-soft)",
  },
  previewRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "baseline",
  },
  table: { width: "100%", borderCollapse: "collapse" },
  tableCell: { whiteSpace: "nowrap" },
  newsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
    gap: 10,
  },
  newsCard: {
    display: "grid",
    alignContent: "start",
    gap: 9,
    minWidth: 0,
    padding: 15,
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    background: "var(--color-surface-raised)",
  },
};

function isRecord(value: unknown): value is LooseRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bigintValue(value: unknown, fallback = BigInt(0)) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/u.test(value)) {
    try {
      return BigInt(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function booleanValue(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = textValue(value).toLocaleLowerCase("en-US");
  if (["1", "open", "active", "yes", "true"].includes(normalized)) return true;
  if (["0", "closed", "paused", "no", "false"].includes(normalized)) return false;
  return fallback;
}

function epochValue(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeMood(value: unknown): StockMood {
  const mood = textValue(value, "mixed").toLocaleLowerCase("en-US");
  if (["surge", "bull", "mixed", "bear", "crash"].includes(mood)) return mood as StockMood;
  return "mixed";
}

function normalizeSide(value: unknown): StockSide {
  const side = textValue(value, "buy").toLocaleLowerCase("en-US");
  return ["sell", "sale", "stock_sell"].includes(side) ? "sell" : "buy";
}

function normalizeStock(value: unknown): FinanceStockAsset | null {
  if (!isRecord(value)) return null;
  const stats = isRecord(value.stats) ? value.stats : {};
  const id = textValue(value.id ?? value.stockId ?? value.stock_id);
  if (!id) return null;
  const totalSupply = numberValue(value.totalSupply ?? value.total_supply);
  const issuedShares = numberValue(value.issuedShares ?? value.issued_shares ?? stats.issuedShares ?? stats.issued_shares);
  const historyRaw = Array.isArray(value.priceHistory ?? value.price_history)
    ? value.priceHistory ?? value.price_history
    : [];
  const priceHistory = (historyRaw as unknown[])
    .map((item) => isRecord(item) ? numberValue(item.price, Number.NaN) : numberValue(item, Number.NaN))
    .filter((item) => Number.isFinite(item) && item >= 0);
  const statusRaw = textValue(value.status, "active").toLocaleLowerCase("en-US");
  const status: StockStatus = statusRaw === "sell_only"
    ? "sell_only"
    : statusRaw === "archived"
      ? "archived"
      : ["halted", "paused"].includes(statusRaw)
        ? "halted"
        : "active";
  return {
    id,
    name: textValue(value.name, "우리 반 주식회사"),
    symbol: textValue(value.symbol, "CLASS"),
    description: textValue(value.description) || null,
    currentPrice: numberValue(value.currentPrice ?? value.current_price),
    previousPrice: value.previousPrice !== undefined || value.previous_price !== undefined
      ? numberValue(value.previousPrice ?? value.previous_price)
      : null,
    status,
    totalSupply,
    availableShares: numberValue(
      value.availableShares ?? value.available_shares,
      Math.max(0, totalSupply - issuedShares),
    ),
    maxSharesPerStudent: numberValue(value.maxSharesPerStudent ?? value.max_shares_per_student),
    revision: numberValue(value.revision),
    holderCount: numberValue(value.holderCount ?? value.holder_count ?? stats.holderCount ?? stats.holder_count),
    issuedShares,
    volume: numberValue(value.volume ?? stats.volume),
    priceHistory,
    updatedAt: epochValue(value.updatedAt ?? value.updated_at) || null,
  };
}

function normalizeHolding(value: unknown, stock: FinanceStockAsset | null): FinanceStockHolding {
  const raw = isRecord(value) ? value : {};
  const shares = numberValue(raw.shares ?? raw.quantity);
  const averagePrice = numberValue(raw.averagePrice ?? raw.average_price ?? raw.avgPrice ?? raw.avg_price);
  const costBasis = numberValue(raw.costBasis ?? raw.cost_basis, shares * averagePrice);
  const calculatedMarketValue = BigInt(shares) * BigInt(stock?.currentPrice ?? 0);
  const marketValueExact = bigintValue(
    raw.marketValueExact ?? raw.market_value_exact ?? raw.marketValue ?? raw.market_value,
    calculatedMarketValue,
  );
  const evaluationProfitExact = bigintValue(
    raw.evaluationProfitExact
      ?? raw.evaluation_profit_exact
      ?? raw.unrealizedProfitExact
      ?? raw.unrealized_profit_exact
      ?? raw.evaluationProfit
      ?? raw.evaluation_profit
      ?? raw.unrealizedProfit
      ?? raw.unrealized_profit,
    marketValueExact - BigInt(costBasis),
  );
  const marketValue = Number(marketValueExact);
  return {
    shares,
    averagePrice,
    costBasis,
    marketValue,
    marketValueExact,
    evaluationProfit: Number(evaluationProfitExact),
    evaluationProfitExact,
    revision: numberValue(raw.revision),
  };
}

function normalizeHolder(value: unknown, stock: FinanceStockAsset | null): FinanceStockHolder | null {
  if (!isRecord(value) || !isRecord(value.student)) return null;
  const id = textValue(value.student.id);
  if (!id) return null;
  return {
    ...normalizeHolding(value, stock),
    student: {
      id,
      number: numberValue(value.student.number),
      name: textValue(value.student.name, "학생"),
    },
  };
}

function normalizeTrade(value: unknown): FinanceStockTrade | null {
  if (!isRecord(value)) return null;
  const id = textValue(value.id ?? value.tradeId ?? value.trade_id);
  if (!id) return null;
  const studentRaw = isRecord(value.student) ? value.student : {};
  const studentId = textValue(studentRaw.id ?? value.studentId ?? value.student_id);
  const side = normalizeSide(value.side ?? value.tradeType ?? value.trade_type);
  const quantity = numberValue(value.quantity ?? value.shares);
  const price = numberValue(value.price ?? value.unitPrice ?? value.unit_price);
  const grossAmount = numberValue(value.grossAmount ?? value.gross_amount ?? value.total, quantity * price);
  const fee = numberValue(value.fee);
  return {
    id,
    side,
    quantity,
    price,
    grossAmount,
    fee,
    netAmount: numberValue(
      value.netAmount ?? value.net_amount ?? value.cashAmount ?? value.cash_amount,
      side === "buy" ? grossAmount + fee : Math.max(0, grossAmount - fee),
    ),
    idempotencyKey: textValue(value.idempotencyKey ?? value.idempotency_key),
    createdAt: epochValue(value.createdAt ?? value.created_at ?? value.timestamp),
    student: studentId
      ? {
        id: studentId,
        number: numberValue(studentRaw.number ?? value.studentNumber ?? value.student_number),
        name: textValue(studentRaw.name ?? value.studentName ?? value.student_name, "학생"),
      }
      : null,
  };
}

function normalizeNews(value: unknown): FinanceStockNews | null {
  if (!isRecord(value)) return null;
  const id = textValue(value.id ?? value.newsId ?? value.news_id);
  const title = textValue(value.title).trim();
  if (!id || !title) return null;
  const rawStatus = textValue(value.status, "expired").toLocaleLowerCase("en-US");
  const status = ["active", "applied", "cancelled"].includes(rawStatus)
    ? rawStatus as "active" | "applied" | "cancelled"
    : "expired";
  return {
    id,
    title,
    content: textValue(value.content),
    impactBps: numberValue(value.impactBps ?? value.impact_bps),
    status,
    revision: numberValue(value.revision),
    createdAt: epochValue(value.createdAt ?? value.created_at),
    expiresAt: epochValue(value.expiresAt ?? value.expires_at),
    cancelledAt: value.cancelledAt !== null && value.cancelledAt !== undefined
      ? epochValue(value.cancelledAt)
      : value.cancelled_at !== null && value.cancelled_at !== undefined
        ? epochValue(value.cancelled_at)
        : null,
  };
}

function normalizeLiquidation(value: unknown): FinanceStockLiquidation | null {
  if (!isRecord(value)) return null;
  const id = textValue(value.id);
  const stockId = textValue(value.stockId ?? value.stock_id);
  const studentId = textValue(value.studentId ?? value.student_id);
  const rootIdempotencyKey = textValue(
    value.rootIdempotencyKey ?? value.root_idempotency_key,
  );
  const rawStatus = textValue(value.status).toLocaleLowerCase("en-US");
  if (
    !id
    || !stockId
    || !studentId
    || !rootIdempotencyKey
    || !["running", "completed", "cancelled"].includes(rawStatus)
  ) return null;
  const frozenRaw = isRecord(value.frozenQuote) ? value.frozenQuote : {};
  const snapshotRaw = isRecord(value.snapshot) ? value.snapshot : {};
  const studentRaw = isRecord(value.student) ? value.student : {};
  const operationStudentId = textValue(studentRaw.id ?? studentId);
  return {
    id,
    stockId,
    studentId,
    rootIdempotencyKey,
    interventionReason: textValue(
      value.interventionReason ?? value.intervention_reason,
    ),
    status: rawStatus as FinanceStockLiquidation["status"],
    initialQuantity: numberValue(value.initialQuantity ?? value.initial_quantity),
    remainingQuantity: numberValue(value.remainingQuantity ?? value.remaining_quantity),
    soldQuantity: numberValue(value.soldQuantity ?? value.sold_quantity),
    expectedPayoutAmount: numberValue(
      value.expectedPayoutAmount ?? value.expected_wallet_delta,
    ),
    completedChunkCount: numberValue(
      value.completedChunkCount ?? value.completed_chunk_count,
    ),
    totalPayoutAmount: numberValue(
      value.totalPayoutAmount ?? value.total_wallet_delta,
    ),
    revision: numberValue(value.revision),
    frozenQuote: {
      referencePrice: numberValue(
        frozenRaw.referencePrice ?? frozenRaw.reference_price,
      ),
      sellSpread: numberValue(frozenRaw.sellSpread ?? frozenRaw.sell_spread),
      unitPrice: numberValue(frozenRaw.unitPrice ?? frozenRaw.unit_price),
      feeBps: numberValue(frozenRaw.feeBps ?? frozenRaw.fee_bps),
      denominationStep: Math.max(1, numberValue(
        frozenRaw.denominationStep ?? frozenRaw.denomination_step,
        1,
      )),
      stockRevision: numberValue(
        frozenRaw.stockRevision ?? frozenRaw.stock_revision,
      ),
      marketRevision: numberValue(
        frozenRaw.marketRevision ?? frozenRaw.market_revision,
      ),
      financeSettingsRevision: numberValue(
        frozenRaw.financeSettingsRevision
          ?? frozenRaw.finance_settings_revision,
      ),
    },
    snapshot: {
      holdingRevision: numberValue(
        snapshotRaw.holdingRevision ?? snapshotRaw.holding_revision,
      ),
    },
    student: operationStudentId
      ? {
          id: operationStudentId,
          number: numberValue(studentRaw.number),
          name: textValue(studentRaw.name, "학생"),
        }
      : null,
    cancellationReason: value.cancellationReason === null
      || value.cancellation_reason === null
      ? null
      : textValue(value.cancellationReason ?? value.cancellation_reason) || null,
    cancellationIdempotencyKey: value.cancellationIdempotencyKey === null
      || value.cancellation_idempotency_key === null
      ? null
      : textValue(
        value.cancellationIdempotencyKey
          ?? value.cancellation_idempotency_key,
      ) || null,
  };
}

export function normalizeStocksResponse(value: unknown): FinanceStocksData {
  if (!isRecord(value)) throw new Error("주식 정보를 확인할 수 없어요. 새로고침해 주세요.");
  const root = isRecord(value.stocks) ? value.stocks : value;
  const marketRaw = isRecord(root.market) ? root.market : {};
  const stock = normalizeStock(root.stock ?? root.asset);
  const walletRaw = isRecord(root.wallet) ? root.wallet : null;
  const walletStatus = textValue(walletRaw?.status, "active").toLocaleLowerCase("en-US");
  const walletBalance = numberValue(walletRaw?.balance);
  const pendingWithdrawalAmount = Math.max(0, numberValue(
    walletRaw?.pendingWithdrawalAmount ?? walletRaw?.pending_withdrawal_amount,
  ));
  const availableBalance = walletRaw
    ? Math.max(0, numberValue(
      walletRaw.availableBalance ?? walletRaw.available_balance,
      walletBalance - pendingWithdrawalAmount,
    ))
    : 0;
  return {
    serverTime: epochValue(root.serverTime ?? root.server_time, Date.now()),
    settingsRevision: numberValue(root.settingsRevision ?? root.settings_revision),
    denominationStep: Math.max(1, numberValue(root.denominationStep ?? root.denomination_step, 1)),
    market: {
      isOpen: booleanValue(marketRaw.isOpen ?? marketRaw.is_open ?? marketRaw.status),
      mood: normalizeMood(marketRaw.mood ?? marketRaw.marketMood ?? marketRaw.market_mood),
      buyFeeBps: numberValue(marketRaw.buyFeeBps ?? marketRaw.buy_fee_bps),
      sellFeeBps: numberValue(marketRaw.sellFeeBps ?? marketRaw.sell_fee_bps),
      buySpread: numberValue(marketRaw.buySpread ?? marketRaw.buy_spread),
      sellSpread: numberValue(marketRaw.sellSpread ?? marketRaw.sell_spread),
      tickIntervalMinutes: Math.max(1, numberValue(
        marketRaw.tickIntervalMinutes ?? marketRaw.tick_interval_minutes,
        15,
      )),
      nextTickAt: marketRaw.nextTickAt !== null && marketRaw.nextTickAt !== undefined
        ? epochValue(marketRaw.nextTickAt)
        : marketRaw.next_tick_at !== null && marketRaw.next_tick_at !== undefined
          ? epochValue(marketRaw.next_tick_at)
          : null,
      revision: numberValue(marketRaw.revision),
    },
    stock,
    holding: normalizeHolding(root.holding, stock),
    wallet: walletRaw
      ? {
        balance: walletBalance,
        pendingWithdrawalAmount,
        availableBalance,
        status: ["frozen", "closed"].includes(walletStatus)
          ? walletStatus as "frozen" | "closed"
          : "active",
        revision: numberValue(walletRaw.revision),
      }
      : null,
    holdings: Array.isArray(root.holdings)
      ? root.holdings
        .map((item) => normalizeHolder(item, stock))
        .filter((item): item is FinanceStockHolder => item !== null)
      : [],
    trades: Array.isArray(root.trades)
      ? root.trades.map(normalizeTrade).filter((item): item is FinanceStockTrade => item !== null)
      : [],
    news: Array.isArray(root.news)
      ? root.news.map(normalizeNews).filter((item): item is FinanceStockNews => item !== null)
      : [],
    liquidations: Array.isArray(root.liquidations)
      ? root.liquidations
        .map(normalizeLiquidation)
        .filter((item): item is FinanceStockLiquidation => item !== null)
      : [],
  };
}

function newIdempotencyKey(scope: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${scope}:${suffix}`;
}

function getStableActionKey(
  store: MutableRefObject<Record<string, { fingerprint: string; key: string }>>,
  slot: string,
  fingerprint: string,
) {
  const existing = store.current[slot];
  if (existing?.fingerprint === fingerprint) return existing.key;
  const key = newIdempotencyKey(slot);
  store.current[slot] = { fingerprint, key };
  return key;
}

function parsePercentToBps(value: string) {
  const trimmed = value.trim();
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const bps = Math.round(Number(trimmed) * 100);
  return Number.isSafeInteger(bps) && bps >= 0 && bps <= 1_000 ? bps : null;
}

function tradeFee(grossAmount: number, feeBps: number, denominationStep: number) {
  if (grossAmount <= 0 || feeBps <= 0) return 0;
  const rawFee = Math.floor((grossAmount * feeBps) / 10_000);
  return Math.floor(rawFee / denominationStep) * denominationStep;
}

function bpsText(value: number) {
  return `${(value / 100).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
}

function signedBpsText(value: number) {
  return `${value > 0 ? "+" : ""}${bpsText(value)}`;
}

function moneyText(value: number, unit: string) {
  return `${Math.round(value).toLocaleString("ko-KR")} ${unit}`;
}

function exactMoneyText(value: bigint, unit: string) {
  return `${value.toLocaleString("ko-KR")} ${unit}`;
}

function signedMoneyText(value: number, unit: string) {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("ko-KR")} ${unit}`;
}

function signedExactMoneyText(value: bigint, unit: string) {
  return `${value > BigInt(0) ? "+" : ""}${value.toLocaleString("ko-KR")} ${unit}`;
}

function dateTimeText(value: number) {
  if (!value) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function moodLabel(value: StockMood) {
  return MOODS.find((mood) => mood.value === value)?.label ?? "혼조세";
}

function apiErrorMessage(status: number, payload: unknown) {
  const raw = isRecord(payload) ? payload : {};
  const serverMessage = textValue(raw.error) || textValue(raw.message);
  if (status === 401) return "로그인이 풀렸어요. 다시 로그인해 주세요.";
  if (status === 403 || status === 404) return "이 학급의 주식을 이용할 권한이 없어요.";
  if (status === 409) {
    const code = textValue(raw.code);
    if (code.includes("STALE")) return "시세나 보유량이 먼저 바뀌었어요. 최신 내용으로 다시 불러왔습니다. 입력한 수량은 그대로 남겨 두었어요.";
    return serverMessage || "이미 처리되었거나 최신 상태가 달라졌어요. 새로고침해 주세요.";
  }
  if (status === 400 || status === 422) return serverMessage || "입력 내용을 다시 확인해 주세요.";
  return serverMessage || "주식 처리에 실패했어요. 잠시 후 다시 시도해 주세요.";
}

async function sendAction(url: string, method: "POST" | "PUT" | "DELETE", body: LooseRecord) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(response.status, payload));
  return payload;
}

function StatusNotice({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <div
      className={`finance-action-notice ${notice.tone}`}
      role={notice.tone === "error" ? "alert" : "status"}
      aria-live={notice.tone === "error" ? "assertive" : "polite"}
    >
      {notice.tone === "success"
        ? <BadgeCheck aria-hidden="true" />
        : notice.tone === "error"
          ? <CircleAlert aria-hidden="true" />
          : <RefreshCw aria-hidden="true" />}
      <p>{notice.message}</p>
    </div>
  );
}

function SummaryCard({ icon, label, value, help }: {
  icon: ReactNode;
  label: string;
  value: string;
  help: string;
}) {
  return (
    <article style={styles.summaryCard}>
      <span style={styles.summaryIcon} aria-hidden="true">{icon}</span>
      <div style={{ minWidth: 0 }}>
        <small style={styles.fieldHelp}>{label}</small>
        <strong style={{ display: "block", marginTop: 2, overflowWrap: "anywhere" }}>{value}</strong>
        <small style={styles.fieldHelp}>{help}</small>
      </div>
    </article>
  );
}

function MarketBadge({ market, stock }: { market: FinanceStockMarket; stock: FinanceStockAsset }) {
  const trading = market.isOpen && stock.status === "active";
  const sellOnly = market.isOpen && stock.status === "sell_only";
  const label = !market.isOpen
    ? "장 마감"
    : stock.status === "active"
      ? "거래 중"
      : stock.status === "sell_only"
        ? "매도만 가능"
        : stock.status === "archived"
          ? "종목 보관"
          : "종목 거래 중지";
  return (
    <span
      style={{
        ...styles.badge,
        color: trading ? "var(--color-success)" : sellOnly ? "var(--color-warning)" : "var(--color-text-muted)",
        background: trading ? "var(--color-success-soft)" : sellOnly ? "var(--color-warning-soft)" : "var(--color-surface-subtle)",
      }}
    >
      {trading || sellOnly ? <PlayCircle size={15} aria-hidden="true" /> : <PauseCircle size={15} aria-hidden="true" />}
      {label}
    </span>
  );
}

function StockNewsCard({
  item,
  teacherView,
  disabled,
  busyId,
  onCancel,
}: {
  item: FinanceStockNews;
  teacherView: boolean;
  disabled: boolean;
  busyId: string | null;
  onCancel?: (item: FinanceStockNews, reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState("상황이 끝나 뉴스를 내립니다.");
  const active = item.status === "active";
  const impactColor = item.impactBps > 0
    ? "var(--color-success)"
    : item.impactBps < 0
      ? "var(--color-danger)"
      : "var(--color-text-muted)";
  const cancelSlot = `stock-news-cancel:${item.id}`;

  async function submitCancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedReason = reason.trim();
    if (!normalizedReason || !onCancel) return;
    await onCancel(item, normalizedReason);
  }

  return (
    <article
      style={{
        ...styles.newsCard,
        borderTop: `3px solid ${active ? impactColor : "var(--color-border-strong)"}`,
        opacity: active ? 1 : 0.78,
      }}
    >
      <div style={{ ...styles.actions, justifyContent: "space-between" }}>
        <span
          style={{
            ...styles.badge,
            color: active ? impactColor : "var(--color-text-muted)",
            background: active ? "var(--color-surface-subtle)" : "var(--color-surface)",
          }}
        >
          {active ? <Megaphone size={15} aria-hidden="true" /> : <Clock3 size={15} aria-hidden="true" />}
          {active ? "반영 대기" : item.status === "applied" ? "시세 반영 완료" : item.status === "cancelled" ? "교사가 내림" : "종료"}
        </span>
        <strong style={{ color: impactColor }}>{signedBpsText(item.impactBps)}</strong>
      </div>
      <div style={{ minWidth: 0 }}>
        <h4 style={{ margin: 0, overflowWrap: "anywhere" }}>{item.title}</h4>
        <p style={{ ...styles.muted, marginTop: 6, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.content}</p>
      </div>
      <small style={styles.fieldHelp}>
        {active ? `${dateTimeText(item.expiresAt)}까지 다음 갱신을 기다려요` : `${dateTimeText(item.createdAt)} 등록`}
      </small>
      {teacherView && active && onCancel && (
        <form style={{ display: "grid", gap: 7 }} onSubmit={submitCancel}>
          <label style={styles.label}>
            뉴스 내리는 이유
            <input
              value={reason}
              maxLength={300}
              onChange={(event) => setReason(event.target.value)}
              disabled={disabled}
              required
            />
          </label>
          <button
            className="button button-light"
            type="submit"
            disabled={disabled || !reason.trim()}
          >
            {busyId === cancelSlot
              ? <LoaderCircle className="spin" aria-hidden="true" />
              : <PauseCircle aria-hidden="true" />}
            뉴스 내리기
          </button>
        </form>
      )}
    </article>
  );
}

function StockNewsSection({
  news,
  teacherView,
  classIsActive,
  busyId,
  onCancel,
}: {
  news: FinanceStockNews[];
  teacherView: boolean;
  classIsActive: boolean;
  busyId: string | null;
  onCancel?: (item: FinanceStockNews, reason: string) => Promise<boolean>;
}) {
  const activeCount = news.filter((item) => item.status === "active").length;
  const titleId = teacherView ? "teacher-stock-news-list-title" : "student-stock-news-list-title";
  return (
    <section style={styles.section} aria-labelledby={titleId}>
      <div style={styles.sectionHeading}>
        <div>
          <p className="eyebrow">시장 소식</p>
          <h3 id={titleId} style={styles.sectionTitle}>현재·최근 뉴스</h3>
          <p style={styles.muted}>새 뉴스는 다음 시세 갱신에 한 번 반영되고, 대기 시간이 지나면 자동 종료됩니다.</p>
        </div>
        <span style={{ ...styles.badge, color: "var(--color-info)", background: "var(--color-info-soft)" }}>
          진행 중 {activeCount}건
        </span>
      </div>
      {news.length === 0 ? (
        <div className="finance-empty-state compact">
          <Newspaper aria-hidden="true" />
          <b>아직 등록된 시장 뉴스가 없어요</b>
          <p>{teacherView ? "뉴스를 등록해 학급 주식시장에 새로운 이야기를 더해 보세요." : "새 소식이 올라오면 이곳에서 바로 볼 수 있어요."}</p>
        </div>
      ) : (
        <div style={styles.newsGrid}>
          {news.map((item) => (
            <StockNewsCard
              key={item.id}
              item={item}
              teacherView={teacherView}
              disabled={!classIsActive || busyId !== null}
              busyId={busyId}
              onCancel={onCancel}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PriceChart({ stock, unit }: { stock: FinanceStockAsset; unit: string }) {
  const values = stock.priceHistory.length > 0 ? stock.priceHistory : [stock.currentPrice];
  const width = 640;
  const height = 210;
  const padding = 28;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = Math.max(1, maximum - minimum);
  const points = values.map((value, index) => {
    const x = values.length === 1
      ? width / 2
      : padding + ((width - padding * 2) * index) / (values.length - 1);
    const y = height - padding - ((value - minimum) / range) * (height - padding * 2);
    return `${x},${y}`;
  }).join(" ");
  const rising = values.at(-1)! >= values[0];
  return (
    <div style={styles.chartCard}>
      <div style={{ ...styles.sectionHeading, marginBottom: 8 }}>
        <div>
          <b>가격 흐름</b>
          <p style={styles.muted}>{values.length === 1 ? "첫 가격이 등록됐어요" : `최근 ${values.length}회 가격`}</p>
        </div>
        <strong style={{ color: rising ? "var(--color-success)" : "var(--color-danger)" }}>
          {moneyText(stock.currentPrice, unit)}
        </strong>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={styles.chart}
        role="img"
        aria-labelledby="finance-stock-chart-title finance-stock-chart-description"
      >
        <title id="finance-stock-chart-title">{stock.name} 가격 그래프</title>
        <desc id="finance-stock-chart-description">
          최저 {moneyText(minimum, unit)}, 최고 {moneyText(maximum, unit)}, 현재 {moneyText(stock.currentPrice, unit)}
        </desc>
        {[0, 1, 2, 3, 4].map((line) => {
          const y = padding + ((height - padding * 2) / 4) * line;
          return <line key={line} x1={padding} x2={width - padding} y1={y} y2={y} stroke="var(--color-border)" strokeWidth="1" />;
        })}
        {values.length > 1 ? (
          <polyline
            points={points}
            fill="none"
            stroke={rising ? "var(--color-success)" : "var(--color-danger)"}
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <circle cx={width / 2} cy={height / 2} r="7" fill="var(--color-info)" />
        )}
      </svg>
    </div>
  );
}

function TradeHistory({ trades, unit, teacherView }: {
  trades: FinanceStockTrade[];
  unit: string;
  teacherView: boolean;
}) {
  if (trades.length === 0) {
    return (
      <div className="finance-empty-state compact">
        <BarChart3 aria-hidden="true" />
        <b>아직 주식 거래가 없어요</b>
        <p>{teacherView ? "학생이 거래하면 여기에 전체 기록이 쌓입니다." : "내 첫 거래가 끝나면 여기에 기록됩니다."}</p>
      </div>
    );
  }
  return (
    <div className="tableWrap" tabIndex={0} aria-label={teacherView ? "학급 전체 주식 거래 기록" : "내 주식 거래 기록"}>
      <table style={styles.table}>
        <caption className="sr-only">{teacherView ? "학급 전체 주식 거래 기록" : "내 주식 거래 기록"}</caption>
        <thead>
          <tr>
            <th scope="col">시간</th>
            {teacherView && <th scope="col">학생</th>}
            <th scope="col">구분</th>
            <th scope="col">수량</th>
            <th scope="col">체결가</th>
            <th scope="col">수수료</th>
            <th scope="col">{teacherView ? "실제 금액" : "지갑 반영"}</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr key={trade.id}>
              <td style={styles.tableCell}>{dateTimeText(trade.createdAt)}</td>
              {teacherView && (
                <td style={styles.tableCell}>
                  {trade.student ? `${trade.student.number ? `${trade.student.number}번 ` : ""}${trade.student.name}` : "교사·시스템"}
                </td>
              )}
              <td>
                <span className={`finance-request-status ${trade.side === "buy" ? "approved" : "pending"}`}>
                  {trade.side === "buy" ? "매수" : "매도"}
                </span>
              </td>
              <td style={styles.tableCell}>{trade.quantity.toLocaleString("ko-KR")}주</td>
              <td style={styles.tableCell}>{moneyText(trade.price, unit)}</td>
              <td style={styles.tableCell}>{moneyText(trade.fee, unit)}</td>
              <td style={styles.tableCell}>
                {trade.side === "buy" ? "-" : "+"}{moneyText(trade.netAmount, unit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeacherHoldingCard({
  holder,
  liquidation,
  stock,
  market,
  settingsRevision,
  unit,
  denominationStep,
  disabled,
  busyId,
  onLiquidate,
  onCancelLiquidation,
}: {
  holder: FinanceStockHolder;
  liquidation: FinanceStockLiquidation | null;
  stock: FinanceStockAsset;
  market: FinanceStockMarket;
  settingsRevision: number;
  unit: string;
  denominationStep: number;
  disabled: boolean;
  busyId: string | null;
  onLiquidate: (
    holder: FinanceStockHolder,
    reason: string,
    liquidation?: FinanceStockLiquidation,
  ) => Promise<boolean>;
  onCancelLiquidation: (
    liquidation: FinanceStockLiquidation,
    reason: string,
  ) => Promise<boolean>;
}) {
  const [reason, setReason] = useState("");
  const [cancellationReason, setCancellationReason] = useState("");
  const [confirmedSnapshot, setConfirmedSnapshot] = useState<string | null>(null);
  const [snapshotChanged, setSnapshotChanged] = useState(false);
  const snapshot = `${holder.revision}:${holder.shares}:${stock.revision}:${stock.currentPrice}:${market.revision}:${market.sellSpread}:${market.sellFeeBps}:${settingsRevision}:${denominationStep}`;
  const confirmed = confirmedSnapshot === snapshot;
  const previousSnapshot = useRef(snapshot);
  const slot = `stock-liquidate:${holder.student.id}`;
  const sellPrice = Math.max(0, stock.currentPrice - market.sellSpread);
  const gross = BigInt(sellPrice) * BigInt(holder.shares);
  const rawFee = (gross * BigInt(market.sellFeeBps)) / BigInt(10_000);
  const step = BigInt(denominationStep);
  const fee = (rawFee / step) * step;
  const payout = gross - fee;
  const quoteWithinSystemLimit = payout <= BigInt(MAX_AMOUNT);
  const canLiquidate = stock.status !== "archived" && quoteWithinSystemLimit;

  useEffect(() => {
    if (previousSnapshot.current === snapshot) return;
    previousSnapshot.current = snapshot;
    setReason("");
    setConfirmedSnapshot(null);
    setSnapshotChanged(true);
  }, [snapshot]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reason.trim().length < 2 || !confirmed) return;
    const completed = await onLiquidate(holder, reason.trim());
    if (completed) setSnapshotChanged(false);
  }

  if (liquidation?.status === "running") {
    const progress = liquidation.initialQuantity > 0
      ? Math.round((liquidation.soldQuantity * 100) / liquidation.initialQuantity)
      : 0;
    const resumeSlot = `stock-liquidate:${holder.student.id}`;
    const cancelSlot = `stock-liquidation-cancel:${liquidation.id}`;
    return (
      <article style={{ ...styles.newsCard, borderColor: "var(--color-warning)" }}>
        <div style={{ ...styles.actions, justifyContent: "space-between" }}>
          <strong>{holder.student.number}번 {holder.student.name}</strong>
          <span className="finance-request-status pending">청산 진행 중</span>
        </div>
        <p style={styles.muted}>
          시작할 때 확인한 매도가와 수수료를 고정해 안전한 크기로 나누어 처리합니다.
        </p>
        <progress
          value={liquidation.soldQuantity}
          max={liquidation.initialQuantity}
          aria-label={`비상 청산 ${progress}% 완료`}
          style={{ width: "100%", minHeight: 14 }}
        />
        <div style={styles.preview}>
          <div style={styles.previewRow}>
            <span>고정 매도가·수수료</span>
            <strong>{moneyText(liquidation.frozenQuote.unitPrice, unit)} · {bpsText(liquidation.frozenQuote.feeBps)}</strong>
          </div>
          <div style={styles.previewRow}>
            <span>처리한 수량</span>
            <strong>{liquidation.soldQuantity.toLocaleString("ko-KR")} / {liquidation.initialQuantity.toLocaleString("ko-KR")}주</strong>
          </div>
          <div style={styles.previewRow}>
            <span>남은 수량</span>
            <strong>{liquidation.remainingQuantity.toLocaleString("ko-KR")}주</strong>
          </div>
          <div style={styles.previewRow}>
            <span>지급 완료</span>
            <strong>{moneyText(liquidation.totalPayoutAmount, unit)}</strong>
          </div>
          <div style={styles.previewRow}>
            <span>전체 예상 지급</span>
            <strong>{moneyText(liquidation.expectedPayoutAmount, unit)}</strong>
          </div>
        </div>
        <div className="finance-action-notice info" style={{ marginTop: 10 }}>
          <ShieldCheck aria-hidden="true" />
          <p>다음 버튼은 남은 수량 중 안전한 한 묶음만 처리합니다. 중복 클릭해도 같은 묶음은 한 번만 반영됩니다.</p>
        </div>
        <button
          className="button button-primary button-large"
          style={styles.fullAction}
          type="button"
          disabled={disabled}
          onClick={() => void onLiquidate(
            holder,
            liquidation.interventionReason,
            liquidation,
          )}
        >
          {busyId === resumeSlot
            ? <LoaderCircle className="spin" aria-hidden="true" />
            : <RefreshCw aria-hidden="true" />}
          다음 묶음 이어 처리
        </button>
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 750 }}>작업을 중단해야 하나요?</summary>
          <form
            style={{ display: "grid", gap: 8, marginTop: 10 }}
            onSubmit={(event) => {
              event.preventDefault();
              if (cancellationReason.trim().length >= 2) {
                void onCancelLiquidation(liquidation, cancellationReason.trim());
              }
            }}
          >
            <label style={styles.label}>
              취소 이유
              <input
                value={cancellationReason}
                minLength={2}
                maxLength={300}
                onChange={(event) => setCancellationReason(event.target.value)}
                disabled={disabled}
                required
              />
            </label>
            <button
              className="button finance-danger-button"
              type="submit"
              disabled={disabled || cancellationReason.trim().length < 2}
            >
              {busyId === cancelSlot
                ? <LoaderCircle className="spin" aria-hidden="true" />
                : <CircleAlert aria-hidden="true" />}
              진행 작업 취소
            </button>
          </form>
        </details>
      </article>
    );
  }

  return (
    <article style={styles.newsCard}>
      <div style={{ ...styles.actions, justifyContent: "space-between" }}>
        <strong>{holder.student.number}번 {holder.student.name}</strong>
        <span style={{ ...styles.badge, color: "var(--color-info)", background: "var(--color-info-soft)" }}>
          {holder.shares.toLocaleString("ko-KR")}주
        </span>
      </div>
      <div style={styles.preview}>
        <div style={styles.previewRow}><span>평균 매수가</span><strong>{moneyText(holder.averagePrice, unit)}</strong></div>
        <div style={styles.previewRow}><span>현재 평가액</span><strong>{exactMoneyText(BigInt(stock.currentPrice) * BigInt(holder.shares), unit)}</strong></div>
        <div style={styles.previewRow}><span>예상 수수료</span><strong>{exactMoneyText(fee, unit)}</strong></div>
        <div style={styles.previewRow}><span>전량 매도 예상 지급</span><strong>{exactMoneyText(payout, unit)}</strong></div>
      </div>
      <details>
        <summary style={{ cursor: "pointer", fontWeight: 750 }}>문제 발생 시 교사가 비상 청산</summary>
        <form style={{ display: "grid", gap: 8, marginTop: 10 }} onSubmit={submit}>
          <label style={styles.label}>
            처리 이유
            <input
              value={reason}
              minLength={2}
              maxLength={300}
              onChange={(event) => {
                setReason(event.target.value);
                setSnapshotChanged(false);
              }}
              disabled={disabled || !canLiquidate}
              required
            />
          </label>
          {snapshotChanged && (
            <small className="finance-inline-alert" role="alert">
              보유량이나 지급 기준이 바뀌었어요. 최신 수량과 금액을 다시 확인해 주세요.
            </small>
          )}
          {!canLiquidate && (
            <small style={styles.fieldHelp}>
              {stock.status === "archived"
                ? "보관된 종목은 비상 청산할 수 없어요."
                : "예상 지급액이 지갑 안전 한도 10억을 넘어요. 현재 가격을 낮춘 뒤 다시 확인해 주세요."}
            </small>
          )}
          {canLiquidate && (!market.isOpen || stock.status === "halted") && (
            <small style={styles.fieldHelp}>
              학생 거래는 멈춰 있지만, 담임교사 비상 청산은 현재 표시된 매도가와 수수료로 안전하게 처리돼요.
            </small>
          )}
          <label className="finance-confirm-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmedSnapshot(
                event.target.checked ? snapshot : null,
              )}
              disabled={disabled || !canLiquidate}
            />
            <span>{holder.student.name} 학생의 {holder.shares.toLocaleString("ko-KR")}주를 전량 매도하고 약 {exactMoneyText(payout, unit)}을 지갑에 지급하는 것을 확인했어요.</span>
          </label>
          <button
            className="button finance-danger-button"
            type="submit"
            disabled={disabled || !canLiquidate || reason.trim().length < 2 || !confirmed}
          >
            {busyId === slot
              ? <LoaderCircle className="spin" aria-hidden="true" />
              : <ShieldCheck aria-hidden="true" />}
            {holder.shares.toLocaleString("ko-KR")}주 전량 청산
          </button>
        </form>
      </details>
    </article>
  );
}

export function FinanceStocksPanel({
  classId,
  financeRole,
  actorType,
  classIsActive = true,
  currencyLabel,
  denominations,
  refreshRevision = 0,
  onRefresh,
}: FinanceStocksPanelProps) {
  const unit = currencyLabel?.trim() || "학급화폐";
  const moneyStep = useMemo(() => {
    const valid = (denominations ?? []).filter((value) => Number.isSafeInteger(value) && value > 0);
    return valid.length > 0 ? Math.min(...valid) : 1;
  }, [denominations]);
  const isTeacher = financeRole === "teacher" && (actorType === undefined || actorType === "teacher");
  const [data, setData] = useState<FinanceStocksData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const actionKeys = useRef<Record<string, { fingerprint: string; key: string }>>({});
  const requestSequence = useRef(0);
  const lastExternalRefresh = useRef(refreshRevision);

  const loadStocks = useCallback(async (quiet = false, signal?: AbortSignal) => {
    const sequence = ++requestSequence.current;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ classId });
      const response = await fetch(`/api/finance/stocks?${query.toString()}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(response.status, payload));
      if (signal?.aborted || requestSequence.current !== sequence) return;
      const normalized = normalizeStocksResponse(payload);
      setData(normalized);
      return normalized;
    } catch (reason) {
      if ((reason as Error).name !== "AbortError" && requestSequence.current === sequence) {
        setError(reason instanceof Error ? reason.message : "주식 정보를 불러오지 못했어요.");
      }
      return null;
    } finally {
      if (!signal?.aborted && requestSequence.current === sequence) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [classId]);

  useEffect(() => {
    const controller = new AbortController();
    const frame = requestAnimationFrame(() => void loadStocks(false, controller.signal));
    return () => {
      cancelAnimationFrame(frame);
      controller.abort();
    };
  }, [loadStocks]);

  useEffect(() => {
    if (lastExternalRefresh.current === refreshRevision) return;
    lastExternalRefresh.current = refreshRevision;
    const controller = new AbortController();
    void loadStocks(true, controller.signal);
    return () => controller.abort();
  }, [loadStocks, refreshRevision]);

  const refreshEverything = useCallback(async () => {
    await loadStocks(true);
    await onRefresh?.().catch(() => undefined);
  }, [loadStocks, onRefresh]);

  async function createStock(draft: CreateDraft) {
    const name = draft.name.trim();
    const symbol = draft.symbol.trim().toLocaleUpperCase("en-US");
    const description = draft.description.trim();
    const initialPrice = Number(draft.initialPrice);
    const totalSupply = Number(draft.totalSupply);
    const maxSharesPerStudent = Number(draft.maxSharesPerStudent);
    const buyFeeBps = parsePercentToBps(draft.buyFeePercent);
    const sellFeeBps = parsePercentToBps(draft.sellFeePercent);
    const buySpread = Number(draft.buySpread);
    const sellSpread = Number(draft.sellSpread);
    if (!name || name.length > 40) {
      setNotice({ tone: "error", message: "회사 이름은 40자 안으로 적어 주세요." });
      return false;
    }
    if (!symbol || symbol.length > 12 || /\s/.test(symbol)) {
      setNotice({ tone: "error", message: "종목 기호는 띄어쓰기 없이 12자 안으로 적어 주세요." });
      return false;
    }
    if (description.length > 200) {
      setNotice({ tone: "error", message: "회사 소개는 200자 안으로 적어 주세요." });
      return false;
    }
    if (!Number.isSafeInteger(initialPrice) || initialPrice <= 0 || initialPrice > MAX_AMOUNT || initialPrice % moneyStep !== 0) {
      setNotice({ tone: "error", message: `첫 가격은 ${moneyText(moneyStep, unit)} 단위의 양수로 적어 주세요.` });
      return false;
    }
    if (!Number.isSafeInteger(totalSupply) || totalSupply < 1 || totalSupply > MAX_SUPPLY) {
      setNotice({ tone: "error", message: `총 발행량은 1주 이상 ${MAX_SUPPLY.toLocaleString("ko-KR")}주 이하로 적어 주세요.` });
      return false;
    }
    if (!Number.isSafeInteger(maxSharesPerStudent) || maxSharesPerStudent < 1 || maxSharesPerStudent > totalSupply) {
      setNotice({ tone: "error", message: "학생 1명당 보유 한도는 1주 이상, 총 발행량 이하로 적어 주세요." });
      return false;
    }
    if (buyFeeBps === null || sellFeeBps === null) {
      setNotice({ tone: "error", message: "수수료는 0% 이상 10% 이하, 소수 둘째 자리까지 적어 주세요." });
      return false;
    }
    if (
      !Number.isSafeInteger(buySpread)
      || !Number.isSafeInteger(sellSpread)
      || buySpread < 0
      || sellSpread < 0
      || buySpread > MAX_AMOUNT
      || sellSpread > MAX_AMOUNT
      || buySpread % moneyStep !== 0
      || sellSpread % moneyStep !== 0
    ) {
      setNotice({ tone: "error", message: `매수·매도 가격 차이는 ${moneyText(moneyStep, unit)} 단위의 0 이상 금액으로 적어 주세요.` });
      return false;
    }
    const input = {
      name,
      symbol,
      ...(description ? { description } : {}),
      initialPrice,
      totalSupply,
      maxSharesPerStudent,
      buyFeeBps,
      sellFeeBps,
      buySpread,
      sellSpread,
    };
    const slot = "stock-create";
    const idempotencyKey = getStableActionKey(actionKeys, slot, JSON.stringify(input));
    setBusyId(slot);
    setNotice(null);
    try {
      await sendAction(`/api/finance/stocks?classId=${encodeURIComponent(classId)}`, "POST", {
        ...input,
        idempotencyKey,
      });
      delete actionKeys.current[slot];
      setNotice({ tone: "success", message: `${name} 주식이 만들어졌어요. 설정을 확인한 뒤 장을 열어 주세요.` });
      await refreshEverything();
      return true;
    } catch (reason) {
      setNotice({ tone: "error", message: reason instanceof Error ? reason.message : "주식을 만들지 못했어요." });
      await refreshEverything().catch(() => undefined);
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function updateMarket(draft: MarketDraft, isOpen: boolean) {
    if (!data?.stock) return false;
    const buyFeeBps = parsePercentToBps(draft.buyFeePercent);
    const sellFeeBps = parsePercentToBps(draft.sellFeePercent);
    const buySpread = Number(draft.buySpread);
    const sellSpread = Number(draft.sellSpread);
    if (buyFeeBps === null || sellFeeBps === null) {
      setNotice({ tone: "error", message: "수수료는 0% 이상 10% 이하, 소수 둘째 자리까지 적어 주세요." });
      return false;
    }
    if (
      !Number.isSafeInteger(buySpread)
      || !Number.isSafeInteger(sellSpread)
      || buySpread < 0
      || sellSpread < 0
      || buySpread > MAX_AMOUNT
      || sellSpread > MAX_AMOUNT
      || buySpread % moneyStep !== 0
      || sellSpread % moneyStep !== 0
    ) {
      setNotice({ tone: "error", message: `매수·매도 가격 차이는 ${moneyText(moneyStep, unit)} 단위의 0 이상 금액으로 적어 주세요.` });
      return false;
    }
    const input = {
      isOpen,
      mood: draft.mood,
      buyFeeBps,
      sellFeeBps,
      buySpread,
      sellSpread,
      expectedRevision: data.market.revision,
    };
    const slot = "stock-market-update";
    const idempotencyKey = getStableActionKey(actionKeys, slot, JSON.stringify(input));
    setBusyId(slot);
    setNotice(null);
    try {
      await sendAction(`/api/finance/stocks/market?classId=${encodeURIComponent(classId)}`, "PUT", {
        ...input,
        idempotencyKey,
      });
      delete actionKeys.current[slot];
      setNotice({
        tone: "success",
        message: isOpen !== data.market.isOpen
          ? isOpen
            ? `${moodLabel(draft.mood)}으로 장을 열었어요. 학생들이 이제 거래할 수 있습니다.`
            : "주식 장을 마감했어요. 기록은 그대로 보존됩니다."
          : "장 운영 설정을 저장했어요.",
      });
      await refreshEverything();
      return true;
    } catch (reason) {
      setNotice({ tone: "error", message: reason instanceof Error ? reason.message : "장 설정을 바꾸지 못했어요." });
      await refreshEverything().catch(() => undefined);
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function updateAsset(draft: AssetDraft) {
    if (!data?.stock) return false;
    const currentPrice = Number(draft.currentPrice);
    if (!Number.isSafeInteger(currentPrice) || currentPrice <= 0 || currentPrice > MAX_AMOUNT || currentPrice % moneyStep !== 0) {
      setNotice({ tone: "error", message: `현재 가격은 ${moneyText(moneyStep, unit)} 단위의 양수로 적어 주세요.` });
      return false;
    }
    const input = {
      currentPrice,
      status: draft.status,
      expectedRevision: data.stock.revision,
    };
    const slot = `stock-asset-update:${data.stock.id}`;
    const idempotencyKey = getStableActionKey(actionKeys, slot, JSON.stringify(input));
    setBusyId(slot);
    setNotice(null);
    try {
      await sendAction(
        `/api/finance/stocks/assets/${encodeURIComponent(data.stock.id)}?classId=${encodeURIComponent(classId)}`,
        "PUT",
        { ...input, idempotencyKey },
      );
      delete actionKeys.current[slot];
      setNotice({ tone: "success", message: "종목 가격과 거래 상태를 저장했어요. 변경 내용은 기록에 남습니다." });
      await refreshEverything();
      return true;
    } catch (reason) {
      setNotice({ tone: "error", message: reason instanceof Error ? reason.message : "종목 설정을 바꾸지 못했어요." });
      await refreshEverything().catch(() => undefined);
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function tickStock() {
    if (!data?.stock) return false;
    const input = {
      expectedStockRevision: data.stock.revision,
      expectedMarketRevision: data.market.revision,
    };
    const slot = `stock-tick:${data.stock.id}`;
    const idempotencyKey = getStableActionKey(actionKeys, slot, JSON.stringify(input));
    setBusyId(slot);
    setNotice(null);
    try {
      const result = await sendAction(`/api/finance/stocks/tick?classId=${encodeURIComponent(classId)}`, "POST", {
        ...input,
        idempotencyKey,
      });
      delete actionKeys.current[slot];
      setNotice({
        tone: "success",
        message: isRecord(result) && result.skipped
          ? "이번에는 최소 권종 안에서 가격 변화가 없어 현재가를 유지했어요."
          : "현재 장세와 새 뉴스를 반영해 시세를 갱신했어요.",
      });
      await refreshEverything();
      return true;
    } catch (reason) {
      setNotice({ tone: "error", message: reason instanceof Error ? reason.message : "시세를 갱신하지 못했어요." });
      await refreshEverything().catch(() => undefined);
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function createNews(draft: NewsDraft) {
    const title = draft.title.trim();
    const content = draft.content.trim();
    const impactBps = Number(draft.impactBps);
    const durationMinutes = Number(draft.durationMinutes);
    if (!title || title.length > 80) {
      setNotice({ tone: "error", message: "뉴스 제목은 1자 이상 80자 이하로 적어 주세요." });
      return false;
    }
    if (!content || content.length > 500) {
      setNotice({ tone: "error", message: "뉴스 내용은 1자 이상 500자 이하로 적어 주세요." });
      return false;
    }
    if (!Number.isSafeInteger(impactBps) || impactBps < -1_000 || impactBps > 1_000) {
      setNotice({ tone: "error", message: "가격 영향은 -10%부터 +10% 사이에서 골라 주세요." });
      return false;
    }
    if (!Number.isSafeInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 1_440) {
      setNotice({ tone: "error", message: "뉴스 유지 시간은 5분부터 24시간 사이에서 골라 주세요." });
      return false;
    }
    const input = { title, content, impactBps, durationMinutes };
    const slot = "stock-news-create";
    const idempotencyKey = getStableActionKey(actionKeys, slot, JSON.stringify(input));
    setBusyId(slot);
    setNotice(null);
    try {
      await sendAction(`/api/finance/stocks/news?classId=${encodeURIComponent(classId)}`, "POST", {
        ...input,
        idempotencyKey,
      });
      delete actionKeys.current[slot];
      setNotice({ tone: "success", message: "시장 뉴스가 등록됐어요. 다음 시세 갱신에 한 번 반영됩니다." });
      await refreshEverything();
      return true;
    } catch (reason) {
      setNotice({ tone: "error", message: reason instanceof Error ? reason.message : "시장 뉴스를 등록하지 못했어요." });
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function cancelNews(item: FinanceStockNews, reason: string) {
    const normalizedReason = reason.trim();
    if (!normalizedReason || normalizedReason.length > 300) {
      setNotice({ tone: "error", message: "뉴스를 내리는 이유는 1자 이상 300자 이하로 적어 주세요." });
      return false;
    }
    const input = {
      newsId: item.id,
      expectedRevision: item.revision,
      reason: normalizedReason,
    };
    const slot = `stock-news-cancel:${item.id}`;
    const idempotencyKey = getStableActionKey(actionKeys, slot, JSON.stringify(input));
    setBusyId(slot);
    setNotice(null);
    try {
      await sendAction(`/api/finance/stocks/news?classId=${encodeURIComponent(classId)}`, "DELETE", {
        ...input,
        idempotencyKey,
      });
      delete actionKeys.current[slot];
      setNotice({ tone: "success", message: `‘${item.title}’ 뉴스를 내렸어요. 기록은 그대로 남습니다.` });
      await refreshEverything();
      return true;
    } catch (errorReason) {
      setNotice({ tone: "error", message: errorReason instanceof Error ? errorReason.message : "시장 뉴스를 내리지 못했어요." });
      await refreshEverything().catch(() => undefined);
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function liquidateHolding(
    holder: FinanceStockHolder,
    reason: string,
    liquidation?: FinanceStockLiquidation,
  ) {
    if (!data?.stock) return false;
    const input = {
      studentId: holder.student.id,
      reason,
      origin: "finance_center",
      expectedStockRevision: liquidation?.frozenQuote.stockRevision
        ?? data.stock.revision,
      expectedMarketRevision: liquidation?.frozenQuote.marketRevision
        ?? data.market.revision,
      expectedFinanceSettingsRevision:
        liquidation?.frozenQuote.financeSettingsRevision
        ?? data.settingsRevision,
      expectedHoldingRevision: liquidation?.snapshot.holdingRevision
        ?? holder.revision,
      ...(liquidation
        ? {
            operationId: liquidation.id,
            expectedOperationRevision: liquidation.revision,
          }
        : {}),
    };
    const slot = `stock-liquidate:${holder.student.id}`;
    const idempotencyKey = liquidation?.rootIdempotencyKey
      ?? getStableActionKey(
        actionKeys,
        slot,
        JSON.stringify({ stockId: data.stock.id, ...input }),
      );
    setBusyId(slot);
    setNotice(null);
    try {
      const result = await sendAction(
        `/api/finance/stocks/assets/${encodeURIComponent(data.stock.id)}/liquidate?classId=${encodeURIComponent(classId)}`,
        "POST",
        { ...input, idempotencyKey },
      );
      delete actionKeys.current[slot];
      const savedOperation = isRecord(result)
        ? normalizeLiquidation(result.operation)
        : null;
      if (savedOperation?.status === "running") {
        setNotice({
          tone: "info",
          message: `${holder.student.number}번 ${holder.student.name} 학생의 비상 청산 ${savedOperation.completedChunkCount}단계를 반영했어요. 남은 ${savedOperation.remainingQuantity.toLocaleString("ko-KR")}주는 ‘다음 묶음 이어 처리’를 눌러 주세요.`,
        });
      } else {
        setNotice({
          tone: "success",
          message: `${holder.student.number}번 ${holder.student.name} 학생의 보유 주식을 전량 청산해 지갑에 반영했어요. 처리 이유도 금융 기록에 남겼습니다.`,
        });
      }
      await refreshEverything();
      return true;
    } catch (reasonValue) {
      const refreshed = await loadStocks(true).catch(() => null);
      const refreshedOperation = refreshed?.liquidations.find(
        (item) => item.rootIdempotencyKey === idempotencyKey,
      );
      const refreshedTrade = refreshed?.trades.find(
        (item) => item.idempotencyKey === idempotencyKey,
      );
      if (refreshedOperation?.status === "completed") {
        delete actionKeys.current[slot];
        setNotice({
          tone: "success",
          message: "응답이 늦었지만 비상 청산이 중복 없이 모두 반영된 것을 확인했어요.",
        });
        await onRefresh?.().catch(() => undefined);
        return true;
      }
      if (!refreshedOperation && refreshedTrade) {
        delete actionKeys.current[slot];
        setNotice({
          tone: "success",
          message: "응답이 늦었지만 비상 청산 거래가 중복 없이 반영된 것을 확인했어요.",
        });
        await onRefresh?.().catch(() => undefined);
        return true;
      }
      if (
        refreshedOperation?.status === "running"
        && refreshedOperation.revision > (liquidation?.revision ?? 0)
      ) {
        setNotice({
          tone: "info",
          message: `응답은 늦었지만 한 묶음이 정상 반영됐어요. 남은 ${refreshedOperation.remainingQuantity.toLocaleString("ko-KR")}주는 진행 카드에서 이어서 처리해 주세요.`,
        });
        await onRefresh?.().catch(() => undefined);
        return true;
      }
      if (refreshedOperation?.status === "running") {
        setNotice({
          tone: "error",
          message: reasonValue instanceof Error
            ? reasonValue.message
            : "이번 묶음은 반영되지 않았어요. 진행 카드에서 다시 시도하거나 작업을 취소할 수 있습니다.",
        });
        await onRefresh?.().catch(() => undefined);
        return false;
      }
      setNotice({
        tone: "error",
        message: reasonValue instanceof Error ? reasonValue.message : "비상 청산을 마치지 못했어요.",
      });
      await onRefresh?.().catch(() => undefined);
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function cancelLiquidation(
    liquidation: FinanceStockLiquidation,
    reason: string,
  ) {
    const input = {
      expectedOperationRevision: liquidation.revision,
      reason: reason.trim(),
    };
    const slot = `stock-liquidation-cancel:${liquidation.id}`;
    const idempotencyKey = getStableActionKey(
      actionKeys,
      slot,
      JSON.stringify(input),
    );
    setBusyId(slot);
    setNotice(null);
    try {
      await sendAction(
        `/api/finance/stocks/liquidations/${encodeURIComponent(liquidation.id)}/cancel?classId=${encodeURIComponent(classId)}`,
        "POST",
        { ...input, idempotencyKey },
      );
      delete actionKeys.current[slot];
      setNotice({
        tone: "info",
        message: "비상 청산 진행 작업을 취소했어요. 이미 반영된 거래와 취소 이유는 기록에 그대로 남습니다.",
      });
      await refreshEverything();
      return true;
    } catch (reasonValue) {
      const refreshed = await loadStocks(true).catch(() => null);
      const refreshedOperation = refreshed?.liquidations.find(
        (item) => item.id === liquidation.id,
      );
      if (
        refreshedOperation?.status === "cancelled"
        && refreshedOperation.cancellationIdempotencyKey === idempotencyKey
      ) {
        delete actionKeys.current[slot];
        setNotice({
          tone: "info",
          message: "응답이 늦었지만 비상 청산 작업이 취소된 것을 확인했어요. 이미 반영된 거래와 취소 이유는 기록에 남습니다.",
        });
        await onRefresh?.().catch(() => undefined);
        return true;
      }
      setNotice({
        tone: "error",
        message: reasonValue instanceof Error
          ? reasonValue.message
          : "비상 청산 작업을 취소하지 못했어요.",
      });
      await onRefresh?.().catch(() => undefined);
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function trade(side: StockSide, quantity: number) {
    if (!data?.stock || !data.wallet) return false;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_SUPPLY) {
      setNotice({ tone: "error", message: "거래 수량은 1주 이상의 정수로 적어 주세요." });
      return false;
    }
    const marketPrice = side === "buy"
      ? data.stock.currentPrice + data.market.buySpread
      : Math.max(0, data.stock.currentPrice - data.market.sellSpread);
    const gross = marketPrice * quantity;
    const feeBps = side === "buy" ? data.market.buyFeeBps : data.market.sellFeeBps;
    const fee = tradeFee(gross, feeBps, data.denominationStep);
    const cashAmount = side === "buy" ? gross + fee : Math.max(0, gross - fee);
    const buyCapacity = Math.max(0, Math.min(
      data.stock.availableShares,
      data.stock.maxSharesPerStudent - data.holding.shares,
    ));
    if (side === "buy" && quantity > buyCapacity) {
      setNotice({ tone: "error", message: `지금은 최대 ${buyCapacity.toLocaleString("ko-KR")}주까지 살 수 있어요.` });
      return false;
    }
    if (side === "buy" && cashAmount > data.wallet.availableBalance) {
      setNotice({ tone: "error", message: "출금 신청 금액을 빼면 수수료를 포함한 결제금액이 부족해요." });
      return false;
    }
    if (side === "sell" && quantity > data.holding.shares) {
      setNotice({ tone: "error", message: `내가 가진 ${data.holding.shares.toLocaleString("ko-KR")}주보다 많이 팔 수 없어요.` });
      return false;
    }
    const input = {
      side,
      quantity,
      expectedStockRevision: data.stock.revision,
      expectedMarketRevision: data.market.revision,
      expectedFinanceSettingsRevision: data.settingsRevision,
      expectedHoldingRevision: data.holding.revision,
      expectedWalletRevision: data.wallet.revision,
    };
    const slot = `stock-trade:${data.stock.id}:${side}`;
    const idempotencyKey = getStableActionKey(
      actionKeys,
      slot,
      JSON.stringify({ stockId: data.stock.id, side, quantity }),
    );
    setBusyId(slot);
    setNotice(null);
    try {
      await sendAction(
        `/api/finance/stocks/assets/${encodeURIComponent(data.stock.id)}/trade?classId=${encodeURIComponent(classId)}`,
        "POST",
        { ...input, idempotencyKey },
      );
      delete actionKeys.current[slot];
      setNotice({
        tone: "success",
        message: `${quantity.toLocaleString("ko-KR")}주 ${side === "buy" ? "매수" : "매도"}가 끝났어요. 지갑과 보유 주식에 바로 반영했습니다.`,
      });
      await refreshEverything();
      return true;
    } catch (reason) {
      const refreshed = await loadStocks(true).catch(() => null);
      if (refreshed?.trades.some((item) => item.idempotencyKey === idempotencyKey)) {
        delete actionKeys.current[slot];
        setNotice({
          tone: "success",
          message: "응답이 늦었지만 거래가 한 번만 정상 반영된 것을 확인했어요.",
        });
        await onRefresh?.().catch(() => undefined);
        return true;
      }
      setNotice({ tone: "error", message: reason instanceof Error ? reason.message : "주식 거래를 마치지 못했어요." });
      await onRefresh?.().catch(() => undefined);
      return false;
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <section id="finance-stocks" className="finance-operations-card" style={styles.cardTop} aria-busy="true">
        <div className="finance-operation-heading">
          <div>
            <p className="eyebrow">우리 반 주식시장</p>
            <h2>주식 정보를 불러오고 있어요</h2>
          </div>
          <LoaderCircle className="spin" aria-hidden="true" />
        </div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section id="finance-stocks" className="finance-operations-card" style={styles.cardTop}>
        <div className="finance-operation-heading">
          <div>
            <p className="eyebrow">우리 반 주식시장</p>
            <h2>주식 정보를 불러오지 못했어요</h2>
            <p role="alert">{error}</p>
          </div>
          <CircleAlert aria-hidden="true" />
        </div>
        <div style={{ ...styles.actions, marginTop: 16 }}>
          <button className="button button-light" type="button" onClick={() => void loadStocks(false)}>
            <RefreshCw aria-hidden="true" />다시 불러오기
          </button>
        </div>
      </section>
    );
  }

  return (
    <section id="finance-stocks" className="finance-operations-card" style={styles.cardTop} aria-labelledby="finance-stocks-title">
      <div className="finance-operation-heading">
        <div>
          <p className="eyebrow">우리 반 주식시장</p>
          <h2 id="finance-stocks-title">{isTeacher ? "학급 주식시장을 운영해요" : "뉴스를 보고 직접 투자해요"}</h2>
          <p>
            {isTeacher
              ? "한 학급에 한 종목을 만들고 장 운영과 거래 기록을 한눈에 확인할 수 있어요."
              : "현재 가격과 수수료를 확인한 뒤 내 주식을 바로 사고팔 수 있어요."}
          </p>
        </div>
        <BarChart3 style={styles.headerIcon} aria-hidden="true" />
      </div>

      <StatusNotice notice={notice} />

      {!classIsActive && (
        <div className="finance-action-notice info" role="status">
          <LockKeyhole aria-hidden="true" />
          <p><b>보관 중인 학급입니다.</b> 주식과 거래 기록은 볼 수 있지만 새 설정이나 거래는 할 수 없어요.</p>
        </div>
      )}

      {isTeacher ? (
        <TeacherStocks
          key={data.stock ? `${data.market.revision}:${data.stock.revision}` : "not-created"}
          data={data}
          unit={unit}
          moneyStep={moneyStep}
          classIsActive={classIsActive}
          busyId={busyId}
          refreshing={refreshing}
          onCreate={createStock}
          onMarketUpdate={updateMarket}
          onAssetUpdate={updateAsset}
          onTick={tickStock}
          onCreateNews={createNews}
          onCancelNews={cancelNews}
          onLiquidate={liquidateHolding}
          onCancelLiquidation={cancelLiquidation}
          onRefresh={() => void refreshEverything()}
        />
      ) : (
        <StudentStocks
          data={data}
          financeRole={financeRole}
          unit={unit}
          classIsActive={classIsActive}
          busyId={busyId}
          refreshing={refreshing}
          onTrade={trade}
          onRefresh={() => void refreshEverything()}
        />
      )}
    </section>
  );
}

function TeacherStocks({
  data,
  unit,
  moneyStep,
  classIsActive,
  busyId,
  refreshing,
  onCreate,
  onMarketUpdate,
  onAssetUpdate,
  onTick,
  onCreateNews,
  onCancelNews,
  onLiquidate,
  onCancelLiquidation,
  onRefresh,
}: {
  data: FinanceStocksData;
  unit: string;
  moneyStep: number;
  classIsActive: boolean;
  busyId: string | null;
  refreshing: boolean;
  onCreate: (draft: CreateDraft) => Promise<boolean>;
  onMarketUpdate: (draft: MarketDraft, isOpen: boolean) => Promise<boolean>;
  onAssetUpdate: (draft: AssetDraft) => Promise<boolean>;
  onTick: () => Promise<boolean>;
  onCreateNews: (draft: NewsDraft) => Promise<boolean>;
  onCancelNews: (item: FinanceStockNews, reason: string) => Promise<boolean>;
  onLiquidate: (
    holder: FinanceStockHolder,
    reason: string,
    liquidation?: FinanceStockLiquidation,
  ) => Promise<boolean>;
  onCancelLiquidation: (
    liquidation: FinanceStockLiquidation,
    reason: string,
  ) => Promise<boolean>;
  onRefresh: () => void;
}) {
  const suggestedPrice = Math.max(10_000, moneyStep * 100);
  const [createDraft, setCreateDraft] = useState<CreateDraft>({
    name: "우리 반 주식회사",
    symbol: "CLASS",
    description: "우리 반의 활동과 선택에 따라 함께 성장하는 학급 주식입니다.",
    initialPrice: String(suggestedPrice),
    totalSupply: "100",
    maxSharesPerStudent: "10",
    buyFeePercent: "5",
    sellFeePercent: "5",
    buySpread: "0",
    sellSpread: "0",
  });
  const [marketDraft, setMarketDraft] = useState<MarketDraft>({
    mood: data.market.mood,
    buyFeePercent: String(data.market.buyFeeBps / 100),
    sellFeePercent: String(data.market.sellFeeBps / 100),
    buySpread: String(data.market.buySpread),
    sellSpread: String(data.market.sellSpread),
  });
  const [assetDraft, setAssetDraft] = useState<AssetDraft>({
    currentPrice: String(data.stock?.currentPrice ?? suggestedPrice),
    status: data.stock?.status ?? "active",
  });
  const [newsDraft, setNewsDraft] = useState<NewsDraft>({
    title: "",
    content: "",
    impactBps: "0",
    durationMinutes: "120",
  });
  const disabled = busyId !== null || !classIsActive;

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onCreate(createDraft);
  }

  async function submitMarket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onMarketUpdate(marketDraft, data.market.isOpen);
  }

  async function submitAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onAssetUpdate(assetDraft);
  }

  async function submitNews(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const completed = await onCreateNews(newsDraft);
    if (completed) {
      setNewsDraft({ title: "", content: "", impactBps: "0", durationMinutes: "120" });
    }
  }

  if (!data.stock) {
    return (
      <section style={styles.section} aria-labelledby="create-stock-title">
        <div style={styles.sectionHeading}>
          <div>
            <p className="eyebrow">처음 한 번만</p>
            <h3 id="create-stock-title" style={styles.sectionTitle}>우리 반 주식을 만들어요</h3>
            <p style={styles.muted}>회사 이름과 첫 가격을 정하면 학생 화면에도 같은 종목이 나타납니다.</p>
          </div>
          <span style={{ ...styles.badge, color: "var(--color-info)", background: "var(--color-info-soft)" }}>학급당 1종목</span>
        </div>
        <form style={styles.form} onSubmit={submitCreate}>
          <div style={styles.fieldGrid}>
            <label style={styles.label}>
              회사 이름
              <input value={createDraft.name} maxLength={40} onChange={(event) => setCreateDraft({ ...createDraft, name: event.target.value })} disabled={disabled} required />
              <small style={styles.fieldHelp}>학생 화면에 가장 크게 표시됩니다.</small>
            </label>
            <label style={styles.label}>
              종목 기호
              <input value={createDraft.symbol} maxLength={12} onChange={(event) => setCreateDraft({ ...createDraft, symbol: event.target.value.toLocaleUpperCase("en-US") })} disabled={disabled} required />
              <small style={styles.fieldHelp}>예: CLASS, SEOI5</small>
            </label>
          </div>
          <label style={styles.label}>
            회사 소개
            <textarea value={createDraft.description} maxLength={200} rows={3} onChange={(event) => setCreateDraft({ ...createDraft, description: event.target.value })} disabled={disabled} />
          </label>
          <div style={styles.fieldGrid}>
            <MoneyField label="첫 가격" value={createDraft.initialPrice} unit={unit} min={moneyStep} step={moneyStep} disabled={disabled} onChange={(value) => setCreateDraft({ ...createDraft, initialPrice: value })} />
            <NumberField label="총 발행량" value={createDraft.totalSupply} suffix="주" min={1} max={MAX_SUPPLY} disabled={disabled} onChange={(value) => setCreateDraft({ ...createDraft, totalSupply: value })} />
            <NumberField label="학생 1명당 보유 한도" value={createDraft.maxSharesPerStudent} suffix="주" min={1} max={MAX_SUPPLY} disabled={disabled} onChange={(value) => setCreateDraft({ ...createDraft, maxSharesPerStudent: value })} />
            <PercentField label="매수 수수료" value={createDraft.buyFeePercent} disabled={disabled} onChange={(value) => setCreateDraft({ ...createDraft, buyFeePercent: value })} />
            <PercentField label="매도 수수료" value={createDraft.sellFeePercent} disabled={disabled} onChange={(value) => setCreateDraft({ ...createDraft, sellFeePercent: value })} />
            <MoneyField label="매수 가격 차이" value={createDraft.buySpread} unit={unit} min={0} step={moneyStep} disabled={disabled} onChange={(value) => setCreateDraft({ ...createDraft, buySpread: value })} help="현재가에 더해지는 금액" />
            <MoneyField label="매도 가격 차이" value={createDraft.sellSpread} unit={unit} min={0} step={moneyStep} disabled={disabled} onChange={(value) => setCreateDraft({ ...createDraft, sellSpread: value })} help="현재가에서 빠지는 금액" />
          </div>
          <div className="finance-action-notice info" style={{ marginTop: 0 }}>
            <ShieldCheck aria-hidden="true" />
            <p>발행 후에도 가격·거래 상태·수수료는 바꿀 수 있지만 회사와 총 발행량은 안전을 위해 고정됩니다.</p>
          </div>
          <button className="button button-primary button-large" style={styles.fullAction} type="submit" disabled={disabled}>
            {busyId === "stock-create" ? <LoaderCircle className="spin" aria-hidden="true" /> : <Building2 aria-hidden="true" />}
            우리 반 주식 만들기
          </button>
        </form>
      </section>
    );
  }

  const stock = data.stock;
  const priceChange = stock.previousPrice === null ? 0 : stock.currentPrice - stock.previousPrice;
  return (
    <>
      <div style={styles.companyCard}>
        <Building2 style={styles.companyIcon} aria-hidden="true" />
        <div style={{ minWidth: 0 }}>
          <div style={{ ...styles.actions, gap: 7 }}>
            <strong style={{ fontSize: "var(--text-lg)", overflowWrap: "anywhere" }}>{stock.name}</strong>
            <span style={{ ...styles.badge, color: "var(--color-info)", background: "var(--color-info-soft)" }}>{stock.symbol}</span>
          </div>
          {stock.description && <p style={styles.muted}>{stock.description}</p>}
        </div>
        <MarketBadge market={data.market} stock={stock} />
      </div>

      <div style={styles.hero}>
        <SummaryCard icon={<Coins />} label="현재가" value={moneyText(stock.currentPrice, unit)} help={priceChange === 0 ? "이전 가격과 같아요" : `직전보다 ${signedMoneyText(priceChange, unit)}`} />
        <SummaryCard icon={<Users />} label="보유 학생" value={`${stock.holderCount.toLocaleString("ko-KR")}명`} help={`학생 보유 ${stock.issuedShares.toLocaleString("ko-KR")}주`} />
        <SummaryCard icon={<BarChart3 />} label="거래량" value={`${stock.volume.toLocaleString("ko-KR")}주`} help={`시장에 ${stock.availableShares.toLocaleString("ko-KR")}주 남음`} />
        <SummaryCard icon={data.market.isOpen ? <PlayCircle /> : <PauseCircle />} label="오늘 장세" value={moodLabel(data.market.mood)} help={data.market.isOpen ? "학생 거래 가능" : "장 마감 중"} />
      </div>

      <section style={styles.section} aria-labelledby="teacher-market-control-title">
        <div style={styles.sectionHeading}>
          <div>
            <p className="eyebrow">오늘의 운영</p>
            <h3 id="teacher-market-control-title" style={styles.sectionTitle}>장세를 고르고 장을 열어요</h3>
            <p style={styles.muted}>장세와 비용을 저장하고, 준비가 끝나면 학생 거래를 시작하세요.</p>
            <p style={styles.muted}>
              자동 시세 {data.market.tickIntervalMinutes.toLocaleString("ko-KR")}분 간격
              {data.market.nextTickAt ? ` · 다음 갱신 ${dateTimeText(data.market.nextTickAt)}` : " · 장을 열면 다음 갱신 시간이 정해져요"}
            </p>
          </div>
          <div style={styles.actions}>
            <button
              className="button button-primary"
              type="button"
              onClick={() => void onTick()}
              disabled={disabled || !data.market.isOpen || ["halted", "archived"].includes(stock.status)}
            >
              {busyId === `stock-tick:${stock.id}`
                ? <LoaderCircle className="spin" aria-hidden="true" />
                : <TrendingUp aria-hidden="true" />}
              지금 시세 갱신
            </button>
            <button className="button button-light" type="button" onClick={onRefresh} disabled={refreshing || busyId !== null}>
              <RefreshCw className={refreshing ? "spin" : undefined} aria-hidden="true" />새로고침
            </button>
          </div>
        </div>
        <form style={styles.form} onSubmit={submitMarket}>
          <fieldset style={{ display: "grid", gap: 9, minWidth: 0, margin: 0, padding: 0, border: 0 }} disabled={disabled}>
            <legend style={{ ...styles.label, marginBottom: 8 }}>오늘의 장세</legend>
            <div style={styles.moodGrid}>
              {MOODS.map((mood) => (
                <button
                  key={mood.value}
                  className="button button-light"
                  style={{ ...styles.moodButton, ...(marketDraft.mood === mood.value ? styles.activeMood : {}) }}
                  type="button"
                  aria-pressed={marketDraft.mood === mood.value}
                  onClick={() => setMarketDraft({ ...marketDraft, mood: mood.value })}
                >
                  <b>{mood.label}</b>
                  <small>{mood.description}</small>
                </button>
              ))}
            </div>
          </fieldset>
          <div style={styles.fieldGrid}>
            <PercentField label="매수 수수료" value={marketDraft.buyFeePercent} disabled={disabled} onChange={(value) => setMarketDraft({ ...marketDraft, buyFeePercent: value })} />
            <PercentField label="매도 수수료" value={marketDraft.sellFeePercent} disabled={disabled} onChange={(value) => setMarketDraft({ ...marketDraft, sellFeePercent: value })} />
            <MoneyField label="매수 가격 차이" value={marketDraft.buySpread} unit={unit} min={0} step={moneyStep} disabled={disabled} onChange={(value) => setMarketDraft({ ...marketDraft, buySpread: value })} help="학생 매수가 = 현재가 + 차이" />
            <MoneyField label="매도 가격 차이" value={marketDraft.sellSpread} unit={unit} min={0} step={moneyStep} disabled={disabled} onChange={(value) => setMarketDraft({ ...marketDraft, sellSpread: value })} help="학생 매도가 = 현재가 - 차이" />
          </div>
          <div style={styles.actions}>
            <button className="button button-light" style={styles.fullAction} type="submit" disabled={disabled}>
              {busyId === "stock-market-update" ? <LoaderCircle className="spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
              설정만 저장
            </button>
            <button
              className={data.market.isOpen ? "button finance-danger-button" : "button button-primary"}
              style={styles.fullAction}
              type="button"
              onClick={() => void onMarketUpdate(marketDraft, !data.market.isOpen)}
              disabled={disabled || (!data.market.isOpen && ["halted", "archived"].includes(stock.status))}
            >
              {busyId === "stock-market-update"
                ? <LoaderCircle className="spin" aria-hidden="true" />
                : data.market.isOpen ? <PauseCircle aria-hidden="true" /> : <PlayCircle aria-hidden="true" />}
              {data.market.isOpen ? "장 마감" : "이 설정으로 장 열기"}
            </button>
          </div>
        </form>
      </section>

      <section style={styles.section} aria-labelledby="teacher-stock-settings-title">
        <div style={styles.sectionHeading}>
          <div>
            <p className="eyebrow">비상 운영 설정</p>
            <h3 id="teacher-stock-settings-title" style={styles.sectionTitle}>현재 가격과 거래 상태</h3>
            <p style={styles.muted}>직접 변경한 내용도 교사 기록에 남습니다.</p>
          </div>
        </div>
        <form style={styles.form} onSubmit={submitAsset}>
          <div style={styles.fieldGrid}>
            <MoneyField label="현재 가격" value={assetDraft.currentPrice} unit={unit} min={moneyStep} step={moneyStep} disabled={disabled} onChange={(value) => setAssetDraft({ ...assetDraft, currentPrice: value })} />
            <label style={styles.label}>
              종목 거래 상태
              <select value={assetDraft.status} onChange={(event) => setAssetDraft({ ...assetDraft, status: event.target.value as StockStatus })} disabled={disabled}>
                <option value="active">거래 허용</option>
                <option value="sell_only">매도만 허용</option>
                <option value="halted">종목 거래 중지</option>
                <option value="archived" disabled>종목 보관됨</option>
              </select>
              <small style={styles.fieldHelp}>장과 별개로 이 종목의 매매를 즉시 막을 수 있어요.</small>
            </label>
          </div>
          {data.market.isOpen && (
            <div className="finance-action-notice warning" style={{ marginTop: 0 }} role="status">
              <CircleAlert aria-hidden="true" />
              <p>장이 열린 상태에서 가격을 바꾸면 학생의 예상 금액도 달라집니다. 꼭 필요한 경우에만 사용하세요.</p>
            </div>
          )}
          <button className="button button-light" style={styles.fullAction} type="submit" disabled={disabled}>
            {busyId?.startsWith("stock-asset-update:") ? <LoaderCircle className="spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
            가격·상태 저장
          </button>
        </form>
      </section>

      <section style={styles.section} aria-labelledby="teacher-stock-news-create-title">
        <div style={styles.sectionHeading}>
          <div>
            <p className="eyebrow">교실 이야기</p>
            <h3 id="teacher-stock-news-create-title" style={styles.sectionTitle}>시장 뉴스 등록</h3>
            <p style={styles.muted}>학급의 사건을 뉴스로 알리고 다음 시세 변화에 영향을 줄 수 있어요.</p>
          </div>
          <Megaphone style={styles.headerIcon} aria-hidden="true" />
        </div>
        <form style={styles.form} onSubmit={submitNews}>
          <label style={styles.label}>
            뉴스 제목
            <input
              value={newsDraft.title}
              maxLength={80}
              placeholder="예: 우리 반 축제 대성공!"
              onChange={(event) => setNewsDraft({ ...newsDraft, title: event.target.value })}
              disabled={disabled}
              required
            />
          </label>
          <label style={styles.label}>
            뉴스 내용
            <textarea
              value={newsDraft.content}
              maxLength={500}
              rows={3}
              placeholder="학생들이 바로 이해할 수 있게 짧고 재미있게 적어 주세요."
              onChange={(event) => setNewsDraft({ ...newsDraft, content: event.target.value })}
              disabled={disabled}
              required
            />
          </label>
          <div style={styles.fieldGrid}>
            <label style={styles.label}>
              가격 영향
              <select
                value={newsDraft.impactBps}
                onChange={(event) => setNewsDraft({ ...newsDraft, impactBps: event.target.value })}
                disabled={disabled}
              >
                <option value="1000">큰 호재 (+10%)</option>
                <option value="500">호재 (+5%)</option>
                <option value="200">작은 호재 (+2%)</option>
                <option value="0">영향 없음 (0%)</option>
                <option value="-200">작은 악재 (-2%)</option>
                <option value="-500">악재 (-5%)</option>
                <option value="-1000">큰 악재 (-10%)</option>
              </select>
              <small style={styles.fieldHelp}>실제 변화는 현재 장세와 함께 계산됩니다.</small>
            </label>
            <label style={styles.label}>
              뉴스 반영 대기 시간
              <select
                value={newsDraft.durationMinutes}
                onChange={(event) => setNewsDraft({ ...newsDraft, durationMinutes: event.target.value })}
                disabled={disabled}
              >
                <option value="30">30분</option>
                <option value="60">1시간</option>
                <option value="120">2시간</option>
                <option value="360">6시간</option>
                <option value="720">12시간</option>
                <option value="1440">24시간</option>
              </select>
              <small style={styles.fieldHelp}>이 시간 안에 시세가 갱신되면 한 번 반영되고, 지나면 자동 종료됩니다.</small>
            </label>
          </div>
          <button className="button button-primary" style={styles.fullAction} type="submit" disabled={disabled}>
            {busyId === "stock-news-create"
              ? <LoaderCircle className="spin" aria-hidden="true" />
              : <Newspaper aria-hidden="true" />}
            시장 뉴스 등록
          </button>
        </form>
      </section>

      <StockNewsSection
        news={data.news}
        teacherView
        classIsActive={classIsActive}
        busyId={busyId}
        onCancel={onCancelNews}
      />

      <section style={styles.section} aria-labelledby="teacher-stock-holdings-title">
        <div style={styles.sectionHeading}>
          <div>
            <p className="eyebrow">현재 보유 현황</p>
            <h3 id="teacher-stock-holdings-title" style={styles.sectionTitle}>학생별 보유 주식</h3>
            <p style={styles.muted}>평소에는 학생이 직접 매도하고, 계정 정리나 오류가 있을 때만 교사가 비상 청산해요.</p>
          </div>
          <span style={{ ...styles.badge, color: "var(--color-info)", background: "var(--color-info-soft)" }}>
            {data.holdings.length.toLocaleString("ko-KR")}명 보유
          </span>
        </div>
        {data.holdings.length === 0 ? (
          <div className="finance-empty-state compact">
            <Coins aria-hidden="true" />
            <b>현재 주식을 보유한 학생이 없어요</b>
          </div>
        ) : (
          <div style={styles.newsGrid}>
            {data.holdings.map((holder) => (
              <TeacherHoldingCard
                key={holder.student.id}
                holder={holder}
                liquidation={data.liquidations.find((item) => (
                  item.studentId === holder.student.id
                  && item.stockId === stock.id
                  && item.status === "running"
                )) ?? null}
                stock={stock}
                market={data.market}
                settingsRevision={data.settingsRevision}
                unit={unit}
                denominationStep={data.denominationStep}
                disabled={disabled}
                busyId={busyId}
                onLiquidate={onLiquidate}
                onCancelLiquidation={onCancelLiquidation}
              />
            ))}
          </div>
        )}
        {data.liquidations.length > 0 && (
          <details style={{ marginTop: 14 }}>
            <summary style={{ cursor: "pointer", fontWeight: 800 }}>
              최근 비상 청산 작업 기록 {data.liquidations.length.toLocaleString("ko-KR")}건
            </summary>
            <div style={{ ...styles.newsGrid, marginTop: 10 }}>
              {data.liquidations.slice(0, 10).map((item) => (
                <article key={item.id} style={styles.newsCard}>
                  <div style={{ ...styles.actions, justifyContent: "space-between" }}>
                    <strong>
                      {item.student?.number ? `${item.student.number}번 ` : ""}
                      {item.student?.name ?? "학생"}
                    </strong>
                    <span className={`finance-request-status ${
                      item.status === "completed"
                        ? "approved"
                        : item.status === "cancelled"
                          ? "rejected"
                          : "pending"
                    }`}>
                      {item.status === "completed"
                        ? "완료"
                        : item.status === "cancelled"
                          ? "취소"
                          : "진행 중"}
                    </span>
                  </div>
                  <p style={styles.muted}>
                    {item.soldQuantity.toLocaleString("ko-KR")} / {item.initialQuantity.toLocaleString("ko-KR")}주 처리
                    {` · ${moneyText(item.totalPayoutAmount, unit)} 지급`}
                  </p>
                  <small style={styles.fieldHelp}>처리 이유: {item.interventionReason}</small>
                  {item.cancellationReason && (
                    <small style={styles.fieldHelp}>취소 이유: {item.cancellationReason}</small>
                  )}
                </article>
              ))}
            </div>
          </details>
        )}
      </section>

      <section style={styles.section} aria-labelledby="teacher-stock-chart-title">
        <h3 id="teacher-stock-chart-title" style={{ ...styles.sectionTitle, marginBottom: 14 }}>가격 흐름</h3>
        <PriceChart stock={stock} unit={unit} />
      </section>

      <section style={styles.section} aria-labelledby="teacher-stock-log-title">
        <div style={styles.sectionHeading}>
          <div>
            <p className="eyebrow">교사 확인</p>
            <h3 id="teacher-stock-log-title" style={styles.sectionTitle}>학급 전체 거래 기록</h3>
            <p style={styles.muted}>누가 언제 얼마에 몇 주를 거래했는지 확인할 수 있어요.</p>
          </div>
          <span style={{ ...styles.badge, color: "var(--color-info)", background: "var(--color-info-soft)" }}>{data.trades.length}건</span>
        </div>
        <TradeHistory trades={data.trades} unit={unit} teacherView />
      </section>
    </>
  );
}

function StudentStocks({
  data,
  financeRole,
  unit,
  classIsActive,
  busyId,
  refreshing,
  onTrade,
  onRefresh,
}: {
  data: FinanceStocksData;
  financeRole: FinanceStockRole;
  unit: string;
  classIsActive: boolean;
  busyId: string | null;
  refreshing: boolean;
  onTrade: (side: StockSide, quantity: number) => Promise<boolean>;
  onRefresh: () => void;
}) {
  const [side, setSide] = useState<StockSide>("buy");
  const [quantityText, setQuantityText] = useState("1");
  const stock = data.stock;
  if (!stock) {
    return (
      <div className="finance-empty-state compact" style={{ marginTop: 18 }}>
        <Building2 aria-hidden="true" />
        <b>아직 우리 반 주식이 만들어지지 않았어요</b>
        <p>선생님이 첫 주식을 만들면 이곳에서 바로 확인할 수 있습니다.</p>
      </div>
    );
  }

  const quantity = Number(quantityText);
  const validQuantity = Number.isSafeInteger(quantity) && quantity > 0;
  const price = side === "buy"
    ? stock.currentPrice + data.market.buySpread
    : Math.max(0, stock.currentPrice - data.market.sellSpread);
  const gross = validQuantity ? price * quantity : 0;
  const feeBps = side === "buy" ? data.market.buyFeeBps : data.market.sellFeeBps;
  const fee = tradeFee(gross, feeBps, data.denominationStep);
  const finalAmount = side === "buy" ? gross + fee : Math.max(0, gross - fee);
  const buyCapacity = Math.max(0, Math.min(
    stock.availableShares,
    stock.maxSharesPerStudent - data.holding.shares,
  ));
  const walletReady = data.wallet?.status === "active";
  const marketReady = data.market.isOpen && (
    stock.status === "active" || (side === "sell" && stock.status === "sell_only")
  );
  const quantityAllowed = validQuantity && (
    side === "buy"
      ? quantity <= buyCapacity && Boolean(data.wallet && finalAmount <= data.wallet.availableBalance)
      : quantity <= data.holding.shares
  );
  const trading = busyId === `stock-trade:${stock.id}:${side}`;
  const profitUp = data.holding.evaluationProfitExact >= BigInt(0);

  async function submitTrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validQuantity) return;
    const completed = await onTrade(side, quantity);
    if (completed) setQuantityText("1");
  }

  return (
    <>
      <div style={styles.companyCard}>
        <Building2 style={styles.companyIcon} aria-hidden="true" />
        <div style={{ minWidth: 0 }}>
          <div style={{ ...styles.actions, gap: 7 }}>
            <strong style={{ fontSize: "var(--text-lg)", overflowWrap: "anywhere" }}>{stock.name}</strong>
            <span style={{ ...styles.badge, color: "var(--color-info)", background: "var(--color-info-soft)" }}>{stock.symbol}</span>
          </div>
          {stock.description && <p style={styles.muted}>{stock.description}</p>}
        </div>
        <MarketBadge market={data.market} stock={stock} />
      </div>

      <div style={styles.hero}>
        <SummaryCard
          icon={<WalletCards />}
          label="내 지갑 사용 가능 금액"
          value={data.wallet ? moneyText(data.wallet.availableBalance, unit) : "확인 필요"}
          help={data.wallet?.status === "frozen"
            ? "지갑 사용이 잠시 멈췄어요"
            : data.wallet && data.wallet.pendingWithdrawalAmount > 0
              ? `출금 신청 ${moneyText(data.wallet.pendingWithdrawalAmount, unit)} 보관 중`
              : "수수료까지 포함해 확인해요"}
        />
        <SummaryCard icon={<Coins />} label="내 보유 주식" value={`${data.holding.shares.toLocaleString("ko-KR")}주`} help={`평균 매수가 ${moneyText(data.holding.averagePrice, unit)}`} />
        <SummaryCard icon={<BarChart3 />} label="현재 평가금액" value={exactMoneyText(data.holding.marketValueExact, unit)} help={`현재가 ${moneyText(stock.currentPrice, unit)}`} />
        <SummaryCard icon={profitUp ? <TrendingUp /> : <TrendingDown />} label="평가 손익" value={signedExactMoneyText(data.holding.evaluationProfitExact, unit)} help={profitUp ? "현재 가격 기준 이익" : "현재 가격 기준 손실"} />
      </div>

      <StockNewsSection
        news={data.news}
        teacherView={false}
        classIsActive={classIsActive}
        busyId={busyId}
      />

      <section style={styles.section} aria-labelledby="student-stock-market-title">
        <div style={styles.sectionHeading}>
          <div>
            <p className="eyebrow">{moodLabel(data.market.mood)}</p>
            <h3 id="student-stock-market-title" style={styles.sectionTitle}>가격을 보고 직접 거래해요</h3>
            <p style={styles.muted}>선택한 수량의 수수료와 최종 금액을 먼저 보여 드립니다.</p>
            {data.market.nextTickAt && (
              <p style={styles.muted}>다음 자동 시세: {dateTimeText(data.market.nextTickAt)}</p>
            )}
          </div>
          <button className="button button-light" type="button" onClick={onRefresh} disabled={refreshing || busyId !== null}>
            <RefreshCw className={refreshing ? "spin" : undefined} aria-hidden="true" />시세 새로고침
          </button>
        </div>

        {!marketReady && (
          <div className="finance-action-notice info" role="status">
            <PauseCircle aria-hidden="true" />
            <p><b>{!data.market.isOpen
              ? "지금은 장 마감 시간이에요."
              : stock.status === "sell_only" && side === "buy"
                ? "지금은 보유 주식만 팔 수 있어요."
                : stock.status === "archived"
                  ? "이 종목은 보관 상태예요."
                  : "종목 거래가 잠시 중지됐어요."}</b> 가격과 내 기록은 계속 볼 수 있습니다.</p>
          </div>
        )}

        <div style={styles.tradeGrid}>
          <PriceChart stock={stock} unit={unit} />
          <form style={styles.tradeCard} onSubmit={submitTrade}>
            <fieldset style={{ display: "grid", gap: 8, minWidth: 0, margin: 0, padding: 0, border: 0 }} disabled={busyId !== null}>
              <legend style={{ ...styles.label, marginBottom: 7 }}>거래 종류</legend>
              <div style={styles.quote}>
                <button
                  className="button button-light"
                  style={{ ...styles.moodButton, ...(side === "buy" ? styles.activeMood : {}) }}
                  type="button"
                  aria-pressed={side === "buy"}
                  onClick={() => setSide("buy")}
                >
                  <b>매수</b>
                  <small>{moneyText(stock.currentPrice + data.market.buySpread, unit)} · 수수료 {bpsText(data.market.buyFeeBps)}</small>
                </button>
                <button
                  className="button button-light"
                  style={{
                    ...styles.moodButton,
                    ...(side === "sell" ? {
                      color: "var(--color-warning)",
                      borderColor: "var(--color-warning)",
                      background: "var(--color-warning-soft)",
                    } : {}),
                  }}
                  type="button"
                  aria-pressed={side === "sell"}
                  onClick={() => setSide("sell")}
                >
                  <b>매도</b>
                  <small>{moneyText(Math.max(0, stock.currentPrice - data.market.sellSpread), unit)} · 수수료 {bpsText(data.market.sellFeeBps)}</small>
                </button>
              </div>
            </fieldset>

            <label style={styles.label}>
              {side === "buy" ? "살 수량" : "팔 수량"}
              <span style={styles.inputWithSuffix}>
                <input
                  style={styles.inputBare}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={side === "buy" ? Math.max(1, buyCapacity) : Math.max(1, data.holding.shares)}
                  step={1}
                  value={quantityText}
                  onChange={(event) => setQuantityText(event.target.value)}
                  disabled={busyId !== null || !classIsActive || !walletReady}
                  aria-describedby="stock-quantity-help"
                />
                <span style={styles.suffix}>주</span>
              </span>
              <small id="stock-quantity-help" style={styles.fieldHelp} aria-live="polite">
                {side === "buy"
                  ? `지금 최대 ${buyCapacity.toLocaleString("ko-KR")}주 매수 가능 · 사용 가능 ${data.wallet ? moneyText(data.wallet.availableBalance, unit) : "확인 필요"}${validQuantity && data.wallet && finalAmount > data.wallet.availableBalance ? ` · ${moneyText(finalAmount - data.wallet.availableBalance, unit)} 부족` : ""}`
                  : `내가 가진 ${data.holding.shares.toLocaleString("ko-KR")}주 안에서 매도 가능`}
              </small>
            </label>

            <div style={styles.preview} aria-live="polite">
              <div style={styles.previewRow}><span>체결 예정 가격</span><strong>{moneyText(price, unit)} × {validQuantity ? quantity : 0}주</strong></div>
              <div style={styles.previewRow}><span>거래금액</span><strong>{moneyText(gross, unit)}</strong></div>
              <div style={styles.previewRow}><span>수수료</span><strong>{moneyText(fee, unit)}</strong></div>
              <div style={{ ...styles.previewRow, paddingTop: 7, borderTop: "1px solid color-mix(in srgb, var(--color-info) 25%, transparent)" }}>
                <b>{side === "buy" ? "지갑에서 나갈 금액" : "지갑에 들어올 금액"}</b>
                <strong>{moneyText(finalAmount, unit)}</strong>
              </div>
            </div>

            <button
              className={side === "buy" ? "button button-primary button-large" : "button button-light button-large"}
              style={styles.fullAction}
              type="submit"
              disabled={!classIsActive || !walletReady || !marketReady || !quantityAllowed || busyId !== null}
            >
              {trading
                ? <LoaderCircle className="spin" aria-hidden="true" />
                : side === "buy" ? <TrendingUp aria-hidden="true" /> : <TrendingDown aria-hidden="true" />}
              {validQuantity ? `${quantity.toLocaleString("ko-KR")}주 ` : ""}{side === "buy" ? "바로 매수" : "바로 매도"}
            </button>
          </form>
        </div>
      </section>

      <section style={styles.section} aria-labelledby="student-stock-log-title">
        <div style={styles.sectionHeading}>
          <div>
            <p className="eyebrow">내 주식 기록</p>
            <h3 id="student-stock-log-title" style={styles.sectionTitle}>내가 사고판 내역</h3>
          </div>
          <span style={{ ...styles.badge, color: "var(--color-info)", background: "var(--color-info-soft)" }}>{data.trades.length}건</span>
        </div>
        <TradeHistory trades={data.trades} unit={unit} teacherView={false} />
      </section>

      <div className="finance-action-notice info">
        <ShieldCheck aria-hidden="true" />
        <p>
          <b>{financeRole === "banker" ? "은행원도 자기 주식만 거래합니다." : "은행원 승인은 필요하지 않아요."}</b>{" "}
          매수·매도와 수수료는 지갑, 보유 주식, 금융 기록에 한 번에 반영됩니다.
        </p>
      </div>
    </>
  );
}

function MoneyField({
  label,
  value,
  unit,
  min,
  step,
  disabled,
  onChange,
  help,
}: {
  label: string;
  value: string;
  unit: string;
  min: number;
  step: number;
  disabled: boolean;
  onChange: (value: string) => void;
  help?: string;
}) {
  return (
    <label style={styles.label}>
      {label}
      <span style={styles.inputWithSuffix}>
        <input style={styles.inputBare} type="number" inputMode="numeric" min={min} max={MAX_AMOUNT} step={step} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required />
        <span style={styles.suffix}>{unit}</span>
      </span>
      {help && <small style={styles.fieldHelp}>{help}</small>}
    </label>
  );
}

function NumberField({
  label,
  value,
  suffix,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  suffix: string;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label style={styles.label}>
      {label}
      <span style={styles.inputWithSuffix}>
        <input style={styles.inputBare} type="number" inputMode="numeric" min={min} max={max} step={1} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required />
        <span style={styles.suffix}>{suffix}</span>
      </span>
    </label>
  );
}

function PercentField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label style={styles.label}>
      {label}
      <span style={styles.inputWithSuffix}>
        <input style={styles.inputBare} type="number" inputMode="decimal" min={0} max={100} step={0.01} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required />
        <span style={styles.suffix}>%</span>
      </span>
    </label>
  );
}
