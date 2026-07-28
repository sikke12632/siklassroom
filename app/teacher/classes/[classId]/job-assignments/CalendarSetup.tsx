"use client";

import { useMemo, useState } from "react";
import { CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, Save } from "lucide-react";
import { Notice } from "@/app/components/Notice";
import { api, putJson } from "@/lib/client-api";

export type CalendarDay = {
  date: string;
  dayType: "class" | "off";
  memo: string;
  isWeekend: boolean;
};

export type CalendarState = {
  saved: boolean;
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

function shiftedMonth(monthValue: string, offset: number) {
  const [year, month] = monthValue.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthValue: string) {
  const [year, month] = monthValue.split("-").map(Number);
  return `${year}년 ${month}월`;
}

export function CalendarSetup({
  classId,
  initial,
  onSaved,
  onCancel,
}: {
  classId: string;
  initial: CalendarState;
  onSaved: (calendar: CalendarState) => void;
  onCancel?: () => void;
}) {
  const [calendar, setCalendar] = useState(initial);
  const [selectedDate, setSelectedDate] = useState(initial.serverTime.date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const firstWeekday = useMemo(
    () => new Date(`${calendar.monthValue}-01T00:00:00Z`).getUTCDay(),
    [calendar.monthValue],
  );
  const selectedDay = calendar.days.find((day) => day.date === selectedDate) ?? null;

  async function moveMonth(offset: number) {
    const nextMonth = shiftedMonth(calendar.monthValue, offset);
    setBusy(true);
    setError("");
    try {
      const data = await api<{ calendar: CalendarState }>(
        `/api/classes/${classId}/calendar?month=${nextMonth}`,
      );
      setCalendar((current) => ({
        ...data.calendar,
        schoolYear: current.schoolYear,
        classStartDate: current.classStartDate,
        firstJobStartDate: current.firstJobStartDate,
        firstJobEndDate: current.firstJobEndDate,
      }));
      setSelectedDate(`${nextMonth}-01`);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function updateSelectedDay(patch: Partial<CalendarDay>) {
    if (!selectedDay) return;
    setCalendar((current) => ({
      ...current,
      days: current.days.map((day) => day.date === selectedDay.date ? { ...day, ...patch } : day),
    }));
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const result = await putJson<{ calendar: CalendarState }>(
        `/api/classes/${classId}/calendar`,
        {
          expectedRevision: calendar.revision,
          schoolYear: calendar.schoolYear,
          classStartDate: calendar.classStartDate,
          firstJobStartDate: calendar.firstJobStartDate,
          firstJobEndDate: calendar.firstJobEndDate,
          days: calendar.days.map(({ date, dayType, memo }) => ({ date, dayType, memo })),
        },
      );
      onSaved(result.calendar);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="calendar-setup panel" data-testid="calendar-setup">
      <div className="calendar-setup-heading">
        <div>
          <p className="eyebrow">3단계 · 달력 설정</p>
          <h1>우리 반 운영 달력을 정해요</h1>
          <p>기기 시계가 아닌 Cloudflare 서버 시각을 대한민국 표준시로 보정합니다.</p>
        </div>
        <div className="server-date-card">
          <CalendarCheck aria-hidden="true" />
          <span>서버가 확인한 오늘</span>
          <strong>{calendar.serverTime.fullLabel}</strong>
          <small>{calendar.timeZoneLabel} · {calendar.timeZone}</small>
        </div>
      </div>

      <Notice message={error} tone="error" />

      <div className="calendar-settings-grid">
        <label>
          <span>학년도</span>
          <input
            type="number"
            min="2020"
            max="2100"
            value={calendar.schoolYear}
            onChange={(event) => setCalendar((current) => ({ ...current, schoolYear: Number(event.target.value) }))}
          />
        </label>
        <label>
          <span>학급 운영 시작일</span>
          <input
            type="date"
            value={calendar.classStartDate}
            onChange={(event) => setCalendar((current) => ({ ...current, classStartDate: event.target.value }))}
          />
        </label>
        <label>
          <span>첫 직업 시작일</span>
          <input
            type="date"
            value={calendar.firstJobStartDate}
            onChange={(event) => setCalendar((current) => ({ ...current, firstJobStartDate: event.target.value }))}
          />
        </label>
        <label>
          <span>첫 직업 종료일</span>
          <input
            type="date"
            value={calendar.firstJobEndDate}
            onChange={(event) => setCalendar((current) => ({ ...current, firstJobEndDate: event.target.value }))}
          />
        </label>
      </div>

      <div className="calendar-editor">
        <div className="calendar-month">
          <header>
            <button aria-label="이전 달" disabled={busy} onClick={() => moveMonth(-1)}><ChevronLeft /></button>
            <h2><CalendarDays aria-hidden="true" />{monthLabel(calendar.monthValue)}</h2>
            <button aria-label="다음 달" disabled={busy} onClick={() => moveMonth(1)}><ChevronRight /></button>
          </header>
          <div className="calendar-weekdays" aria-hidden="true">
            {["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="calendar-days">
            {Array.from({ length: firstWeekday }, (_, index) => <i key={`blank-${index}`} />)}
            {calendar.days.map((day) => (
              <button
                key={day.date}
                className={[
                  day.dayType === "off" ? "off" : "class",
                  day.date === calendar.serverTime.date ? "today" : "",
                  day.date === selectedDate ? "selected" : "",
                ].filter(Boolean).join(" ")}
                aria-pressed={day.date === selectedDate}
                onClick={() => setSelectedDate(day.date)}
              >
                <b>{Number(day.date.slice(-2))}</b>
                <small>{day.dayType === "off" ? "쉬는 날" : "수업일"}</small>
                {day.memo && <em>{day.memo}</em>}
              </button>
            ))}
          </div>
        </div>

        <aside className="calendar-day-editor">
          {selectedDay ? (
            <>
              <p className="eyebrow">선택한 날짜</p>
              <h3>{selectedDay.date}</h3>
              <div className="day-type-toggle" role="group" aria-label="날짜 유형">
                <button
                  className={selectedDay.dayType === "class" ? "active" : ""}
                  aria-pressed={selectedDay.dayType === "class"}
                  onClick={() => updateSelectedDay({ dayType: "class", memo: "" })}
                >수업일</button>
                <button
                  className={selectedDay.dayType === "off" ? "active" : ""}
                  aria-pressed={selectedDay.dayType === "off"}
                  onClick={() => updateSelectedDay({ dayType: "off" })}
                >쉬는 날</button>
              </div>
              <label>
                <span>쉬는 날 메모</span>
                <input
                  value={selectedDay.memo}
                  disabled={selectedDay.dayType !== "off"}
                  maxLength={80}
                  placeholder="예: 공휴일, 방학"
                  onChange={(event) => updateSelectedDay({ memo: event.target.value })}
                />
              </label>
              <small>토요일과 일요일은 처음에 쉬는 날로 제안되며 언제든 수업일로 바꿀 수 있어요.</small>
            </>
          ) : <p>달력에서 날짜를 선택해 주세요.</p>}
        </aside>
      </div>

      <div className="calendar-actions">
        {onCancel && <button className="button button-light" disabled={busy} onClick={onCancel}>배정 화면으로 돌아가기</button>}
        <button className="button button-primary button-large" disabled={busy} onClick={save}>
          <Save aria-hidden="true" />{busy ? "달력 저장 중…" : "달력 저장하고 직업 배정으로"}
        </button>
      </div>
    </section>
  );
}
