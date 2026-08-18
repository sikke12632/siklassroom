"use client";

import { Fragment, FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, BriefcaseBusiness, CalendarDays, CheckCircle2, ClipboardCheck, Dices, Home, KeyRound, Landmark, ListOrdered, LogOut, MailCheck, Plus, Search, School, ShoppingBasket, UsersRound } from "lucide-react";
import { Logo } from "@/app/components/Logo";
import { AnnouncementBanner } from "@/app/components/AnnouncementBanner";
import { TeacherEntryIntro } from "@/app/components/EntryIntro";
import { Notice } from "@/app/components/Notice";
import { PrintCards, RegistrationCard } from "@/app/components/PrintCards";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { SchoolIllustration } from "@/app/components/SchoolIllustration";
import { TeacherScheduleOverview } from "./TeacherScheduleOverview";
import { TeacherDashboardHome } from "./TeacherDashboardHome";
import { api, ClientApiError, friendlyStatus, patchJson, postJson } from "@/lib/client-api";
import { PROVINCES, SCHOOL_LEVELS } from "@/lib/schools";
import { parseStudentNumberRanges } from "@/lib/student-number-ranges";

type TeacherActor = {
  type: "teacher";
  id: string;
  email: string;
  email_verified_at: number | null;
  teacher_access_status: "pending" | "invite_verified" | "revoked";
  teacher_access_verified_at: number | null;
  school_id: string | null;
  manual_school_request_id: string | null;
  registration_mode?: "open" | "verified";
  school_display_name?: string | null;
  school_province_name?: string | null;
  school_level?: string | null;
  school_pending?: number;
};
type VerificationDelivery = { sent: boolean; retryAfterSeconds: number; developmentUrl?: string };
type ClassRoom = {
  id: string; school_name: string; school_year: number; grade: number; class_number: number;
  display_name: string | null; status: string; student_count?: number; active_count?: number; action_count?: number;
  job_student_count?: number; job_status?: "not_started" | "draft" | "completed";
  job_count?: number; job_capacity?: number; job_student_snapshot?: number; job_student_count_changed?: number;
  calendar_saved?: number; assignment_status?: "not_started" | "draft" | "confirmed";
  monthly_choice_status?: "draft" | "confirmed" | null;
  monthly_choice_target_year?: number | null;
  monthly_choice_target_month?: number | null;
  job_evaluation_status?: "open" | "closed" | "finalized" | null;
  job_evaluation_submitted_count?: number | null;
  job_evaluation_student_count?: number | null;
};
type Student = {
  id: string; student_number: number; official_name: string; status: string;
  qr_generation: number; activated_at: number | null;
};
type DraftStudent = { key: string; number: string; name: string };

const currentYear = new Date().getFullYear();
const emptyDraft = (number = ""): DraftStudent => ({ key: crypto.randomUUID(), number, name: "" });

export function TeacherPortal() {
  const router = useRouter();
  const verificationStarted = useRef(false);
  const classLoadSequence = useRef(0);
  const [loading, setLoading] = useState(true);
  const [actor, setActor] = useState<TeacherActor | null>(null);
  const [wrongEntrance, setWrongEntrance] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup" | "forgot">("login");
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [classRoom, setClassRoom] = useState<ClassRoom | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [showClassForm, setShowClassForm] = useState(false);
  const [addingStudents, setAddingStudents] = useState(false);
  const [cards, setCards] = useState<RegistrationCard[]>([]);
  const [bulkQrResume, setBulkQrResume] = useState<{
    classId: string;
    afterStudentNumber: number;
    completedCount: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [dashboardScheduleRevision, setDashboardScheduleRevision] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [initialVerification, setInitialVerification] = useState<VerificationDelivery | null>(null);

  const loadClasses = useCallback(async (preferredId?: string) => {
    const data = await api<{ classes: ClassRoom[] }>("/api/classes");
    setClasses(data.classes);
    const availableIds = new Set(data.classes.map((item) => item.id));
    const id = (
      preferredId && availableIds.has(preferredId) ? preferredId : null
    ) || (
      selectedClassId && availableIds.has(selectedClassId) ? selectedClassId : null
    ) || data.classes[0]?.id || null;
    setSelectedClassId(id);
    setShowClassForm(data.classes.length === 0);
    return id;
  }, [selectedClassId]);

  const loadClass = useCallback(async (id: string) => {
    const sequence = ++classLoadSequence.current;
    let data: { class: ClassRoom; students: Student[] };
    try {
      data = await api<{ class: ClassRoom; students: Student[] }>(`/api/classes/${id}/students`);
    } catch (reason) {
      if (sequence !== classLoadSequence.current) return false;
      throw reason;
    }
    if (sequence !== classLoadSequence.current) return false;
    setClassRoom(data.class);
    setStudents(data.students);
    return true;
  }, []);

  const loadActor = useCallback(async () => {
    const data = await api<{ actor: TeacherActor | { type: "student" } | null }>("/api/session");
    if (data.actor?.type === "teacher") {
      setActor(data.actor);
      if (
        data.actor.email_verified_at
        && data.actor.teacher_access_status === "invite_verified"
        && (data.actor.school_id || data.actor.manual_school_request_id)
      ) {
        const preferredClassId = new URLSearchParams(window.location.search).get("classId") || undefined;
        await loadClasses(preferredClassId);
      }
    } else if (data.actor?.type === "student") {
      setWrongEntrance(true);
    } else {
      setActor(null);
    }
    return data.actor;
  }, [loadClasses]);

  useEffect(() => {
    if (verificationStarted.current) return;
    verificationStarted.current = true;
    const current = new URL(window.location.href);
    const token = new URLSearchParams(current.hash.replace(/^#/, "")).get("verifyEmailToken");
    const legacyQueryToken = current.searchParams.has("verifyEmailToken");
    current.searchParams.delete("verifyEmailToken");
    if (token || legacyQueryToken) {
      window.history.replaceState({}, "", `${current.pathname}${current.search}`);
    }
    const verify = token
      ? postJson("/api/teacher/email-verification/confirm", { token })
        .then(() => {
          setAuthNotice("이메일 확인을 완료했어요. 다음 단계로 이어갈게요.");
        })
        .catch((reason) => setError((reason as Error).message))
      : legacyQueryToken
        ? Promise.resolve().then(() => setError("이전 인증 링크는 더 이상 사용할 수 없어요. 새 인증 메일을 받아 주세요."))
      : Promise.resolve();
    verify.then(() => loadActor())
      .then(() => setSessionError(""))
      .catch(() => setSessionError("접속 상태를 확인하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요."))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!actor || !selectedClassId) {
      classLoadSequence.current += 1;
      return;
    }
    const frame = requestAnimationFrame(() => loadClass(selectedClassId).catch((reason) => setError(reason.message)));
    return () => cancelAnimationFrame(frame);
  }, [actor, selectedClassId, loadClass]);

  function selectClass(id: string) {
    if (id === selectedClassId && !showClassForm) return;
    if (scheduleDirty && !confirm("저장하지 않은 시간표 변경이 있어요. 변경을 버리고 다른 학급으로 이동할까요?")) return;
    setScheduleDirty(false);
    classLoadSequence.current += 1;
    setClassRoom(null);
    setStudents([]);
    setAddingStudents(false);
    setShowClassForm(false);
    setSelectedClassId(id);
  }

  function startClassCreation() {
    if (scheduleDirty && !confirm("저장하지 않은 시간표 변경이 있어요. 변경을 버리고 새 학급 만들기로 이동할까요?")) return;
    setScheduleDirty(false);
    classLoadSequence.current += 1;
    setClassRoom(null);
    setStudents([]);
    setAddingStudents(false);
    setShowClassForm(true);
  }

  async function logout() {
    if (logoutBusy) return;
    if (scheduleDirty && !confirm("저장하지 않은 시간표 변경이 있어요. 변경을 버리고 로그아웃할까요?")) return;
    setLogoutBusy(true);
    setError("");
    try {
      await api("/api/session", { method: "DELETE" });
      // This route is already /teacher, so replacing it does not necessarily
      // remount this client component. Clear every authenticated view state
      // immediately instead of waiting for a router refresh to do it for us.
      classLoadSequence.current += 1;
      setScheduleDirty(false);
      setActor(null);
      setWrongEntrance(false);
      setClasses([]);
      setSelectedClassId(null);
      setClassRoom(null);
      setStudents([]);
      setShowClassForm(false);
      setAddingStudents(false);
      setCards([]);
      setBulkQrResume(null);
      setInitialVerification(null);
      setAuthMode("login");
      setAuthNotice("");
      setMessage("");
      setSessionError("");
      router.replace("/teacher");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLogoutBusy(false);
    }
  }

  async function retrySession() {
    setLoading(true);
    setSessionError("");
    try {
      await loadActor();
    } catch {
      setSessionError("접속 상태를 확인하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <LoadingScreen label="교사 화면을 준비하고 있어요" />;
  if (wrongEntrance) return (
    <CenteredCard>
      <Logo />
      <h1>학생으로 로그인되어 있어요</h1>
      <p>학생 화면으로 이동하거나 로그아웃한 뒤 교사 계정으로 들어와 주세요.</p>
      <Notice message={error} tone="error" />
      <div className="button-stack"><a className="button button-primary" href="/student">학생 화면으로</a><button className="button button-light" disabled={logoutBusy} onClick={() => void logout()}>{logoutBusy ? "로그아웃 중…" : "로그아웃"}</button></div>
    </CenteredCard>
  );
  if (!actor) return (
    <TeacherAuth
      mode={authMode}
      setMode={setAuthMode}
      notice={authNotice}
      initialError={error}
      sessionError={sessionError}
      onRetrySession={retrySession}
      onAuthenticated={(teacher, verification) => {
        setActor(teacher);
        setInitialVerification(verification ?? null);
        loadActor();
      }}
    />
  );
  if (!actor.email_verified_at) {
    return <EmailVerificationGate actor={actor} initialDelivery={initialVerification} onComplete={loadActor} onLogout={logout} />;
  }
  if (actor.teacher_access_status === "revoked") {
    return <AccessRevokedGate actor={actor} onLogout={logout} />;
  }
  if (actor.teacher_access_status !== "invite_verified") {
    return <InviteCodeGate actor={actor} onComplete={loadActor} onLogout={logout} />;
  }
  if (!actor.school_id && !actor.manual_school_request_id) {
    return <SchoolSelectionGate actor={actor} onComplete={loadActor} onLogout={logout} />;
  }

  const selectedSummary = classes.find((item) => item.id === selectedClassId);
  const classLabel = classRoom ? (classRoom.display_name || `${classRoom.school_name} ${classRoom.grade}학년 ${classRoom.class_number}반`) : "우리 반";
  const pendingCount = students.filter((student) => student.status === "pending").length;
  const activeCount = students.filter((student) => student.status === "active").length;
  const attentionCount = students.filter((student) => student.status === "reset_required" || student.status === "locked").length;
  const operationalStudentCount = students.filter((student) => student.status !== "excluded").length;
  const monthlyChoiceReady = Boolean(
    selectedSummary
      && Number(selectedSummary.job_student_count ?? 0) > 0
      && selectedSummary.job_status === "completed"
      && !selectedSummary.job_student_count_changed
      && selectedSummary.assignment_status === "confirmed",
  );
  const monthlyChoiceAccessible = Boolean(
    monthlyChoiceReady
      || selectedSummary?.monthly_choice_status
      || selectedSummary?.job_evaluation_status,
  );
  const monthlyChoiceBlockedReason = Number(selectedSummary?.job_student_count ?? 0) < 1
    ? "학생 명단을 먼저 등록해 주세요."
    : selectedSummary?.job_status !== "completed"
      ? "우리 반 직업을 먼저 확정해 주세요."
      : selectedSummary.job_student_count_changed
        ? "달라진 학생 수에 맞춰 직업 정원을 먼저 조정해 주세요."
        : selectedSummary?.assignment_status !== "confirmed"
          ? "첫 직업 배정을 먼저 확정해 주세요."
          : "";

  return (
    <div className="teacher-shell">
      <aside className="teacher-sidebar">
        <Logo compact />
        <nav className="primary-nav" aria-label="주요 메뉴">
          <a href="#dashboard"><Home aria-hidden="true" /><span>홈</span></a>
          <a href="#students"><UsersRound aria-hidden="true" /><span>학생 관리</span></a>
          {selectedClassId && <a href="#class-schedule"><CalendarDays aria-hidden="true" /><span>달력·시간표</span></a>}
          {selectedClassId && <a href={`/teacher/classes/${selectedClassId}/jobs`}><BriefcaseBusiness aria-hidden="true" /><span>우리 반 직업</span></a>}
          {selectedClassId && selectedSummary?.job_status === "completed" && (
            <a href={`/teacher/classes/${selectedClassId}/job-assignments`}><Dices aria-hidden="true" /><span>첫 직업 배정</span></a>
          )}
          {selectedClassId && (
            monthlyChoiceAccessible ? (
              <a href={`/teacher/classes/${selectedClassId}/monthly-jobs`}><ListOrdered aria-hidden="true" /><span>다음 달 직업 선정</span></a>
            ) : (
              <a
                aria-disabled="true"
                tabIndex={-1}
                title={monthlyChoiceBlockedReason}
                style={{ opacity: 0.5, pointerEvents: "none" }}
              >
                <ListOrdered aria-hidden="true" /><span>다음 달 직업 선정</span>
              </a>
            )
          )}
          {selectedClassId && <a href={`/finance?classId=${selectedClassId}`}><Landmark aria-hidden="true" /><span>금융센터</span></a>}
          {selectedClassId && <a href={`/mart?classId=${selectedClassId}`}><ShoppingBasket aria-hidden="true" /><span>마트센터</span></a>}
          {selectedClassId && <a href={`/life-checks?classId=${selectedClassId}`}><ClipboardCheck aria-hidden="true" /><span>생활확인</span></a>}
        </nav>
        <button className="sidebar-add" onClick={startClassCreation}><Plus aria-hidden="true" /> 새 학급 만들기</button>
        <SchoolIllustration className="sidebar-school-illustration" variant="compact" />
        <div className="sidebar-account">
          <ThemeToggle />
          <span>{actor.email}</span>
          <button onClick={logout}><LogOut aria-hidden="true" />로그아웃</button>
        </div>
      </aside>

      <main className="teacher-main">
        <header className="mobile-teacher-header">
          <Logo compact />
          <div className="mobile-header-actions"><ThemeToggle compact /><button type="button" onClick={logout} aria-label="로그아웃"><LogOut aria-hidden="true" /></button></div>
          <div className="mobile-class-controls">
            <label>
              <span className="visually-hidden">내 학급 선택</span>
              <select
                aria-label="내 학급 선택"
                value={showClassForm ? "" : selectedClassId ?? ""}
                onChange={(event) => selectClass(event.target.value)}
              >
                <option value="" disabled>{classes.length ? "학급을 선택해 주세요" : "등록된 학급이 없습니다"}</option>
                {classes.map((item) => (
                  <option key={item.id} value={item.id}>{item.display_name || `${item.grade}학년 ${item.class_number}반`} · {item.school_year}</option>
                ))}
              </select>
            </label>
            <button className="button button-light" type="button" onClick={startClassCreation}><Plus aria-hidden="true" /><span>새 학급</span></button>
          </div>
          {selectedClassId && (
            <details className="mobile-service-menu">
              <summary>우리 반 전체 메뉴</summary>
              <nav aria-label="모바일 주요 메뉴">
                <a href="#dashboard"><Home aria-hidden="true" />홈</a>
                <a href="#students"><UsersRound aria-hidden="true" />학생 관리</a>
                <a href="#class-schedule"><CalendarDays aria-hidden="true" />달력·시간표</a>
                <a href={`/teacher/classes/${selectedClassId}/jobs`}><BriefcaseBusiness aria-hidden="true" />직업센터</a>
                {selectedSummary?.job_status === "completed" && (
                  <a href={`/teacher/classes/${selectedClassId}/job-assignments`}><Dices aria-hidden="true" />첫 직업 배정</a>
                )}
                {monthlyChoiceAccessible && (
                  <a href={`/teacher/classes/${selectedClassId}/monthly-jobs`}><ListOrdered aria-hidden="true" />다음 달 직업 선정</a>
                )}
                <a href={`/finance?classId=${selectedClassId}`}><Landmark aria-hidden="true" />금융센터</a>
                <a href={`/mart?classId=${selectedClassId}`}><ShoppingBasket aria-hidden="true" />마트센터</a>
                <a href={`/life-checks?classId=${selectedClassId}`}><ClipboardCheck aria-hidden="true" />생활확인</a>
              </nav>
            </details>
          )}
        </header>
        {showClassForm ? (
          <>
            <AnnouncementBanner />
            <Notice message={error} tone="error" />
            <Notice message={message} tone="success" />
            <ClassCreateForm actor={actor} busy={busy} onSubmit={async (input) => {
              setBusy(true); setError("");
              try {
                const data = await postJson<{ class: ClassRoom }>("/api/classes", input);
                await loadClasses(data.class.id);
                setShowClassForm(false);
                setSelectedClassId(data.class.id);
                setMessage("학급을 만들었어요. 이제 학생 명단을 입력해 주세요.");
              } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
            }} />
          </>
        ) : classRoom && selectedSummary && classRoom.id === selectedClassId ? (
          <>
            <div id="dashboard">
              <TeacherDashboardHome
                actorEmail={actor.email}
                classes={classes}
                selectedClassId={classRoom.id}
                classRoom={classRoom}
                summary={selectedSummary}
                studentCount={operationalStudentCount}
                activeCount={activeCount}
                pendingCount={pendingCount}
                attentionCount={attentionCount}
                monthlyChoiceAccessible={monthlyChoiceAccessible}
                monthlyChoiceBlockedReason={monthlyChoiceBlockedReason}
                scheduleRevision={dashboardScheduleRevision}
                onSelectClass={selectClass}
                onCreateClass={startClassCreation}
                onLogout={logout}
                announcement={<AnnouncementBanner />}
                status={
                  <>
                    <Notice message={error} tone="error" />
                    <Notice message={message} tone="success" />
                  </>
                }
              />
            </div>
            <section className="setup-progress setup-progress-five" aria-label="학급 준비 단계">
              <div className={operationalStudentCount ? "done" : "current"}><b>1</b><span>학생 명단<small>{operationalStudentCount ? `${operationalStudentCount}명` : "입력 중"}</small></span></div>
              <i />
              <div className={selectedSummary.job_status === "completed" ? "done" : students.length ? "current" : ""}><b>2</b><span>직업 만들기<small>{selectedSummary.job_status === "completed" ? `${selectedSummary.job_count}개` : "대기"}</small></span></div>
              <i />
              <div className={selectedSummary.calendar_saved ? "done" : selectedSummary.job_status === "completed" ? "current" : ""}><b>3</b><span>달력 설정<small>{selectedSummary.calendar_saved ? "저장됨" : "대기"}</small></span></div>
              <i />
              <div className={selectedSummary.assignment_status === "confirmed" ? "done" : selectedSummary.calendar_saved ? "current" : ""}><b>4</b><span>첫 직업 배정<small>{selectedSummary.assignment_status === "confirmed" ? "확정" : selectedSummary.assignment_status === "draft" ? "진행 중" : "대기"}</small></span></div>
              <i />
              <div className={selectedSummary.assignment_status === "confirmed" ? "done" : ""}><b>5</b><span>설정 완료<small>{selectedSummary.assignment_status === "confirmed" ? "완료" : "대기"}</small></span></div>
            </section>

            <TeacherScheduleOverview
              key={classRoom.id}
              classId={classRoom.id}
              readOnly={classRoom.status !== "active"}
              onDirtyChange={setScheduleDirty}
              onTimetableSaved={() => setDashboardScheduleRevision((current) => current + 1)}
            />

            <div id="students" data-dashboard-section="students">
              {students.length === 0 ? (
                <RosterEditor onSaved={(newCards) => { setCards(newCards); setAddingStudents(false); loadClass(classRoom.id); loadClasses(classRoom.id); }} classId={classRoom.id} />
              ) : (
                <>
                <section className="stat-grid">
                  <div><span>운영 학생</span><strong>{operationalStudentCount}</strong><small>명</small></div>
                  <div><span>등록 완료</span><strong>{activeCount}</strong><small>명</small></div>
                  <div><span>등록 전</span><strong>{pendingCount}</strong><small>명</small></div>
                  <div className={attentionCount ? "attention" : ""}><span>확인 필요</span><strong>{attentionCount}</strong><small>명</small></div>
                </section>
                {addingStudents && (
                  <RosterEditor
                    classId={classRoom.id}
                    existingStudentNumbers={students.map((student) => student.student_number)}
                    onCancel={() => setAddingStudents(false)}
                    onSaved={(newCards) => {
                      setCards(newCards);
                      setAddingStudents(false);
                      loadClass(classRoom.id);
                      loadClasses(classRoom.id);
                    }}
                  />
                )}
                <section className="panel roster-panel">
                  <div className="panel-heading">
                    <div><p className="eyebrow">학생 계정</p><h2>우리 반 명단</h2><p>이름이나 번호를 고쳐도 같은 학생의 기록으로 이어집니다.</p></div>
                    <div className="button-row">
                      <button className="button button-light" onClick={() => setAddingStudents((value) => !value)}>{addingStudents ? "추가 취소" : "전입생 추가"}</button>
                      <button className="button button-primary" disabled={busy || (!pendingCount && !students.some((s) => s.status === "reset_required"))} onClick={async () => {
                        const resume = bulkQrResume?.classId === classRoom.id ? bulkQrResume : null;
                        if (!confirm(resume
                          ? `${resume.completedCount}명 다음 학생부터 QR 만들기를 계속할까요? 앞에서 만든 QR은 바뀌지 않습니다.`
                          : "등록 전·재설정 학생의 기존 QR을 새 개인 QR로 바꿀까요? 새로 발급하면 이전 QR은 무효가 됩니다.")) return;
                        setBusy(true); setError("");
                        const nextCards: RegistrationCard[] = resume ? [...cards] : [];
                        const previouslyCompleted = resume?.completedCount ?? 0;
                        let newlyCompleted = 0;
                        try {
                          let afterStudentNumber: number | null = resume?.afterStudentNumber ?? null;
                          for (let page = 0; page < 30; page += 1) {
                            const data: {
                              cards: RegistrationCard[];
                              nextAfterStudentNumber: number | null;
                            } = await postJson(`/api/classes/${classRoom.id}/registration-tokens`, { afterStudentNumber });
                            nextCards.push(...data.cards);
                            newlyCompleted += data.cards.length;
                            // Preserve every successful page immediately. The print
                            // dialog stays hidden while busy, but a later network
                            // failure can still show and print these valid new cards.
                            setCards([...nextCards]);
                            if (data.nextAfterStudentNumber === null) {
                              setBulkQrResume(null);
                              break;
                            }
                            afterStudentNumber = data.nextAfterStudentNumber;
                            setBulkQrResume({
                              classId: classRoom.id,
                              afterStudentNumber,
                              completedCount: previouslyCompleted + newlyCompleted,
                            });
                            setMessage(`새 QR 카드를 안전하게 나누어 만드는 중… ${previouslyCompleted + newlyCompleted}명`);
                          }
                          setCards(nextCards);
                          setMessage(`${previouslyCompleted + newlyCompleted}명의 새 QR 카드를 만들었어요.`);
                        } catch (reason) {
                          const completedCount = previouslyCompleted + newlyCompleted;
                          setError(completedCount > 0
                            ? `${completedCount}명의 QR은 안전하게 만들었습니다. 아래 카드를 인쇄한 뒤 'QR 계속 만들기'를 눌러 다음 학생부터 이어 주세요. (${(reason as Error).message})`
                            : (reason as Error).message);
                        } finally { setBusy(false); }
                      }}>{busy ? "만드는 중…" : bulkQrResume?.classId === classRoom.id ? "QR 계속 만들기" : "미등록 QR 인쇄"}</button>
                    </div>
                  </div>
                  <StudentTable classId={classRoom.id} students={students} busy={busy} onBusy={setBusy} onError={setError} onMessage={setMessage} onCards={setCards} onReload={() => { loadClass(classRoom.id); loadClasses(classRoom.id); }} />
                </section>
                </>
              )}
            </div>

          </>
        ) : <LoadingScreen label="학급 정보를 불러오고 있어요" />}
      </main>
      {cards.length > 0 && !busy && <PrintCards cards={cards} classLabel={classLabel} onClose={() => setCards([])} />}
    </div>
  );
}

function OnboardingShell({ step, steps, icon, title, description, children, onLogout }: {
  step: number;
  steps?: string[];
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
  onLogout: () => void;
}) {
  const stepLabels = steps ?? ["계정", "이메일", "초대코드", "학교", "학급"];
  return (
    <div className="auth-page onboarding-auth-page">
      <header><Logo /><div className="header-actions"><ThemeToggle compact /><button className="text-button" onClick={onLogout}>로그아웃</button></div></header>
      <main className="onboarding-gate-wrap">
        <section className="onboarding-gate">
          <div className="onboarding-gate-icon" aria-hidden="true">{icon}</div>
          <div className="onboarding-step">{step} / {stepLabels.length}</div>
          <p className="eyebrow">교사 가입 준비</p>
          <h1>{title}</h1>
          <p>{description}</p>
          <div className="account-steps" aria-label="가입 단계">
            {stepLabels.map((label, index) => (
              <span key={label} className={index + 1 < step ? "done" : index + 1 === step ? "current" : ""}>
                {index + 1 < step ? <CheckCircle2 aria-hidden="true" /> : index + 1}<small>{label}</small>
              </span>
            ))}
          </div>
          {children}
        </section>
      </main>
    </div>
  );
}

function EmailVerificationGate({ actor, initialDelivery, onComplete, onLogout }: {
  actor: TeacherActor;
  initialDelivery: VerificationDelivery | null;
  onComplete: () => Promise<unknown>;
  onLogout: () => void;
}) {
  const [delivery, setDelivery] = useState<VerificationDelivery | null>(initialDelivery);
  const [requested, setRequested] = useState(initialDelivery !== null);
  const [cooldown, setCooldown] = useState(initialDelivery?.retryAfterSeconds ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState(initialDelivery?.sent ? "인증 메일을 보냈어요. 스팸함도 확인해 주세요." : "");

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function resend() {
    setBusy(true); setError(""); setMessage("");
    try {
      const wasRequested = requested;
      const data = await postJson<{ verification?: VerificationDelivery; alreadyVerified?: boolean }>("/api/teacher/email-verification/request", {});
      if (data.alreadyVerified) return void await onComplete();
      const next = data.verification ?? null;
      setDelivery(next);
      setRequested(true);
      setCooldown(next?.retryAfterSeconds ?? 60);
      setMessage(next?.sent ? (wasRequested ? "인증 메일을 다시 보냈어요." : "인증 메일을 보냈어요.") : "메일 발송 설정을 확인하고 있어요.");
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }

  return (
    <OnboardingShell step={2} icon={<MailCheck />} title="이메일을 확인해 주세요" description={requested ? `${actor.email} 주소로 보낸 링크를 누르면 이메일 확인이 완료됩니다.` : `${actor.email} 주소로 인증 메일을 받은 뒤 링크를 눌러 주세요.`} onLogout={onLogout}>
      <div className="verification-help">
        <b>{requested ? "메일이 보이지 않나요?" : "인증 메일이 필요해요"}</b>
        <span>{requested ? "스팸함을 확인하고, 주소가 맞는지 살펴본 뒤 다시 보내 주세요." : "아래 버튼을 누르면 입력한 주소로 인증 메일을 보내 드려요."}</span>
      </div>
      <Notice message={error} tone="error" /><Notice message={message} tone="success" />
      {delivery?.developmentUrl && <a className="dev-reset-link" href={delivery.developmentUrl}>개발 환경 인증 링크 열기</a>}
      <div className="button-stack">
        <button className="button button-primary" disabled={busy || cooldown > 0} onClick={resend}>
          {busy ? "보내는 중…" : cooldown > 0 ? `${cooldown}초 뒤 다시 보내기` : requested ? "인증 메일 다시 보내기" : "인증 메일 받기"}
        </button>
        <button className="button button-light" onClick={() => onComplete()}>확인 완료 상태 새로고침</button>
      </div>
    </OnboardingShell>
  );
}

function InviteCodeGate({ actor, onComplete, onLogout }: {
  actor: TeacherActor;
  onComplete: () => Promise<unknown>;
  onLogout: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await postJson("/api/teacher/invite-code/redeem", { code });
      await onComplete();
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }
  return (
    <OnboardingShell step={3} icon={<KeyRound />} title="초대코드를 입력해 주세요" description={`${actor.email} 이메일 확인이 완료됐어요. 베타 이용 권한을 활성화할 차례입니다.`} onLogout={onLogout}>
      <div className="verification-help"><b>초대코드는 일회용입니다</b><span>발급받은 코드는 한 계정에서 한 번만 사용할 수 있어요.</span></div>
      <form className="form-stack" onSubmit={submit}>
        <label>교사 초대코드<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 23))} placeholder="XXXXX-XXXXX-XXXXX-XXXXX" autoComplete="one-time-code" autoFocus required /></label>
        <Notice message={error} tone="error" />
        <button className="button button-primary button-large" disabled={busy}>{busy ? "확인 중…" : "초대코드 인증하기"}</button>
      </form>
      <p className="privacy-note">초대코드는 베타 서비스 이용 권한을 위한 것이며, 재직 또는 학교 소속을 공식 인증하지 않습니다.</p>
    </OnboardingShell>
  );
}

function AccessRevokedGate({ actor, onLogout }: { actor: TeacherActor; onLogout: () => void }) {
  return (
    <OnboardingShell step={3} icon={<KeyRound />} title="교사 이용 권한이 비활성화됐어요" description={`${actor.email} 계정으로 로그인되어 있지만 지금은 학급을 변경할 수 없습니다.`} onLogout={onLogout}>
      <Notice message="서비스 관리자에게 새 이용 권한을 요청해 주세요." tone="error" />
    </OnboardingShell>
  );
}

type SchoolResult = {
  id: string;
  official_name: string;
  province_name: string;
  school_level: string;
  district_name: string | null;
  road_address: string | null;
};

function SchoolSelectionGate({ actor, onComplete, onLogout }: {
  actor: TeacherActor;
  onComplete: () => Promise<unknown>;
  onLogout: () => void;
}) {
  const [query, setQuery] = useState("");
  const [province, setProvince] = useState("");
  const [level, setLevel] = useState("");
  const [results, setResults] = useState<SchoolResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualProvince, setManualProvince] = useState("");
  const [manualLevel, setManualLevel] = useState("");
  const [manualDistrict, setManualDistrict] = useState("");
  const [manualNote, setManualNote] = useState("");

  useEffect(() => {
    if (query.trim().replace(/\s+/g, "").length < 2) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const params = new URLSearchParams({ q: query });
        if (province) params.set("province", province);
        if (level) params.set("level", level);
        const data = await api<{ schools: SchoolResult[] }>(`/api/schools/search?${params}`, { signal: controller.signal });
        setResults(data.schools); setSearched(true);
      } catch (reason) {
        if (!controller.signal.aborted) setError((reason as Error).message);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, province, level]);

  async function selectSchool(school: SchoolResult) {
    setBusy(true); setError("");
    try {
      await postJson("/api/schools/select", { schoolId: school.id });
      await onComplete();
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }

  async function submitManual(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await postJson("/api/schools/manual", {
        enteredName: manualName,
        provinceName: manualProvince,
        schoolLevel: manualLevel,
        districtOrAddress: manualDistrict,
        note: manualNote,
      });
      await onComplete();
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }

  return (
    <OnboardingShell
      step={actor.registration_mode === "open" ? 2 : 4}
      steps={actor.registration_mode === "open" ? ["계정", "학교", "학급"] : undefined}
      icon={<School />}
      title="학교를 선택해 주세요"
      description={`${actor.email} 계정에 공식 학교를 연결합니다. 찾을 수 없으면 직접 입력할 수 있어요.`}
      onLogout={onLogout}
    >
      {!manual ? (
        <>
          <div className="school-filters">
            <label>시도<select value={province} onChange={(event) => setProvince(event.target.value)}><option value="">전체 시도</option>{PROVINCES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>학교급<select value={level} onChange={(event) => setLevel(event.target.value)}><option value="">전체 학교급</option>{SCHOOL_LEVELS.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
          <label className="school-search-label">학교명 검색<div className="school-search-input"><Search aria-hidden="true" /><input value={query} onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            if (value.trim().replace(/\s+/g, "").length < 2) {
              setResults([]);
              setSearched(false);
            }
          }} placeholder="예: 서이초" autoFocus /></div></label>
          <Notice message={error} tone="error" />
          <div className="school-results" aria-live="polite" aria-busy={loading}>
            {loading ? <p>학교를 찾고 있어요…</p> : results.map((school) => (
              <button key={school.id} disabled={busy} onClick={() => selectSchool(school)}>
                <School aria-hidden="true" /><span><strong>{school.official_name}</strong><small>{school.province_name} · {school.school_level}{school.district_name ? ` · ${school.district_name}` : ""}</small><em>{school.road_address || "주소 정보 없음"}</em></span>
              </button>
            ))}
            {!loading && searched && !results.length && <p>검색 결과가 없어요. 이름을 다시 확인하거나 직접 입력해 주세요.</p>}
          </div>
          <button className="button button-light button-large" onClick={() => { setManual(true); setManualName(query); }}>학교를 찾을 수 없나요? 직접 입력</button>
        </>
      ) : (
        <form className="form-stack manual-school-form" onSubmit={submitManual}>
          <div className="school-filters">
            <label>시도<select value={manualProvince} onChange={(event) => setManualProvince(event.target.value)} required><option value="">선택</option>{PROVINCES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>학교급<select value={manualLevel} onChange={(event) => setManualLevel(event.target.value)} required><option value="">선택</option>{SCHOOL_LEVELS.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
          <label>학교명<input value={manualName} onChange={(event) => setManualName(event.target.value)} maxLength={80} required /></label>
          <label>교육지원청 또는 주소 일부<input value={manualDistrict} onChange={(event) => setManualDistrict(event.target.value)} maxLength={120} required /></label>
          <label>추가 설명 <small>선택</small><textarea value={manualNote} onChange={(event) => setManualNote(event.target.value)} maxLength={300} rows={3} /></label>
          <Notice message={error} tone="error" />
          <button className="button button-primary button-large" disabled={busy}>{busy ? "저장 중…" : "학교 확인 요청 저장하기"}</button>
          <button type="button" className="text-button" onClick={() => setManual(false)}>공식 학교 검색으로 돌아가기</button>
          <p className="privacy-note">직접 입력한 학교는 공식 학교 목록에 바로 추가되지 않고 ‘학교 확인 중’으로 저장됩니다.</p>
        </form>
      )}
    </OnboardingShell>
  );
}

function TeacherAuth({ mode, setMode, notice, initialError, sessionError, onRetrySession, onAuthenticated }: {
  mode: "login" | "signup" | "forgot";
  setMode: (mode: "login" | "signup" | "forgot") => void;
  notice?: string;
  initialError?: string;
  sessionError?: string;
  onRetrySession: () => void;
  onAuthenticated: (teacher: TeacherActor, verification?: VerificationDelivery) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [developmentUrl, setDevelopmentUrl] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setMessage(""); setBusy(true);
    try {
      if (mode === "forgot") {
        const data = await postJson<{ message: string; developmentResetUrl?: string }>("/api/teacher/password/request", { email });
        setMessage(data.message);
        setDevelopmentUrl(data.developmentResetUrl || "");
      } else {
        if (mode === "signup" && password !== confirmPassword) throw new Error("비밀번호가 서로 달라요.");
        if (mode === "signup") {
          const data = await postJson<{
            accepted: boolean;
            message: string;
          }>("/api/teacher/signup", { email, password });
          setMessage(data.message);
          setPassword("");
          setConfirmPassword("");
          setMode("login");
        } else {
          const data = await postJson<{ teacher: TeacherActor }>("/api/teacher/login", { email, password });
          onAuthenticated({ ...data.teacher, type: "teacher" });
        }
      }
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="auth-page">
      <header><Logo /><div className="header-actions"><ThemeToggle compact /><a href="/student">학생 로그인</a></div></header>
      <main className="auth-layout">
        <TeacherEntryIntro />
        <section className="auth-card">
          {mode !== "forgot" && <div className="segmented"><button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>로그인</button><button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>처음 가입</button></div>}
          <h2>{mode === "login" ? "교사 로그인" : mode === "signup" ? "교사 가입" : "비밀번호 찾기"}</h2>
          <form onSubmit={submit} className="form-stack">
            <label>이메일<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teacher@school.kr" autoComplete="email" required /></label>
            {mode !== "forgot" && <label>비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "signup" ? "8자 이상" : "비밀번호"} autoComplete={mode === "signup" ? "new-password" : "current-password"} required /></label>}
            {mode === "signup" && <label>비밀번호 확인<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required /></label>}
            <Notice message={error || initialError || sessionError || ""} tone="error" /><Notice message={message || notice || ""} tone="success" />
            {sessionError && <button className="button button-light" type="button" onClick={onRetrySession}>접속 상태 다시 확인</button>}
            {developmentUrl && <a className="dev-reset-link" href={developmentUrl}>개발 확인용 재설정 링크 열기</a>}
            <button className="button button-primary button-large" disabled={busy}>{busy ? "확인 중…" : mode === "login" ? "로그인" : mode === "signup" ? "가입하기" : "재설정 메일 받기"}</button>
          </form>
          {mode === "login" && <button className="text-button" onClick={() => setMode("forgot")}>비밀번호를 잊었어요</button>}
          {mode === "forgot" && <button className="text-button" onClick={() => setMode("login")}>로그인으로 돌아가기</button>}
        </section>
      </main>
    </div>
  );
}

function ClassCreateForm({ actor, busy, onSubmit }: { actor: TeacherActor; busy: boolean; onSubmit: (input: Record<string, string | number>) => Promise<void> }) {
  const [schoolYear, setSchoolYear] = useState(String(currentYear));
  const [grade, setGrade] = useState("");
  const [classNumber, setClassNumber] = useState("");
  const [displayName, setDisplayName] = useState("");
  return (
    <section className="onboarding-card">
      <div className="onboarding-step">{actor.registration_mode === "open" ? "3 / 3" : "5 / 5"}</div><p className="eyebrow">학급 만들기</p><h1>우리 반을 알려 주세요</h1><p>학생에게는 학교·학년·반만 보여요. 내부에서는 학급마다 안전한 고유 번호를 따로 사용합니다.</p>
      <div className="selected-school-summary"><School aria-hidden="true" /><div><small>{actor.school_pending ? "학교 확인 중" : "선택한 학교"}</small><strong>{actor.school_display_name}</strong><span>{actor.school_province_name} · {actor.school_level}</span></div></div>
      <form className="class-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ schoolYear: Number(schoolYear), grade: Number(grade), classNumber: Number(classNumber), displayName }); }}>
        <label>학년도<input type="number" min="2020" max="2100" value={schoolYear} onChange={(event) => setSchoolYear(event.target.value)} required /></label>
        <label>학년<select value={grade} onChange={(event) => setGrade(event.target.value)} required><option value="">선택</option>{[1,2,3,4,5,6].map((item) => <option key={item} value={item}>{item}학년</option>)}</select></label>
        <label>반<input type="number" min="1" max="30" value={classNumber} onChange={(event) => setClassNumber(event.target.value)} placeholder="예: 3" required /></label>
        <label className="wide">학급 표시 이름 <small>선택</small><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="예: 별빛반 (비워도 괜찮아요)" /></label>
        <button className="button button-primary button-large wide" disabled={busy}>{busy ? "만드는 중…" : "학급 만들고 학생 입력하기 →"}</button>
      </form>
    </section>
  );
}

function RosterEditor({ classId, onSaved, onCancel, existingStudentNumbers = [] }: {
  classId: string;
  onSaved: (cards: RegistrationCard[]) => void;
  onCancel?: () => void;
  existingStudentNumbers?: number[];
}) {
  const [rows, setRows] = useState<DraftStudent[]>(() => existingStudentNumbers.length
    ? [emptyDraft("")]
    : Array.from({ length: 5 }, (_, index) => emptyDraft(String(index + 1))));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeInput, setRangeInput] = useState("");
  const [rangeError, setRangeError] = useState("");
  const [rangeMessage, setRangeMessage] = useState("");
  const rangeInputRef = useRef<HTMLInputElement>(null);
  const rangeButtonRef = useRef<HTMLButtonElement>(null);
  const nameInputRefs = useRef(new Map<string, HTMLInputElement>());
  const focusFrameRef = useRef<number | null>(null);
  const initialRowsRef = useRef(rows);
  const validCount = rows.filter((row) => row.number.trim() && row.name.trim()).length;
  const duplicateNumbers = useMemo(() => rows.filter((row) => row.number.trim()).filter((row, index, source) => source.findIndex((other) => other.number === row.number) !== index).map((row) => row.number), [rows]);
  const existingNumberSet = useMemo(() => new Set(existingStudentNumbers), [existingStudentNumbers]);
  const rangePreview = useMemo(() => parseStudentNumberRanges(rangeInput, { maxCount: 60 }), [rangeInput]);

  useEffect(() => {
    if (!rangeOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => rangeInputRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [rangeOpen]);

  useEffect(() => {
    const initialRows = initialRowsRef.current;
    const firstBlankName = initialRows.find((row) => row.number.trim() && !row.name.trim());
    const frame = requestAnimationFrame(() => {
      if (firstBlankName) {
        nameInputRefs.current.get(firstBlankName.key)?.focus();
      } else {
        document.querySelector<HTMLInputElement>(`[data-roster-number="${initialRows[0]?.key}"]`)?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => () => {
    if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
  }, []);

  function focusName(key: string) {
    if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null;
      nameInputRefs.current.get(key)?.focus();
    });
  }

  function update(key: string, field: "number" | "name", value: string) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, [field]: value } : row));
  }
  function handleRosterKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number, field: "number" | "name") {
    // Enter and arrow keys can be used inside a Korean IME candidate list.
    // Do not move focus until that composition has finished.
    if (event.nativeEvent.isComposing) return;

    if (field === "number") {
      if (event.key !== "Enter") return;
      event.preventDefault();
      focusName(rows[index].key);
      return;
    }

    const movingBackward = event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey);
    const movingForward = event.key === "ArrowDown" || event.key === "Enter" || (event.key === "Tab" && !event.shiftKey);
    if (!movingBackward && !movingForward) return;

    const targetIndex = index + (movingBackward ? -1 : 1);
    if (targetIndex >= 0 && targetIndex < rows.length) {
      event.preventDefault();
      focusName(rows[targetIndex].key);
      return;
    }

    // Keep the established Enter-to-add behavior, but prefill the number and
    // focus the new name so a teacher can continue typing in Korean.
    if (movingForward && event.key === "Enter") {
      event.preventDefault();
      const next = emptyDraft(String((Number(rows.at(-1)?.number) || rows.length) + 1));
      setRows((current) => [...current, next]);
      focusName(next.key);
      return;
    }

    // At the last name, Tab continues to the next roster action rather than
    // stopping at the per-row delete control.
    if (movingForward && event.key === "Tab") {
      event.preventDefault();
      rangeButtonRef.current?.focus();
    }
  }

  function openRangeDialog() {
    setRangeError("");
    setRangeMessage("");
    setRangeOpen(true);
  }

  function closeRangeDialog() {
    setRangeOpen(false);
    setRangeError("");
    requestAnimationFrame(() => rangeButtonRef.current?.focus());
  }

  function handleRangeDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeRangeDialog();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getAttribute("aria-hidden") !== "true");
    if (!focusable.length) {
      event.preventDefault();
      return;
    }

    const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
    if (activeIndex === -1 || (event.shiftKey && activeIndex === 0) || (!event.shiftKey && activeIndex === focusable.length - 1)) {
      event.preventDefault();
      (event.shiftKey ? focusable.at(-1) : focusable[0])?.focus();
    }
  }

  function applyNumberRanges() {
    setRangeError("");
    const parsed = parseStudentNumberRanges(rangeInput, { maxCount: 60 });
    if (!parsed.ok) {
      setRangeError(parsed.error.message);
      return;
    }
    const conflicts = parsed.numbers.filter((number) => existingNumberSet.has(number));
    if (conflicts.length) {
      setRangeError(`${conflicts.join(", ")}번 학생은 이미 우리 반 명단에 있어요. 해당 번호를 빼고 다시 입력해 주세요.`);
      return;
    }
    const currentNumbers = new Set(rows.flatMap((row) => {
      const number = Number(row.number);
      return Number.isInteger(number) && number >= 1 && number <= 99 ? [number] : [];
    }));
    const additions = parsed.numbers.flatMap((number) => currentNumbers.has(number)
      ? []
      : [emptyDraft(String(number))]);

    // Keep every existing row object and its order so names already being
    // entered cannot be lost or moved when a range is appended.
    const nextRows = [...rows, ...additions];
    const firstBlankName = nextRows.find((row) => row.number.trim() && !row.name.trim());
    setRows(nextRows);
    setRangeMessage(additions.length
      ? `${parsed.numbers.length}개 번호를 확인해 새 학생 행 ${additions.length}개를 추가했어요.`
      : "입력한 번호의 행이 이미 모두 준비되어 있어요.");
    setRangeInput("");
    setRangeOpen(false);
    if (firstBlankName) focusName(firstBlankName.key);
    else requestAnimationFrame(() => rangeButtonRef.current?.focus());
  }

  async function save() {
    setError("");
    const complete = rows.filter((row) => row.number.trim() || row.name.trim());
    if (!complete.length) return setError("학생을 한 명 이상 입력해 주세요.");
    if (complete.some((row) => !row.number.trim() || !row.name.trim())) return setError("번호나 이름이 빈 줄이 있어요.");
    if (duplicateNumbers.length) return setError(`${[...new Set(duplicateNumbers)].join(", ")}번이 두 번 입력되었어요.`);
    const existingConflicts = complete
      .map((row) => Number(row.number))
      .filter((number) => existingNumberSet.has(number));
    if (existingConflicts.length) return setError(`${existingConflicts.join(", ")}번 학생은 이미 우리 반 명단에 있어요.`);
    setBusy(true);
    try {
      const data = await postJson<{ students: Array<Student & { activation_url: string }> }>(`/api/classes/${classId}/students`, {
        students: complete.map((row) => ({ number: Number(row.number), name: row.name })),
      });
      onSaved(data.students);
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="panel roster-entry-panel">
      <div className="panel-heading"><div><p className="eyebrow">2 / 3 · 학생 명단</p><h2>{onCancel ? "추가할 학생을 입력해 주세요" : "번호와 이름을 차례로 입력해 주세요"}</h2><p>이름칸에서는 Tab·Enter·위아래 방향키로 이름칸만 연속 이동할 수 있어요. 같은 이름은 괜찮지만 번호는 겹치면 안 돼요.</p></div><div className="button-row"><span className="count-chip">{validCount}명 입력</span>{onCancel && <button className="text-button" onClick={onCancel}>취소</button>}</div></div>
      <div className="roster-entry-list">
        <div className="roster-entry-head"><span>번호</span><span>공식 이름</span><span /></div>
        {rows.map((row, index) => (
          <div className="roster-entry-row" key={row.key}>
            <input data-roster-number={row.key} inputMode="numeric" value={row.number} onChange={(event) => update(row.key, "number", event.target.value.replace(/\D/g, "").slice(0, 2))} onKeyDown={(event) => handleRosterKeyDown(event, index, "number")} aria-label={`${index + 1}번째 학생 번호`} />
            <input
              ref={(element) => {
                if (element) nameInputRefs.current.set(row.key, element);
                else nameInputRefs.current.delete(row.key);
              }}
              data-roster-name={row.key}
              value={row.name}
              onChange={(event) => update(row.key, "name", event.target.value)}
              onKeyDown={(event) => handleRosterKeyDown(event, index, "name")}
              placeholder="학생 이름"
              lang="ko"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-label={`${index + 1}번째 학생 이름`}
            />
            <button type="button" aria-label={`${row.number || index + 1}번 학생 행 지우기`} disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}>×</button>
          </div>
        ))}
      </div>
      <button ref={rangeButtonRef} className="add-row-button" type="button" onClick={openRangeDialog}>+ 학생 행 한꺼번에 추가</button>
      <Notice message={rangeMessage} tone="success" />
      <Notice message={error} tone="error" />
      <div className="panel-footer"><p>저장하면 학생마다 학급 운영 중 다시 쓸 수 있는 개인 QR이 만들어집니다.</p><button className="button button-primary button-large" disabled={busy} onClick={save}>{busy ? "계정을 만드는 중…" : `${validCount || "학생"}명 계정 만들고 QR 보기 →`}</button></div>
      {rangeOpen && (
        <div
          className="range-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeRangeDialog();
          }}
        >
          <section
            className="range-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="range-dialog-title"
            aria-describedby="range-dialog-description"
            onKeyDown={handleRangeDialogKeyDown}
          >
            <div className="range-dialog-heading">
              <div><p className="eyebrow">학생 행 빠른 추가</p><h2 id="range-dialog-title">번호를 범위로 입력해 주세요</h2></div>
              <button type="button" onClick={closeRangeDialog} aria-label="학생 행 추가 창 닫기">×</button>
            </div>
            <p id="range-dialog-description">띄어쓰기나 쉼표로 여러 범위를 구분할 수 있어요. 이미 입력한 이름과 행은 그대로 유지됩니다.</p>
            <label className="range-input-label">
              <span>학생 번호 또는 범위</span>
              <input
                ref={rangeInputRef}
                value={rangeInput}
                onChange={(event) => { setRangeInput(event.target.value); setRangeError(""); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyNumberRanges();
                  }
                }}
                placeholder="예: 1~13 51~63"
                autoComplete="off"
                aria-invalid={Boolean(rangeError)}
              />
            </label>
            <div className="range-example-list" aria-label="입력 예시">
              <button type="button" onClick={() => { setRangeInput("1~26"); setRangeError(""); }}>1~26</button>
              <button type="button" onClick={() => { setRangeInput("1~13 51~63"); setRangeError(""); }}>1~13 51~63</button>
              <button type="button" onClick={() => { setRangeInput("1, 3, 5~10"); setRangeError(""); }}>1, 3, 5~10</button>
            </div>
            {rangeInput.trim() && rangePreview.ok && (
              <p className="range-preview" role="status"><CheckCircle2 aria-hidden="true" />{rangePreview.numbers.length}개 번호: {compactNumberList(rangePreview.numbers)}</p>
            )}
            <Notice message={rangeError} tone="error" />
            <div className="range-dialog-actions">
              <button className="button button-light" type="button" onClick={closeRangeDialog}>취소</button>
              <button className="button button-primary" type="button" onClick={applyNumberRanges}>학생 행 추가</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function compactNumberList(numbers: number[]) {
  if (numbers.length <= 14) return numbers.join(", ");
  return `${numbers.slice(0, 7).join(", ")} … ${numbers.slice(-5).join(", ")}`;
}

function StudentTable({ classId, students, busy, onBusy, onError, onMessage, onCards, onReload }: {
  classId: string;
  students: Student[]; busy: boolean; onBusy: (value: boolean) => void; onError: (value: string) => void;
  onMessage: (value: string) => void; onCards: (cards: RegistrationCard[]) => void; onReload: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNumber, setEditNumber] = useState("");
  const [editName, setEditName] = useState("");
  const [financeBlock, setFinanceBlock] = useState<{
    studentId: string;
    kind: "request" | "deposit" | "stock";
  } | null>(null);

  async function updateStudent(student: Student, input: Record<string, string | number>) {
    onBusy(true); onError("");
    try {
      await patchJson(`/api/students/${student.id}`, input);
      onMessage("학생 정보를 고쳤어요.");
      setEditingId(null);
      setFinanceBlock((current) => current?.studentId === student.id ? null : current);
      onReload();
    } catch (reason) {
      const blockedKind = reason instanceof ClientApiError
        ? {
          FINANCE_REQUEST_PENDING_STUDENT: "request",
          FINANCE_DEPOSIT_ACTIVE_STUDENT: "deposit",
          FINANCE_STOCK_ACTIVE_STUDENT: "stock",
        }[reason.code] as "request" | "deposit" | "stock" | undefined
        : undefined;
      if (blockedKind) {
        onError("");
        setFinanceBlock({ studentId: student.id, kind: blockedKind });
      } else {
        onError((reason as Error).message);
      }
    } finally { onBusy(false); }
  }
  async function issueCard(student: Student) {
    const isReplacement = student.status === "active" || student.status === "reset_required";
    if (isReplacement && !confirm(`${student.student_number}번 ${student.official_name} 학생에게 새 QR을 발급할까요? 이전 QR과 현재 로그인은 무효가 되지만 비밀번호는 그대로 유지됩니다.`)) return;
    onBusy(true); onError("");
    try {
      const data = await postJson<{ card: RegistrationCard }>(`/api/students/${student.id}/registration-token`, {});
      onCards([data.card]);
      onMessage(isReplacement
        ? "이전 QR과 현재 로그인을 무효로 하고 새 개인 QR을 만들었어요. 비밀번호를 잊었다면 재설정을 10분 허용해 주세요."
        : "이전 QR을 무효로 하고 새 개인 QR을 만들었어요.");
      onReload();
    } catch (reason) { onError((reason as Error).message); } finally { onBusy(false); }
  }

  async function allowExistingCardReset(student: Student) {
    if (!confirm(`${student.student_number}번 ${student.official_name} 학생이 기존 QR로 10분 안에 비밀번호를 다시 만들 수 있게 할까요?`)) return;
    onBusy(true); onError("");
    try {
      await postJson<{ expiresAt: number }>(`/api/students/${student.id}/qr-reset-grant`, {});
      onMessage("기존 QR의 비밀번호 재설정을 10분 동안 허용했어요. 학생에게 지금 QR을 스캔하라고 알려 주세요.");
    } catch (reason) { onError((reason as Error).message); } finally { onBusy(false); }
  }

  async function resetStudentPassword(student: Student) {
    if (!confirm(`${student.student_number}번 ${student.official_name} 학생의 비밀번호를 123456으로 초기화할까요? 현재 로그인은 종료되고, 학생은 새 비밀번호를 만든 뒤에만 서비스를 이용할 수 있습니다.`)) return;
    onBusy(true); onError("");
    try {
      await postJson(`/api/students/${student.id}/password-reset`, {});
      onMessage("비밀번호를 123456으로 초기화했어요. 학생은 로그인 후 새 비밀번호를 먼저 만들어야 합니다.");
      onReload();
    } catch (reason) { onError((reason as Error).message); } finally { onBusy(false); }
  }

  return (
    <div className="student-table-wrap">
      <table className="student-table"><thead><tr><th>번호</th><th>공식 이름</th><th>계정 상태</th><th>관리</th></tr></thead><tbody>
        {students.map((student) => (
          <Fragment key={student.id}>
          <tr className={student.status === "excluded" ? "muted-row" : ""}>
            <td>{editingId === student.id ? <input className="table-input number" inputMode="numeric" value={editNumber} onChange={(event) => setEditNumber(event.target.value.replace(/\D/g, ""))} aria-label={`${student.official_name} 학생 번호`} /> : <b>{student.student_number}</b>}</td>
            <td>{editingId === student.id ? <input className="table-input" value={editName} onChange={(event) => setEditName(event.target.value)} aria-label={`${student.official_name} 학생 이름`} /> : <strong>{student.official_name}</strong>}</td>
            <td><span className={`status-badge status-${student.status}`}>{friendlyStatus(student.status)}</span></td>
            <td><div className="table-actions">
              {editingId === student.id ? <><button onClick={() => updateStudent(student, { number: Number(editNumber), name: editName })}>저장</button><button onClick={() => setEditingId(null)}>취소</button></> : <>
                <button onClick={() => { setEditingId(student.id); setEditNumber(String(student.student_number)); setEditName(student.official_name); }}>수정</button>
                {(student.status === "active" || student.status === "reset_required") && <button onClick={() => resetStudentPassword(student)}>비밀번호 초기화</button>}
                {(student.status === "active" || student.status === "reset_required") && <button onClick={() => allowExistingCardReset(student)}>QR 재설정 10분 허용</button>}
                {student.status !== "excluded" && <button onClick={() => issueCard(student)}>{student.status === "active" ? "새 QR 발급" : "QR 재발급"}</button>}
                {student.status === "locked" ? <button onClick={() => updateStudent(student, { status: student.activated_at ? "active" : "pending" })}>잠금 해제</button> : student.status !== "excluded" && <button onClick={() => updateStudent(student, { status: "locked" })}>잠금</button>}
                {student.status !== "excluded" && <button className="danger-link" onClick={() => { if (confirm("학생을 명단에서 제외할까요? 기록은 삭제하지 않고 보존합니다.")) updateStudent(student, { status: "excluded" }); }}>제외</button>}
              </>}
            </div></td>
          </tr>
          {financeBlock?.studentId === student.id && (
            <tr className="student-finance-guidance-row">
              <td colSpan={4}>
                <div className="finance-action-notice warning" role="alert">
                  <Landmark aria-hidden="true" />
                  <div className="finance-action-notice-body">
                    <p>
                      <b>{student.official_name} 학생을 아직 제외하지 않았어요.</b>{" "}
                      {financeBlock.kind === "request"
                        ? "처리 대기 중인 입금·출금 신청을 먼저 승인하거나 거절해 주세요."
                        : financeBlock.kind === "deposit"
                          ? "진행 중인 예금을 약정 금액대로 먼저 정산해 주세요."
                          : "보유 중인 주식을 먼저 매도하거나 비상 청산해 주세요."}
                    </p>
                    <div className="button-row">
                      <a
                        className="button button-primary"
                        href={financeBlock.kind === "request"
                          ? `/finance?classId=${encodeURIComponent(classId)}#finance-operations`
                          : financeBlock.kind === "deposit"
                            ? `/finance?classId=${encodeURIComponent(classId)}&depositStudentId=${encodeURIComponent(student.id)}&depositOrigin=student_exclusion#finance-deposit-contracts`
                            : `/finance?classId=${encodeURIComponent(classId)}#finance-stocks`}
                      >
                        {financeBlock.kind === "request"
                          ? "입출금 신청 처리"
                          : financeBlock.kind === "deposit"
                            ? "예금 확인·정산"
                            : "주식 확인·청산"}
                      </a>
                      <button className="button button-light" type="button" onClick={() => setFinanceBlock(null)}>취소</button>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          )}
          </Fragment>
        ))}
      </tbody></table>
      {busy && <div className="table-busy">변경 내용을 안전하게 저장하고 있어요…</div>}
    </div>
  );
}

function LoadingScreen({ label }: { label: string }) { return <div className="loading-screen"><span className="loading-mark"><BookOpen aria-hidden="true" /></span><p>{label}</p></div>; }
function CenteredCard({ children }: { children: React.ReactNode }) { return <main className="centered-page"><section className="centered-card">{children}</section></main>; }
