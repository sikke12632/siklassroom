"use client";

import {
  BadgeCheck,
  CalendarClock,
  CircleAlert,
  Clock3,
  Landmark,
  LoaderCircle,
  PauseCircle,
  PiggyBank,
  PlayCircle,
  Plus,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import {
  type CSSProperties,
  type Dispatch,
  type FormEvent,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type FinanceDepositRole = "teacher" | "banker" | "student";

export type FinanceDepositProduct = {
  id: string;
  name: string;
  description: string | null;
  termWeeks: number;
  maturityInterestBps: number;
  earlyInterestBps: number;
  minAmount: number;
  maxAmount: number;
  isOpen: boolean;
  revision: number;
  createdAt: number;
  updatedAt: number;
  subscriberCount: number;
  activeSubscriberCount: number;
  totalPrincipal: number;
  nextMaturityAt: number | null;
};

export type FinanceDepositContract = {
  id: string;
  productId: string;
  productName: string;
  principal: number;
  maturityInterest: number;
  earlyInterest: number;
  maturityPayout: number;
  earlyPayout: number;
  openedAt: number;
  maturesAt: number;
  status: "active" | "matured" | "maturity_paid" | "early_terminated";
  settledAt: number | null;
  settlementType: "maturity" | "early_termination" | null;
  payout: number | null;
  student: null | {
    id: string;
    number: number;
    name: string;
  };
};

export type FinanceDepositsData = {
  serverTime: number;
  products: FinanceDepositProduct[];
  contracts: FinanceDepositContract[];
  wallet: null | {
    balance: number;
    pendingWithdrawalAmount: number;
    availableBalance: number;
    status: "active" | "frozen" | "closed";
  };
  summary: {
    activeContractCount: number;
    activePrincipal: number;
    expectedMaturityPayout: number;
    settledContractCount: number;
  };
  automation: {
    due: number;
    settled: number;
    failed: number;
  };
};

export function depositAutomationChangedWallet(data: FinanceDepositsData) {
  return data.automation.settled > 0;
}

export type DepositAutomationRefreshState = {
  pending: boolean;
  queued: boolean;
};

export async function requestDepositAutomationRefresh(
  state: DepositAutomationRefreshState,
  refresh: () => Promise<void>,
) {
  if (state.pending) {
    state.queued = true;
    return;
  }
  state.pending = true;
  try {
    do {
      state.queued = false;
      await refresh().catch(() => undefined);
    } while (state.queued);
  } finally {
    state.pending = false;
  }
}

export type FinanceDepositsPanelProps = {
  classId: string;
  financeRole: FinanceDepositRole;
  actorType?: "teacher" | "student";
  classIsActive?: boolean;
  currencyLabel?: string;
  denominations?: number[];
  settings?: {
    currencyUnit?: string;
    denominations?: number[];
  };
  refreshRevision?: number;
  onRefresh?: () => Promise<void>;
};

type Notice = {
  tone: "success" | "error" | "info";
  message: string;
} | null;

type ProductDraft = {
  name: string;
  description: string;
  termWeeks: string;
  maturityInterestPercent: string;
  earlyInterestPercent: string;
  minAmount: string;
  maxAmount: string;
};

type LooseRecord = Record<string, unknown>;

const MAX_AMOUNT = 1_000_000_000;
const EMPTY_DRAFT: ProductDraft = {
  name: "",
  description: "",
  termWeeks: "4",
  maturityInterestPercent: "5",
  earlyInterestPercent: "0",
  minAmount: "100",
  maxAmount: "1000",
};

const styles: Record<string, CSSProperties> = {
  cardTop: { borderTop: "4px solid var(--color-success)" },
  headerIcon: {
    width: 38,
    height: 38,
    padding: 7,
    borderRadius: "var(--radius-md)",
    color: "var(--color-success)",
    background: "var(--color-success-soft)",
    flex: "0 0 auto",
  },
  guide: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 210px), 1fr))",
    gap: 10,
    marginTop: 18,
  },
  guideItem: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    gap: 10,
    alignItems: "center",
    padding: 13,
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    background: "var(--color-surface-raised)",
  },
  guideNumber: {
    display: "grid",
    placeItems: "center",
    width: 30,
    height: 30,
    borderRadius: "50%",
    color: "var(--color-success)",
    background: "var(--color-success-soft)",
    fontWeight: 850,
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
  productGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 310px), 1fr))",
    gap: 12,
  },
  productCard: {
    display: "grid",
    alignContent: "start",
    gap: 14,
    minWidth: 0,
    padding: 18,
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-lg)",
    background: "var(--color-surface-raised)",
  },
  productHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  productTitle: { margin: 0, fontSize: "var(--text-lg)", overflowWrap: "anywhere" },
  productDescription: { margin: "4px 0 0", color: "var(--color-text-muted)", fontSize: "var(--text-sm)" },
  statusOpen: {
    display: "inline-flex",
    flex: "0 0 auto",
    padding: "4px 9px",
    borderRadius: "var(--radius-pill)",
    color: "var(--color-success)",
    background: "var(--color-success-soft)",
    fontSize: "var(--text-xs)",
    fontWeight: 850,
  },
  statusPaused: {
    display: "inline-flex",
    flex: "0 0 auto",
    padding: "4px 9px",
    borderRadius: "var(--radius-pill)",
    color: "var(--color-text-muted)",
    background: "var(--color-surface-subtle)",
    fontSize: "var(--text-xs)",
    fontWeight: 850,
  },
  terms: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 8,
    margin: 0,
  },
  term: {
    minWidth: 0,
    padding: 10,
    borderRadius: "var(--radius-sm)",
    background: "var(--color-surface-subtle)",
  },
  termLabel: { display: "block", color: "var(--color-text-muted)", fontSize: "var(--text-xs)" },
  termValue: { display: "block", marginTop: 2, fontWeight: 800, overflowWrap: "anywhere" },
  actions: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  fullAction: { flex: "1 1 170px", justifyContent: "center" },
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
  label: { display: "grid", gap: 6, color: "var(--color-text)", fontSize: "var(--text-sm)", fontWeight: 750 },
  fieldHelp: { color: "var(--color-text-muted)", fontSize: "var(--text-xs)", fontWeight: 500 },
  preview: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 170px), 1fr))",
    gap: 8,
    padding: 13,
    borderRadius: "var(--radius-md)",
    color: "var(--color-success)",
    background: "var(--color-success-soft)",
  },
  previewItem: { display: "grid", gap: 2 },
  summaryGrid: {
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
    color: "var(--color-success)",
    background: "var(--color-success-soft)",
  },
  contractList: { display: "grid", gap: 10, margin: 0, padding: 0, listStyle: "none" },
  contractCard: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 14,
    alignItems: "center",
    padding: 15,
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    background: "var(--color-surface-raised)",
  },
  contractMeta: { display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap", marginBottom: 3 },
  tinyBadge: {
    display: "inline-flex",
    padding: "3px 7px",
    borderRadius: "var(--radius-pill)",
    color: "var(--color-info)",
    background: "var(--color-info-soft)",
    fontSize: "var(--text-xs)",
    fontWeight: 800,
  },
  progressTrack: {
    height: 8,
    overflow: "hidden",
    borderRadius: "var(--radius-pill)",
    background: "var(--color-surface-subtle)",
  },
  amountInput: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    border: "1px solid var(--color-border-strong)",
    borderRadius: "var(--radius-md)",
    background: "var(--color-surface)",
  },
  inputBare: { minWidth: 0, border: 0, boxShadow: "none" },
  inputSuffix: { paddingRight: 12, color: "var(--color-text-muted)", fontSize: "var(--text-sm)" },
};

function isRecord(value: unknown): value is LooseRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function booleanValue(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "open") return true;
  if (value === 0 || value === "0" || value === "paused" || value === "closed") return false;
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

function normalizeProduct(value: unknown): FinanceDepositProduct | null {
  if (!isRecord(value)) return null;
  const stats = isRecord(value.stats)
    ? value.stats
    : isRecord(value.statistics)
      ? value.statistics
      : {};
  const id = textValue(value.id);
  if (!id) return null;
  return {
    id,
    name: textValue(value.name, "이름 없는 예금"),
    description: textValue(value.description) || null,
    termWeeks: numberValue(value.termWeeks ?? value.term_weeks),
    maturityInterestBps: numberValue(value.maturityInterestBps ?? value.maturity_interest_bps),
    earlyInterestBps: numberValue(value.earlyInterestBps ?? value.early_interest_bps),
    minAmount: numberValue(value.minAmount ?? value.min_amount),
    maxAmount: numberValue(value.maxAmount ?? value.max_amount),
    isOpen: booleanValue(value.isOpen ?? value.saleStatus ?? value.status, true),
    revision: numberValue(value.revision),
    createdAt: epochValue(value.createdAt ?? value.created_at),
    updatedAt: epochValue(value.updatedAt ?? value.updated_at),
    subscriberCount: numberValue(value.subscriberCount ?? stats.subscriberCount ?? stats.subscriber_count),
    activeSubscriberCount: numberValue(value.activeSubscriberCount ?? stats.activeSubscriberCount ?? stats.active_subscriber_count),
    totalPrincipal: numberValue(value.totalPrincipal ?? stats.totalPrincipal ?? stats.total_principal),
    nextMaturityAt: epochValue(value.nextMaturityAt ?? stats.nextMaturityAt ?? stats.next_maturity_at) || null,
  };
}

function normalizedContractStatus(value: unknown): FinanceDepositContract["status"] {
  const status = textValue(value).toLocaleLowerCase("en-US");
  if (["maturity_paid", "matured_paid", "claimed", "completed", "paid"].includes(status)) {
    return "maturity_paid";
  }
  if (["early_terminated", "early_cancelled", "early_canceled", "cancelled", "canceled"].includes(status)) {
    return "early_terminated";
  }
  if (["matured", "due", "maturity_due"].includes(status)) return "matured";
  return "active";
}

function normalizeContract(value: unknown): FinanceDepositContract | null {
  if (!isRecord(value)) return null;
  const product = isRecord(value.product) ? value.product : {};
  const studentRaw = isRecord(value.student) ? value.student : null;
  const settlement = isRecord(value.settlement) ? value.settlement : {};
  const id = textValue(value.id);
  if (!id) return null;
  const settlementTypeRaw = textValue(
    value.settlementType
    ?? value.settlement_type
    ?? settlement.type
    ?? settlement.settlementType
    ?? settlement.settlement_type,
  );
  const settlementType = settlementTypeRaw === "maturity"
    ? "maturity"
    : settlementTypeRaw === "early_termination"
      ? "early_termination"
      : null;
  const rawStatus = textValue(value.status ?? settlement.status);
  const status = ["settled", "completed"].includes(rawStatus.toLocaleLowerCase("en-US"))
    ? settlementType === "early_termination" ? "early_terminated" : "maturity_paid"
    : normalizedContractStatus(rawStatus);
  const studentId = textValue(studentRaw?.id ?? value.studentId ?? value.student_id);
  return {
    id,
    productId: textValue(value.productId ?? value.product_id ?? product.id),
    productName: textValue(value.productName ?? value.product_name ?? product.name, "예금 상품"),
    principal: numberValue(value.principal),
    maturityInterest: numberValue(value.maturityInterest ?? value.maturity_interest),
    earlyInterest: numberValue(value.earlyInterest ?? value.early_interest),
    maturityPayout: numberValue(value.maturityPayout ?? value.maturity_payout),
    earlyPayout: numberValue(value.earlyPayout ?? value.early_payout),
    openedAt: epochValue(value.openedAt ?? value.opened_at),
    maturesAt: epochValue(value.maturesAt ?? value.matures_at),
    status,
    settledAt: epochValue(
      value.settledAt
      ?? value.settled_at
      ?? settlement.settledAt
      ?? settlement.settled_at,
    ) || null,
    settlementType,
    payout: numberValue(value.payout ?? settlement.payout) || null,
    student: studentId
      ? {
        id: studentId,
        number: numberValue(studentRaw?.number ?? value.studentNumber ?? value.student_number),
        name: textValue(studentRaw?.name ?? value.studentName ?? value.student_name, "학생"),
      }
      : null,
  };
}

export function normalizeDepositsResponse(value: unknown): FinanceDepositsData {
  if (!isRecord(value)) throw new Error("예금 정보를 확인할 수 없어요. 새로고침해 주세요.");
  const root = isRecord(value.deposits) ? value.deposits : value;
  const summaryRaw = isRecord(root.summary) ? root.summary : {};
  const walletRaw = isRecord(root.wallet) ? root.wallet : null;
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
  const automationRaw = isRecord(root.automation) ? root.automation : {};
  const products = Array.isArray(root.products)
    ? root.products.map(normalizeProduct).filter((item): item is FinanceDepositProduct => item !== null)
    : [];
  const contracts = Array.isArray(root.contracts)
    ? root.contracts.map(normalizeContract).filter((item): item is FinanceDepositContract => item !== null)
    : [];
  const active = contracts.filter((contract) => contract.status === "active" || contract.status === "matured");
  return {
    serverTime: epochValue(root.serverTime ?? root.server_time, Date.now()),
    products,
    contracts,
    wallet: walletRaw
      ? {
        balance: walletBalance,
        pendingWithdrawalAmount,
        availableBalance,
        status: ["frozen", "closed"].includes(textValue(walletRaw.status))
          ? textValue(walletRaw.status) as "frozen" | "closed"
          : "active",
      }
      : null,
    summary: {
      activeContractCount: numberValue(summaryRaw.activeContractCount, active.length),
      activePrincipal: numberValue(
        summaryRaw.activePrincipal,
        active.reduce((sum, contract) => sum + contract.principal, 0),
      ),
      expectedMaturityPayout: numberValue(
        summaryRaw.expectedMaturityPayout,
        active.reduce((sum, contract) => sum + contract.maturityPayout, 0),
      ),
      settledContractCount: numberValue(
        summaryRaw.settledContractCount,
        contracts.length - active.length,
      ),
    },
    automation: {
      due: numberValue(automationRaw.due),
      settled: numberValue(automationRaw.settled),
      failed: numberValue(automationRaw.failed),
    },
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
  return Number.isSafeInteger(bps) && bps >= 0 && bps <= 10_000 ? bps : null;
}

function bpsText(bps: number) {
  return `${(bps / 100).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
}

function amountText(value: number, unit: string) {
  return `${Math.max(0, value).toLocaleString("ko-KR")} ${unit}`;
}

function dateText(value: number | null) {
  if (!value) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}

function dateTimeText(value: number | null) {
  if (!value) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function remainingText(maturesAt: number, now: number) {
  const remaining = maturesAt - now;
  if (remaining <= 0) return "만기가 되어 자동 지급 중";
  const days = Math.ceil(remaining / 86_400_000);
  return days === 1 ? "내일 만기" : `${days}일 남음`;
}

function progressPercent(contract: FinanceDepositContract, now: number) {
  const duration = contract.maturesAt - contract.openedAt;
  if (duration <= 0) return 100;
  return Math.max(0, Math.min(100, ((now - contract.openedAt) / duration) * 100));
}

function apiErrorMessage(status: number, payload: unknown) {
  const raw = isRecord(payload) ? payload : {};
  const serverMessage = textValue(raw.error) || textValue(raw.message);
  if (status === 401) return "로그인이 풀렸어요. 다시 로그인해 주세요.";
  if (status === 403 || status === 404) return "이 학급의 예금을 이용할 권한이 없어요.";
  if (status === 409) {
    const code = textValue(raw.code);
    if (code.includes("STALE")) return "다른 화면에서 먼저 바뀌었어요. 최신 내용으로 다시 불러왔습니다.";
    return serverMessage || "이미 처리되었거나 최신 상태가 달라졌어요. 새로고침해 주세요.";
  }
  if (status === 422 || status === 400) return serverMessage || "입력 내용을 다시 확인해 주세요.";
  return serverMessage || "예금 처리에 실패했어요. 잠시 후 다시 시도해 주세요.";
}

async function sendAction(url: string, method: "POST" | "PATCH", body: LooseRecord) {
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
        <small style={styles.termLabel}>{label}</small>
        <strong style={{ display: "block", marginTop: 2, overflowWrap: "anywhere" }}>{value}</strong>
        <small style={styles.termLabel}>{help}</small>
      </div>
    </article>
  );
}

function ProductTerms({ product, unit }: { product: FinanceDepositProduct; unit: string }) {
  return (
    <dl style={styles.terms}>
      <div style={styles.term}>
        <dt style={styles.termLabel}>맡기는 기간</dt>
        <dd style={{ ...styles.termValue, marginInline: 0 }}>{product.termWeeks}주</dd>
      </div>
      <div style={styles.term}>
        <dt style={styles.termLabel}>만기 이자</dt>
        <dd style={{ ...styles.termValue, marginInline: 0 }}>원금의 {bpsText(product.maturityInterestBps)}</dd>
      </div>
      <div style={styles.term}>
        <dt style={styles.termLabel}>중도해지 이자</dt>
        <dd style={{ ...styles.termValue, marginInline: 0 }}>약정 이자의 {bpsText(product.earlyInterestBps)}</dd>
      </div>
      <div style={styles.term}>
        <dt style={styles.termLabel}>가입 금액</dt>
        <dd style={{ ...styles.termValue, marginInline: 0 }}>
          {amountText(product.minAmount, unit)} ~ {amountText(product.maxAmount, unit)}
        </dd>
      </div>
    </dl>
  );
}

function contractStatusText(contract: FinanceDepositContract, now: number) {
  if (contract.status === "maturity_paid") return "만기 지급 완료";
  if (contract.status === "early_terminated") return "중도해지 완료";
  if (contract.status === "matured" || contract.maturesAt <= now) return "만기 자동 지급 중";
  return "저축 중";
}

export function FinanceDepositsPanel({
  classId,
  financeRole,
  actorType,
  classIsActive = true,
  currencyLabel,
  denominations,
  settings,
  refreshRevision = 0,
  onRefresh,
}: FinanceDepositsPanelProps) {
  const unit = currencyLabel?.trim() || settings?.currencyUnit?.trim() || "학급화폐";
  const moneySteps = useMemo(() => {
    const values = denominations ?? settings?.denominations ?? [100, 500, 1000];
    return Array.from(new Set(values.filter((value) => Number.isSafeInteger(value) && value > 0)))
      .sort((left, right) => left - right);
  }, [denominations, settings?.denominations]);
  const isTeacher = financeRole === "teacher" && (actorType === undefined || actorType === "teacher");
  const [data, setData] = useState<FinanceDepositsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProductDraft>(EMPTY_DRAFT);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [joinConfirmation, setJoinConfirmation] = useState<string | null>(null);
  const [earlyConfirmation, setEarlyConfirmation] = useState<string | null>(null);
  const actionKeys = useRef<Record<string, { fingerprint: string; key: string }>>({});
  const requestSequence = useRef(0);
  const lastExternalRefresh = useRef(refreshRevision);
  const automationRefreshState = useRef<DepositAutomationRefreshState>({
    pending: false,
    queued: false,
  });

  const loadDeposits = useCallback(async (
    quiet = false,
    signal?: AbortSignal,
    settleMatured = true,
  ) => {
    const sequence = ++requestSequence.current;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ classId });
      if (!settleMatured) query.set("settleMatured", "0");
      const response = await fetch(`/api/finance/deposits?${query.toString()}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(response.status, payload));
      const normalized = normalizeDepositsResponse(payload);
      if (signal?.aborted) return null;
      if (requestSequence.current !== sequence) {
        return settleMatured && depositAutomationChangedWallet(normalized)
          ? normalized
          : null;
      }
      setData(normalized);
      return normalized;
    } catch (reason) {
      if ((reason as Error).name !== "AbortError" && requestSequence.current === sequence) {
        setError(reason instanceof Error ? reason.message : "예금 정보를 불러오지 못했어요.");
      }
      return null;
    } finally {
      if (!signal?.aborted && requestSequence.current === sequence) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [classId]);

  const synchronizeAutomatedSettlement = useCallback(async (
    loaded: FinanceDepositsData | null,
  ) => {
    if (
      !loaded
      || !depositAutomationChangedWallet(loaded)
      || !onRefresh
    ) return;
    await requestDepositAutomationRefresh(
      automationRefreshState.current,
      onRefresh,
    );
  }, [onRefresh]);

  useEffect(() => {
    const controller = new AbortController();
    const frame = requestAnimationFrame(() => {
      void loadDeposits(false, controller.signal).then(synchronizeAutomatedSettlement);
    });
    return () => {
      cancelAnimationFrame(frame);
      controller.abort();
    };
  }, [loadDeposits, synchronizeAutomatedSettlement]);

  useEffect(() => {
    if (lastExternalRefresh.current === refreshRevision) return;
    lastExternalRefresh.current = refreshRevision;
    const controller = new AbortController();
    void loadDeposits(true, controller.signal, false).then(synchronizeAutomatedSettlement);
    return () => controller.abort();
  }, [loadDeposits, refreshRevision, synchronizeAutomatedSettlement]);

  const refreshEverything = useCallback(async () => {
    await loadDeposits(true);
    await onRefresh?.().catch(() => undefined);
  }, [loadDeposits, onRefresh]);

  const settleContract = useCallback(async (
    contract: FinanceDepositContract,
    action: "early_termination" | "maturity",
  ) => {
    const slot = `deposit-settle:${contract.id}:${action}`;
    const key = getStableActionKey(actionKeys, slot, `${contract.id}:${action}`);
    setBusyId(slot);
    setNotice(null);
    try {
      await sendAction(
        `/api/finance/deposits/contracts/${encodeURIComponent(contract.id)}/settle`
          + `?classId=${encodeURIComponent(classId)}`,
        "POST",
        { action, idempotencyKey: key },
      );
      delete actionKeys.current[slot];
      setEarlyConfirmation(null);
      setNotice({
        tone: "success",
        message: action === "maturity"
          ? `${contract.productName} 만기 금액이 지갑에 자동 지급됐어요.`
          : `${contract.productName}을 중도해지하고 지급액을 지갑에 넣었어요.`,
      });
      await refreshEverything();
    } catch (reason) {
      setNotice({
        tone: "error",
        message: reason instanceof Error ? reason.message : "예금 해지를 처리하지 못했어요.",
      });
      await refreshEverything().catch(() => undefined);
    } finally {
      setBusyId(null);
    }
  }, [classId, refreshEverything]);

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draft.name.trim();
    const description = draft.description.trim();
    const termWeeks = Number(draft.termWeeks);
    const maturityInterestBps = parsePercentToBps(draft.maturityInterestPercent);
    const earlyInterestBps = parsePercentToBps(draft.earlyInterestPercent);
    const minAmount = Number(draft.minAmount);
    const maxAmount = Number(draft.maxAmount);
    const step = moneySteps[0] ?? 1;
    if (!name || name.length > 40) {
      setNotice({ tone: "error", message: "상품 이름은 40자 이내로 적어 주세요." });
      return;
    }
    if (description.length > 200) {
      setNotice({ tone: "error", message: "상품 설명은 200자 이내로 적어 주세요." });
      return;
    }
    if (!Number.isSafeInteger(termWeeks) || termWeeks < 1 || termWeeks > 52) {
      setNotice({ tone: "error", message: "기간은 1주 이상 52주 이하로 정해 주세요." });
      return;
    }
    if (maturityInterestBps === null || earlyInterestBps === null) {
      setNotice({ tone: "error", message: "이율은 0% 이상 100% 이하, 소수 둘째 자리까지 적어 주세요." });
      return;
    }
    if (
      !Number.isSafeInteger(minAmount)
      || !Number.isSafeInteger(maxAmount)
      || minAmount <= 0
      || maxAmount < minAmount
      || maxAmount > MAX_AMOUNT
      || minAmount % step !== 0
      || maxAmount % step !== 0
    ) {
      setNotice({
        tone: "error",
        message: `최소·최대 금액은 ${amountText(step, unit)} 단위로, 최소액이 최대액보다 크지 않게 적어 주세요.`,
      });
      return;
    }

    const input = {
      name,
      ...(description ? { description } : {}),
      termWeeks,
      maturityInterestBps,
      earlyInterestBps,
      minAmount,
      maxAmount,
    };
    const fingerprint = JSON.stringify(input);
    const idempotencyKey = getStableActionKey(actionKeys, "deposit-product-create", fingerprint);
    setBusyId("deposit-product-create");
    setNotice(null);
    try {
      await sendAction(
        `/api/finance/deposits/products?classId=${encodeURIComponent(classId)}`,
        "POST",
        { ...input, idempotencyKey },
      );
      delete actionKeys.current["deposit-product-create"];
      setDraft(EMPTY_DRAFT);
      setNotice({ tone: "success", message: `${name} 상품을 발행했어요. 학생들이 바로 가입할 수 있어요.` });
      await refreshEverything();
    } catch (reason) {
      setNotice({ tone: "error", message: reason instanceof Error ? reason.message : "상품을 발행하지 못했어요." });
      await refreshEverything().catch(() => undefined);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleProduct(product: FinanceDepositProduct) {
    const nextOpen = !product.isOpen;
    const slot = `deposit-product-toggle:${product.id}`;
    const fingerprint = `${product.id}:${product.revision}:${nextOpen}`;
    const idempotencyKey = getStableActionKey(actionKeys, slot, fingerprint);
    setBusyId(slot);
    setNotice(null);
    try {
      await sendAction(
        `/api/finance/deposits/products/${encodeURIComponent(product.id)}`
          + `?classId=${encodeURIComponent(classId)}`,
        "PATCH",
        { isOpen: nextOpen, expectedRevision: product.revision, idempotencyKey },
      );
      delete actionKeys.current[slot];
      setNotice({
        tone: "success",
        message: nextOpen
          ? `${product.name} 가입을 다시 열었어요.`
          : `${product.name} 신규 가입을 잠시 멈췄어요. 기존 예금은 그대로 유지됩니다.`,
      });
      await refreshEverything();
    } catch (reason) {
      setNotice({ tone: "error", message: reason instanceof Error ? reason.message : "판매 상태를 바꾸지 못했어요." });
      await refreshEverything().catch(() => undefined);
    } finally {
      setBusyId(null);
    }
  }

  async function subscribe(product: FinanceDepositProduct) {
    const amount = Number(amounts[product.id]);
    const step = moneySteps[0] ?? 1;
    if (
      !Number.isSafeInteger(amount)
      || amount < product.minAmount
      || amount > product.maxAmount
      || amount % step !== 0
    ) {
      setNotice({
        tone: "error",
        message: `${amountText(product.minAmount, unit)}부터 ${amountText(product.maxAmount, unit)}까지 ${amountText(step, unit)} 단위로 적어 주세요.`,
      });
      return;
    }
    if (data?.wallet && amount > data.wallet.availableBalance) {
      setNotice({ tone: "error", message: "출금 신청 금액을 뺀 사용 가능 금액보다 많이 맡길 수 없어요." });
      return;
    }
    const slot = `deposit-subscribe:${product.id}`;
    const fingerprint = `${product.id}:${amount}`;
    const idempotencyKey = getStableActionKey(actionKeys, slot, fingerprint);
    setBusyId(slot);
    setNotice(null);
    try {
      await sendAction(
        `/api/finance/deposits/products/${encodeURIComponent(product.id)}/subscribe`
          + `?classId=${encodeURIComponent(classId)}`,
        "POST",
        { amount, expectedProductRevision: product.revision, idempotencyKey },
      );
      delete actionKeys.current[slot];
      setAmounts((current) => ({ ...current, [product.id]: "" }));
      setJoinConfirmation(null);
      setNotice({ tone: "success", message: `${product.name} 가입을 마쳤어요. 만기에는 시스템이 자동으로 지급해요.` });
      await refreshEverything();
    } catch (reason) {
      setNotice({ tone: "error", message: reason instanceof Error ? reason.message : "예금에 가입하지 못했어요." });
      await refreshEverything().catch(() => undefined);
    } finally {
      setBusyId(null);
    }
  }

  const draftPreview = useMemo(() => {
    const principal = Number(draft.minAmount);
    const maturityBps = parsePercentToBps(draft.maturityInterestPercent);
    const earlyBps = parsePercentToBps(draft.earlyInterestPercent);
    if (!Number.isSafeInteger(principal) || principal <= 0 || maturityBps === null || earlyBps === null) return null;
    const maturityInterest = Math.floor((principal * maturityBps) / 10_000);
    const earlyInterest = Math.floor((maturityInterest * earlyBps) / 10_000);
    return { principal, maturityInterest, maturityPayout: principal + maturityInterest, earlyPayout: principal + earlyInterest };
  }, [draft.earlyInterestPercent, draft.maturityInterestPercent, draft.minAmount]);

  if (loading) {
    return (
      <section id="finance-deposits" className="finance-operations-card" style={styles.cardTop} aria-busy="true">
        <div className="finance-operation-heading">
          <div>
            <p className="eyebrow">자동으로 운영되는 예금</p>
            <h2>예금 상품을 불러오고 있어요</h2>
          </div>
          <LoaderCircle className="spin" aria-hidden="true" />
        </div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section id="finance-deposits" className="finance-operations-card" style={styles.cardTop}>
        <div className="finance-operation-heading">
          <div>
            <p className="eyebrow">자동으로 운영되는 예금</p>
            <h2>예금 정보를 불러오지 못했어요</h2>
            <p role="alert">{error}</p>
          </div>
          <CircleAlert aria-hidden="true" />
        </div>
        <div style={{ ...styles.actions, marginTop: 16 }}>
          <button className="button button-light" type="button" onClick={() => void loadDeposits(false).then(synchronizeAutomatedSettlement)}>
            <RefreshCw aria-hidden="true" />다시 불러오기
          </button>
        </div>
      </section>
    );
  }

  const now = data.serverTime;

  return (
    <section id="finance-deposits" className="finance-operations-card" style={styles.cardTop} aria-labelledby="finance-deposits-title">
      <div className="finance-operation-heading">
        <div>
          <p className="eyebrow">자동으로 운영되는 예금</p>
          <h2 id="finance-deposits-title">
            {isTeacher ? "예금 상품을 발행해요" : "내가 직접 저축하고 키워요"}
          </h2>
          <p>
            {isTeacher
              ? "선생님은 상품만 만들면 됩니다. 가입, 중도해지, 만기 지급은 학생과 시스템이 처리합니다."
              : "가입과 해지는 내가 직접 하고, 만기가 되면 받을 금액은 시스템이 지갑에 자동으로 넣어 줍니다."}
          </p>
        </div>
        <PiggyBank style={styles.headerIcon} aria-hidden="true" />
      </div>

      <StatusNotice notice={notice} />

      {data.automation.failed > 0 && (
        <div className="finance-action-notice warning" role="status">
          <CircleAlert aria-hidden="true" />
          <p>
            <b>만기 지급을 기다리는 예금이 있어요.</b>{" "}
            지갑이 잠겨 있거나 다른 거래가 처리 중일 수 있어 잠시 뒤 자동으로 다시 확인합니다.
          </p>
        </div>
      )}

      {!classIsActive && (
        <div className="finance-action-notice info" role="status">
          <CircleAlert aria-hidden="true" />
          <p><b>보관된 학급입니다.</b> 예금 기록만 확인할 수 있고 새 상품 발행·가입·해지는 할 수 없어요.</p>
        </div>
      )}

      {isTeacher ? (
        <TeacherDeposits
          data={data}
          draft={draft}
          setDraft={setDraft}
          draftPreview={draftPreview}
          unit={unit}
          classIsActive={classIsActive}
          busyId={busyId}
          refreshing={refreshing}
          onCreate={createProduct}
          onToggle={toggleProduct}
          onRefresh={() => void refreshEverything()}
        />
      ) : (
        <StudentDeposits
          data={data}
          unit={unit}
          moneySteps={moneySteps}
          classIsActive={classIsActive}
          busyId={busyId}
          refreshing={refreshing}
          amounts={amounts}
          setAmounts={setAmounts}
          joinConfirmation={joinConfirmation}
          setJoinConfirmation={setJoinConfirmation}
          earlyConfirmation={earlyConfirmation}
          setEarlyConfirmation={setEarlyConfirmation}
          onSubscribe={subscribe}
          onSettle={settleContract}
          onRefresh={() => void refreshEverything()}
          now={now}
        />
      )}
    </section>
  );
}

function TeacherDeposits({
  data,
  draft,
  setDraft,
  draftPreview,
  unit,
  classIsActive,
  busyId,
  refreshing,
  onCreate,
  onToggle,
  onRefresh,
}: {
  data: FinanceDepositsData;
  draft: ProductDraft;
  setDraft: Dispatch<SetStateAction<ProductDraft>>;
  draftPreview: null | {
    principal: number;
    maturityInterest: number;
    maturityPayout: number;
    earlyPayout: number;
  };
  unit: string;
  classIsActive: boolean;
  busyId: string | null;
  refreshing: boolean;
  onCreate: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onToggle: (product: FinanceDepositProduct) => Promise<void>;
  onRefresh: () => void;
}) {
  const activeContracts = data.contracts.filter((contract) => (
    contract.status === "active" || contract.status === "matured"
  ));
  const sortedContracts = [...data.contracts].sort((left, right) => (
    right.openedAt - left.openedAt
  ));

  function updateDraft<Key extends keyof ProductDraft>(key: Key, value: ProductDraft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <>
      <div style={styles.guide} aria-label="예금 운영 순서">
        <div style={styles.guideItem}>
          <span style={styles.guideNumber}>1</span>
          <div><b>상품 발행</b><small style={styles.termLabel}>기간과 이자를 한 번만 정해요</small></div>
        </div>
        <div style={styles.guideItem}>
          <span style={styles.guideNumber}>2</span>
          <div><b>학생이 직접 가입</b><small style={styles.termLabel}>은행원 승인 없이 바로 처리돼요</small></div>
        </div>
        <div style={styles.guideItem}>
          <span style={styles.guideNumber}>3</span>
          <div><b>시스템이 만기 지급</b><small style={styles.termLabel}>원금과 이자를 자동으로 돌려줘요</small></div>
        </div>
      </div>

      <div style={styles.summaryGrid}>
        <SummaryCard
          icon={<Landmark />}
          label="발행한 상품"
          value={`${data.products.length.toLocaleString("ko-KR")}개`}
          help={`${data.products.filter((product) => product.isOpen).length}개 가입 가능`}
        />
        <SummaryCard
          icon={<PiggyBank />}
          label="저축 중인 예금"
          value={`${activeContracts.length.toLocaleString("ko-KR")}건`}
          help={amountText(data.summary.activePrincipal, unit)}
        />
        <SummaryCard
          icon={<TrendingUp />}
          label="예상 만기 지급액"
          value={amountText(data.summary.expectedMaturityPayout, unit)}
          help="현재 저축 중인 계약 기준"
        />
        <SummaryCard
          icon={<BadgeCheck />}
          label="자동 처리 완료"
          value={`${data.summary.settledContractCount.toLocaleString("ko-KR")}건`}
          help="만기 지급과 중도해지 포함"
        />
      </div>

      <section style={styles.section} aria-labelledby="deposit-create-title">
        <div style={styles.sectionHeading}>
          <div>
            <p className="eyebrow">선생님 전용</p>
            <h3 id="deposit-create-title" style={styles.sectionTitle}>새 예금 상품 발행</h3>
            <p style={styles.muted}>발행한 뒤에는 약속한 조건을 바꿀 수 없고, 신규 가입만 열거나 멈출 수 있어요.</p>
          </div>
          <ShieldCheck style={{ color: "var(--color-success)" }} aria-hidden="true" />
        </div>

        <form style={styles.form} onSubmit={(event) => void onCreate(event)}>
          <div style={styles.fieldGrid}>
            <label style={styles.label}>
              상품 이름
              <input
                value={draft.name}
                maxLength={40}
                autoComplete="off"
                placeholder="예: 4주 차곡차곡 예금"
                onChange={(event) => updateDraft("name", event.target.value)}
                disabled={busyId !== null || !classIsActive}
                required
              />
              <small style={styles.fieldHelp}>학생이 한눈에 알아볼 수 있는 이름</small>
            </label>
            <label style={styles.label}>
              맡기는 기간
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={52}
                step={1}
                value={draft.termWeeks}
                onChange={(event) => updateDraft("termWeeks", event.target.value)}
                disabled={busyId !== null || !classIsActive}
                required
              />
              <small style={styles.fieldHelp}>1주부터 52주까지</small>
            </label>
            <label style={styles.label}>
              만기 이자율 (%)
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step={0.01}
                value={draft.maturityInterestPercent}
                onChange={(event) => updateDraft("maturityInterestPercent", event.target.value)}
                disabled={busyId !== null || !classIsActive}
                required
              />
              <small style={styles.fieldHelp}>연이율이 아니라, 전체 기간에 원금의 몇 %를 줄지 정해요</small>
            </label>
            <label style={styles.label}>
              중도해지 때 약정 이자 지급률 (%)
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step={0.01}
                value={draft.earlyInterestPercent}
                onChange={(event) => updateDraft("earlyInterestPercent", event.target.value)}
                disabled={busyId !== null || !classIsActive}
                required
              />
              <small style={styles.fieldHelp}>0%면 이자 없이 원금만, 50%면 약정 이자의 절반을 줘요</small>
            </label>
            <label style={styles.label}>
              최소 가입 금액
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_AMOUNT}
                step={1}
                value={draft.minAmount}
                onChange={(event) => updateDraft("minAmount", event.target.value)}
                disabled={busyId !== null || !classIsActive}
                required
              />
              <small style={styles.fieldHelp}>{unit} 단위의 정수</small>
            </label>
            <label style={styles.label}>
              최대 가입 금액
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_AMOUNT}
                step={1}
                value={draft.maxAmount}
                onChange={(event) => updateDraft("maxAmount", event.target.value)}
                disabled={busyId !== null || !classIsActive}
                required
              />
              <small style={styles.fieldHelp}>학생 한 명이 이 상품에 맡길 수 있는 최대액</small>
            </label>
          </div>

          <label style={styles.label}>
            학생에게 보여 줄 설명 <small style={styles.fieldHelp}>(선택)</small>
            <textarea
              rows={3}
              value={draft.description}
              maxLength={200}
              placeholder="예: 한 달 동안 차곡차곡 맡기고 만기에 이자를 받아요."
              onChange={(event) => updateDraft("description", event.target.value)}
              disabled={busyId !== null || !classIsActive}
            />
          </label>

          {draftPreview && (
            <div style={styles.preview} aria-label="상품 지급 예시">
              <div style={styles.previewItem}>
                <small>예시 원금</small>
                <strong>{amountText(draftPreview.principal, unit)}</strong>
              </div>
              <div style={styles.previewItem}>
                <small>만기 이자</small>
                <strong>+{amountText(draftPreview.maturityInterest, unit)}</strong>
              </div>
              <div style={styles.previewItem}>
                <small>만기 지급액</small>
                <strong>{amountText(draftPreview.maturityPayout, unit)}</strong>
              </div>
              <div style={styles.previewItem}>
                <small>중도해지 지급액</small>
                <strong>{amountText(draftPreview.earlyPayout, unit)}</strong>
              </div>
            </div>
          )}

          <div style={styles.actions}>
            <button
              className="button button-primary button-large"
              type="submit"
              disabled={busyId !== null || !classIsActive}
            >
              {busyId === "deposit-product-create" ? <LoaderCircle className="spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
              상품 발행하기
            </button>
            <small style={styles.fieldHelp}>발행 즉시 학생 화면에 가입 가능한 상품으로 나타납니다.</small>
          </div>
        </form>
      </section>

      <section style={styles.section} aria-labelledby="deposit-products-title">
        <div style={styles.sectionHeading}>
          <div>
            <p className="eyebrow">상품 관리</p>
            <h3 id="deposit-products-title" style={styles.sectionTitle}>발행한 예금 상품</h3>
            <p style={styles.muted}>가입을 멈춰도 이미 가입한 학생의 조건과 만기 지급은 그대로 유지됩니다.</p>
          </div>
          <button className="button button-light" type="button" onClick={onRefresh} disabled={refreshing || busyId !== null}>
            <RefreshCw className={refreshing ? "spin" : undefined} aria-hidden="true" />새로고침
          </button>
        </div>

        {data.products.length === 0 ? (
          <div className="finance-empty-state compact">
            <PiggyBank aria-hidden="true" />
            <b>아직 발행한 예금 상품이 없어요</b>
            <p>위 양식에서 첫 상품을 만들면 학생이 직접 가입할 수 있어요.</p>
          </div>
        ) : (
          <div style={styles.productGrid}>
            {data.products.map((product) => {
              const toggleSlot = `deposit-product-toggle:${product.id}`;
              return (
                <article key={product.id} style={styles.productCard}>
                  <div style={styles.productHeader}>
                    <div style={{ minWidth: 0 }}>
                      <h4 style={styles.productTitle}>{product.name}</h4>
                      {product.description && <p style={styles.productDescription}>{product.description}</p>}
                    </div>
                    <span style={product.isOpen ? styles.statusOpen : styles.statusPaused}>
                      {product.isOpen ? "가입 가능" : "가입 멈춤"}
                    </span>
                  </div>
                  <ProductTerms product={product} unit={unit} />
                  <div style={{ ...styles.preview, color: "var(--color-info)", background: "var(--color-info-soft)" }}>
                    <div style={styles.previewItem}>
                      <small>가입 학생</small>
                      <strong>{product.subscriberCount}명</strong>
                    </div>
                    <div style={styles.previewItem}>
                      <small>저축 중</small>
                      <strong>{product.activeSubscriberCount}명</strong>
                    </div>
                    <div style={styles.previewItem}>
                      <small>맡긴 원금</small>
                      <strong>{amountText(product.totalPrincipal, unit)}</strong>
                    </div>
                    <div style={styles.previewItem}>
                      <small>다음 만기</small>
                      <strong>{dateText(product.nextMaturityAt)}</strong>
                    </div>
                  </div>
                  <button
                    className={`button ${product.isOpen ? "button-light" : "button-primary"}`}
                    style={styles.fullAction}
                    type="button"
                    onClick={() => void onToggle(product)}
                    disabled={busyId !== null || !classIsActive}
                  >
                    {busyId === toggleSlot
                      ? <LoaderCircle className="spin" aria-hidden="true" />
                      : product.isOpen
                        ? <PauseCircle aria-hidden="true" />
                        : <PlayCircle aria-hidden="true" />}
                    {product.isOpen ? "신규 가입 멈추기" : "신규 가입 다시 열기"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section style={styles.section} aria-labelledby="deposit-contracts-title">
        <div style={styles.sectionHeading}>
          <div>
            <p className="eyebrow">교사 확인용</p>
            <h3 id="deposit-contracts-title" style={styles.sectionTitle}>학생 예금 기록</h3>
            <p style={styles.muted}>선생님은 진행 상황을 확인만 하면 됩니다. 학생별 처리는 시스템이 자동으로 기록해요.</p>
          </div>
          <span style={styles.tinyBadge}>{data.contracts.length}건</span>
        </div>
        <ContractHistory contracts={sortedContracts} unit={unit} now={data.serverTime} teacherView />
      </section>
    </>
  );
}

function StudentDeposits({
  data,
  unit,
  moneySteps,
  classIsActive,
  busyId,
  refreshing,
  amounts,
  setAmounts,
  joinConfirmation,
  setJoinConfirmation,
  earlyConfirmation,
  setEarlyConfirmation,
  onSubscribe,
  onSettle,
  onRefresh,
  now,
}: {
  data: FinanceDepositsData;
  unit: string;
  moneySteps: number[];
  classIsActive: boolean;
  busyId: string | null;
  refreshing: boolean;
  amounts: Record<string, string>;
  setAmounts: Dispatch<SetStateAction<Record<string, string>>>;
  joinConfirmation: string | null;
  setJoinConfirmation: Dispatch<SetStateAction<string | null>>;
  earlyConfirmation: string | null;
  setEarlyConfirmation: Dispatch<SetStateAction<string | null>>;
  onSubscribe: (product: FinanceDepositProduct) => Promise<void>;
  onSettle: (
    contract: FinanceDepositContract,
    action: "early_termination" | "maturity",
    automatic?: boolean,
  ) => Promise<void>;
  onRefresh: () => void;
  now: number;
}) {
  const activeContracts = data.contracts.filter((contract) => (
    contract.status === "active" || contract.status === "matured"
  ));
  const settledContracts = data.contracts.filter((contract) => (
    contract.status === "maturity_paid" || contract.status === "early_terminated"
  ));
  const activeProductIds = new Set(activeContracts.map((contract) => contract.productId));
  const openProducts = data.products.filter((product) => product.isOpen);
  const walletReady = data.wallet?.status === "active";

  return (
    <>
      <div style={styles.summaryGrid}>
        <SummaryCard
          icon={<WalletCards />}
          label="지갑에서 쓸 수 있는 금액"
          value={data.wallet ? amountText(data.wallet.availableBalance, unit) : "확인 필요"}
          help={data.wallet?.status === "frozen"
            ? "지갑 사용이 잠시 멈췄어요"
            : data.wallet && data.wallet.pendingWithdrawalAmount > 0
              ? `출금 신청 ${amountText(data.wallet.pendingWithdrawalAmount, unit)} 보관 중`
              : "예금 원금은 따로 안전하게 보관"}
        />
        <SummaryCard
          icon={<PiggyBank />}
          label="예금으로 저축 중"
          value={amountText(data.summary.activePrincipal, unit)}
          help={`${data.summary.activeContractCount}개 상품`}
        />
        <SummaryCard
          icon={<TrendingUp />}
          label="모두 만기까지 기다리면"
          value={amountText(data.summary.expectedMaturityPayout, unit)}
          help="원금과 약속된 이자를 합친 금액"
        />
      </div>

      <div style={styles.guide} aria-label="학생 예금 이용 방법">
        <div style={styles.guideItem}>
          <span style={styles.guideNumber}>1</span>
          <div><b>원하는 상품 고르기</b><small style={styles.termLabel}>기간과 받을 금액을 확인해요</small></div>
        </div>
        <div style={styles.guideItem}>
          <span style={styles.guideNumber}>2</span>
          <div><b>내가 직접 가입</b><small style={styles.termLabel}>지갑에서 원금이 예금으로 옮겨져요</small></div>
        </div>
        <div style={styles.guideItem}>
          <span style={styles.guideNumber}>3</span>
          <div><b>만기에는 자동 지급</b><small style={styles.termLabel}>은행원이나 선생님 승인을 기다리지 않아요</small></div>
        </div>
      </div>

      <section style={styles.section} aria-labelledby="my-active-deposits-title">
        <div style={styles.sectionHeading}>
          <div>
            <p className="eyebrow">내 예금</p>
            <h3 id="my-active-deposits-title" style={styles.sectionTitle}>지금 저축 중인 상품</h3>
          </div>
          <button className="button button-light" type="button" onClick={onRefresh} disabled={refreshing || busyId !== null}>
            <RefreshCw className={refreshing ? "spin" : undefined} aria-hidden="true" />새로고침
          </button>
        </div>

        {activeContracts.length === 0 ? (
          <div className="finance-empty-state compact">
            <PiggyBank aria-hidden="true" />
            <b>지금 저축 중인 예금이 없어요</b>
            <p>아래에서 마음에 드는 상품의 기간과 이자를 살펴보세요.</p>
          </div>
        ) : (
          <div style={styles.productGrid}>
            {activeContracts.map((contract) => {
              const due = contract.status === "matured" || contract.maturesAt <= now;
              const settling = busyId === `deposit-settle:${contract.id}:early_termination`;
              return (
                <article key={contract.id} style={{ ...styles.productCard, borderColor: "color-mix(in srgb, var(--color-success) 45%, var(--color-border))" }}>
                  <div style={styles.productHeader}>
                    <div style={{ minWidth: 0 }}>
                      <span style={styles.tinyBadge}>{contractStatusText(contract, now)}</span>
                      <h4 style={{ ...styles.productTitle, marginTop: 7 }}>{contract.productName}</h4>
                    </div>
                    {due ? <LoaderCircle className="spin" style={{ color: "var(--color-success)" }} aria-label="만기 금액 자동 지급 중" /> : <CalendarClock style={{ color: "var(--color-success)" }} aria-hidden="true" />}
                  </div>

                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 7, color: "var(--color-text-muted)", fontSize: "var(--text-xs)" }}>
                      <span>{dateText(contract.openedAt)} 시작</span>
                      <b>{remainingText(contract.maturesAt, now)}</b>
                    </div>
                    <div style={styles.progressTrack} aria-label={`예금 기간 ${Math.round(progressPercent(contract, now))}% 지남`}>
                      <div style={{ width: `${progressPercent(contract, now)}%`, height: "100%", borderRadius: "inherit", background: "var(--color-success)", transition: "width var(--transition-base)" }} />
                    </div>
                  </div>

                  <dl style={styles.terms}>
                    <div style={styles.term}>
                      <dt style={styles.termLabel}>맡긴 원금</dt>
                      <dd style={{ ...styles.termValue, marginInline: 0 }}>{amountText(contract.principal, unit)}</dd>
                    </div>
                    <div style={styles.term}>
                      <dt style={styles.termLabel}>만기 이자</dt>
                      <dd style={{ ...styles.termValue, marginInline: 0, color: "var(--color-success)" }}>+{amountText(contract.maturityInterest, unit)}</dd>
                    </div>
                    <div style={styles.term}>
                      <dt style={styles.termLabel}>만기일</dt>
                      <dd style={{ ...styles.termValue, marginInline: 0 }}>{dateText(contract.maturesAt)}</dd>
                    </div>
                    <div style={styles.term}>
                      <dt style={styles.termLabel}>만기 자동 지급액</dt>
                      <dd style={{ ...styles.termValue, marginInline: 0 }}>{amountText(contract.maturityPayout, unit)}</dd>
                    </div>
                  </dl>

                  {due ? (
                    <div className="finance-action-notice info" style={{ marginTop: 0 }}>
                      <LoaderCircle className="spin" aria-hidden="true" />
                      <p>만기를 확인했어요. 시스템이 원금과 이자를 지갑에 자동으로 넣고 있습니다.</p>
                    </div>
                  ) : earlyConfirmation === contract.id ? (
                    <div className="finance-decision-confirm reject" style={{ border: 0, borderRadius: "var(--radius-md)" }}>
                      <div>
                        <b>정말 지금 중도해지할까요?</b>
                        <p>
                          지갑에 <strong>{amountText(contract.earlyPayout, unit)}</strong> 들어옵니다.
                          만기까지 기다릴 때보다 {amountText(Math.max(0, contract.maturityPayout - contract.earlyPayout), unit)} 적어요.
                        </p>
                      </div>
                      <div className="finance-confirm-actions">
                        <button className="button button-light" type="button" onClick={() => setEarlyConfirmation(null)} disabled={settling}>
                          계속 저축하기
                        </button>
                        <button className="button finance-danger-button" type="button" onClick={() => void onSettle(contract, "early_termination")} disabled={settling || !classIsActive || !walletReady}>
                          {settling && <LoaderCircle className="spin" aria-hidden="true" />}
                          {amountText(contract.earlyPayout, unit)} 받고 해지
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="button button-light"
                      style={styles.fullAction}
                      type="button"
                      onClick={() => {
                        setJoinConfirmation(null);
                        setEarlyConfirmation(contract.id);
                      }}
                      disabled={busyId !== null || !classIsActive || !walletReady}
                    >
                      중도해지 금액 확인
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section style={styles.section} aria-labelledby="available-deposits-title">
        <div style={styles.sectionHeading}>
          <div>
            <p className="eyebrow">가입 가능한 상품</p>
            <h3 id="available-deposits-title" style={styles.sectionTitle}>새 예금을 골라요</h3>
            <p style={styles.muted}>가입 버튼을 누르기 전에 받을 금액을 한 번 더 확인할 수 있어요.</p>
          </div>
          <span style={styles.tinyBadge}>{openProducts.length}개</span>
        </div>

        {openProducts.length === 0 ? (
          <div className="finance-empty-state compact">
            <Clock3 aria-hidden="true" />
            <b>지금 가입 가능한 상품이 없어요</b>
            <p>선생님이 새 상품의 가입을 열면 여기에 나타납니다.</p>
          </div>
        ) : (
          <div style={styles.productGrid}>
            {openProducts.map((product) => {
              const hasActive = activeProductIds.has(product.id);
              const amount = Number(amounts[product.id]);
              const validAmount = Number.isSafeInteger(amount)
                && amount >= product.minAmount
                && amount <= product.maxAmount;
              const maturityInterest = validAmount
                ? Math.floor((amount * product.maturityInterestBps) / 10_000)
                : 0;
              const maturityPayout = validAmount ? amount + maturityInterest : 0;
              const quickAmounts = Array.from(new Set([
                product.minAmount,
                ...moneySteps.filter((step) => step >= product.minAmount && step <= product.maxAmount),
                product.maxAmount,
              ])).slice(0, 6);
              const joining = busyId === `deposit-subscribe:${product.id}`;
              return (
                <article key={product.id} style={styles.productCard}>
                  <div style={styles.productHeader}>
                    <div style={{ minWidth: 0 }}>
                      <h4 style={styles.productTitle}>{product.name}</h4>
                      {product.description && <p style={styles.productDescription}>{product.description}</p>}
                    </div>
                    <span style={styles.statusOpen}>가입 가능</span>
                  </div>
                  <ProductTerms product={product} unit={unit} />

                  {hasActive ? (
                    <div className="finance-action-notice info" style={{ marginTop: 0 }}>
                      <BadgeCheck aria-hidden="true" />
                      <p>이미 이 상품에 가입해 저축하고 있어요.</p>
                    </div>
                  ) : (
                    <>
                      <label style={styles.label}>
                        맡길 금액
                        <span style={styles.amountInput}>
                          <input
                            style={styles.inputBare}
                            type="number"
                            inputMode="numeric"
                            min={product.minAmount}
                            max={product.maxAmount}
                            step={moneySteps[0] ?? 1}
                            value={amounts[product.id] ?? ""}
                            placeholder={product.minAmount.toLocaleString("ko-KR")}
                            onChange={(event) => {
                              setAmounts((current) => ({ ...current, [product.id]: event.target.value }));
                              setJoinConfirmation((current) => current === product.id ? null : current);
                            }}
                            disabled={busyId !== null || !classIsActive || !walletReady}
                            aria-describedby={`deposit-help-${product.id}`}
                          />
                          <span style={styles.inputSuffix}>{unit}</span>
                        </span>
                        <small id={`deposit-help-${product.id}`} style={styles.fieldHelp} aria-live="polite">
                          사용 가능 {data.wallet ? amountText(data.wallet.availableBalance, unit) : "확인 필요"}
                          {data.wallet && data.wallet.pendingWithdrawalAmount > 0
                            ? ` · 출금 신청 ${amountText(data.wallet.pendingWithdrawalAmount, unit)} 제외`
                            : ""}
                        </small>
                      </label>
                      <div className="finance-quick-amounts">
                        <span>빠른 금액 선택</span>
                        <div>
                          {quickAmounts.map((value) => (
                            <button
                              key={value}
                              className="button button-light"
                              type="button"
                              onClick={() => {
                                setAmounts((current) => ({ ...current, [product.id]: String(value) }));
                                setJoinConfirmation(null);
                              }}
                              disabled={busyId !== null || !classIsActive || !walletReady}
                            >
                              {value.toLocaleString("ko-KR")}
                            </button>
                          ))}
                        </div>
                      </div>

                      {validAmount && (
                        <div style={styles.preview}>
                          <div style={styles.previewItem}>
                            <small>맡길 원금</small>
                            <strong>{amountText(amount, unit)}</strong>
                          </div>
                          <div style={styles.previewItem}>
                            <small>만기 이자</small>
                            <strong>+{amountText(maturityInterest, unit)}</strong>
                          </div>
                          <div style={styles.previewItem}>
                            <small>만기 자동 지급액</small>
                            <strong>{amountText(maturityPayout, unit)}</strong>
                          </div>
                        </div>
                      )}

                      {joinConfirmation === product.id ? (
                        <div className="finance-decision-confirm approve" style={{ border: 0, borderRadius: "var(--radius-md)" }}>
                          <div>
                            <b>{amountText(amount, unit)}을 {product.termWeeks}주 동안 맡길까요?</b>
                            <p>가입하면 지갑에서 바로 빠지고, {dateText(now + product.termWeeks * 7 * 86_400_000)} 무렵 만기 지급됩니다.</p>
                          </div>
                          <div className="finance-confirm-actions">
                            <button className="button button-light" type="button" onClick={() => setJoinConfirmation(null)} disabled={joining}>
                              금액 다시 보기
                            </button>
                            <button className="button button-primary" type="button" onClick={() => void onSubscribe(product)} disabled={joining || !validAmount || !classIsActive || !walletReady || Boolean(data.wallet && amount > data.wallet.availableBalance)}>
                              {joining && <LoaderCircle className="spin" aria-hidden="true" />}
                              확인하고 가입
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className="button button-primary button-large"
                          style={styles.fullAction}
                          type="button"
                          onClick={() => {
                            setEarlyConfirmation(null);
                            setJoinConfirmation(product.id);
                          }}
                          disabled={busyId !== null || !validAmount || !classIsActive || !walletReady || Boolean(data.wallet && amount > data.wallet.availableBalance)}
                        >
                          <PiggyBank aria-hidden="true" />받을 금액 확인하고 가입
                        </button>
                      )}
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section style={styles.section} aria-labelledby="deposit-history-title">
        <div style={styles.sectionHeading}>
          <div>
            <p className="eyebrow">내 예금 기록</p>
            <h3 id="deposit-history-title" style={styles.sectionTitle}>지급이 끝난 예금</h3>
          </div>
          <span style={styles.tinyBadge}>{settledContracts.length}건</span>
        </div>
        <ContractHistory contracts={settledContracts} unit={unit} now={now} />
      </section>

      <div className="finance-action-notice info">
        <ShieldCheck aria-hidden="true" />
        <p><b>은행원 학생의 승인은 필요하지 않아요.</b> 가입·해지·만기 지급은 모두 내 계정과 안전한 금융 원장에 자동으로 기록됩니다.</p>
      </div>
    </>
  );
}

function ContractHistory({
  contracts,
  unit,
  now,
  teacherView = false,
}: {
  contracts: FinanceDepositContract[];
  unit: string;
  now: number;
  teacherView?: boolean;
}) {
  if (contracts.length === 0) {
    return (
      <div className="finance-empty-state compact">
        <ReceiptText aria-hidden="true" />
        <b>아직 예금 기록이 없어요</b>
      </div>
    );
  }
  return (
    <ol style={styles.contractList}>
      {contracts.map((contract) => {
        const settled = contract.status === "maturity_paid" || contract.status === "early_terminated";
        const payout = contract.payout ?? (
          contract.status === "early_terminated" ? contract.earlyPayout : contract.maturityPayout
        );
        return (
          <li key={contract.id} style={styles.contractCard}>
            <div style={{ minWidth: 0 }}>
              <div style={styles.contractMeta}>
                {teacherView && contract.student && (
                  <span style={styles.tinyBadge}>{contract.student.number}번 {contract.student.name}</span>
                )}
                <strong>{contract.productName}</strong>
                <span
                  className={`finance-request-status ${settled ? "approved" : "pending"}`}
                  style={{ minWidth: 0 }}
                >
                  {contractStatusText(contract, now)}
                </span>
              </div>
              <p style={{ ...styles.muted, marginTop: 2 }}>
                {amountText(contract.principal, unit)} 가입 · {dateText(contract.openedAt)} 시작 · {dateText(contract.maturesAt)} 만기
              </p>
              {settled && (
                <small style={styles.termLabel}>
                  {dateTimeText(contract.settledAt)} · {contract.status === "maturity_paid" ? "만기 자동 지급" : "학생이 직접 중도해지"}
                </small>
              )}
            </div>
            <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              <small style={styles.termLabel}>{settled ? "지급액" : "만기 예상액"}</small>
              <strong style={{ display: "block", marginTop: 2, color: settled ? "var(--color-success)" : "var(--color-text)" }}>
                {amountText(settled ? payout : contract.maturityPayout, unit)}
              </strong>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
