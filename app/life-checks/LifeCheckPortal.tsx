"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Milk,
  RefreshCw,
  Utensils,
} from "lucide-react";
import { Logo } from "@/app/components/Logo";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import {
  LIFE_CHECK_MAX_YEAR,
  LIFE_CHECK_MIN_YEAR,
  lifeCheckMonthForYear,
  lifeCheckYears,
  parseLifeCheckMonth,
} from "./life-check-navigation";
import { createSerialTaskQueue } from "./serial-task-queue";
import styles from "./life-checks.module.css";

type CheckType = "tooth" | "milk" | "lunch";
type CheckPeriod = "first" | "second";

type Overview = {
  context: {
    actor: { type: "teacher" | "student"; id: string; name: string };
    classroom: { id: string; displayName: string; schoolName: string; status: "active" | "archived" };
    role: "teacher" | "checker" | "student";
    allowedWriteTypes: CheckType[];
    permissions: { canViewClass: boolean; canRecord: boolean; canManagePayouts: boolean; canOverride: boolean };
    activeJob: null | { name: string; templateId: string | null; assignmentYear: number; assignmentMonth: number };
  };
  selection: {
    type: CheckType;
    typeLabel: string;
    month: string;
    year: number;
    monthNumber: number;
    period: CheckPeriod;
    periodLabel: string;
  };
  serverTime: { date: string };
  calendar: {
    saved: boolean;
    monthSaved: boolean;
    revision: number;
    dates: string[];
    firstDates: string[];
    secondDates: string[];
  };
  series: { revision: number; updatedAt: number };
  students: Array<{
    id: string;
    number: number;
    name: string;
    passedCount: number;
    totalCount: number;
    expectedReward: number;
  }>;
  records: Record<string, Record<string, boolean>>;
  preview: {
    items: Array<{
      studentId: string;
      studentNumber: number;
      studentName: string;
      amount: number;
      reason: string;
    }>;
    recipientCount: number;
    totalAmount: number;
    currencyUnit: string;
  };
  payout: null | {
    id: string;
    status: "prepared" | "completed" | "cancelled";
    items: Overview["preview"]["items"];
    recipientCount: number;
    totalAmount: number;
    sourceSeriesRevision: number;
    sourceCalendarRevision: number;
    revision: number;
    completedAt: number | null;
  };
  recentEvents: Array<{
    id: string;
    kind: "record" | "payout";
    date: string | null;
    studentNumber: number | null;
    studentName: string | null;
    passed: boolean | null;
    reason: string | null;
    action: "prepared" | "refreshed" | "completed" | "cancelled" | "reopened" | null;
    year: number | null;
    month: number | null;
    period: CheckPeriod | null;
    actorType: string;
    actorName: string;
    createdAt: number;
  }>;
  recentEventsNextCursor: string | null;
};

const TYPE_INFO: Record<CheckType, { label: string; icon: typeof ClipboardCheck }> = {
  tooth: { label: "양치", icon: ClipboardCheck },
  milk: { label: "우유", icon: Milk },
  lunch: { label: "급식", icon: Utensils },
};

const PAYOUT_ACTION_LABEL = {
  prepared: "지급 명단 준비",
  refreshed: "지급 명단 갱신",
  completed: "지급 완료 기록",
  cancelled: "지급 명단 취소",
  reopened: "교사 비상 재개",
} as const;

const SEOUL_TIME_ZONE = "Asia/Seoul";
const SEOUL_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: SEOUL_TIME_ZONE,
});

function currentSeoulYear() {
  const year = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    timeZone: SEOUL_TIME_ZONE,
  }).formatToParts(Date.now()).find((part) => part.type === "year")?.value;
  return Number(year) || new Date().getUTCFullYear();
}

function seoulDateTime(value: number) {
  return SEOUL_DATE_TIME_FORMATTER.format(value);
}

function shortDate(date: string) {
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function requestKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...init?.headers },
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string; code?: string };
  if (!response.ok) {
    const error = new Error(data.error || "요청을 처리하지 못했어요.") as Error & { status?: number; code?: string };
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

export function LifeCheckPortal() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [type, setType] = useState<CheckType>("tooth");
  const [month, setMonth] = useState("");
  const [period, setPeriod] = useState<CheckPeriod>("first");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [auditBusy, setAuditBusy] = useState(false);
  const [savingCells, setSavingCells] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const requestSequence = useRef(0);
  const savingCellsRef = useRef<Set<string>>(new Set());
  const pendingRecordChangesRef = useRef(new Map<string, {
    studentId: string;
    date: string;
    passed: boolean;
    type: CheckType;
  }>());
  const recordQueueRef = useRef(createSerialTaskQueue());
  const recordQueueCountRef = useRef(0);
  const recordQueueReadyRef = useRef(true);
  const recordQueueErrorRef = useRef("");
  const seriesRevisionRef = useRef(0);
  const classId = typeof window === "undefined"
    ? ""
    : new URLSearchParams(window.location.search).get("classId") || "";

  const load = useCallback(async (quiet = false, selection?: Partial<{ type: CheckType; month: string; period: CheckPeriod }>) => {
    const sequence = ++requestSequence.current;
    if (!quiet) setLoading(true);
    setError("");
    const nextType = selection?.type ?? type;
    const nextMonth = selection?.month ?? month;
    const nextPeriod = selection?.period ?? period;
    const query = new URLSearchParams();
    if (classId) query.set("classId", classId);
    query.set("type", nextType);
    if (nextMonth) query.set("month", nextMonth);
    query.set("period", nextPeriod);
    try {
      const data = await jsonRequest<Overview>(`/api/life-checks/overview?${query}`);
      if (sequence !== requestSequence.current) return;
      seriesRevisionRef.current = data.series.revision;
      let records = data.records;
      for (const change of pendingRecordChangesRef.current.values()) {
        if (change.type !== data.selection.type) continue;
        records = {
          ...records,
          [change.studentId]: {
            ...records[change.studentId],
            [change.date]: change.passed,
          },
        };
      }
      setOverview(records === data.records ? data : { ...data, records });
      setType(data.selection.type);
      setMonth(data.selection.month);
      setPeriod(data.selection.period);
      return data;
    } catch (reason) {
      if (sequence === requestSequence.current) setError((reason as Error).message);
      return null;
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [classId, month, period, type]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load(false));
    return () => cancelAnimationFrame(frame);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const canWriteSelected = Boolean(
    overview?.context.permissions.canRecord
    && overview.context.allowedWriteTypes.includes(type)
    && overview.context.classroom.status === "active"
    && overview.calendar.monthSaved,
  );
  const payoutOutdated = Boolean(
    overview?.payout
    && overview.payout.status === "prepared"
    && (
      overview.payout.sourceSeriesRevision !== overview.series.revision
      || overview.payout.sourceCalendarRevision !== overview.calendar.revision
    ),
  );
  const periodInProgress = overview
    ? overview.calendar.dates.some((date) => date > overview.serverTime.date)
    : false;
  const selectedMonth = parseLifeCheckMonth(month);
  const selectedYear = Math.min(
    LIFE_CHECK_MAX_YEAR,
    Math.max(
      LIFE_CHECK_MIN_YEAR,
      selectedMonth?.year ?? overview?.selection.year ?? currentSeoulYear(),
    ),
  );
  const years = useMemo(() => lifeCheckYears(), []);
  const months = useMemo(() => {
    return Array.from({ length: 12 }, (_, index) => {
      const value = `${selectedYear}-${String(index + 1).padStart(2, "0")}`;
      return { value, label: `${index + 1}월` };
    });
  }, [selectedYear]);

  function markCellSaving(key: string, saving: boolean) {
    const next = new Set(savingCellsRef.current);
    if (saving) next.add(key);
    else next.delete(key);
    savingCellsRef.current = next;
    setSavingCells(next);
  }

  async function loadMoreAudit() {
    if (!overview?.recentEventsNextCursor || auditBusy) return;
    const cursor = overview.recentEventsNextCursor;
    const selectedType = overview.selection.type;
    const query = new URLSearchParams({
      type: selectedType,
      cursor,
      limit: "40",
    });
    if (classId) query.set("classId", classId);

    setAuditBusy(true);
    setError("");
    try {
      const page = await jsonRequest<{
        events: Overview["recentEvents"];
        nextCursor: string | null;
        hasMore: boolean;
      }>(`/api/life-checks/audit?${query}`);
      setOverview((current) => {
        if (
          !current
          || current.selection.type !== selectedType
          || current.recentEventsNextCursor !== cursor
        ) return current;
        const events = new Map<string, Overview["recentEvents"][number]>();
        for (const event of [...current.recentEvents, ...page.events]) {
          events.set(`${event.kind}:${event.id}`, event);
        }
        return {
          ...current,
          recentEvents: [...events.values()].sort((left, right) => {
            const timeDifference = right.createdAt - left.createdAt;
            if (timeDifference !== 0) return timeDifference;
            const leftKey = `${left.kind}:${left.id}`;
            const rightKey = `${right.kind}:${right.id}`;
            return leftKey === rightKey ? 0 : leftKey < rightKey ? 1 : -1;
          }),
          recentEventsNextCursor: page.hasMore ? page.nextCursor : null,
        };
      });
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setAuditBusy(false);
    }
  }

  async function toggleRecord(studentId: string, date: string, passed: boolean) {
    const cellKey = `${studentId}:${date}`;
    if (!overview || busy || savingCellsRef.current.has(cellKey)) return;
    const previousPassed = Boolean(overview.records[studentId]?.[date]);
    const queuedSelection = {
      type: overview.selection.type,
      month: overview.selection.month,
      period: overview.selection.period,
    };
    const requestId = requestKey("life-check");
    if (recordQueueCountRef.current === 0) {
      recordQueueReadyRef.current = true;
      recordQueueErrorRef.current = "";
      setError("");
      setMessage("");
    }
    recordQueueCountRef.current += 1;
    pendingRecordChangesRef.current.set(cellKey, {
      studentId,
      date,
      passed,
      type: queuedSelection.type,
    });
    markCellSaving(cellKey, true);
    setOverview((current) => current ? {
      ...current,
      records: {
        ...current.records,
        [studentId]: { ...current.records[studentId], [date]: passed },
      },
    } : current);

    const operation = recordQueueRef.current.run(async () => {
      let failed = false;
      if (!recordQueueReadyRef.current) {
        failed = true;
        recordQueueErrorRef.current ||= "앞선 저장의 최신 상태를 확인하지 못해 나머지 입력은 저장하지 않았어요. 새로고침 후 다시 표시해 주세요.";
      } else {
        try {
          const result = await jsonRequest<{ revision: number }>(
            `/api/life-checks/records${classId ? `?classId=${encodeURIComponent(classId)}` : ""}`,
            {
              method: "PUT",
              body: JSON.stringify({
                type: queuedSelection.type,
                date,
                studentId,
                passed,
                expectedRevision: seriesRevisionRef.current,
                requestId,
              }),
            },
          );
          if (!Number.isInteger(result.revision)) throw new Error("저장 결과를 확인하지 못했어요.");
          seriesRevisionRef.current = result.revision;
        } catch (reason) {
          failed = true;
          recordQueueErrorRef.current = (reason as Error).message;
        }
      }

      pendingRecordChangesRef.current.delete(cellKey);
      if (failed) {
        setOverview((current) => current ? {
          ...current,
          records: {
            ...current.records,
            [studentId]: { ...current.records[studentId], [date]: previousPassed },
          },
        } : current);
        if (recordQueueReadyRef.current) {
          const refreshed = await load(true, queuedSelection);
          if (!refreshed) {
            recordQueueReadyRef.current = false;
            recordQueueErrorRef.current = `${recordQueueErrorRef.current} 최신 기록도 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.`;
          }
        }
      }

      markCellSaving(cellKey, false);
      recordQueueCountRef.current -= 1;
      if (recordQueueCountRef.current === 0) {
        const queueError = recordQueueErrorRef.current;
        if (recordQueueReadyRef.current) await load(true, queuedSelection);
        if (queueError) setError(queueError);
      }
    });
    await operation;
  }

  async function preparePayout() {
    if (!overview || busy || savingCellsRef.current.size > 0 || periodInProgress) return;
    setBusy(true);
    setError("");
    try {
      await jsonRequest(`/api/life-checks/payouts${classId ? `?classId=${encodeURIComponent(classId)}` : ""}`, {
        method: "POST",
        body: JSON.stringify({
          type,
          month,
          period,
          expectedSeriesRevision: overview.series.revision,
          expectedCalendarRevision: overview.calendar.revision,
          expectedPayoutRevision: overview.payout?.revision ?? 0,
          requestId: requestKey("life-payout"),
        }),
      });
      setMessage("현재 기록으로 지급 명단을 만들었어요. 실제 지급 후 완료로 표시해 주세요.");
      await load(true);
    } catch (reason) {
      setError((reason as Error).message);
      if ((reason as Error & { status?: number }).status === 409) await load(true);
    } finally {
      setBusy(false);
    }
  }

  async function updatePayout(action: "complete" | "cancel" | "reopen") {
    if (!overview?.payout || busy || savingCellsRef.current.size > 0) return;
    const needsReason = action !== "complete";
    const reason = needsReason ? window.prompt(action === "cancel" ? "취소 이유를 적어 주세요." : "다시 여는 이유를 적어 주세요.") : "";
    if (needsReason && !reason?.trim()) return;
    if (action === "complete" && !window.confirm("현물 학급화폐 지급을 실제로 마쳤나요? 완료 후에도 교사가 다시 열 수 있습니다.")) return;
    setBusy(true);
    setError("");
    try {
      await jsonRequest(`/api/life-checks/payouts/${encodeURIComponent(overview.payout.id)}${classId ? `?classId=${encodeURIComponent(classId)}` : ""}`, {
        method: "PATCH",
        body: JSON.stringify({
          action,
          expectedRevision: overview.payout.revision,
          requestId: requestKey(`life-payout-${action}`),
          reason,
        }),
      });
      setMessage(action === "complete" ? "지급 완료로 기록했어요." : action === "cancel" ? "지급 명단을 취소했어요." : "지급 명단을 다시 열었어요.");
      await load(true);
    } catch (reasonValue) {
      setError((reasonValue as Error).message);
      if ((reasonValue as Error & { status?: number }).status === 409) await load(true);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !overview) {
    return <main className={styles.statePage} aria-busy="true"><ClipboardCheck aria-hidden="true" /><p>생활확인 기록을 준비하고 있어요</p></main>;
  }

  if (!overview) {
    return (
      <main className={styles.statePage}>
        <ClipboardCheck aria-hidden="true" />
        <h1>생활확인을 열지 못했어요</h1>
        <p role="alert">{error || "로그인 상태와 학급을 확인해 주세요."}</p>
        <div className={styles.stateActions}>
          <button className="button button-primary" type="button" onClick={() => void load(false)}>다시 시도</button>
          <a className="button button-light" href="/student">학생 화면으로</a>
          <a className="button button-light" href={classId ? `/teacher?classId=${encodeURIComponent(classId)}` : "/teacher"}>교사 화면으로</a>
        </div>
      </main>
    );
  }

  const backHref = overview.context.actor.type === "teacher" ? `/teacher?classId=${overview.context.classroom.id}` : "/student";

  return (
    <main className={styles.page} aria-busy={busy}>
      <header className={styles.header}>
        <Logo compact />
        <div>
          <a className="button button-light" href={backHref}><ArrowLeft aria-hidden="true" />돌아가기</a>
          <ThemeToggle compact />
        </div>
      </header>

      <section className={styles.hero}>
        <div>
          <p className="eyebrow">직업교실 · 생활확인</p>
          <h1>{overview.context.classroom.displayName} 생활확인</h1>
          <p>{overview.context.role === "teacher"
            ? "담당 학생들의 기록을 확인하고, 꼭 필요할 때만 도와주세요."
            : overview.context.role === "checker"
              ? `${overview.context.activeJob?.name || "확인 담당"}으로 친구들의 생활 기록을 책임 있게 정리해요.`
              : "내 생활확인 결과와 예상 보상을 확인할 수 있어요."}</p>
        </div>
        <button className="button button-light" disabled={busy || savingCells.size > 0} onClick={() => void load(true)}><RefreshCw aria-hidden="true" />새로고침</button>
      </section>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {message && <div className={styles.success} role="status">{message}</div>}

      <section className={styles.controls} aria-label="생활확인 기간 선택">
        <div className={styles.typeTabs} aria-label="확인 항목 선택">
          {(Object.keys(TYPE_INFO) as CheckType[]).map((item) => {
            const Icon = TYPE_INFO[item].icon;
            const writable = overview.context.allowedWriteTypes.includes(item);
            return (
              <button
                key={item}
                className={type === item ? styles.active : ""}
                disabled={busy || savingCells.size > 0}
                onClick={() => void load(false, { type: item })}
                aria-pressed={type === item}
              >
                <Icon aria-hidden="true" />{TYPE_INFO[item].label}{writable && overview.context.role === "checker" ? <small>내 담당</small> : null}
              </button>
            );
          })}
        </div>
        <label>연도
          <select
            value={selectedYear}
            disabled={busy || savingCells.size > 0}
            onChange={(event) => void load(false, {
              month: lifeCheckMonthForYear(month, Number(event.target.value)),
            })}
            aria-label="생활확인 연도"
          >
            {years.map((year) => <option key={year} value={year}>{year}년</option>)}
          </select>
        </label>
        <label>월
          <select value={month} disabled={busy || savingCells.size > 0} onChange={(event) => void load(false, { month: event.target.value })}>
            {months.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <div className={styles.periodTabs} aria-label="기간 선택">
          <button disabled={busy || savingCells.size > 0} aria-pressed={period === "first"} className={period === "first" ? styles.active : ""} onClick={() => void load(false, { period: "first" })}>상반기</button>
          <button disabled={busy || savingCells.size > 0} aria-pressed={period === "second"} className={period === "second" ? styles.active : ""} onClick={() => void load(false, { period: "second" })}>하반기</button>
        </div>
      </section>

      {!overview.calendar.monthSaved && (
        <div className={styles.notice}><CalendarDays aria-hidden="true" /><span>{overview.calendar.saved ? "선택한 달의 학급 달력을 아직 저장하지 않았어요. 선생님이 이 달의 수업일을 저장하면 기록할 수 있습니다." : "학급 달력을 아직 저장하지 않아 평일을 임시 수업일로 표시하고 있어요. 선생님이 달력을 저장하면 기록할 수 있습니다."}</span></div>
      )}

      <section className={styles.recordPanel} aria-labelledby="life-record-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className="eyebrow">{overview.selection.year}년 {overview.selection.monthNumber}월 {overview.selection.periodLabel}</p>
            <h2 id="life-record-title">{overview.selection.typeLabel} 기록</h2>
          </div>
          <span>{overview.calendar.dates.length}일</span>
        </div>
        {overview.calendar.dates.length === 0 ? (
          <p className={styles.empty}>이 기간에는 수업일이 없습니다.</p>
        ) : (
          <div
            className={styles.tableWrap}
            role="region"
            tabIndex={0}
            aria-label={`${overview.selection.typeLabel} 학생별 기록표. 좌우로 스크롤할 수 있습니다.`}
          >
            <table className={styles.checkTable}>
              <caption className="visually-hidden">{overview.selection.typeLabel} 학생별 수업일 확인 기록</caption>
              <thead><tr><th scope="col">학생</th>{overview.calendar.dates.map((date) => <th scope="col" key={date}>{shortDate(date)}</th>)}<th scope="col">통과</th><th scope="col">예상</th></tr></thead>
              <tbody>
                {overview.students.map((student) => (
                  <tr key={student.id}>
                    <th scope="row"><span>{student.number}번</span>{student.name}</th>
                    {overview.calendar.dates.map((date) => {
                      const checked = Boolean(overview.records[student.id]?.[date]);
                      const futureDate = date > overview.serverTime.date;
                      const cellKey = `${student.id}:${date}`;
                      const cellBusy = savingCells.has(cellKey);
                      return (
                        <td key={date} aria-busy={cellBusy || undefined}>
                          <label className={`${styles.checkCell} ${cellBusy ? styles.checkCellBusy : ""}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!canWriteSelected || busy || futureDate || cellBusy}
                              onChange={(event) => void toggleRecord(student.id, date, event.target.checked)}
                              aria-label={`${student.number}번 ${student.name} ${shortDate(date)} ${overview.selection.typeLabel}${cellBusy ? ", 저장 중" : ""}`}
                            />
                            <span aria-hidden="true"><CheckCircle2 /></span>
                          </label>
                        </td>
                      );
                    })}
                    <td><b>{student.passedCount}/{student.totalCount}</b></td>
                    <td>{student.expectedReward > 0 ? `${student.expectedReward.toLocaleString()} ${overview.preview.currencyUnit}` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!canWriteSelected && overview.context.role === "checker" && (
          <p className={styles.readOnly}>이 항목은 현재 맡은 직업의 담당 기록이 아니어서 읽기만 할 수 있어요.</p>
        )}
      </section>

      <section className={styles.payoutPanel} aria-labelledby="life-payout-title">
        <div className={styles.sectionHeading}>
          <div><p className="eyebrow">현물 학급화폐</p><h2 id="life-payout-title">보상 지급 명단</h2></div>
          <strong>{overview.preview.recipientCount}명 · {overview.preview.totalAmount.toLocaleString()} {overview.preview.currencyUnit}</strong>
        </div>
        <p>여기서는 지급할 명단과 완료 여부만 기록합니다. 금융센터 디지털 잔액은 바뀌지 않습니다.</p>
        {overview.preview.items.length ? (
          <ul className={styles.rewardList}>{overview.preview.items.map((item) => <li key={item.studentId}><span>{item.studentNumber}번 {item.studentName}</span><small>{item.reason}</small><b>{item.amount.toLocaleString()} {overview.preview.currencyUnit}</b></li>)}</ul>
        ) : <p className={styles.empty}>현재 기록으로 지급 대상이 없습니다.</p>}
        {payoutOutdated && <div className={styles.warning}>지급 명단을 만든 뒤 확인 기록이나 학급 달력이 달라졌어요. 최신 명단으로 다시 만들어 주세요.</div>}
        {periodInProgress && <div className={styles.notice}>이 기간에는 아직 지나지 않은 수업일이 있어요. 모든 수업일이 끝나면 지급 명단을 만들 수 있습니다.</div>}
        {overview.context.permissions.canManagePayouts && canWriteSelected && (
          <div className={styles.actions}>
            {(!overview.payout || overview.payout.status === "prepared") && (
              <button className="button button-primary" disabled={busy || savingCells.size > 0 || !overview.calendar.monthSaved || periodInProgress || !overview.preview.items.length} onClick={() => void preparePayout()}>
                {overview.payout?.status === "prepared" ? "최신 명단으로 다시 만들기" : "지급 명단 만들기"}
              </button>
            )}
            {overview.payout?.status === "prepared" && !payoutOutdated && <button className="button button-light" disabled={busy || savingCells.size > 0 || !overview.calendar.monthSaved || periodInProgress} onClick={() => void updatePayout("complete")}>실제 지급 완료</button>}
            {overview.payout?.status === "prepared" && <button className="button button-light" disabled={busy || savingCells.size > 0} onClick={() => void updatePayout("cancel")}>명단 취소</button>}
            {overview.payout && overview.payout.status !== "prepared" && overview.context.permissions.canOverride && <button className="button button-light" disabled={busy || savingCells.size > 0} onClick={() => void updatePayout("reopen")}>교사 비상 재개</button>}
          </div>
        )}
        {overview.payout && <p className={styles.payoutStatus}>현재 상태: <b>{overview.payout.status === "prepared" ? "지급 준비" : overview.payout.status === "completed" ? "지급 완료" : "취소됨"}</b></p>}
      </section>

      {overview.context.role !== "student" && overview.context.permissions.canViewClass && (
        <section className={styles.auditPanel} aria-labelledby="life-audit-title">
          <div className={styles.sectionHeading}><div><p className="eyebrow">되돌릴 수 없는 기록</p><h2 id="life-audit-title">최근 변경 기록</h2></div></div>
          {overview.recentEvents.length ? (
            <ol>{overview.recentEvents.map((event) => (
              <li key={`${event.kind}:${event.id}`}>
                <time dateTime={new Date(event.createdAt).toISOString()}>{seoulDateTime(event.createdAt)}</time>
                {event.kind === "record" ? (
                  <>
                    <b>{event.studentNumber}번 {event.studentName}</b>
                    <span>{event.date ? shortDate(event.date) : "-"} · {event.passed ? "통과 표시" : "표시 해제"}</span>
                  </>
                ) : (
                  <>
                    <b>{event.year}년 {event.month}월 {event.period === "first" ? "상반기" : "하반기"}</b>
                    <span>{event.action ? PAYOUT_ACTION_LABEL[event.action] : "지급 명단 변경"}</span>
                  </>
                )}
                <small>{event.actorName}{event.reason ? ` · ${event.reason}` : ""}</small>
              </li>
            ))}</ol>
          ) : <p className={styles.empty}>아직 변경 기록이 없습니다.</p>}
          {overview.recentEventsNextCursor && (
            <div className={styles.auditMore}>
              <button
                className="button button-light"
                type="button"
                disabled={auditBusy}
                onClick={() => void loadMoreAudit()}
              >
                {auditBusy ? "불러오는 중" : "이전 변경 기록 더 보기"}
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
