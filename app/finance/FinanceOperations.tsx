"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BadgeCheck,
  Check,
  CircleAlert,
  Clock3,
  Coins,
  FileSearch,
  History,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  Undo2,
  X,
} from "lucide-react";
import {
  type FormEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  TRANSACTION_LABELS,
  amountText,
  dateTimeText,
  type FinanceOverviewData,
  type FinanceRequestData,
  type FinanceRole,
  type FinanceTransactionData,
} from "./FinanceWalletOverview";

type NoticeState = {
  tone: "success" | "error" | "info";
  message: string;
} | null;

type FinanceOperationsProps = {
  role: FinanceRole;
  actorId: string;
  classId: string;
  classIsActive: boolean;
  canOverride: boolean;
  finance: FinanceOverviewData;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
};

class FinanceActionError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}

function newActionKey(prefix: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${suffix}`;
}

async function postFinanceAction(
  url: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as {
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    throw new FinanceActionError(
      data.error || "금융 업무를 처리하지 못했어요.",
      data.code || "FINANCE_ACTION_FAILED",
      response.status,
    );
  }
  return data;
}

function friendlyActionError(error: unknown) {
  if (!(error instanceof FinanceActionError)) {
    return "인터넷 연결을 확인하지 못했어요. 같은 내용을 다시 보내지 않고 처리 결과부터 확인해 주세요.";
  }
  if (
    error.code === "FINANCE_REQUEST_ALREADY_DECIDED"
    || error.code === "FINANCE_REQUEST_ALREADY_RESOLVED"
    || error.code === "FINANCE_REQUEST_STALE"
  ) {
    return "다른 사람이 먼저 처리했어요. 최신 목록으로 바꿨어요.";
  }
  if (
    error.code === "FINANCE_SELF_APPROVAL_FORBIDDEN"
    || error.code === "FINANCE_REQUEST_SELF_APPROVAL"
  ) {
    return "내 신청은 다른 은행원이나 선생님이 처리해야 해요.";
  }
  if (error.code === "FINANCE_INSUFFICIENT_AVAILABLE_BALANCE") {
    return "지금 사용할 수 있는 금액보다 큰 금액은 출금할 수 없어요.";
  }
  if (error.code === "FINANCE_ACCOUNT_FROZEN") {
    return "이 지갑은 잠시 멈춰 있어요. 선생님께 확인해 주세요.";
  }
  if (error.code === "FINANCE_LEDGER_ATTENTION") {
    return "잔액과 기록을 먼저 확인해야 해서 금융 처리를 잠시 멈췄어요.";
  }
  if (error.status === 403) {
    return "지금은 이 업무를 처리할 권한이 없어요. 역할이나 학급 상태를 다시 확인해 주세요.";
  }
  return error.message;
}

function requestTypeText(type: FinanceRequestData["requestType"]) {
  return type === "deposit" ? "입금" : "출금";
}

function requestStatusText(status: FinanceRequestData["status"]) {
  if (status === "pending") return "확인 중";
  if (status === "approved") return "처리 완료";
  if (status === "rejected") return "다시 확인";
  return "신청 취소";
}

const REJECTION_REASONS = [
  { code: "amount_check", label: "금액을 다시 확인해 주세요" },
  { code: "cash_not_confirmed", label: "실물 화폐를 확인하지 못했어요" },
  { code: "ask_student", label: "학생에게 다시 물어봐야 해요" },
  { code: "other", label: "기타 이유" },
] as const;

function requestReasonText(request: FinanceRequestData) {
  if (request.reasonNote) return request.reasonNote;
  return REJECTION_REASONS.find((reason) => reason.code === request.reasonCode)?.label
    ?? request.reasonCode;
}

function ActionNotice({ notice }: { notice: NoticeState }) {
  if (!notice) return null;
  return (
    <div
      className={`finance-action-notice ${notice.tone}`}
      role={notice.tone === "error" ? "alert" : "status"}
    >
      {notice.tone === "success"
        ? <BadgeCheck aria-hidden="true" />
        : notice.tone === "error"
          ? <CircleAlert aria-hidden="true" />
          : <Clock3 aria-hidden="true" />}
      <p>{notice.message}</p>
    </div>
  );
}

export function FinanceOperations(props: FinanceOperationsProps) {
  if (props.role === "student") {
    return <StudentRequestPanel {...props} />;
  }
  if (props.role === "banker") {
    return <BankerRequestPanel {...props} />;
  }
  return <TeacherFinanceOperations {...props} />;
}

function StudentRequestPanel({
  actorId,
  classIsActive,
  finance,
  refreshing,
  onRefresh,
}: FinanceOperationsProps) {
  const requests = finance.requests ?? [];
  const ownRequests = requests.filter((request) => request.student.id === actorId);
  const pendingRequest = ownRequests.find((request) => request.status === "pending") ?? null;
  const wallet = finance.wallets.find((item) => item.studentId === actorId) ?? null;
  const pendingWithdrawal = finance.requestSummary?.pendingWithdrawalAmount
    ?? ownRequests
      .filter((request) => request.status === "pending" && request.requestType === "withdrawal")
      .reduce((total, request) => total + request.amount, 0);
  const availableBalance = finance.requestSummary?.availableBalance
    ?? (wallet ? Math.max(0, wallet.balance - pendingWithdrawal) : 0);
  const [requestType, setRequestType] = useState<"deposit" | "withdrawal">("deposit");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState>(null);
  const submitKey = useRef<string | null>(null);
  const cancelKeys = useRef<Record<string, string>>({});
  const numericAmount = Number(amount);
  const validAmount = Number.isSafeInteger(numericAmount) && numericAmount > 0;
  const quickAmounts = [...new Set(
    finance.settings.denominations.filter((value) => (
      Number.isSafeInteger(value) && value > 0
    )),
  )].sort((left, right) => left - right);
  const minDenomination = quickAmounts[0] ?? 1;
  const matchesDenomination = validAmount
    && numericAmount % minDenomination === 0;
  const requestTypeEnabled = requestType === "deposit"
    ? finance.settings.depositEnabled
    : finance.settings.withdrawalEnabled;
  const canSubmit = classIsActive
    && finance.settings.bankOpen
    && requestTypeEnabled
    && wallet?.status === "active"
    && !pendingRequest
    && validAmount
    && matchesDenomination
    && numericAmount <= finance.settings.maxRequestAmount
    && (requestType === "deposit" || numericAmount <= availableBalance);

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      setNotice({
        tone: "error",
        message: validAmount && !matchesDenomination
          ? `금액은 최소 권종인 ${amountText(minDenomination, finance.currencyLabel)} 단위로 입력해 주세요.`
          : requestType === "withdrawal" && validAmount && numericAmount > availableBalance
            ? "지금 사용할 수 있는 금액보다 큰 금액은 출금할 수 없어요."
            : "신청 금액과 지갑 상태를 다시 확인해 주세요.",
      });
      return;
    }
    setBusy(true);
    setNotice(null);
    submitKey.current ??= newActionKey("finance-request");
    try {
      await postFinanceAction("/api/finance/requests", {
        requestType,
        amount: numericAmount,
        idempotencyKey: submitKey.current,
      });
      submitKey.current = null;
      setAmount("");
      setNotice({
        tone: "success",
        message: `${requestTypeText(requestType)} 신청을 보냈어요. 은행원이 확인하면 알려 줄게요.`,
      });
      await onRefresh();
    } catch (error) {
      setNotice({ tone: "error", message: friendlyActionError(error) });
      await onRefresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function cancelRequest(request: FinanceRequestData) {
    setBusy(true);
    setNotice(null);
    cancelKeys.current[request.id] ??= newActionKey("finance-cancel");
    try {
      await postFinanceAction(`/api/finance/requests/${encodeURIComponent(request.id)}/cancel`, {
        expectedRevision: request.revision,
        idempotencyKey: cancelKeys.current[request.id],
      });
      delete cancelKeys.current[request.id];
      setCancelConfirm(null);
      setNotice({ tone: "success", message: "신청을 취소했어요." });
      await onRefresh();
    } catch (error) {
      setNotice({ tone: "error", message: friendlyActionError(error) });
      await onRefresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="finance-operations-card student-requests" aria-labelledby="student-request-title">
      <div className="finance-operation-heading">
        <div>
          <p className="eyebrow">나의 은행 업무</p>
          <h2 id="student-request-title">맡기거나 찾아갈 금액을 신청해요</h2>
          <p>은행원 친구가 실물 화폐와 신청 금액을 확인한 뒤 지갑에 반영해요.</p>
        </div>
        <button
          className="button button-light finance-refresh-button"
          type="button"
          onClick={() => void onRefresh()}
          disabled={refreshing || busy}
        >
          <RefreshCw className={refreshing ? "spin" : ""} aria-hidden="true" />
          새로고침
        </button>
      </div>

      <div className="finance-student-balance-strip" aria-label="내 지갑 금액">
        <div>
          <small>현재 디지털 잔액</small>
          <strong>{amountText(wallet?.balance ?? 0, finance.currencyLabel)}</strong>
        </div>
        <div>
          <small>출금 확인 중</small>
          <strong>{amountText(pendingWithdrawal, finance.currencyLabel)}</strong>
        </div>
        <div className="available">
          <small>지금 사용 가능</small>
          <strong>{amountText(availableBalance, finance.currencyLabel)}</strong>
        </div>
      </div>

      <ActionNotice notice={notice} />

      {pendingRequest ? (
        <article className="finance-active-request">
          <span className={`finance-request-type ${pendingRequest.requestType}`}>
            {pendingRequest.requestType === "deposit"
              ? <ArrowDownToLine aria-hidden="true" />
              : <ArrowUpFromLine aria-hidden="true" />}
          </span>
          <div>
            <p className="eyebrow">은행원이 확인하고 있어요</p>
            <h3>
              {requestTypeText(pendingRequest.requestType)}{" "}
              {amountText(pendingRequest.amount, finance.currencyLabel)}
            </h3>
            <p>
              {pendingRequest.requestType === "withdrawal"
                ? "이 금액은 처리될 때까지 다른 곳에서 사용할 수 없어요."
                : "승인 전에는 디지털 잔액에 더해지지 않아요."}
            </p>
            <small>{dateTimeText(pendingRequest.requestedAt)} 신청</small>
          </div>
          <div className="finance-request-cancel">
            {cancelConfirm === pendingRequest.id ? (
              <div className="finance-inline-confirm">
                <b>이 신청을 취소할까요?</b>
                <div>
                  <button
                    className="button button-light"
                    type="button"
                    onClick={() => setCancelConfirm(null)}
                    disabled={busy}
                  >
                    계속 기다리기
                  </button>
                  <button
                    className="button finance-danger-button"
                    type="button"
                    onClick={() => void cancelRequest(pendingRequest)}
                    disabled={busy}
                  >
                    {busy && <LoaderCircle className="spin" aria-hidden="true" />}
                    신청 취소
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="text-button"
                type="button"
                onClick={() => setCancelConfirm(pendingRequest.id)}
                disabled={busy || pendingRequest.canCancel === false}
              >
                신청 취소
              </button>
            )}
          </div>
        </article>
      ) : (
        <form className="finance-request-form" onSubmit={submitRequest}>
          <fieldset
            disabled={
              !classIsActive
              || !finance.settings.bankOpen
              || wallet?.status !== "active"
              || busy
            }
          >
            <legend>어떤 은행 업무를 신청할까요?</legend>
            <div className="finance-request-type-choice">
              <label className={requestType === "deposit" ? "selected" : ""}>
                <input
                  type="radio"
                  name="finance-request-type"
                  value="deposit"
                  checked={requestType === "deposit"}
                  onChange={() => {
                    setRequestType("deposit");
                    submitKey.current = null;
                    setNotice(null);
                  }}
                />
                <ArrowDownToLine aria-hidden="true" />
                <span>
                  <b>입금 신청</b>
                  <small>실물 화폐를 디지털 지갑에 넣어요</small>
                </span>
              </label>
              <label className={requestType === "withdrawal" ? "selected" : ""}>
                <input
                  type="radio"
                  name="finance-request-type"
                  value="withdrawal"
                  checked={requestType === "withdrawal"}
                  onChange={() => {
                    setRequestType("withdrawal");
                    submitKey.current = null;
                    setNotice(null);
                  }}
                />
                <ArrowUpFromLine aria-hidden="true" />
                <span>
                  <b>출금 신청</b>
                  <small>디지털 지갑에서 실물 화폐로 찾아가요</small>
                </span>
              </label>
            </div>
          </fieldset>

          <label className="finance-amount-field">
            신청 금액
            <span className="finance-amount-input">
              <Coins aria-hidden="true" />
              <input
                type="number"
                inputMode="numeric"
                min={minDenomination}
                max={finance.settings.maxRequestAmount}
                step={minDenomination}
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  submitKey.current = null;
                  setNotice(null);
                }}
                placeholder="금액을 숫자로 입력"
                aria-describedby="finance-request-help"
                aria-invalid={Boolean(
                  amount
                  && (
                    !validAmount
                    || !matchesDenomination
                    || numericAmount > finance.settings.maxRequestAmount
                    || (
                      requestType === "withdrawal"
                      && numericAmount > availableBalance
                    )
                  )
                )}
                disabled={
                  !classIsActive
                  || !finance.settings.bankOpen
                  || !requestTypeEnabled
                  || wallet?.status !== "active"
                  || busy
                }
              />
              <span>{finance.currencyLabel}</span>
            </span>
          </label>
          {quickAmounts.length > 0 && (
            <div className="finance-quick-amounts" aria-label="권종 빠른 금액 입력">
              <span>빠른 금액</span>
              <div>
                {quickAmounts.map((quickAmount) => {
                  const exceedsLimit = quickAmount > finance.settings.maxRequestAmount;
                  const exceedsAvailable = requestType === "withdrawal"
                    && quickAmount > availableBalance;
                  return (
                    <button
                      key={quickAmount}
                      className="button button-light"
                      type="button"
                      onClick={() => {
                        setAmount(String(quickAmount));
                        submitKey.current = null;
                        setNotice(null);
                      }}
                      disabled={
                        !classIsActive
                        || !finance.settings.bankOpen
                        || !requestTypeEnabled
                        || wallet?.status !== "active"
                        || busy
                        || exceedsLimit
                        || exceedsAvailable
                      }
                    >
                      {amountText(quickAmount, finance.currencyLabel)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <p id="finance-request-help" className="finance-form-help">
            {!finance.settings.bankOpen
              ? "지금은 학급 은행이 잠시 쉬는 중이에요."
              : !requestTypeEnabled
                ? `지금은 ${requestTypeText(requestType)} 신청을 받지 않아요.`
                : validAmount && numericAmount > finance.settings.maxRequestAmount
                  ? `한 번에 최대 ${amountText(finance.settings.maxRequestAmount, finance.currencyLabel)}까지 신청할 수 있어요.`
                  : validAmount && !matchesDenomination
                    ? `금액은 최소 권종인 ${amountText(minDenomination, finance.currencyLabel)}의 배수로 입력해 주세요.`
                  : requestType === "withdrawal" && validAmount
              ? `신청 후 사용할 수 있는 금액: ${amountText(Math.max(0, availableBalance - numericAmount), finance.currencyLabel)}`
              : requestType === "withdrawal"
                ? `최대 ${amountText(availableBalance, finance.currencyLabel)}까지 신청할 수 있어요.`
                : `은행원에게 맡길 ${finance.settings.currencyName}와 같은 금액을 적어 주세요.`}
          </p>
          <button
            className="button button-primary button-large finance-submit-request"
            type="submit"
            disabled={!canSubmit || busy}
          >
            {busy
              ? <><LoaderCircle className="spin" aria-hidden="true" />신청 보내는 중</>
              : `${requestTypeText(requestType)} 신청 보내기`}
          </button>
        </form>
      )}

      <RequestHistory
        title="내 신청 기록"
        requests={ownRequests.filter((request) => request.status !== "pending")}
        currencyLabel={finance.currencyLabel}
        emptyMessage="처리가 끝난 신청이 아직 없어요."
      />
    </section>
  );
}

function BankerRequestPanel(props: FinanceOperationsProps) {
  const requests = props.finance.requests ?? [];
  const pending = requests.filter((request) => request.status === "pending");
  const recent = requests.filter((request) => request.status !== "pending").slice(0, 10);

  return (
    <section className="finance-operations-card banker-requests" aria-labelledby="banker-request-title">
      <div className="finance-operation-heading">
        <div>
          <p className="eyebrow">은행원 업무</p>
          <h2 id="banker-request-title">
            지금 확인할 신청 <strong>{pending.length}건</strong>
          </h2>
          <p>친구에게 실물 화폐를 받거나 건네기 전에 종류와 금액을 확인해 주세요.</p>
        </div>
        <button
          className="button button-light finance-refresh-button"
          type="button"
          onClick={() => void props.onRefresh()}
          disabled={props.refreshing}
        >
          <RefreshCw className={props.refreshing ? "spin" : ""} aria-hidden="true" />
          새로고침
        </button>
      </div>

      <RequestDecisionQueue
        role="banker"
        actorId={props.actorId}
        classId={props.classId}
        requests={pending}
        currencyLabel={props.finance.currencyLabel}
        classIsActive={props.classIsActive}
        onRefresh={props.onRefresh}
      />

      <RequestHistory
        title="최근 처리한 신청"
        requests={recent}
        currencyLabel={props.finance.currencyLabel}
        emptyMessage="아직 처리한 신청이 없어요."
      />
    </section>
  );
}

function TeacherFinanceOperations(props: FinanceOperationsProps) {
  const requests = props.finance.requests ?? [];
  const pending = requests.filter((request) => request.status === "pending");
  const [tab, setTab] = useState<"requests" | "transactions">("requests");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const filteredRequests = requests.filter((request) => {
    const matchesQuery = !normalizedQuery
      || request.student.name.toLocaleLowerCase("ko-KR").includes(normalizedQuery)
      || String(request.student.number) === normalizedQuery;
    return matchesQuery && (status === "all" || request.status === status);
  });
  const filteredTransactions = props.finance.transactions.filter((transaction) => (
    !normalizedQuery
    || transaction.studentName.toLocaleLowerCase("ko-KR").includes(normalizedQuery)
    || String(transaction.studentNumber) === normalizedQuery
  ));

  return (
    <>
      <section className="finance-operations-card teacher-help-card" aria-labelledby="teacher-help-title">
        <div className="finance-operation-heading">
          <div>
            <p className="eyebrow">은행원 친구 운영 현황</p>
            <h2 id="teacher-help-title">처리 대기 신청 {pending.length}건</h2>
            <p>아이들이 평소 업무를 맡고, 어려울 때만 선생님이 대신 처리할 수 있어요.</p>
          </div>
          <span className="finance-teacher-help-badge">
            <ShieldAlert aria-hidden="true" />필요할 때만 도움
          </span>
        </div>
        <RequestDecisionQueue
          role="teacher"
          actorId={props.actorId}
          classId={props.classId}
          requests={pending}
          currencyLabel={props.finance.currencyLabel}
          classIsActive={props.classIsActive && props.canOverride}
          onRefresh={props.onRefresh}
        />
      </section>

      <section className="finance-operations-card finance-audit-card" aria-labelledby="finance-audit-title">
        <div className="finance-operation-heading">
          <div>
            <p className="eyebrow">선생님 최근 업무 기록</p>
            <h2 id="finance-audit-title">최근 신청과 거래를 확인해요</h2>
            <p>문제가 생겼을 때 학생, 처리자, 사유와 정정 관계를 찾아볼 수 있어요.</p>
          </div>
          <FileSearch aria-hidden="true" />
        </div>

        <div className="finance-audit-tabs" role="group" aria-label="기록 종류">
          <button
            type="button"
            className={tab === "requests" ? "active" : ""}
            aria-pressed={tab === "requests"}
            onClick={() => setTab("requests")}
          >
            입출금 신청 <span>{requests.length}</span>
          </button>
          <button
            type="button"
            className={tab === "transactions" ? "active" : ""}
            aria-pressed={tab === "transactions"}
            onClick={() => setTab("transactions")}
          >
            거래 원장 <span>{props.finance.transactions.length}</span>
          </button>
        </div>

        <div className="finance-audit-filters">
          <label>
            <span className="visually-hidden">학생 이름 또는 번호 검색</span>
            <span className="finance-search-input">
              <Search aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="학생 이름 또는 번호 검색"
              />
            </span>
          </label>
          {tab === "requests" && (
            <label>
              <span className="visually-hidden">신청 상태</span>
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="all">모든 상태</option>
                <option value="pending">확인 중</option>
                <option value="approved">처리 완료</option>
                <option value="rejected">다시 확인</option>
                <option value="cancelled">신청 취소</option>
              </select>
            </label>
          )}
        </div>

        {tab === "requests" ? (
          <RequestHistory
            title=""
            requests={filteredRequests}
            currencyLabel={props.finance.currencyLabel}
            emptyMessage="조건에 맞는 신청 기록이 없어요."
          />
        ) : (
          <TeacherTransactionHistory
            transactions={filteredTransactions}
            currencyLabel={props.finance.currencyLabel}
            canOverride={props.classIsActive && props.canOverride}
            classId={props.classId}
            onRefresh={props.onRefresh}
          />
        )}
      </section>
    </>
  );
}

function RequestDecisionQueue({
  role,
  actorId,
  classId,
  requests,
  currencyLabel,
  classIsActive,
  onRefresh,
}: {
  role: "teacher" | "banker";
  actorId: string;
  classId: string;
  requests: FinanceRequestData[];
  currencyLabel: string;
  classIsActive: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [active, setActive] = useState<{
    requestId: string;
    decision: "approve" | "reject";
  } | null>(null);
  const [reasonChoice, setReasonChoice] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [teacherReason, setTeacherReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState>(null);
  const keys = useRef<Record<string, string>>({});

  function closeAction() {
    setActive(null);
    setReasonChoice("");
    setCustomReason("");
    setTeacherReason("");
  }

  async function decide(request: FinanceRequestData, decision: "approve" | "reject") {
    const rejectionNote = reasonChoice === "other" ? customReason.trim() : "";
    const interventionReason = role === "teacher" ? teacherReason.trim() : "";
    const missingRejectionReason = decision === "reject"
      && (!reasonChoice || (reasonChoice === "other" && !rejectionNote));
    const missingInterventionReason = role === "teacher" && !interventionReason;
    if (missingRejectionReason || missingInterventionReason) {
      setNotice({
        tone: "error",
        message: missingRejectionReason
          ? "학생이 이해할 수 있도록 거절 이유를 골라 주세요."
          : "선생님이 대신 처리하는 이유를 적어 주세요.",
      });
      return;
    }
    const keyId = `${request.id}:${decision}`;
    keys.current[keyId] ??= newActionKey(`finance-${decision}`);
    setBusyId(request.id);
    setNotice(null);
    try {
      const decisionPath =
        `/api/finance/requests/${encodeURIComponent(request.id)}/decision`;
      await postFinanceAction(
        role === "teacher"
          ? `${decisionPath}?classId=${encodeURIComponent(classId)}`
          : decisionPath,
        {
          decision,
          expectedRevision: request.revision,
          idempotencyKey: keys.current[keyId],
          ...(decision === "reject" ? {
            reasonCode: reasonChoice,
            ...(rejectionNote ? { reasonNote: rejectionNote } : {}),
          } : {}),
          ...(interventionReason ? { interventionReason } : {}),
        },
      );
      delete keys.current[keyId];
      closeAction();
      setNotice({
        tone: "success",
        message: decision === "approve"
          ? `${request.student.name} 학생의 ${requestTypeText(request.requestType)} 신청을 승인했어요.`
          : `${request.student.name} 학생에게 확인할 이유를 보냈어요.`,
      });
      await onRefresh();
    } catch (error) {
      setNotice({ tone: "error", message: friendlyActionError(error) });
      await onRefresh().catch(() => undefined);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="finance-request-queue">
      <ActionNotice notice={notice} />
      {requests.length === 0 ? (
        <div className="finance-empty-state compact">
          <BadgeCheck aria-hidden="true" />
          <b>기다리는 신청이 없어요.</b>
          <p>새 신청이 들어오면 이곳에 나타납니다.</p>
        </div>
      ) : (
        <ol>
          {requests.map((request) => {
            const selfRequest = role === "banker" && request.student.id === actorId;
            const decisionBlocked = !classIsActive
              || selfRequest
              || request.canDecide === false;
            const activeDecision = active?.requestId === request.id
              ? active.decision
              : null;
            return (
              <li key={request.id} className={selfRequest ? "self-request" : ""}>
                <div className="finance-request-main">
                  <span className={`finance-request-type ${request.requestType}`}>
                    {request.requestType === "deposit"
                      ? <ArrowDownToLine aria-hidden="true" />
                      : <ArrowUpFromLine aria-hidden="true" />}
                  </span>
                  <div>
                    <div className="finance-request-student">
                      <span>{request.student.number}</span>
                      <strong>{request.student.name}</strong>
                      <small>{requestTypeText(request.requestType)}</small>
                    </div>
                    <b className="finance-request-amount">
                      {amountText(request.amount, currencyLabel)}
                    </b>
                    <small>{dateTimeText(request.requestedAt)} 신청</small>
                  </div>
                  {selfRequest ? (
                    <div className="finance-self-lock">
                      <ShieldAlert aria-hidden="true" />
                      <span>내 신청은 다른 은행원이나 선생님이 처리해요.</span>
                    </div>
                  ) : (
                    <div className="finance-decision-buttons">
                      <button
                        className="button button-primary"
                        type="button"
                        onClick={() => {
                          closeAction();
                          setActive({ requestId: request.id, decision: "approve" });
                        }}
                        disabled={decisionBlocked || busyId !== null}
                      >
                        <Check aria-hidden="true" />승인
                      </button>
                      <button
                        className="button button-light"
                        type="button"
                        onClick={() => {
                          closeAction();
                          setActive({ requestId: request.id, decision: "reject" });
                        }}
                        disabled={decisionBlocked || busyId !== null}
                      >
                        <X aria-hidden="true" />거절
                      </button>
                    </div>
                  )}
                </div>

                {activeDecision && (
                  <div className={`finance-decision-confirm ${activeDecision}`}>
                    {activeDecision === "approve" ? (
                      <>
                        <div>
                          <b>
                            {request.requestType === "deposit"
                              ? "학생에게 실물 화폐를 받았나요?"
                              : "학생에게 건넬 실물 화폐를 확인했나요?"}
                          </b>
                          <p>
                            승인하면 {amountText(request.amount, currencyLabel)}이
                            {request.requestType === "deposit" ? " 지갑에 더해집니다." : " 지갑에서 빠집니다."}
                          </p>
                        </div>
                      </>
                    ) : (
                      <fieldset>
                        <legend>학생에게 알려 줄 이유</legend>
                        <div className="finance-rejection-options">
                          {REJECTION_REASONS.map((option) => (
                            <label key={option.code}>
                              <input
                                type="radio"
                                name={`reject-${request.id}`}
                                value={option.code}
                                checked={reasonChoice === option.code}
                                onChange={() => setReasonChoice(option.code)}
                              />
                              {option.label}
                            </label>
                          ))}
                        </div>
                        {reasonChoice === "other" && (
                          <label>
                            기타 이유
                            <input
                              value={customReason}
                              maxLength={200}
                              onChange={(event) => setCustomReason(event.target.value)}
                              placeholder="학생이 이해하기 쉽게 적어 주세요"
                            />
                          </label>
                        )}
                      </fieldset>
                    )}
                    {role === "teacher" && (
                      <label>
                        선생님이 대신 처리하는 이유
                        <input
                          value={teacherReason}
                          maxLength={200}
                          onChange={(event) => setTeacherReason(event.target.value)}
                          placeholder="예: 은행원 학생이 자리를 비움"
                        />
                      </label>
                    )}
                    <div className="finance-confirm-actions">
                      <button
                        className="button button-light"
                        type="button"
                        onClick={closeAction}
                        disabled={busyId === request.id}
                      >
                        돌아가기
                      </button>
                      <button
                        className={activeDecision === "approve"
                          ? "button button-primary"
                          : "button finance-danger-button"}
                        type="button"
                        onClick={() => void decide(request, activeDecision)}
                        disabled={
                          busyId === request.id
                          || (role === "teacher" && !teacherReason.trim())
                          || (
                            activeDecision === "reject"
                            && (
                              !reasonChoice
                              || (reasonChoice === "other" && !customReason.trim())
                            )
                          )
                        }
                      >
                        {busyId === request.id && <LoaderCircle className="spin" aria-hidden="true" />}
                        {activeDecision === "approve"
                          ? `${amountText(request.amount, currencyLabel)} 승인`
                          : "거절 이유 보내기"}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function RequestHistory({
  title,
  requests,
  currencyLabel,
  emptyMessage,
}: {
  title: string;
  requests: FinanceRequestData[];
  currencyLabel: string;
  emptyMessage: string;
}) {
  return (
    <section className="finance-request-history" aria-label={title || "신청 기록"}>
      {title && (
        <div className="finance-subsection-heading">
          <h3>{title}</h3>
          <span>{requests.length}건</span>
        </div>
      )}
      {requests.length === 0 ? (
        <div className="finance-empty-state compact">
          <History aria-hidden="true" />
          <b>{emptyMessage}</b>
        </div>
      ) : (
        <ol>
          {requests.map((request) => (
            <li key={request.id}>
              <span className={`finance-request-status ${request.status}`}>
                {requestStatusText(request.status)}
              </span>
              <div>
                <div>
                  <b>{requestTypeText(request.requestType)}</b>
                  <span>{request.student.number}번 {request.student.name}</span>
                </div>
                <p>{amountText(request.amount, currencyLabel)}</p>
                <small>
                  {dateTimeText(request.requestedAt)}
                  {request.processorLabel ? ` · 처리자 ${request.processorLabel}` : ""}
                </small>
                {requestReasonText(request) && <blockquote>{requestReasonText(request)}</blockquote>}
                {request.interventionReason && (
                  <blockquote className="teacher-intervention-reason">
                    선생님 도움 사유: {request.interventionReason}
                  </blockquote>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function TeacherTransactionHistory({
  transactions,
  currencyLabel,
  canOverride,
  classId,
  onRefresh,
}: {
  transactions: FinanceTransactionData[];
  currencyLabel: string;
  canOverride: boolean;
  classId: string;
  onRefresh: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<FinanceTransactionData | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);
  const keys = useRef<Record<string, string>>({});

  const reversible = useMemo(() => (
    selected
    && selected.transactionType !== "reversal"
    && !selected.isReversed
    && selected.canReverse !== false
  ), [selected]);

  async function reverseTransaction() {
    if (!selected || !reversible || !reason.trim()) {
      setNotice({ tone: "error", message: "정정 이유를 적어 주세요." });
      return;
    }
    keys.current[selected.id] ??= newActionKey("finance-reversal");
    setBusy(true);
    setNotice(null);
    try {
      await postFinanceAction(
        `/api/finance/transactions/${encodeURIComponent(selected.id)}/reverse`
          + `?classId=${encodeURIComponent(classId)}`,
        {
          reason: reason.trim(),
          idempotencyKey: keys.current[selected.id],
        },
      );
      delete keys.current[selected.id];
      setNotice({
        tone: "success",
        message: "원래 기록을 남긴 채 반대 금액의 정정 기록을 만들었어요.",
      });
      setSelected(null);
      setReason("");
      await onRefresh();
    } catch (error) {
      setNotice({ tone: "error", message: friendlyActionError(error) });
      await onRefresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="finance-teacher-ledger">
      <ActionNotice notice={notice} />
      {transactions.length === 0 ? (
        <div className="finance-empty-state compact">
          <FileSearch aria-hidden="true" />
          <b>조건에 맞는 거래 기록이 없어요.</b>
        </div>
      ) : (
        <ol className="finance-audit-ledger-list">
          {transactions.map((transaction) => {
            const canReverse = canOverride
              && transaction.transactionType !== "reversal"
              && !transaction.isReversed
              && transaction.canReverse !== false;
            return (
              <li key={`${transaction.id}:${transaction.studentId}`}>
                <div className="finance-audit-transaction">
                  <span className={`finance-ledger-direction ${transaction.amount > 0 ? "credit" : "debit"}`}>
                    {transaction.amount > 0 ? "증가" : "감소"}
                  </span>
                  <div>
                    <div>
                      <b>{TRANSACTION_LABELS[transaction.transactionType] ?? "금융 거래"}</b>
                      <span>{transaction.studentNumber}번 {transaction.studentName}</span>
                    </div>
                    <p>{transaction.description}</p>
                    <small>
                      {dateTimeText(transaction.postedAt)} · 처리자 {transaction.actorLabel}
                      {transaction.isReversed ? " · 정정됨" : ""}
                    </small>
                  </div>
                  <div className="finance-ledger-amount">
                    <strong className={transaction.amount > 0 ? "credit" : "debit"}>
                      {amountText(transaction.amount, currencyLabel, true)}
                    </strong>
                    <small>반영 후 {amountText(transaction.balanceAfter, currencyLabel)}</small>
                  </div>
                  <button
                    className="button button-light"
                    type="button"
                    onClick={() => {
                      setSelected(transaction);
                      setReason("");
                      setNotice(null);
                    }}
                    disabled={!canReverse || busy}
                    title={transaction.isReversed
                      ? "이미 정정된 거래입니다"
                      : transaction.transactionType === "reversal"
                        ? "정정 거래는 다시 정정할 수 없습니다"
                        : transaction.reversalBlockedReason || undefined}
                  >
                    <Undo2 aria-hidden="true" />
                    {transaction.isReversed ? "정정됨" : "이 거래 정정"}
                  </button>
                </div>
                {selected?.id === transaction.id && (
                  <div className="finance-reversal-panel" role="dialog" aria-labelledby="finance-reversal-title">
                    <div>
                      <ShieldAlert aria-hidden="true" />
                      <div>
                        <h3 id="finance-reversal-title">이 거래를 정정할까요?</h3>
                        <p>원래 기록은 지워지지 않고 반대 금액의 정정 기록이 새로 남습니다.</p>
                      </div>
                    </div>
                    <dl>
                      <div><dt>학생</dt><dd>{transaction.studentNumber}번 {transaction.studentName}</dd></div>
                      <div><dt>원래 금액</dt><dd>{amountText(transaction.amount, currencyLabel, true)}</dd></div>
                      <div><dt>정정 변화</dt><dd>{amountText(-transaction.amount, currencyLabel, true)}</dd></div>
                    </dl>
                    <label>
                      정정 이유
                      <textarea
                        value={reason}
                        maxLength={200}
                        rows={3}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="무엇을 잘못 처리했는지 적어 주세요"
                      />
                    </label>
                    <div className="finance-confirm-actions">
                      <button
                        className="button button-light"
                        type="button"
                        onClick={() => {
                          setSelected(null);
                          setReason("");
                        }}
                        disabled={busy}
                      >
                        돌아가기
                      </button>
                      <button
                        className="button finance-danger-button"
                        type="button"
                        onClick={() => void reverseTransaction()}
                        disabled={busy || !reason.trim()}
                      >
                        {busy && <LoaderCircle className="spin" aria-hidden="true" />}
                        정정 기록 남기기
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
