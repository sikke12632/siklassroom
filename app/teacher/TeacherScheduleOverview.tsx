"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BookOpen,
  CalendarCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  PencilLine,
  RefreshCw,
  Save,
} from "lucide-react";
import { Notice } from "@/app/components/Notice";
import { api, ClientApiError, putJson } from "@/lib/client-api";
import {
  changedFields,
  createTimetableDraft as timetableDraft,
  draftsEqual,
  MAX_TIMETABLE_PERIODS,
  mergeDrafts,
  timetableSlotKey as slotKey,
  TIMETABLE_WEEKDAYS,
  type TimetableChange,
  type TimetableDraft,
  type TimetableState,
} from "@/lib/timetable-draft";
import styles from "./TeacherScheduleOverview.module.css";

type CalendarDay = {
  date: string;
  dayType: "class" | "off";
  memo: string;
  isWeekend: boolean;
};

type CalendarState = {
  saved: boolean;
  monthSaved: boolean;
  schoolYear: number;
  timeZone: string;
  timeZoneLabel: string;
  classStartDate: string;
  firstJobStartDate: string;
  firstJobEndDate: string;
  revision: number;
  monthValue: string;
  days: CalendarDay[];
  serverTime: {
    epochMs: number;
    iso: string;
    date: string;
    label: string;
    weekday: string;
    fullLabel: string;
    timeZone: "Asia/Seoul";
  };
};

type TeachingCalendarResponse = {
  calendar: CalendarState;
  timetable: TimetableState;
};

type TimetableConflict = {
  base: TimetableDraft;
  local: TimetableDraft;
  latest: TimetableDraft;
  changes: TimetableChange[];
};

const WEEKDAYS = TIMETABLE_WEEKDAYS;
const CALENDAR_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;
const MAX_PERIODS = MAX_TIMETABLE_PERIODS;
const SEOUL_UTC_OFFSET_MS = 9 * 60 * 60 * 1000;
const MIDNIGHT_REFRESH_GRACE_MS = 1_500;

const fullDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "UTC",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});

function shiftedMonth(monthValue: string, offset: number) {
  const [year, month] = monthValue.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthValue: string) {
  const [year, month] = monthValue.split("-").map(Number);
  return `${year}년 ${month}월`;
}

function fullDateLabel(date: string) {
  return fullDateFormatter.format(new Date(`${date}T00:00:00Z`));
}

function weekdayForDate(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function nextSeoulMidnightEpoch(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day + 1) - SEOUL_UTC_OFFSET_MS;
}

function calendarRows(calendar: CalendarState) {
  const firstWeekday = new Date(`${calendar.monthValue}-01T00:00:00Z`).getUTCDay();
  const cells: Array<CalendarDay | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...calendar.days,
  ];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, row) => cells.slice(row * 7, row * 7 + 7));
}

export function TeacherScheduleOverview({
  classId,
  readOnly = false,
  onDirtyChange,
  onTimetableSaved,
}: {
  classId: string;
  readOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onTimetableSaved?: () => void;
}) {
  const [data, setData] = useState<TeachingCalendarResponse | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [draft, setDraft] = useState<TimetableDraft | null>(null);
  const [baseDraft, setBaseDraft] = useState<TimetableDraft | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [mobileWeekday, setMobileWeekday] = useState(1);
  const [initialLoading, setInitialLoading] = useState(true);
  const [monthBusy, setMonthBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflictLoading, setConflictLoading] = useState(false);
  const [todayRefreshing, setTodayRefreshing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [staleNeedsRefresh, setStaleNeedsRefresh] = useState(false);
  const [conflict, setConflict] = useState<TimetableConflict | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const todayRefreshController = useRef<AbortController | null>(null);
  const dateButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const weekdayTabRefs = useRef(new Map<number, HTMLButtonElement>());
  const todayRefreshInFlight = useRef(false);
  const serverClockOffsetMs = useRef(0);

  const load = useCallback(async (
    monthValue?: string,
    options: { replaceDraft?: boolean; preserveSelection?: boolean } = {},
  ) => {
    const sequence = ++requestSequence.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setMonthBusy(true);
    setError("");
    try {
      const query = monthValue ? `?month=${encodeURIComponent(monthValue)}` : "";
      const next = await api<TeachingCalendarResponse>(
        `/api/classes/${classId}/teaching-calendar${query}`,
        { signal: controller.signal },
      );
      if (sequence !== requestSequence.current) return null;
      serverClockOffsetMs.current = next.calendar.serverTime.epochMs - Date.now();
      setData(next);
      setSelectedDate((current) => {
        if (options.preserveSelection && next.calendar.days.some((day) => day.date === current)) return current;
        if (next.calendar.days.some((day) => day.date === next.calendar.serverTime.date)) {
          return next.calendar.serverTime.date;
        }
        return next.calendar.days[0]?.date ?? "";
      });
      if (options.replaceDraft) {
        const nextDraft = timetableDraft(next.timetable);
        setDraft(nextDraft);
        setBaseDraft(nextDraft);
        const todayWeekday = weekdayForDate(next.calendar.serverTime.date);
        if (todayWeekday >= 1 && todayWeekday <= 5) setMobileWeekday(todayWeekday);
        setDirty(false);
        setConflict(null);
        setStaleNeedsRefresh(false);
      }
      return next;
    } catch (reason) {
      if (controller.signal.aborted || (reason instanceof DOMException && reason.name === "AbortError")) return null;
      if (sequence === requestSequence.current) {
        setError((reason as Error).message || "학급 일정을 불러오지 못했어요.");
      }
      return null;
    } finally {
      if (sequence === requestSequence.current) {
        setInitialLoading(false);
        setMonthBusy(false);
      }
    }
  }, [classId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void load(undefined, { replaceDraft: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      requestSequence.current += 1;
      requestController.current?.abort();
      todayRefreshController.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const refreshCurrentServerDay = useCallback(async () => {
    if (
      !data
      || saving
      || monthBusy
      || conflictLoading
      || staleNeedsRefresh
      || conflict
      || todayRefreshInFlight.current
    ) return;
    todayRefreshInFlight.current = true;
    setTodayRefreshing(true);
    const controller = new AbortController();
    todayRefreshController.current = controller;
    try {
      const { serverTime } = await api<{
        serverTime: { epochMs: number; date: string; monthValue: string };
      }>(
        "/api/time",
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      serverClockOffsetMs.current = serverTime.epochMs - Date.now();
      if (serverTime.date === data.calendar.serverTime.date) return;
      const previousTodayMonth = data.calendar.serverTime.date.slice(0, 7);
      const viewingPreviousTodayMonth = data.calendar.monthValue === previousTodayMonth;
      const crossedMonthBoundary = previousTodayMonth !== serverTime.monthValue;
      const wasFollowingToday = selectedDate === data.calendar.serverTime.date;
      const targetMonth = viewingPreviousTodayMonth && crossedMonthBoundary
        ? serverTime.monthValue
        : data.calendar.monthValue;
      await load(targetMonth, {
        preserveSelection: targetMonth === data.calendar.monthValue && !wasFollowingToday,
        replaceDraft: !dirty,
      });
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError((reason as Error).message || "오늘 날짜를 새로 확인하지 못했어요.");
      }
    } finally {
      if (!controller.signal.aborted) setTodayRefreshing(false);
      todayRefreshInFlight.current = false;
    }
  }, [conflict, conflictLoading, data, dirty, load, monthBusy, saving, selectedDate, staleNeedsRefresh]);

  useEffect(() => {
    const refreshOnFocus = () => { void refreshCurrentServerDay(); };
    const refreshOnVisibility = () => {
      if (document.visibilityState === "visible") void refreshCurrentServerDay();
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisibility);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisibility);
    };
  }, [refreshCurrentServerDay]);

  useEffect(() => {
    if (!data) return;
    const nextMidnightEpoch = nextSeoulMidnightEpoch(data.calendar.serverTime.date);
    const estimatedServerNow = Date.now() + serverClockOffsetMs.current;
    const delay = Math.max(
      MIDNIGHT_REFRESH_GRACE_MS,
      nextMidnightEpoch - estimatedServerNow + MIDNIGHT_REFRESH_GRACE_MS,
    );
    const timer = window.setTimeout(() => {
      void refreshCurrentServerDay();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [data, refreshCurrentServerDay]);

  const rows = useMemo(() => data ? calendarRows(data.calendar) : [], [data]);
  const selectedDay = useMemo(
    () => data?.calendar.days.find((day) => day.date === selectedDate) ?? null,
    [data, selectedDate],
  );
  const selectedWeekday = selectedDate ? weekdayForDate(selectedDate) : 0;
  const savedTimetable = useMemo(
    () => data ? timetableDraft(data.timetable) : null,
    [data],
  );
  const selectedLessons = useMemo(() => {
    if (!savedTimetable || !selectedDay || selectedDay.dayType === "off" || selectedWeekday < 1 || selectedWeekday > 5) return [];
    return Array.from({ length: savedTimetable.periodCount }, (_, index) => ({
      period: index + 1,
      subject: savedTimetable.subjects[slotKey(selectedWeekday, index + 1)]?.trim() ?? "",
    })).filter((lesson) => lesson.subject);
  }, [savedTimetable, selectedDay, selectedWeekday]);

  async function moveMonth(offset: number) {
    if (!data || monthBusy || saving || conflictLoading || staleNeedsRefresh || conflict || todayRefreshing) return;
    await load(shiftedMonth(data.calendar.monthValue, offset), { replaceDraft: !dirty });
  }

  function moveDateFocus(event: ReactKeyboardEvent<HTMLButtonElement>, date: string) {
    if (!data) return;
    const currentIndex = data.calendar.days.findIndex((day) => day.date === date);
    if (currentIndex < 0) return;
    const weekday = weekdayForDate(date);
    let nextIndex: number | null = null;
    if (event.key === "ArrowLeft") nextIndex = currentIndex - 1;
    if (event.key === "ArrowRight") nextIndex = currentIndex + 1;
    if (event.key === "ArrowUp") nextIndex = currentIndex - 7;
    if (event.key === "ArrowDown") nextIndex = currentIndex + 7;
    if (event.key === "Home") nextIndex = currentIndex - weekday;
    if (event.key === "End") nextIndex = currentIndex + (6 - weekday);
    if (nextIndex === null) return;
    event.preventDefault();
    const target = data.calendar.days[Math.max(0, Math.min(data.calendar.days.length - 1, nextIndex))];
    if (!target) return;
    setSelectedDate(target.date);
    requestAnimationFrame(() => dateButtonRefs.current.get(target.date)?.focus());
  }

  function updateSubject(weekday: number, period: number, subject: string) {
    setDraft((current) => current ? {
      ...current,
      subjects: { ...current.subjects, [slotKey(weekday, period)]: subject },
    } : current);
    setDirty(true);
    setConflict(null);
    setMessage("");
  }

  function moveWeekdayTab(event: ReactKeyboardEvent<HTMLButtonElement>, weekday: number) {
    const currentIndex = WEEKDAYS.findIndex((item) => item.value === weekday);
    if (currentIndex < 0) return;
    let targetIndex: number | null = null;
    if (event.key === "ArrowLeft") targetIndex = (currentIndex - 1 + WEEKDAYS.length) % WEEKDAYS.length;
    if (event.key === "ArrowRight") targetIndex = (currentIndex + 1) % WEEKDAYS.length;
    if (event.key === "Home") targetIndex = 0;
    if (event.key === "End") targetIndex = WEEKDAYS.length - 1;
    if (targetIndex === null) return;
    event.preventDefault();
    const target = WEEKDAYS[targetIndex];
    setMobileWeekday(target.value);
    requestAnimationFrame(() => weekdayTabRefs.current.get(target.value)?.focus());
  }

  function updatePeriodCount(periodCount: number) {
    setDraft((current) => current ? { ...current, periodCount } : current);
    setDirty(true);
    setConflict(null);
    setMessage("");
  }

  function resetDraft() {
    if (!data) return;
    const savedDraft = timetableDraft(data.timetable);
    setDraft(savedDraft);
    setBaseDraft(savedDraft);
    setDirty(false);
    setConflict(null);
    setStaleNeedsRefresh(false);
    setError("");
    setMessage("저장 전 변경을 취소했어요.");
  }

  async function inspectLatestConflict(local: TimetableDraft, base: TimetableDraft) {
    if (!data || conflictLoading || monthBusy || todayRefreshing) return;
    setConflictLoading(true);
    setStaleNeedsRefresh(true);
    setError("");
    try {
      const latestResponse = await api<TeachingCalendarResponse>(
        `/api/classes/${classId}/teaching-calendar?month=${encodeURIComponent(data.calendar.monthValue)}`,
      );
      const latest = timetableDraft(latestResponse.timetable);
      setData((current) => current ? { ...current, timetable: latestResponse.timetable } : current);
      setConflict({
        base,
        local,
        latest,
        changes: changedFields(base, local, latest),
      });
      setStaleNeedsRefresh(false);
      setError("다른 화면에서 시간표가 변경됐어요. 아래에서 최신 변경을 확인하고 사용할 내용을 선택해 주세요.");
    } catch (reason) {
      setError(`최신 시간표를 확인하지 못했어요. 입력은 그대로 보관했습니다. (${(reason as Error).message})`);
    } finally {
      setConflictLoading(false);
    }
  }

  async function saveTimetable() {
    if (!draft || !baseDraft || saving || conflictLoading || monthBusy || todayRefreshing || staleNeedsRefresh || conflict || readOnly) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await putJson<{ timetable: TimetableState }>(
        `/api/classes/${classId}/teaching-calendar`,
        {
          expectedRevision: draft.revision,
          periodCount: draft.periodCount,
          slots: WEEKDAYS.flatMap((weekday) =>
            Array.from({ length: draft.periodCount }, (_, index) => ({
              weekday: weekday.value,
              period: index + 1,
              subject: draft.subjects[slotKey(weekday.value, index + 1)]?.trim() ?? "",
            })).filter((slot) => slot.subject),
          ),
        },
      );
      const savedDraft = timetableDraft(result.timetable);
      setData((current) => current ? { ...current, timetable: result.timetable } : current);
      setDraft(savedDraft);
      setBaseDraft(savedDraft);
      setDirty(false);
      setConflict(null);
      setStaleNeedsRefresh(false);
      setMessage("기초 시간표를 저장했어요. 오늘 수업에 바로 반영했습니다.");
      onTimetableSaved?.();
    } catch (reason) {
      if (reason instanceof ClientApiError && reason.code === "TIMETABLE_STALE") {
        await inspectLatestConflict(draft, baseDraft);
      } else {
        setError((reason as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }

  function useLatestTimetable() {
    if (!conflict) return;
    setDraft(conflict.latest);
    setBaseDraft(conflict.latest);
    setDirty(false);
    setConflict(null);
    setStaleNeedsRefresh(false);
    setError("");
    setMessage("최신 저장본을 편집기에 반영했어요.");
  }

  function mergeWithLocalPriority() {
    if (!conflict) return;
    const merged = mergeDrafts(conflict.base, conflict.local, conflict.latest);
    const hasLocalChanges = !draftsEqual(merged, conflict.latest);
    setDraft(merged);
    setBaseDraft(conflict.latest);
    setDirty(hasLocalChanges);
    setConflict(null);
    setStaleNeedsRefresh(false);
    setError("");
    setMessage(hasLocalChanges
      ? "서버 변경과 내 입력을 합쳤어요. 같은 칸은 내 입력을 우선했습니다. 확인 후 시간표 저장을 눌러 주세요."
      : "서버 변경을 반영했어요. 추가로 저장할 내 변경은 없습니다.");
  }

  if (initialLoading && !data) {
    return (
      <section id="class-schedule" className={`${styles.section} panel`} aria-busy="true" aria-labelledby="class-schedule-loading-title">
        <div className={styles.loadingIcon} aria-hidden="true"><CalendarDays /></div>
        <div>
          <p className="eyebrow">학급 일정</p>
          <h2 id="class-schedule-loading-title">달력과 오늘 수업을 불러오고 있어요</h2>
          <p>대한민국 표준시로 학급 일정을 확인합니다.</p>
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section id="class-schedule" className={`${styles.section} ${styles.loadError} panel`} aria-labelledby="class-schedule-error-title">
        <div>
          <p className="eyebrow">학급 일정</p>
          <h2 id="class-schedule-error-title">일정을 불러오지 못했어요</h2>
          <p>{error || "잠시 뒤 다시 시도해 주세요."}</p>
        </div>
        <button className="button button-light" type="button" onClick={() => {
          setInitialLoading(true);
          void load(undefined, { replaceDraft: true });
        }}><RefreshCw aria-hidden="true" />다시 시도</button>
      </section>
    );
  }

  const isToday = selectedDate === data.calendar.serverTime.date;
  const periods = Array.from({ length: draft?.periodCount ?? 0 }, (_, index) => index + 1);
  const transitionLocked = saving || conflictLoading || monthBusy || todayRefreshing || staleNeedsRefresh || Boolean(conflict);
  const editorLocked = readOnly || transitionLocked;

  return (
    <section
      id="class-schedule"
      className={`${styles.section} panel`}
      aria-labelledby="class-schedule-title"
      aria-busy={monthBusy || saving || conflictLoading || todayRefreshing}
    >
      <header className={styles.header}>
        <div>
          <p className="eyebrow">매일 바로 보는 우리 반</p>
          <h2 id="class-schedule-title">학급 일정</h2>
          <p>월간 수업일과 선택한 날짜의 시간표를 한눈에 확인해요.</p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.serverDate}>
            <CalendarCheck aria-hidden="true" />
            <span>서버가 확인한 오늘</span>
            <time dateTime={data.calendar.serverTime.date}>{data.calendar.serverTime.fullLabel}</time>
            <small>{data.calendar.timeZoneLabel}</small>
          </div>
          {readOnly ? (
            <span className="button button-light is-disabled" aria-disabled="true">
              <CalendarDays aria-hidden="true" />달력 설정 불가
            </span>
          ) : (
            <a className="button button-light" href={`/teacher/classes/${classId}/job-assignments`}>
              <CalendarDays aria-hidden="true" />{data.calendar.monthSaved ? "달력 보기·수정" : "이 달의 달력 설정"}
            </a>
          )}
          <button
            className="button button-primary"
            type="button"
            disabled={transitionLocked}
            aria-expanded={editorOpen}
            aria-controls="basic-timetable-editor"
            onClick={() => {
              if (editorOpen && dirty && !confirm("저장하지 않은 시간표 변경이 있어요. 편집기를 닫을까요? 입력은 이 학급 화면을 떠나기 전까지 유지됩니다.")) return;
              setEditorOpen((current) => !current);
              setMessage("");
            }}
          >
            <PencilLine aria-hidden="true" />{readOnly ? "기초 시간표 보기" : "기초 시간표 설정"}
          </button>
        </div>
      </header>

      {!data.calendar.monthSaved && (
        <div className={styles.calendarPending} role="status">
          {data.calendar.saved
            ? "현재 보고 있는 달의 운영 달력을 아직 저장하지 않았어요. 아래 달력은 주말을 쉬는 날로 제안한 미리보기입니다."
            : "운영 달력을 아직 저장하지 않았어요. 아래 달력은 주말을 쉬는 날로 제안한 미리보기입니다."}
        </div>
      )}
      {readOnly && (
        <div className={styles.readOnlyNotice} role="status">
          보관된 학급은 달력과 시간표를 볼 수만 있어요. 다시 사용 상태로 바꾸면 설정할 수 있습니다.
        </div>
      )}
      <Notice message={error} tone="error" />
      <Notice message={message} tone="success" />
      {staleNeedsRefresh && !conflict && !conflictLoading && draft && baseDraft && (
        <div className={styles.conflictAction}>
          <button className="button button-light" type="button" onClick={() => inspectLatestConflict(draft, baseDraft)}>
            <RefreshCw aria-hidden="true" />최신 저장본 다시 확인
          </button>
        </div>
      )}
      {conflictLoading && <p className={styles.conflictLoading} role="status">최신 저장본과 내 입력을 안전하게 비교하고 있어요…</p>}
      {conflict && (
        <section className={styles.conflictPanel} aria-labelledby="timetable-conflict-title">
          <div>
            <p className="eyebrow">동시 편집 확인</p>
            <h3 id="timetable-conflict-title">최신 저장본에서 바뀐 내용을 확인해 주세요</h3>
            <p>내가 건드리지 않은 칸은 최신 저장본을 따르고, 내가 바꾼 칸은 내 입력을 유지해 합칠 수 있습니다.</p>
          </div>
          {conflict.changes.length ? (
            <div className={styles.conflictTableWrap}>
              <table className={styles.conflictTable}>
                <caption className="visually-hidden">시간표 동시 편집 변경 비교</caption>
                <thead><tr><th scope="col">항목</th><th scope="col">이전</th><th scope="col">최신 저장본</th><th scope="col">내 입력</th><th scope="col">판정</th></tr></thead>
                <tbody>
                  {conflict.changes.map((change) => (
                    <tr key={change.key} className={change.collision ? styles.collisionRow : undefined}>
                      <th scope="row">{change.label}</th>
                      <td>{change.previous}</td>
                      <td>{change.latest}</td>
                      <td>{change.local}</td>
                      <td><span className={change.collision ? styles.collisionBadge : styles.serverChangeBadge}>{change.collision ? "같은 칸 충돌" : "서버 변경"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.sameContent}>저장된 내용은 같지만 저장 버전이 바뀌었습니다.</p>
          )}
          {conflict.changes.some((change) => change.collision) && (
            <p className={styles.collisionHelp} role="alert">‘같은 칸 충돌’은 두 화면에서 같은 칸을 서로 다르게 바꾼 경우입니다. 내 입력 우선 병합을 누르면 표의 ‘내 입력’ 값이 적용됩니다.</p>
          )}
          <div className={styles.conflictChoices}>
            <button className="button button-light" type="button" onClick={useLatestTimetable}>최신 저장본 사용</button>
            <button className="button button-primary" type="button" onClick={mergeWithLocalPriority}>내 입력 우선으로 합치기</button>
          </div>
        </section>
      )}

      <div className={styles.overview}>
        <div className={styles.monthCard}>
          <div className={styles.monthHeader}>
            <button type="button" aria-label="이전 달" disabled={transitionLocked} onClick={() => moveMonth(-1)}>
              <ChevronLeft aria-hidden="true" />
            </button>
            <h3 aria-live="polite"><CalendarDays aria-hidden="true" />{monthLabel(data.calendar.monthValue)}</h3>
            <button type="button" aria-label="다음 달" disabled={transitionLocked} onClick={() => moveMonth(1)}>
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
          <div className={styles.calendarScroll}>
            <table className={styles.calendarTable}>
              <caption className="visually-hidden">{monthLabel(data.calendar.monthValue)} 학급 운영 달력. 방향키로 날짜를 이동할 수 있습니다.</caption>
              <thead>
                <tr>{CALENDAR_WEEKDAYS.map((day) => <th key={day} scope="col">{day}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((week, weekIndex) => (
                  <tr key={`week-${weekIndex}`}>
                    {week.map((day, dayIndex) => day ? (
                      <td key={day.date} className={day.dayType === "off" ? styles.offDay : undefined}>
                        <button
                          ref={(element) => {
                            if (element) dateButtonRefs.current.set(day.date, element);
                            else dateButtonRefs.current.delete(day.date);
                          }}
                          type="button"
                          className={[
                            styles.dateButton,
                            day.date === selectedDate ? styles.selectedDate : "",
                            day.date === data.calendar.serverTime.date ? styles.today : "",
                          ].filter(Boolean).join(" ")}
                          tabIndex={day.date === selectedDate ? 0 : -1}
                          aria-pressed={day.date === selectedDate}
                          aria-current={day.date === data.calendar.serverTime.date ? "date" : undefined}
                          aria-label={[
                            fullDateLabel(day.date),
                            day.date === data.calendar.serverTime.date ? "오늘" : "",
                            day.dayType === "off" ? "쉬는 날" : "수업일",
                            day.memo,
                          ].filter(Boolean).join(", ")}
                          onClick={() => setSelectedDate(day.date)}
                          onKeyDown={(event) => moveDateFocus(event, day.date)}
                        >
                          <span className={styles.dateNumber}>{Number(day.date.slice(-2))}</span>
                          {day.date === data.calendar.serverTime.date && <span className={styles.todayLabel}>오늘</span>}
                          <span className={styles.dayType}>{day.dayType === "off" ? "쉬는 날" : "수업일"}</span>
                          {day.memo && <span className={styles.dayMemo}>{day.memo}</span>}
                        </button>
                      </td>
                    ) : <td key={`blank-${weekIndex}-${dayIndex}`} className={styles.blankDay} aria-hidden="true" />)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.legend} aria-label="달력 표시 안내">
            <span><i className={styles.classDot} />수업일</span>
            <span><i className={styles.offDot} />쉬는 날</span>
            <span><i className={styles.todayRing} />오늘</span>
          </div>
        </div>

        <aside className={styles.lessonsCard} aria-live="polite" aria-labelledby="selected-lessons-title">
          <div className={styles.lessonsHeading}>
            <span className={styles.lessonsIcon} aria-hidden="true"><BookOpen /></span>
            <div>
              <p className="eyebrow">{isToday ? "오늘 수업" : "선택한 날짜 수업"}</p>
              <h3 id="selected-lessons-title">{selectedDate ? fullDateLabel(selectedDate) : "날짜를 선택해 주세요"}</h3>
            </div>
            <span className={`${styles.savedBasisBadge} ${dirty ? styles.draftPendingBadge : ""}`}>
              {dirty ? "저장본 기준 · 편집 내용 저장 전" : "저장본 기준"}
            </span>
          </div>
          {selectedDay?.dayType === "off" ? (
            <div className={styles.offMessage}>
              <CalendarCheck aria-hidden="true" />
              <strong>쉬는 날이에요</strong>
              <span>{selectedDay.memo || "등록된 수업이 없습니다."}</span>
            </div>
          ) : selectedWeekday < 1 || selectedWeekday > 5 ? (
            <div className={styles.emptyLessons}>
              <strong>주말 기초 시간표는 비어 있어요</strong>
              <span>특별 수업이 있다면 달력 메모에서 확인해 주세요.</span>
            </div>
          ) : selectedLessons.length ? (
            <ol className={styles.lessonList}>
              {selectedLessons.map((lesson) => (
                <li key={lesson.period}>
                  <span><Clock3 aria-hidden="true" />{lesson.period}교시</span>
                  <strong>{lesson.subject}</strong>
                </li>
              ))}
            </ol>
          ) : (
            <div className={styles.emptyLessons}>
              <strong>{data.timetable.saved ? "이 요일의 수업이 비어 있어요" : "기초 시간표를 먼저 설정해 주세요"}</strong>
              <span>한 번 저장하면 매주 선택한 요일에 자동으로 보여요.</span>
              <button className="button button-light" type="button" disabled={transitionLocked} onClick={() => setEditorOpen(true)}>
                <PencilLine aria-hidden="true" />{readOnly ? "전체 시간표 보기" : "시간표 입력하기"}
              </button>
            </div>
          )}
        </aside>
      </div>

      {editorOpen && draft && (
        <div id="basic-timetable-editor" className={styles.editor} aria-busy={saving || conflictLoading}>
          <div className={styles.editorHeading}>
            <div>
              <p className="eyebrow">매주 반복되는 기본 수업</p>
              <h3>기초 시간표 설정 {dirty && <span className={styles.unsavedBadge}>저장 전 변경</span>}</h3>
              <p>빈 교시는 오늘 수업에 표시하지 않습니다. 달력에서 쉬는 날로 정한 날짜에는 시간표가 나오지 않아요.</p>
            </div>
            <label className={styles.periodCount}>
              <span>하루 교시 수</span>
              <select disabled={editorLocked} value={draft.periodCount} onChange={(event) => updatePeriodCount(Number(event.target.value))}>
                {Array.from({ length: MAX_PERIODS }, (_, index) => index + 1).map((period) => (
                  <option key={period} value={period}>{period}교시</option>
                ))}
              </select>
            </label>
          </div>

          <div className={styles.desktopEditor}>
            <table className={styles.timetableTable}>
              <caption className="visually-hidden">월요일부터 금요일까지의 기초 시간표 입력</caption>
              <thead>
                <tr>
                  <th scope="col">교시</th>
                  {WEEKDAYS.map((weekday) => <th key={weekday.value} scope="col">{weekday.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => (
                  <tr key={period}>
                    <th scope="row">{period}교시</th>
                    {WEEKDAYS.map((weekday) => (
                      <td key={weekday.value}>
                        <label className="visually-hidden" htmlFor={`subject-${weekday.value}-${period}`}>
                          {weekday.label} {period}교시 과목
                        </label>
                        <input
                          id={`subject-${weekday.value}-${period}`}
                          value={draft.subjects[slotKey(weekday.value, period)] ?? ""}
                          disabled={editorLocked}
                          maxLength={40}
                          placeholder="과목"
                          onChange={(event) => updateSubject(weekday.value, period, event.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.mobileEditor}>
            <div className={styles.weekdayTabs} role="tablist" aria-label="시간표 요일 선택">
              {WEEKDAYS.map((weekday) => (
                <button
                  key={weekday.value}
                  ref={(element) => {
                    if (element) weekdayTabRefs.current.set(weekday.value, element);
                    else weekdayTabRefs.current.delete(weekday.value);
                  }}
                  id={`weekday-tab-${weekday.value}`}
                  type="button"
                  role="tab"
                  aria-selected={mobileWeekday === weekday.value}
                  aria-controls="mobile-weekday-panel"
                  tabIndex={mobileWeekday === weekday.value ? 0 : -1}
                  disabled={transitionLocked}
                  onClick={() => setMobileWeekday(weekday.value)}
                  onKeyDown={(event) => moveWeekdayTab(event, weekday.value)}
                >{weekday.short}</button>
              ))}
            </div>
            <div
              id="mobile-weekday-panel"
              className={styles.mobilePeriodList}
              role="tabpanel"
              aria-labelledby={`weekday-tab-${mobileWeekday}`}
            >
              {periods.map((period) => (
                <label key={period}>
                  <span>{period}교시</span>
                  <input
                    value={draft.subjects[slotKey(mobileWeekday, period)] ?? ""}
                    disabled={editorLocked}
                    maxLength={40}
                    placeholder={`${WEEKDAYS.find((weekday) => weekday.value === mobileWeekday)?.label} ${period}교시 과목`}
                    onChange={(event) => updateSubject(mobileWeekday, period, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className={styles.editorActions}>
            <span role="status">{conflictLoading ? "최신 저장본과 비교 중이에요." : dirty ? "저장하지 않은 변경이 있어요." : "현재 저장 내용과 같습니다."}</span>
            <button className="button button-light" type="button" disabled={editorLocked || !dirty} onClick={resetDraft}>변경 취소</button>
            <button className="button button-primary" type="button" disabled={editorLocked || !dirty} onClick={saveTimetable}>
              <Save aria-hidden="true" />{saving ? "저장 중…" : conflictLoading ? "비교 중…" : "시간표 저장"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
