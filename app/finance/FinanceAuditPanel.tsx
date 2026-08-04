"use client";

import {
  CircleAlert,
  FileSearch,
  LoaderCircle,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

type AuditCategory = "all" | "request" | "decision" | "transaction" | "setting" | "deposit" | "stock";

export type FinanceAuditEvent = {
  id: string;
  category: string;
  action: string;
  title: string;
  detail: string;
  actorLabel: string;
  studentName: string | null;
  amount: number | null;
  occurredAt: string;
  outcome: string;
  relatedId: string | null;
};

type FinanceAuditResponse = {
  events: FinanceAuditEvent[];
  nextCursor: string | null;
  error?: string;
};

export type FinanceAuditPanelProps = {
  classId: string;
  currencyUnit: string;
};

const CATEGORY_OPTIONS: ReadonlyArray<{
  value: AuditCategory;
  label: string;
}> = [
  { value: "all", label: "전체" },
  { value: "request", label: "신청" },
  { value: "decision", label: "처리" },
  { value: "transaction", label: "거래" },
  { value: "setting", label: "설정" },
  { value: "deposit", label: "예금" },
  { value: "stock", label: "주식" },
];

function categoryText(category: string) {
  return CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? "기타";
}

function outcomeText(outcome: string) {
  const labels: Record<string, string> = {
    success: "완료",
    completed: "완료",
    approved: "승인",
    rejected: "거절",
    cancelled: "취소",
    canceled: "취소",
    failed: "실패",
    error: "실패",
    pending: "기다리는 중",
  };
  return labels[outcome.toLocaleLowerCase("en-US")] ?? outcome;
}

function occurredAtText(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "시간 정보 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function amountText(
  amount: number | null,
  currencyUnit: string,
  category: string,
) {
  if (amount === null || !Number.isFinite(amount)) return null;
  const sign = category === "transaction"
    ? amount > 0 ? "+" : amount < 0 ? "-" : ""
    : "";
  return `${sign}${Math.abs(amount).toLocaleString("ko-KR")} ${currencyUnit}`;
}

function loadErrorMessage(status: number, serverMessage?: string) {
  if (status === 401) return "로그인이 풀렸어요. 다시 로그인한 뒤 확인해 주세요.";
  if (status === 403 || status === 404) {
    return "이 학급의 금융 기록을 볼 수 없어요. 학급 선택과 권한을 확인해 주세요.";
  }
  return serverMessage || "금융 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.";
}

export function FinanceAuditPanel({
  classId,
  currencyUnit,
}: FinanceAuditPanelProps) {
  const [category, setCategory] = useState<AuditCategory>("all");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [events, setEvents] = useState<FinanceAuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeController = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);
  const unit = currencyUnit.trim() || "학급화폐";
  const busy = loading || refreshing || loadingMore;

  const loadEvents = useCallback(async (
    mode: "initial" | "refresh" | "more",
    cursor?: string,
  ) => {
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    const sequence = ++requestSequence.current;

    if (mode === "initial") {
      setLoading(true);
      setEvents([]);
      setNextCursor(null);
    } else if (mode === "refresh") {
      setRefreshing(true);
    } else {
      setLoadingMore(true);
    }
    setError(null);

    const parameters = new URLSearchParams({
      classId,
      limit: "50",
      category: category === "all" ? "" : category,
      query,
    });
    if (cursor) parameters.set("cursor", cursor);

    try {
      const response = await fetch(`/api/finance/audit?${parameters.toString()}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({})) as Partial<FinanceAuditResponse>;
      if (!response.ok) {
        throw new Error(loadErrorMessage(response.status, data.error));
      }
      if (!Array.isArray(data.events)) {
        throw new Error("금융 기록의 모양을 확인할 수 없어요. 새로고침해 주세요.");
      }
      if (controller.signal.aborted || requestSequence.current !== sequence) return;

      if (mode === "more") {
        setEvents((current) => {
          const merged = new Map(current.map((event) => [event.id, event]));
          data.events?.forEach((event) => merged.set(event.id, event));
          return Array.from(merged.values());
        });
      } else {
        setEvents(data.events);
      }
      setNextCursor(typeof data.nextCursor === "string" && data.nextCursor
        ? data.nextCursor
        : null);
    } catch (reason) {
      if ((reason as Error).name !== "AbortError" && requestSequence.current === sequence) {
        setError(reason instanceof Error
          ? reason.message
          : "금융 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      if (!controller.signal.aborted && requestSequence.current === sequence) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [category, classId, query]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void loadEvents("initial");
    });
    return () => {
      cancelAnimationFrame(frame);
      activeController.current?.abort();
    };
  }, [loadEvents]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedQuery = queryInput.trim();
    if (normalizedQuery === query) {
      void loadEvents("initial");
      return;
    }
    setQuery(normalizedQuery);
  }

  return (
    <section
      className="finance-audit-panel finance-operations-card finance-audit-card"
      aria-labelledby="finance-audit-panel-title"
    >
      <div className="finance-audit-heading finance-operation-heading">
        <div>
          <p className="eyebrow">선생님 금융 기록</p>
          <h2 id="finance-audit-panel-title">우리 반에서 있었던 일을 찾아봐요</h2>
          <p>학생 신청, 은행원 처리, 실제 거래와 설정 변경을 시간순으로 확인할 수 있어요.</p>
        </div>
        <button
          className="finance-audit-refresh button button-light finance-refresh-button"
          type="button"
          onClick={() => void loadEvents("refresh")}
          disabled={busy}
        >
          <RefreshCw className={refreshing ? "spin" : ""} aria-hidden="true" />
          새로고침
        </button>
      </div>

      <div className="finance-audit-tabs" role="group" aria-label="기록 종류">
        {CATEGORY_OPTIONS.map((option) => (
          <button
            key={option.value}
            className={category === option.value ? "active" : ""}
            type="button"
            aria-pressed={category === option.value}
            onClick={() => setCategory(option.value)}
            disabled={busy}
          >
            {option.label}
          </button>
        ))}
      </div>

      <form className="finance-audit-filters" role="search" onSubmit={submitSearch}>
        <label className="finance-audit-search-label finance-search-input">
          <span className="visually-hidden">학생 이름이나 기록 내용 검색</span>
          <Search aria-hidden="true" />
          <input
            type="search"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="학생 이름이나 기록 내용을 검색하세요"
            maxLength={80}
            disabled={busy}
          />
        </label>
        <button
          className="finance-audit-search-submit button button-primary"
          type="submit"
          disabled={busy}
        >
          <Search aria-hidden="true" />
          검색
        </button>
      </form>

      {error && (
        <div className="finance-audit-state finance-audit-error" role="alert">
          <CircleAlert aria-hidden="true" />
          <div>
            <b>기록을 확인하지 못했어요</b>
            <p>{error}</p>
          </div>
          <button
            className="finance-audit-retry button button-light"
            type="button"
            onClick={() => void loadEvents(events.length ? "refresh" : "initial")}
            disabled={busy}
          >
            다시 시도
          </button>
        </div>
      )}

      {loading ? (
        <div className="finance-audit-state finance-audit-loading" role="status" aria-live="polite">
          <LoaderCircle className="spin" aria-hidden="true" />
          <p>금융 기록을 모으고 있어요.</p>
        </div>
      ) : error && events.length === 0 ? null : events.length === 0 ? (
        <div className="finance-audit-state finance-audit-empty finance-empty-state compact">
          <FileSearch aria-hidden="true" />
          <b>{query || category !== "all"
            ? "조건에 맞는 기록이 없어요"
            : "아직 남겨진 금융 기록이 없어요"}</b>
          <p>{query || category !== "all"
            ? "검색어나 기록 종류를 바꿔 보세요."
            : "신청이나 거래가 생기면 여기에 차례대로 표시돼요."}</p>
        </div>
      ) : (
        <>
          <p className="finance-audit-summary" role="status">
            지금까지 {events.length.toLocaleString("ko-KR")}개의 기록을 확인했어요.
          </p>
          <ol className="finance-audit-list finance-audit-ledger-list">
            {events.map((auditEvent) => {
              const formattedAmount = amountText(
                auditEvent.amount,
                unit,
                auditEvent.category,
              );
              return (
                <li key={auditEvent.id} className="finance-audit-event">
                  <article className="finance-audit-event-content finance-audit-transaction">
                    <span className={`finance-audit-category category-${auditEvent.category}`}>
                      {categoryText(auditEvent.category)}
                    </span>
                    <div className="finance-audit-event-body">
                      <div className="finance-audit-event-title">
                        <b>{auditEvent.title || auditEvent.action || "금융 기록"}</b>
                        <span className={`finance-audit-outcome outcome-${auditEvent.outcome}`}>
                          {outcomeText(auditEvent.outcome)}
                        </span>
                      </div>
                      {auditEvent.detail && <p>{auditEvent.detail}</p>}
                      <p className="finance-audit-event-meta">
                        <time dateTime={auditEvent.occurredAt}>
                          {occurredAtText(auditEvent.occurredAt)}
                        </time>
                        {" · 처리한 사람: "}
                        {auditEvent.actorLabel || "시스템"}
                        {auditEvent.studentName ? ` · 학생: ${auditEvent.studentName}` : ""}
                      </p>
                    </div>
                    {formattedAmount && (
                      <div className="finance-audit-amount finance-ledger-amount">
                        <strong className={
                          auditEvent.category === "transaction"
                            ? Number(auditEvent.amount) >= 0 ? "credit" : "debit"
                            : ""
                        }>
                          {formattedAmount}
                        </strong>
                      </div>
                    )}
                  </article>
                </li>
              );
            })}
          </ol>
        </>
      )}

      {nextCursor && !loading && (
        <div className="finance-audit-more">
          <button
            className="finance-audit-more-button button button-light button-large"
            type="button"
            onClick={() => void loadEvents("more", nextCursor)}
            disabled={busy}
          >
            {loadingMore && <LoaderCircle className="spin" aria-hidden="true" />}
            {loadingMore ? "이전 기록을 불러오는 중" : "이전 기록 더 보기"}
          </button>
        </div>
      )}
    </section>
  );
}
