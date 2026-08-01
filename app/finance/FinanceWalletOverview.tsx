import {
  BadgeCheck,
  CircleAlert,
  Clock3,
  Coins,
  ListChecks,
  ShieldCheck,
  UsersRound,
  WalletCards,
} from "lucide-react";

export type FinanceWalletData = {
  id: string;
  studentId: string;
  studentNumber: number;
  studentName: string;
  balance: number;
  status: "active" | "frozen" | "closed";
  revision: number;
  updatedAt: number;
};

export type FinanceTransactionData = {
  id: string;
  transactionType: string;
  description: string;
  actorType: "teacher" | "banker" | "system";
  actorLabel: string;
  postedAt: number;
  reversalOfTransactionId: string | null;
  isReversed: boolean;
  amount: number;
  balanceAfter: number;
  studentId: string;
  studentNumber: number;
  studentName: string;
  canReverse?: boolean;
  reversalBlockedReason?: string | null;
};

export type FinanceRequestData = {
  id: string;
  requestType: "deposit" | "withdrawal";
  amount: number;
  memo: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  student: {
    id: string;
    number: number;
    name: string;
  };
  requestedAt: number;
  resolvedAt: number | null;
  processorLabel: string | null;
  reasonCode: string | null;
  reasonNote: string | null;
  interventionReason: string | null;
  revision: number;
  canCancel: boolean;
  canDecide: boolean;
  decisionBlockedReason: string | null;
  transactionId: string | null;
  isCorrected: boolean;
};

export type FinanceRequestSummaryData = {
  pendingCount: number;
  pendingWithdrawalAmount: number;
  availableBalance: number | null;
};

export type FinanceOverviewData = {
  phase: "settings_audit";
  mode: "read_only" | "operations";
  currencyLabel: string;
  scope: "class" | "self";
  settings: {
    currencyName: string;
    currencyUnit: string;
    denominations: number[];
    bankOpen: boolean;
    depositEnabled: boolean;
    withdrawalEnabled: boolean;
    bankerProcessingEnabled: boolean;
    maxRequestAmount: number;
    revision: number;
    updatedAt: number;
  };
  bankers: Array<{
    studentId: string;
    studentNumber: number;
    studentName: string;
    jobName: string;
    assignmentYear: number;
    assignmentMonth: number;
  }>;
  summary: {
    walletCount: number;
    totalBalance: number;
    lastEntryAt: number | null;
    ledgerIntegrity: "ok" | "attention" | "not_checked";
  };
  wallets: FinanceWalletData[];
  requestSummary?: FinanceRequestSummaryData;
  requests?: FinanceRequestData[];
  transactions: FinanceTransactionData[];
};

export type FinanceRole = "teacher" | "banker" | "student";

export const TRANSACTION_LABELS: Record<string, string> = {
  opening: "첫 잔액",
  manual_credit: "지급",
  manual_debit: "차감",
  deposit: "입금",
  withdrawal: "출금",
  cash_deposit: "입금",
  cash_withdrawal: "출금",
  deposit_open: "예금 가입",
  deposit_maturity: "예금 만기 지급",
  deposit_early_termination: "예금 중도해지",
  stock_buy: "주식 매수",
  stock_sell: "주식 매도",
  salary: "직업 월급",
  transfer: "이체",
  reversal: "정정",
};

export function amountText(amount: number, currencyLabel: string, showPlus = false) {
  const sign = amount < 0 ? "-" : showPlus && amount > 0 ? "+" : "";
  return `${sign}${Math.abs(amount).toLocaleString("ko-KR")} ${currencyLabel}`;
}

export function dateTimeText(epochMs: number | null) {
  if (!epochMs) return "아직 기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(epochMs));
}

function walletStatusText(status: FinanceWalletData["status"]) {
  if (status === "active") return "사용 가능";
  if (status === "frozen") return "잠시 멈춤";
  return "보관됨";
}

export function FinanceWalletOverview({
  role,
  actorId,
  finance,
  classIsActive,
  hideLedger = false,
  hideBalanceSummary = false,
}: {
  role: FinanceRole;
  actorId: string;
  finance: FinanceOverviewData;
  classIsActive: boolean;
  hideLedger?: boolean;
  hideBalanceSummary?: boolean;
}) {
  const ownWallet = finance.wallets.find((wallet) => wallet.studentId === actorId) ?? null;
  const classScope = role === "teacher" || role === "banker";
  const integrityAttention = finance.summary.ledgerIntegrity === "attention";

  return (
    <section className="finance-wallet-section" aria-labelledby="finance-wallet-title">
      <div className="finance-wallet-heading">
        <div>
          <p className="eyebrow">안전한 지갑과 거래 원장</p>
          <h2 id="finance-wallet-title">{hideLedger ? "학생별 지갑을 확인해요" : "잔액과 기록을 확인해요"}</h2>
          <p>모든 금액 변화는 이유와 처리자를 남기는 원장을 통해서만 반영됩니다.</p>
        </div>
        <span className="finance-integrity-ok">
          <ShieldCheck aria-hidden="true" />원장으로 안전하게 기록
        </span>
      </div>

      {!classIsActive && (
        <div className="finance-ledger-notice warning">
          <CircleAlert aria-hidden="true" />
          <p><b>보관된 학급입니다.</b> 기존 잔액과 기록만 확인할 수 있고 새 거래는 만들 수 없습니다.</p>
        </div>
      )}

      {integrityAttention && (
        <div className="finance-ledger-notice danger" role="alert">
          <CircleAlert aria-hidden="true" />
          <p><b>잔액과 원장 확인이 필요합니다.</b> 실제 거래 기능을 열기 전에 선생님이 점검해야 합니다.</p>
        </div>
      )}

      {!hideBalanceSummary && (
        <div className="finance-balance-grid">
        {role !== "teacher" && (
          <article className="finance-balance-card primary">
            <span aria-hidden="true"><WalletCards /></span>
            <div>
              <small>내 지갑 잔액</small>
              {ownWallet ? (
                <>
                  <strong>{amountText(ownWallet.balance, finance.currencyLabel)}</strong>
                  <p>{walletStatusText(ownWallet.status)} · 원장 {ownWallet.revision}건 반영</p>
                </>
              ) : (
                <>
                  <strong className="missing">확인 필요</strong>
                  <p>지갑 정보를 준비하지 못했어요.</p>
                </>
              )}
            </div>
          </article>
        )}

        {classScope && (
          <>
            <article className="finance-balance-card">
              <span aria-hidden="true"><Coins /></span>
              <div>
                <small>학급 전체 학생 잔액</small>
                <strong>{amountText(finance.summary.totalBalance, finance.currencyLabel)}</strong>
                <p>학생 지갑 잔액을 모두 합한 금액</p>
              </div>
            </article>
            <article className="finance-balance-card">
              <span aria-hidden="true"><UsersRound /></span>
              <div>
                <small>{role === "teacher" ? "준비·보관 중인 학생 지갑" : "사용 중인 학생 지갑"}</small>
                <strong>{finance.summary.walletCount.toLocaleString("ko-KR")}개</strong>
                <p>
                  {role === "teacher"
                    ? "제외 학생의 기록까지 안전하게 보존"
                    : "현재 금융활동에 참여하는 학생 지갑"}
                </p>
              </div>
            </article>
          </>
        )}

        <article className="finance-balance-card">
          <span aria-hidden="true"><Clock3 /></span>
          <div>
            <small>최근 반영 시각</small>
            <strong className="date-value">{dateTimeText(finance.summary.lastEntryAt)}</strong>
            <p>{finance.summary.lastEntryAt ? "서울 시간 기준" : "첫 거래를 기다리고 있어요"}</p>
          </div>
        </article>
        </div>
      )}

      {classScope && (
        <section className="finance-wallet-list-card" aria-labelledby="finance-wallet-list-title">
          <div className="finance-subsection-heading">
            <div>
              <p className="eyebrow">{role === "banker" ? "은행원 조회 화면" : "선생님 확인 화면"}</p>
              <h3 id="finance-wallet-list-title">학생별 지갑 현황</h3>
            </div>
            <span>{finance.wallets.length}명</span>
          </div>
          {finance.wallets.length > 0 ? (
            <ul className="finance-wallet-list">
              {finance.wallets.map((wallet) => (
                <li key={wallet.id}>
                  <span className="finance-student-number">{wallet.studentNumber}</span>
                  <div>
                    <strong>{wallet.studentName}</strong>
                    <small>{walletStatusText(wallet.status)} · 원장 {wallet.revision}건</small>
                  </div>
                  <b>{amountText(wallet.balance, finance.currencyLabel)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <div className="finance-empty-state">
              <WalletCards aria-hidden="true" />
              <b>준비된 학생 지갑이 없습니다.</b>
              <p>학생 명단을 먼저 확인해 주세요.</p>
            </div>
          )}
        </section>
      )}

      {!hideLedger && (
        <section className="finance-ledger-card" aria-labelledby="finance-ledger-title">
        <div className="finance-subsection-heading">
          <div>
            <p className="eyebrow">{classScope ? "학급 거래 기록" : "나의 거래 기록"}</p>
            <h3 id="finance-ledger-title">최근 원장</h3>
          </div>
          {role === "teacher" && finance.summary.ledgerIntegrity === "ok" && (
            <span className="finance-integrity-ok">
              <BadgeCheck aria-hidden="true" />잔액과 원장 일치
            </span>
          )}
        </div>

        {finance.transactions.length > 0 ? (
          <ol className="finance-ledger-list">
            {finance.transactions.map((transaction) => {
              const direction = transaction.amount > 0 ? "증가" : "감소";
              const state = transaction.reversalOfTransactionId
                ? "정정 거래"
                : transaction.isReversed
                  ? "정정됨"
                  : "정상 반영";
              return (
                <li key={`${transaction.id}:${transaction.studentId}`}>
                  <span
                    className={`finance-ledger-direction ${transaction.amount > 0 ? "credit" : "debit"}`}
                  >
                    {direction}
                  </span>
                  <div className="finance-ledger-copy">
                    <div>
                      <b>{TRANSACTION_LABELS[transaction.transactionType] ?? "금융 거래"}</b>
                      <span>{transaction.studentNumber}번 {transaction.studentName}</span>
                    </div>
                    <p>{transaction.description}</p>
                    <small>
                      {dateTimeText(transaction.postedAt)} · 처리자 {transaction.actorLabel} · {state}
                    </small>
                  </div>
                  <div className="finance-ledger-amount">
                    <strong className={transaction.amount > 0 ? "credit" : "debit"}>
                      {amountText(transaction.amount, finance.currencyLabel, true)}
                    </strong>
                    <small>반영 후 {amountText(transaction.balanceAfter, finance.currencyLabel)}</small>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="finance-empty-state">
            <ListChecks aria-hidden="true" />
            <b>지갑은 준비됐어요. 아직 거래 기록이 없어요.</b>
            <p>첫 지급도 원장을 통해 기록한 뒤 이곳에 나타납니다.</p>
          </div>
        )}
        </section>
      )}

      <div className="finance-ledger-notice">
        <ShieldCheck aria-hidden="true" />
        <p><b>모든 금융 업무는 기록으로 남습니다.</b> 승인이나 정정을 여러 번 눌러도 같은 거래가 중복 반영되지 않습니다.</p>
      </div>
    </section>
  );
}
