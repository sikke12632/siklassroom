"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CircleAlert,
  Dices,
  RefreshCw,
  RotateCcw,
  UserCheck,
  UsersRound,
} from "lucide-react";
import { Logo } from "@/app/components/Logo";
import { Notice } from "@/app/components/Notice";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { api, postJson } from "@/lib/client-api";
import { chooseSecureCandidate } from "@/lib/local-job-assignment";
import { CalendarSetup, type CalendarState } from "./CalendarSetup";
import { WinnerCelebration, type Winner } from "./WinnerCelebration";

type Student = {
  id: string;
  student_number: number;
  official_name: string;
  status: string;
};

type AssignedStudent = {
  assignmentId: string;
  id: string;
  studentNumber: number;
  name: string;
  method: "random" | "manual";
  sequence: number;
};

type Job = {
  id: string;
  name: string;
  description: string;
  memberCapacity: number;
  assignedCount: number;
  remainingCapacity: number;
  assignedStudents: AssignedStudent[];
};

type Assignment = {
  id: string;
  class_job_id: string;
  student_id: string;
  assignment_method: "random" | "manual";
  assignment_sequence: number;
  assigned_at: number;
  job_name: string;
  student_number: number;
  student_name: string;
};

type AssignmentResponse = {
  class: {
    id: string;
    school_name: string;
    school_year: number;
    grade: number;
    class_number: number;
    display_name: string | null;
  };
  period: {
    year: number;
    month: number;
    monthValue: string;
    label: string;
    serverTime: CalendarState["serverTime"];
  };
  setupReady: boolean;
  setupStatus: "not_started" | "draft" | "completed";
  calendar: CalendarState;
  assignmentPeriodRecord: {
    id: string;
    mode: "random" | "manual" | null;
    status: "draft" | "confirmed";
    confirmed_at: number | null;
    revision: number;
  } | null;
  mode: "random" | "manual" | null;
  status: "not_started" | "draft" | "confirmed";
  revision: number;
  students: Student[];
  availableStudents: Student[];
  assignments: Assignment[];
  candidateStudentIdsByJob: Record<string, string[]>;
  preflight: {
    ready: boolean;
    errors: Array<{ code: string; message: string; action?: string }>;
    studentCount: number;
    seatCount: number;
    seatDifference: number;
    confirmed: boolean;
  };
  summary: {
    totalStudents: number;
    assignedCount: number;
    availableCount: number;
    remainingSeats: number;
    canComplete: boolean;
  };
  jobs: Job[];
};

type LocalAssignment = {
  localId: string;
  classJobId: string;
  studentId: string;
  method: "random" | "manual";
  sequence: number;
  assignedAt: number;
};

type LocalDraft = {
  version: 1;
  mode: "random" | "manual" | null;
  assignments: LocalAssignment[];
  candidateStudentIdsByJob: Record<string, string[]>;
  baseRevision: number;
  updatedAt: number;
};

function localDraftKey(classId: string) {
  return `job-classroom:first-assignment:${classId}:v1`;
}

function draftFromServer(data: AssignmentResponse): LocalDraft {
  return {
    version: 1,
    mode: data.mode,
    assignments: data.assignments.map((assignment) => ({
      localId: assignment.id,
      classJobId: assignment.class_job_id,
      studentId: assignment.student_id,
      method: assignment.assignment_method,
      sequence: assignment.assignment_sequence,
      assignedAt: assignment.assigned_at,
    })),
    candidateStudentIdsByJob: data.candidateStudentIdsByJob,
    baseRevision: data.revision,
    updatedAt: Date.now(),
  };
}

function readLocalDraft(classId: string): LocalDraft | null {
  try {
    const raw = window.localStorage.getItem(localDraftKey(classId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalDraft>;
    const assignmentIsValid = (item: unknown): item is LocalAssignment => {
      if (!item || typeof item !== "object") return false;
      const row = item as Partial<LocalAssignment>;
      return typeof row.localId === "string"
        && typeof row.classJobId === "string"
        && typeof row.studentId === "string"
        && (row.method === "random" || row.method === "manual")
        && Number.isInteger(row.sequence)
        && typeof row.assignedAt === "number";
    };
    if (
      parsed.version !== 1
      || (parsed.mode !== null && parsed.mode !== "random" && parsed.mode !== "manual")
      || !Number.isInteger(parsed.baseRevision)
      || !Array.isArray(parsed.assignments)
      || !parsed.assignments.every(assignmentIsValid)
      || !parsed.candidateStudentIdsByJob
      || typeof parsed.candidateStudentIdsByJob !== "object"
      || !Object.values(parsed.candidateStudentIdsByJob).every(
        (ids) => Array.isArray(ids) && ids.every((id) => typeof id === "string"),
      )
    ) return null;
    return parsed as LocalDraft;
  } catch {
    return null;
  }
}

function writeLocalDraft(classId: string, draft: LocalDraft | null) {
  try {
    if (draft) {
      window.localStorage.setItem(localDraftKey(classId), JSON.stringify(draft));
    } else {
      window.localStorage.removeItem(localDraftKey(classId));
    }
  } catch {}
}

function applyLocalDraft(server: AssignmentResponse, draft: LocalDraft): AssignmentResponse {
  if (server.status === "confirmed") return server;
  const studentById = new Map(server.students.map((student) => [student.id, student]));
  const jobById = new Map(server.jobs.map((job) => [job.id, job]));
  const usedStudents = new Set<string>();
  const jobCounts = new Map<string, number>();
  const validDrafts = [...draft.assignments]
    .sort((a, b) => a.sequence - b.sequence)
    .filter((assignment) => {
      const job = jobById.get(assignment.classJobId);
      if (!job || !studentById.has(assignment.studentId) || usedStudents.has(assignment.studentId)) return false;
      const count = jobCounts.get(job.id) ?? 0;
      if (count >= job.memberCapacity) return false;
      usedStudents.add(assignment.studentId);
      jobCounts.set(job.id, count + 1);
      return true;
    });
  const assignments: Assignment[] = validDrafts.map((assignment) => {
    const student = studentById.get(assignment.studentId)!;
    const job = jobById.get(assignment.classJobId)!;
    return {
      id: assignment.localId,
      class_job_id: job.id,
      student_id: student.id,
      assignment_method: assignment.method,
      assignment_sequence: assignment.sequence,
      assigned_at: assignment.assignedAt,
      job_name: job.name,
      student_number: student.student_number,
      student_name: student.official_name,
    };
  });
  const byJob = new Map<string, Assignment[]>();
  for (const assignment of assignments) {
    const rows = byJob.get(assignment.class_job_id) ?? [];
    rows.push(assignment);
    byJob.set(assignment.class_job_id, rows);
  }
  const availableStudents = server.students.filter((student) => !usedStudents.has(student.id));
  const availableIds = new Set(availableStudents.map((student) => student.id));
  const candidateStudentIdsByJob = Object.fromEntries(
    server.jobs.map((job) => [
      job.id,
      [...new Set(draft.candidateStudentIdsByJob[job.id] ?? [])].filter((id) => availableIds.has(id)),
    ]),
  );
  const seatCount = server.jobs.reduce((sum, job) => sum + job.memberCapacity, 0);
  const remainingSeats = Math.max(0, seatCount - assignments.length);
  const canComplete = server.preflight.errors.length === 0
    && server.students.length > 0
    && assignments.length === server.students.length
    && remainingSeats === 0;
  return {
    ...server,
    mode: draft.mode,
    status: draft.mode || assignments.length ? "draft" : server.status,
    assignments,
    availableStudents,
    candidateStudentIdsByJob,
    summary: {
      totalStudents: server.students.length,
      assignedCount: assignments.length,
      availableCount: availableStudents.length,
      remainingSeats,
      canComplete,
    },
    jobs: server.jobs.map((job) => {
      const assigned = byJob.get(job.id) ?? [];
      return {
        ...job,
        assignedCount: assigned.length,
        remainingCapacity: Math.max(0, job.memberCapacity - assigned.length),
        assignedStudents: assigned.map((assignment) => ({
          assignmentId: assignment.id,
          id: assignment.student_id,
          studentNumber: assignment.student_number,
          name: assignment.student_name,
          method: assignment.assignment_method,
          sequence: assignment.assignment_sequence,
        })),
      };
    }),
  };
}

function classLabel(classRoom: AssignmentResponse["class"] | null) {
  if (!classRoom) return "우리 반";
  return classRoom.display_name
    || `${classRoom.school_name} ${classRoom.grade}학년 ${classRoom.class_number}반`;
}

function SetupProgress({ data }: { data: AssignmentResponse }) {
  const steps = [
    { label: "학생 명단", done: data.students.length > 0 },
    { label: "직업 만들기", done: data.setupReady },
    { label: "달력 설정", done: data.calendar.saved },
    { label: "첫 직업 배정", done: data.status === "confirmed", current: data.calendar.saved && data.status !== "confirmed" },
    { label: "설정 완료", done: data.status === "confirmed" },
  ];
  return (
    <nav className="assignment-setup-progress" aria-label="초기 설정 진행 단계">
      {steps.map((step, index) => (
        <div key={step.label} className={step.done ? "done" : step.current ? "current" : ""}>
          <span>{step.done ? <Check aria-hidden="true" /> : index + 1}</span>
          <b>{step.label}</b>
        </div>
      ))}
    </nav>
  );
}

export function InitialJobAssignmentPortal({ classId }: { classId: string }) {
  const [serverData, setServerData] = useState<AssignmentResponse | null>(null);
  const [localDraft, setLocalDraft] = useState<LocalDraft | null>(null);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [manualStudentIds, setManualStudentIds] = useState<string[]>([]);
  const [showCalendar, setShowCalendar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [winner, setWinner] = useState<Winner | null>(null);
  const [drawJob, setDrawJob] = useState<string | null>(null);
  const [winnerCandidates, setWinnerCandidates] = useState<string[]>([]);
  const selectedJobRef = useRef("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const next = await api<AssignmentResponse>(`/api/classes/${classId}/job-assignments`);
      if (next.status === "confirmed") {
        writeLocalDraft(classId, null);
        setLocalDraft(null);
        setServerData(next);
        return;
      }
      const stored = readLocalDraft(classId);
      const draft = stored?.baseRevision === next.revision ? stored : draftFromServer(next);
      if (stored && stored.baseRevision !== next.revision) {
        setMessage("다른 화면의 변경을 반영해 로컬 초안을 최신 서버 상태로 다시 시작했어요.");
      }
      writeLocalDraft(classId, draft);
      setLocalDraft(draft);
      setServerData(next);
      const view = applyLocalDraft(next, draft);
      const selected = view.jobs.find((job) => job.id === selectedJobRef.current && job.remainingCapacity > 0);
      const nextJobId = selected?.id
        ?? view.jobs.find((job) => job.remainingCapacity > 0)?.id
        ?? view.jobs[0]?.id
        ?? "";
      selectedJobRef.current = nextJobId;
      setSelectedJobId(nextJobId);
      setManualStudentIds([]);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }, [classId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      api<{ serverTime: CalendarState["serverTime"] }>("/api/time")
        .then(({ serverTime }) => setServerData((current) => current
          ? { ...current, calendar: { ...current.calendar, serverTime } }
          : current))
        .catch(() => {});
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const data = useMemo(
    () => serverData && localDraft ? applyLocalDraft(serverData, localDraft) : serverData,
    [localDraft, serverData],
  );
  const selectedJob = useMemo(
    () => data?.jobs.find((job) => job.id === selectedJobId) ?? null,
    [data, selectedJobId],
  );
  const candidateIds = localDraft?.candidateStudentIdsByJob[selectedJobId] ?? [];

  function persistDraft(next: LocalDraft) {
    const updated = { ...next, updatedAt: next.updatedAt + 1 };
    setLocalDraft(updated);
    writeLocalDraft(classId, updated);
  }

  function setCandidates(next: string[]) {
    if (!localDraft || !selectedJobId) return;
    persistDraft({
      ...localDraft,
      candidateStudentIdsByJob: {
        ...localDraft.candidateStudentIdsByJob,
        [selectedJobId]: [...new Set(next)],
      },
    });
  }

  function toggleCandidate(studentId: string) {
    const next = candidateIds.includes(studentId)
      ? candidateIds.filter((id) => id !== studentId)
      : [...candidateIds, studentId];
    setCandidates(next);
  }

  function toggleManualStudent(studentId: string) {
    if (!selectedJob) return;
    if (manualStudentIds.includes(studentId)) {
      setManualStudentIds((current) => current.filter((id) => id !== studentId));
      return;
    }
    if (manualStudentIds.length >= selectedJob.remainingCapacity) {
      setError(`${selectedJob.name}의 남은 정원은 ${selectedJob.remainingCapacity}명입니다.`);
      return;
    }
    setError("");
    setManualStudentIds((current) => [...current, studentId]);
  }

  function chooseMode(mode: "random" | "manual") {
    if (!localDraft) return;
    setError("");
    persistDraft({ ...localDraft, mode });
    setMessage(mode === "random"
      ? "희망자 추첨 방식을 이 브라우저에 임시 저장했어요."
      : "직접 배정 방식을 이 브라우저에 임시 저장했어요.");
  }

  function drawRandom() {
    if (!data || !localDraft || !selectedJob || !candidateIds.length) return;
    const candidates = data.availableStudents.filter((student) => candidateIds.includes(student.id));
    if (!candidates.length) return;
    const selectedStudent = chooseSecureCandidate(candidates);
    const candidateNames = candidates.map((student) => student.official_name);
    const nextSequence = Math.max(0, ...localDraft.assignments.map((assignment) => assignment.sequence)) + 1;
    const assignment: LocalAssignment = {
      localId: `local:${crypto.randomUUID()}`,
      classJobId: selectedJob.id,
      studentId: selectedStudent.id,
      method: "random",
      sequence: nextSequence,
      assignedAt: data.calendar.serverTime.epochMs + nextSequence,
    };
    const candidateStudentIdsByJob = Object.fromEntries(
      Object.entries(localDraft.candidateStudentIdsByJob).map(([jobId, ids]) => [
        jobId,
        ids.filter((id) => id !== selectedStudent.id),
      ]),
    );
    persistDraft({
      ...localDraft,
      assignments: [...localDraft.assignments, assignment],
      candidateStudentIdsByJob,
    });
    setWinnerCandidates(candidateNames);
    setDrawJob(selectedJob.name);
    setError("");
    setWinner({
      name: selectedStudent.official_name,
      number: selectedStudent.student_number,
      job: selectedJob.name,
    });
    setMessage(`${candidates.length}명의 희망자 중 한 명을 브라우저 내장 난수로 뽑아 로컬 초안에 저장했어요.`);
  }

  function assignManual() {
    if (!data || !localDraft || !selectedJob || !manualStudentIds.length) return;
    const baseSequence = Math.max(0, ...localDraft.assignments.map((assignment) => assignment.sequence));
    const assignments = manualStudentIds.map((studentId, index): LocalAssignment => ({
      localId: `local:${crypto.randomUUID()}`,
      classJobId: selectedJob.id,
      studentId,
      method: "manual",
      sequence: baseSequence + index + 1,
      assignedAt: data.calendar.serverTime.epochMs + baseSequence + index + 1,
    }));
    persistDraft({ ...localDraft, assignments: [...localDraft.assignments, ...assignments] });
    setError("");
    setMessage(`${manualStudentIds.length}명을 ${selectedJob.name}에 배정해 이 브라우저에 임시 저장했어요.`);
    setManualStudentIds([]);
  }

  function removeAssignment(assignment: Assignment) {
    if (!localDraft) return;
    if (!confirm(`${assignment.student_number}번 ${assignment.student_name} 학생의 ${assignment.job_name} 배정을 취소할까요? 학생과 자리가 모두 복구됩니다.`)) return;
    setError("");
    persistDraft({
      ...localDraft,
      assignments: localDraft.assignments.filter((item) => item.localId !== assignment.id),
    });
    setMessage("로컬 초안에서 배정을 취소했어요. 학생과 자리가 바로 복구됐습니다.");
  }

  async function completeAssignments() {
    if (!data?.summary.canComplete || !data.mode) return;
    if (!confirm(`${data.summary.totalStudents}명 모두의 첫 직업 배정을 확정할까요?\n확정하면 학생 화면에 직업이 공개되고 초기 설정이 완료됩니다.`)) return;
    setBusy(true);
    setError("");
    try {
      await postJson(`/api/classes/${classId}/job-assignments/complete`, {
        mode: data.mode,
        expectedRevision: data.revision,
        expectedCalendarRevision: data.calendar.revision,
        requestId: crypto.randomUUID(),
        assignments: data.assignments.map((assignment) => ({
          classJobId: assignment.class_job_id,
          studentId: assignment.student_id,
          method: assignment.assignment_method,
        })),
      });
      writeLocalDraft(classId, null);
      setLocalDraft(null);
      setMessage("첫 직업 배정을 확정했어요. 이제 학생 화면에 각자의 직업이 공개됩니다.");
      await load();
    } catch (reason) {
      setError((reason as Error).message);
      setMessage("서버 확정에 실패했지만 이 브라우저의 배정 초안은 그대로 보관했어요. 내용을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <main className="job-page job-loading">
        <Logo />
        <Notice message={error} tone="error" />
        {error
          ? <a className="button button-primary" href="/teacher">교사 대시보드로</a>
          : <p>달력과 첫 직업 배정 화면을 준비하고 있어요…</p>}
      </main>
    );
  }

  const lastRandom = [...data.assignments]
    .filter((assignment) => assignment.assignment_method === "random")
    .sort((a, b) => b.assignment_sequence - a.assignment_sequence)[0];
  const studentOrder = [...data.assignments].sort((a, b) => a.student_number - b.student_number);

  return (
    <div className="job-page assignment-page">
      <header className="job-topbar">
        <Logo compact />
        <div>
          <strong>{classLabel(data.class)}</strong>
          <span>달력 · 첫 직업 배정</span>
        </div>
        <div className="job-topbar-actions">
          <ThemeToggle compact />
          <a className="button button-light" href="/teacher"><ArrowLeft aria-hidden="true" />대시보드</a>
        </div>
      </header>

      <main className="job-main assignment-main">
        <SetupProgress data={data} />
        <Notice message={error} tone="error" />
        <Notice message={message} tone="success" />

        {!data.setupReady ? (
          <section className="assignment-blocked panel">
            <span className="mode-icon" aria-hidden="true"><BriefcaseBusiness /></span>
            <p className="eyebrow">2단계 · 직업 만들기</p>
            <h2>우리 반 직업을 먼저 확정해 주세요</h2>
            <p>학생 수와 직업 자리 수를 정확히 맞춘 뒤 달력과 첫 배정을 시작할 수 있어요.</p>
            <a className="button button-primary" href={`/teacher/classes/${classId}/jobs`}>직업 설정으로 이동</a>
          </section>
        ) : showCalendar || !data.calendar.saved ? (
          <CalendarSetup
            classId={classId}
            initial={data.calendar}
            onCancel={data.calendar.saved ? () => setShowCalendar(false) : undefined}
            onSaved={() => {
              setShowCalendar(false);
              setMessage("달력을 저장했어요. 이제 첫 직업 배정 방식을 선택해 주세요.");
              load();
            }}
          />
        ) : data.preflight.errors.length ? (
          <section className="assignment-blocked panel preflight-blocked">
            <CircleAlert aria-hidden="true" />
            <p className="eyebrow">배정 전 확인</p>
            <h2>학생 수와 직업 자리 수를 맞춰 주세요</h2>
            {data.preflight.errors.map((item) => <p key={item.code}>{item.message}</p>)}
            <div className="button-row">
              <a className="button button-primary" href={`/teacher/classes/${classId}/jobs`}>직업 설정으로 돌아가기</a>
              <button className="button button-light" onClick={() => setShowCalendar(true)}>달력 다시 보기</button>
            </div>
          </section>
        ) : !data.mode && data.status !== "confirmed" ? (
          <section className="assignment-mode-choice">
            <div>
              <p className="eyebrow">4단계 · 첫 직업 배정</p>
              <h1>첫 직업을 어떻게 배정할까요?</h1>
              <p>선택과 배정은 이 브라우저에 자동 저장되고, 마지막 확정 때만 서버로 전송됩니다.</p>
            </div>
            <div className="assignment-mode-cards">
              <button disabled={busy} onClick={() => chooseMode("random")}>
                <span><Dices aria-hidden="true" /></span>
                <h2>희망자 중에서 랜덤으로 뽑기</h2>
                <p>손들기 등으로 희망자를 조사한 뒤, 화면에서 체크하고 한 명씩 추첨합니다.</p>
                <b>희망자 추첨 시작 →</b>
              </button>
              <button disabled={busy} onClick={() => chooseMode("manual")}>
                <span><UserCheck aria-hidden="true" /></span>
                <h2>선생님이 직접 배정하기</h2>
                <p>직업마다 맡을 학생을 직접 선택하고 정원 안에서 로컬 초안에 바로 반영합니다.</p>
                <b>직접 배정 시작 →</b>
              </button>
            </div>
            <div className="calendar-summary-strip">
              <CalendarDays aria-hidden="true" />
              <span><b>{data.calendar.firstJobStartDate} ~ {data.calendar.firstJobEndDate}</b> · 대한민국 표준시</span>
              <button onClick={() => setShowCalendar(true)}>달력 수정</button>
            </div>
          </section>
        ) : data.status === "confirmed" ? (
          <section className="assignment-confirmed">
            <div className="assignment-complete-hero panel">
              <span><Check aria-hidden="true" /></span>
              <p className="eyebrow">5단계 · 설정 완료</p>
              <h1>첫 직업 배정을 확정했어요</h1>
              <p>{data.summary.totalStudents}명 모두에게 직업이 공개됐습니다. 이후 변경은 운영 화면의 정식 절차에서 진행해 주세요.</p>
              <a className="button button-primary button-large" href="/teacher">교사 운영 화면으로</a>
            </div>
            <AssignmentReview assignments={studentOrder} jobs={data.jobs} />
          </section>
        ) : (
          <>
            <section className="assignment-heading">
              <div>
                <p className="eyebrow">4단계 · 첫 직업 배정</p>
                <h1>{data.mode === "random" ? "희망자 중 한 명씩 뽑아요" : "학생을 직접 배정해요"}</h1>
                <p>추첨과 배정은 즉시 로컬 저장되고, 최종 확정할 때 전체 배정표를 서버에서 한 번 검증합니다.</p>
              </div>
              <div className="assignment-calendar">
                <label><CalendarDays aria-hidden="true" />첫 직업 운영 기간</label>
                <strong>{data.calendar.firstJobStartDate} ~ {data.calendar.firstJobEndDate}</strong>
                <small><Check aria-hidden="true" />서버 확인: {data.calendar.serverTime.fullLabel}</small>
                <button onClick={() => {
                  if (data.assignments.length && !confirm("달력을 수정해도 이미 저장된 임시 배정은 유지됩니다. 달력 화면으로 이동할까요?")) return;
                  setShowCalendar(true);
                }}>달력 수정</button>
              </div>
            </section>

            <section className="assignment-status" aria-label="배정 현황">
              <div><UsersRound aria-hidden="true" /><span>전체 학생<strong>{data.summary.totalStudents}명</strong></span></div>
              <div><UserCheck aria-hidden="true" /><span>배정 완료<strong>{data.summary.assignedCount}명</strong></span></div>
              <div><RefreshCw aria-hidden="true" /><span>선택 가능<strong>{data.summary.availableCount}명</strong></span></div>
              <div className={data.summary.remainingSeats === 0 ? "complete" : ""}>
                <BriefcaseBusiness aria-hidden="true" /><span>남은 자리<strong>{data.summary.remainingSeats}개</strong></span>
              </div>
            </section>

            <div className="assignment-toolbar">
              <span>현재 방식: <b>{data.mode === "random" ? "희망자 추첨" : "직접 배정"}</b></span>
              <div>
                {lastRandom && <button disabled={busy} onClick={() => removeAssignment(lastRandom)}><RotateCcw />마지막 추첨 취소</button>}
                <button disabled={busy} onClick={() => chooseMode(data.mode === "random" ? "manual" : "random")}>배정 방식 변경</button>
                <button disabled={busy} onClick={load}><RefreshCw />학생·직업 새로고침</button>
              </div>
            </div>

            <section className="assignment-layout">
              <div className="assignment-workspace panel">
                <div className="assignment-step">
                  <span>1</span>
                  <div><h2>직업 선택</h2><p>상태와 남은 자리를 확인해 직업을 골라 주세요.</p></div>
                </div>
                <div className="assignment-job-grid">
                  {data.jobs.map((job) => (
                    <button
                      key={job.id}
                      className={[
                        selectedJobId === job.id ? "selected" : "",
                        job.remainingCapacity === 0 ? "filled" : job.assignedCount ? "partial" : "empty",
                      ].filter(Boolean).join(" ")}
                      disabled={job.remainingCapacity === 0 || busy}
                      onClick={() => {
                        selectedJobRef.current = job.id;
                        setSelectedJobId(job.id);
                        setManualStudentIds([]);
                        setError("");
                      }}
                    >
                      <span><BriefcaseBusiness aria-hidden="true" /></span>
                      <b>{job.name}</b>
                      <small>{job.assignedCount}/{job.memberCapacity}명 배정</small>
                      <em>{job.remainingCapacity ? `${job.remainingCapacity}자리 남음` : "배정 완료"}</em>
                    </button>
                  ))}
                </div>

                <div className="assignment-step">
                  <span>2</span>
                  <div>
                    <h2>{data.mode === "random" ? "희망자 체크" : "학생 선택"}</h2>
                    <p>{data.mode === "random"
                      ? "아직 미배정인 희망 학생을 체크해 브라우저에서 바로 한 명씩 추첨합니다."
                      : "남은 정원 안에서 여러 학생을 선택해 로컬 초안에 바로 반영할 수 있어요."}</p>
                  </div>
                </div>

                {data.mode === "random" && data.availableStudents.length > 0 && (
                  <div className="candidate-tools">
                    <span>선택 {candidateIds.length}명 · 이 브라우저에 자동 저장</span>
                    <button disabled={busy} onClick={() => setCandidates(data.availableStudents.map((student) => student.id))}>모두 선택</button>
                    <button disabled={busy} onClick={() => setCandidates([])}>모두 해제</button>
                  </div>
                )}

                {data.availableStudents.length ? (
                  <div className="assignment-student-grid">
                    {data.availableStudents.map((student) => {
                      const checked = data.mode === "random"
                        ? candidateIds.includes(student.id)
                        : manualStudentIds.includes(student.id);
                      return (
                        <label key={student.id} className={checked ? "selected" : ""}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={busy || !selectedJob}
                            onChange={() => data.mode === "random"
                              ? toggleCandidate(student.id)
                              : toggleManualStudent(student.id)}
                          />
                          <span>{student.student_number}</span>
                          <b title={student.official_name}>{student.official_name}</b>
                          <Check aria-hidden="true" />
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="assignment-empty">
                    <Check aria-hidden="true" />
                    <h3>모든 학생의 첫 직업을 배정했어요</h3>
                    <p>배정표를 검토한 뒤 최종 확정해 주세요.</p>
                  </div>
                )}

                <div className="assignment-action">
                  <span>{selectedJob
                    ? `${selectedJob.name} · ${selectedJob.remainingCapacity}자리 남음`
                    : "남은 자리가 있는 직업을 선택해 주세요"}</span>
                  {data.mode === "random" ? (
                    <button
                      className="button button-primary button-large"
                      disabled={busy || !selectedJob || candidateIds.length === 0 || selectedJob.remainingCapacity === 0}
                      onClick={drawRandom}
                    >
                      <Dices aria-hidden="true" />
                      {candidateIds.length ? `바로 추첨 · 희망자 ${candidateIds.length}명` : "희망자를 선택해 주세요"}
                    </button>
                  ) : (
                    <button
                      className="button button-primary button-large"
                      disabled={busy || !selectedJob || manualStudentIds.length === 0 || manualStudentIds.length > selectedJob.remainingCapacity}
                      onClick={assignManual}
                    >
                      <UserCheck aria-hidden="true" />
                      {`로컬 배정 적용 · ${manualStudentIds.length}명`}
                    </button>
                  )}
                </div>
              </div>

              <aside className="assignment-roster panel">
                <div>
                  <p className="eyebrow">이 브라우저의 임시 배정표</p>
                  <h2>직업별 배정</h2>
                  <p>새로고침해도 유지되며, 확정 전에는 서버로 전송되지 않아요.</p>
                </div>
                {data.jobs.map((job) => (
                  <section key={job.id}>
                    <header>
                      <span><BriefcaseBusiness aria-hidden="true" /></span>
                      <div><b>{job.name}</b><small>{job.assignedCount}/{job.memberCapacity}명</small></div>
                    </header>
                    {job.assignedStudents.length ? (
                      <ul>
                        {job.assignedStudents.map((student) => (
                          <li key={student.assignmentId}>
                            <span><b>{student.studentNumber}번</b> {student.name}<small>{student.method === "random" ? "추첨" : "직접"}</small></span>
                            <button
                              aria-label={`${student.name} 학생 배정 취소`}
                              disabled={busy}
                              onClick={() => {
                                const assignment = data.assignments.find((item) => item.id === student.assignmentId);
                                if (assignment) removeAssignment(assignment);
                              }}
                            ><RotateCcw aria-hidden="true" />취소</button>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="unassigned-job">아직 배정된 학생이 없어요.</p>}
                  </section>
                ))}
              </aside>
            </section>

            {data.summary.assignedCount > 0 && (
              <section className="assignment-final-review panel">
                <div>
                  <p className="eyebrow">최종 확인</p>
                  <h2>학생 번호순 배정표</h2>
                  <p>전체 배정표를 서버에서 한 번 검증해 저장합니다. 미배정 학생과 남은 자리가 모두 0이어야 해요.</p>
                </div>
                <div className="student-assignment-list">
                  {studentOrder.map((assignment) => (
                    <span key={assignment.id}><b>{assignment.student_number}번 {assignment.student_name}</b><small>{assignment.job_name}</small></span>
                  ))}
                </div>
                <button
                  className="button button-primary button-large"
                  disabled={busy || !data.summary.canComplete}
                  onClick={completeAssignments}
                >
                  <Check aria-hidden="true" />
                  {data.summary.canComplete
                    ? `전체 배정 확정·서버 저장 · ${data.summary.totalStudents}명`
                    : `미배정 ${data.summary.availableCount}명 · 남은 자리 ${data.summary.remainingSeats}개`}
                </button>
              </section>
            )}
          </>
        )}
      </main>
      {drawJob && (
        <WinnerCelebration
          winner={winner}
          job={drawJob}
          candidateNames={winnerCandidates}
          onClose={() => {
            setDrawJob(null);
            setWinner(null);
          }}
        />
      )}
    </div>
  );
}

function AssignmentReview({ assignments, jobs }: { assignments: Assignment[]; jobs: Job[] }) {
  return (
    <div className="assignment-review-grid">
      <section className="panel">
        <p className="eyebrow">학생 번호순</p>
        <h2>학생별 배정표</h2>
        <div className="student-assignment-list">
          {assignments.map((assignment) => (
            <span key={assignment.id}><b>{assignment.student_number}번 {assignment.student_name}</b><small>{assignment.job_name}</small></span>
          ))}
        </div>
      </section>
      <section className="panel">
        <p className="eyebrow">직업별</p>
        <h2>직업별 배정표</h2>
        {jobs.map((job) => (
          <div className="confirmed-job-row" key={job.id}>
            <b>{job.name}</b>
            <span>{job.assignedStudents.map((student) => `${student.studentNumber}번 ${student.name}`).join(", ")}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
