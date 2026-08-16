"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Landmark,
  LogOut,
  Plus,
  ShoppingBasket,
  UsersRound,
} from "lucide-react";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { SchoolIllustration } from "@/app/components/SchoolIllustration";
import { api } from "@/lib/client-api";

type PortalClass = {
  id: string;
  school_name: string;
  school_year: number;
  grade: number;
  class_number: number;
  display_name: string | null;
};

type PortalSummary = {
  job_status?: "not_started" | "draft" | "completed";
  job_count?: number;
  job_capacity?: number;
  job_student_count_changed?: number;
  calendar_saved?: number;
  assignment_status?: "not_started" | "draft" | "confirmed";
  monthly_choice_status?: "draft" | "confirmed" | null;
  job_evaluation_status?: "open" | "closed" | "finalized" | null;
  job_evaluation_submitted_count?: number | null;
  job_evaluation_student_count?: number | null;
};

type CalendarDay = {
  date: string;
  dayType: "class" | "off";
  memo: string;
};

type ScheduleSnapshot = {
  calendar: {
    monthValue: string;
    days: CalendarDay[];
    serverTime: {
      epochMs: number;
      date: string;
      fullLabel: string;
    };
  };
  timetable: {
    saved: boolean;
    slots: Array<{ weekday: number; period: number; subject: string }>;
  };
};

type DashboardTask = {
  id: string;
  label: string;
  href: string;
  complete?: boolean;
};

export function TeacherDashboardHome({
  actorEmail,
  classes,
  selectedClassId,
  classRoom,
  summary,
  studentCount,
  activeCount,
  pendingCount,
  attentionCount,
  monthlyChoiceAccessible,
  monthlyChoiceBlockedReason,
  scheduleRevision,
  onSelectClass,
  onCreateClass,
  onLogout,
  announcement,
  status,
}: {
  actorEmail: string;
  classes: PortalClass[];
  selectedClassId: string;
  classRoom: PortalClass;
  summary: PortalSummary;
  studentCount: number;
  activeCount: number;
  pendingCount: number;
  attentionCount: number;
  monthlyChoiceAccessible: boolean;
  monthlyChoiceBlockedReason: string;
  scheduleRevision: number;
  onSelectClass: (id: string) => void;
  onCreateClass: () => void;
  onLogout: () => void;
  announcement?: ReactNode;
  status?: ReactNode;
}) {
  const [scheduleResult, setScheduleResult] = useState<{ classId: string; data: ScheduleSnapshot } | null>(null);
  const [failedClassId, setFailedClassId] = useState<string | null>(null);
  const classLabel = classRoom.display_name || `${classRoom.grade}학년 ${classRoom.class_number}반`;

  useEffect(() => {
    let active = true;
    loadDashboardSchedule(selectedClassId)
      .then((value) => {
        if (active) {
          setScheduleResult({ classId: selectedClassId, data: value });
          setFailedClassId(null);
        }
      })
      .catch(() => {
        if (active) setFailedClassId(selectedClassId);
      });
    return () => { active = false; };
  }, [scheduleRevision, selectedClassId]);

  const schedule = scheduleResult?.classId === selectedClassId ? scheduleResult.data : null;
  const scheduleUnavailable = failedClassId === selectedClassId;

  const today = schedule?.calendar.serverTime.date ?? "";
  const todayWeekday = today ? new Date(`${today}T00:00:00Z`).getUTCDay() : 0;
  const todayCalendar = schedule?.calendar.days.find((day) => day.date === today) ?? null;
  const todayLessons = useMemo(() => {
    if (!schedule || !today || todayCalendar?.dayType === "off" || todayWeekday < 1 || todayWeekday > 5) return [];
    return schedule.timetable.slots
      .filter((slot) => slot.weekday === todayWeekday)
      .sort((left, right) => left.period - right.period);
  }, [schedule, today, todayCalendar, todayWeekday]);

  const weekEvents = useMemo(() => {
    if (!schedule || !today) return [];
    const { start, end } = weekDateBounds(today);
    return schedule.calendar.days
      .filter((day) => day.date >= start && day.date <= end && Boolean(day.memo.trim()))
      .slice(0, 5);
  }, [schedule, today]);

  const greeting = greetingFor(schedule?.calendar.serverTime.epochMs);
  const jobAction = jobNextAction(selectedClassId, summary, studentCount, monthlyChoiceAccessible);
  const tasks = dashboardTasks({
    selectedClassId,
    studentCount,
    pendingCount,
    attentionCount,
    summary,
    monthlyChoiceAccessible,
    monthlyChoiceBlockedReason,
  });
  const openTaskCount = tasks.filter((task) => !task.complete).length;

  return (
    <>
      <header className="portal-topbar">
        <div className="portal-class-picker">
          <UsersRound aria-hidden="true" />
          <label>
            <span className="visually-hidden">현재 학급 선택</span>
            <select value={selectedClassId} onChange={(event) => onSelectClass(event.target.value)} aria-label="현재 학급 선택">
              {classes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.display_name || `${item.grade}학년 ${item.class_number}반`} · {item.school_year}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="portal-add-class" onClick={onCreateClass} aria-label="새 학급 만들기">
            <Plus aria-hidden="true" />
          </button>
        </div>
        <div className="portal-current-date" aria-live="polite">
          <CalendarDays aria-hidden="true" />
          <span>{schedule?.calendar.serverTime.fullLabel || (scheduleUnavailable ? "날짜 확인 불가" : "오늘 날짜 확인 중…")}</span>
        </div>
        <div className="portal-account">
          <ThemeToggle compact />
          <span className="portal-account-avatar" aria-hidden="true"><UsersRound /></span>
          <span className="portal-account-email" title={actorEmail}>{actorEmail}</span>
          <button type="button" onClick={onLogout} aria-label="로그아웃"><LogOut aria-hidden="true" /></button>
        </div>
      </header>

      {announcement}
      {status}

      <section className="portal-welcome" aria-labelledby="portal-welcome-title">
        <div>
          <p className="eyebrow">우리 반 오늘</p>
          <p className="portal-mobile-date" aria-live="polite"><CalendarDays aria-hidden="true" />{schedule?.calendar.serverTime.fullLabel || (scheduleUnavailable ? "날짜 확인 필요" : "오늘 날짜 확인 중")}</p>
          <h1 id="portal-welcome-title">{greeting}, {classLabel} <span aria-hidden="true">👋</span></h1>
          <p>학생 관리부터 수업, 직업, 금융 활동까지 한곳에서 확인해요.</p>
        </div>
        <SchoolIllustration className="portal-school-illustration" />
      </section>

      <section className="portal-summary-grid" aria-label="우리 반 오늘 요약">
        <a className="portal-summary-card schedule" href="#class-schedule">
          <span className="portal-summary-icon"><CalendarDays aria-hidden="true" /></span>
          <span><small>오늘 수업</small><strong>{scheduleUnavailable ? "확인 필요" : schedule ? schedule.timetable.saved ? `${todayLessons.length}개` : "시간표 미설정" : "불러오는 중"}</strong></span>
          <ArrowRight aria-hidden="true" />
        </a>
        <a className="portal-summary-card job" href={jobAction.href}>
          <span className="portal-summary-icon"><BriefcaseBusiness aria-hidden="true" /></span>
          <span><small>직업 운영</small><strong>{summary.job_status === "completed" ? `${summary.job_count ?? 0}개` : summary.job_status === "draft" ? "초안 저장" : "설정 전"}</strong></span>
          <ArrowRight aria-hidden="true" />
        </a>
        <a className="portal-summary-card students" href="#students">
          <span className="portal-summary-icon"><UsersRound aria-hidden="true" /></span>
          <span><small>학생 계정</small><strong>{activeCount}/{studentCount}명</strong></span>
          <ArrowRight aria-hidden="true" />
        </a>
        <a className={`portal-summary-card attention ${openTaskCount ? "needs-attention" : ""}`} href="#portal-tasks">
          <span className="portal-summary-icon">{openTaskCount ? <AlertCircle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}</span>
          <span><small>지금 할 일</small><strong>{openTaskCount ? `${openTaskCount}개` : "준비 완료"}</strong></span>
          <ArrowRight aria-hidden="true" />
        </a>
      </section>

      <div className="portal-dashboard-layout">
        <section className="portal-services" aria-labelledby="portal-services-title">
          <div className="portal-section-heading">
            <div><p className="eyebrow">바로가기</p><h2 id="portal-services-title">우리 반 운영</h2></div>
            <p>필요한 일을 고르면 현재 학급 정보로 바로 이어집니다.</p>
          </div>
          <div className="portal-service-grid">
            <ServiceCard tone="students" icon={<UsersRound />} title="학생 관리" description="학생 명단과 계정, 개인 QR을 관리해요." href="#students" action="명단 확인" />
            <ServiceCard tone="schedule" icon={<CalendarDays />} title="학급 일정" description="달력과 기초 시간표, 오늘 수업을 확인해요." href="#class-schedule" action="일정 확인" />
            <ServiceCard tone="job" icon={<BriefcaseBusiness />} title="직업센터" description={jobAction.description} href={jobAction.href} action={jobAction.label} />
            <ServiceCard tone="finance" icon={<Landmark />} title="금융센터" description="지갑, 은행 업무, 예금과 주식 활동을 운영해요." href={`/finance?classId=${selectedClassId}`} action="금융센터" />
            <ServiceCard tone="mart" icon={<ShoppingBasket />} title="마트센터" description="현물 학급화폐 판매와 상품·재고를 기록해요." href={`/mart?classId=${selectedClassId}`} action="마트센터" />
            <ServiceCard tone="life" icon={<ClipboardCheck />} title="생활확인" description="양치·우유·급식 확인과 보상 명단을 관리해요." href={`/life-checks?classId=${selectedClassId}`} action="생활확인" />
          </div>
        </section>

        <aside className="portal-side-widgets" aria-label="이번 주와 지금 할 일">
          <section className="portal-widget" aria-labelledby="portal-week-title">
            <div className="portal-widget-heading"><div><p className="eyebrow">학급 달력</p><h2 id="portal-week-title">이번 주 일정</h2></div><CalendarDays aria-hidden="true" /></div>
            {weekEvents.length ? (
              <ul className="portal-week-list">
                {weekEvents.map((event) => (
                  <li key={event.date}><time dateTime={event.date}>{shortDate(event.date)}</time><span>{event.memo}</span></li>
                ))}
              </ul>
            ) : (
              <div className="portal-widget-empty"><CalendarDays aria-hidden="true" /><p>{scheduleUnavailable ? "일정을 불러오지 못했어요." : schedule ? "이번 주에 적어 둔 일정이 없어요." : "이번 주 일정을 확인하고 있어요."}</p></div>
            )}
            <a href="#class-schedule" className="portal-widget-link">전체 일정 보기 <ArrowRight aria-hidden="true" /></a>
          </section>

          <section className="portal-widget" id="portal-tasks" aria-labelledby="portal-tasks-title">
            <div className="portal-widget-heading"><div><p className="eyebrow">준비 상태</p><h2 id="portal-tasks-title">지금 할 일</h2></div><span className="portal-task-count">{tasks.length - openTaskCount}/{tasks.length}</span></div>
            <ul className="portal-task-list">
              {tasks.map((task) => (
                <li key={task.id} className={task.complete ? "complete" : ""}>
                  {task.complete ? <CheckCircle2 aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
                  <a href={task.href}>{task.label}</a>
                </li>
              ))}
            </ul>
          </section>

          {schedule?.timetable.saved && todayLessons.length > 0 && (
            <section className="portal-widget portal-today-lessons" aria-labelledby="portal-lessons-title">
              <div className="portal-widget-heading"><div><p className="eyebrow">저장된 시간표</p><h2 id="portal-lessons-title">오늘 수업</h2></div><BookOpen aria-hidden="true" /></div>
              <ol>{todayLessons.slice(0, 7).map((lesson) => <li key={lesson.period}><span>{lesson.period}교시</span><strong>{lesson.subject}</strong></li>)}</ol>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

function ServiceCard({ tone, icon, title, description, href, action }: {
  tone: string;
  icon: ReactNode;
  title: string;
  description: string;
  href: string;
  action: string;
}) {
  return (
    <a className={`portal-service-card ${tone}`} href={href}>
      <span className="portal-service-icon" aria-hidden="true">{icon}</span>
      <div><h3>{title}</h3><p>{description}</p></div>
      <span className="portal-service-action">{action}<ArrowRight aria-hidden="true" /></span>
    </a>
  );
}

function greetingFor(epochMs?: number) {
  if (!epochMs) return "반가워요";
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date(epochMs)));
  if (hour < 12) return "좋은 아침이에요";
  if (hour < 18) return "좋은 오후예요";
  return "좋은 저녁이에요";
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "UTC",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${value}T00:00:00Z`));
}

function jobNextAction(classId: string, summary: PortalSummary, studentCount: number, monthlyChoiceAccessible: boolean) {
  if (studentCount < 1) return { href: "#students", label: "학생 명단 먼저", description: "학생을 등록하면 학급 인원에 맞춰 직업을 구성할 수 있어요." };
  if (summary.job_student_count_changed) return { href: `/teacher/classes/${classId}/jobs`, label: "자리 다시 맞추기", description: "학생 수가 바뀌었어요. 직업 자리 수를 다시 맞춰 주세요." };
  if (summary.job_status !== "completed") return { href: `/teacher/classes/${classId}/jobs`, label: summary.job_status === "draft" ? "초안 이어서" : "직업 설정", description: "우리 반에 필요한 직업과 자리 수를 준비해요." };
  if (summary.assignment_status !== "confirmed") return { href: `/teacher/classes/${classId}/job-assignments`, label: summary.calendar_saved ? "첫 직업 배정" : "달력 설정", description: summary.calendar_saved ? "학생에게 우리 반의 첫 직업을 배정해요." : "운영 달력을 정한 뒤 첫 직업을 배정해요." };
  if (monthlyChoiceAccessible) {
    const label = summary.monthly_choice_status === "draft"
      ? "선정 이어 하기"
      : summary.job_evaluation_status === "open"
        ? "평가 현황 보기"
        : summary.job_evaluation_status === "closed"
          ? "추천등급 검토"
          : summary.monthly_choice_status === "confirmed"
            ? "확정 결과 보기"
            : summary.job_evaluation_status === "finalized"
              ? "선택 순서 만들기"
              : "학생 평가 열기";
    return { href: `/teacher/classes/${classId}/monthly-jobs`, label, description: "학생 평가와 지난달 결과로 다음 달 직업을 정해요." };
  }
  return { href: `/teacher/classes/${classId}/jobs`, label: "직업 확인", description: "확정한 직업과 자리 수를 확인하거나 수정해요." };
}

async function loadDashboardSchedule(classId: string): Promise<ScheduleSnapshot> {
  const base = await api<ScheduleSnapshot>(`/api/classes/${classId}/teaching-calendar`);
  const { start, end } = weekDateBounds(base.calendar.serverTime.date);
  const adjacentMonths = [...new Set([start.slice(0, 7), end.slice(0, 7)])]
    .filter((month) => month !== base.calendar.monthValue);
  if (!adjacentMonths.length) return base;

  const adjacent = await Promise.all(adjacentMonths.map((month) =>
    api<ScheduleSnapshot>(`/api/classes/${classId}/teaching-calendar?month=${encodeURIComponent(month)}`),
  ));
  const days = new Map(base.calendar.days.map((day) => [day.date, day]));
  adjacent.forEach((snapshot) => snapshot.calendar.days.forEach((day) => days.set(day.date, day)));
  return {
    ...base,
    calendar: {
      ...base.calendar,
      days: [...days.values()].sort((left, right) => left.date.localeCompare(right.date)),
    },
  };
}

function weekDateBounds(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  const sunday = new Date(date);
  sunday.setUTCDate(date.getUTCDate() - date.getUTCDay());
  const saturday = new Date(sunday);
  saturday.setUTCDate(sunday.getUTCDate() + 6);
  return {
    start: sunday.toISOString().slice(0, 10),
    end: saturday.toISOString().slice(0, 10),
  };
}

function dashboardTasks(input: {
  selectedClassId: string;
  studentCount: number;
  pendingCount: number;
  attentionCount: number;
  summary: PortalSummary;
  monthlyChoiceAccessible: boolean;
  monthlyChoiceBlockedReason: string;
}): DashboardTask[] {
  const jobHref = `/teacher/classes/${input.selectedClassId}/jobs`;
  const assignmentHref = `/teacher/classes/${input.selectedClassId}/job-assignments`;
  const tasks: DashboardTask[] = [
    { id: "students", label: input.studentCount ? `학생 명단 ${input.studentCount}명 등록` : "학생 명단 입력하기", href: "#students", complete: input.studentCount > 0 },
    { id: "qr", label: input.pendingCount ? `등록 전 학생 QR ${input.pendingCount}명 준비` : "학생 계정 등록 확인", href: "#students", complete: input.studentCount > 0 && input.pendingCount === 0 },
    { id: "jobs", label: input.summary.job_student_count_changed ? "학생 수에 맞춰 직업 자리 조정" : input.summary.job_status === "completed" ? "우리 반 직업 구성 완료" : "우리 반 직업 구성하기", href: jobHref, complete: input.summary.job_status === "completed" && !input.summary.job_student_count_changed },
    { id: "calendar", label: input.summary.calendar_saved ? "운영 달력 저장 완료" : "운영 달력 설정하기", href: assignmentHref, complete: Boolean(input.summary.calendar_saved) },
    { id: "assignment", label: input.summary.assignment_status === "confirmed" ? "첫 직업 배정 완료" : "첫 직업 배정 확정하기", href: assignmentHref, complete: input.summary.assignment_status === "confirmed" },
  ];
  if (input.attentionCount > 0) {
    tasks.splice(2, 0, { id: "accounts", label: `확인 필요한 학생 계정 ${input.attentionCount}명`, href: "#students" });
  }
  if (input.monthlyChoiceAccessible && input.summary.job_evaluation_status === "open") {
    tasks.push({
      id: "evaluation",
      label: `직업평가 ${input.summary.job_evaluation_submitted_count ?? 0}/${input.summary.job_evaluation_student_count ?? 0}명 제출`,
      href: `/teacher/classes/${input.selectedClassId}/monthly-jobs`,
      complete: false,
    });
  }
  return tasks.slice(0, 6);
}
