"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  CircleAlert,
  RefreshCw,
  RotateCcw,
  Shuffle,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Logo } from "@/app/components/Logo";
import { Notice } from "@/app/components/Notice";
import { ThemeToggle } from "@/app/components/ThemeToggle";

type JobGrade = "A" | "B" | "C";
type PreviousChoiceGrade = JobGrade | "D" | "NEW";

type ChoiceStudent = {
  studentId: string;
  studentNumber: number;
  studentName: string;
  previousJobName: string | null;
  previousGrade: PreviousChoiceGrade;
};

type ChoiceBoard = {
  classroom: {
    id: string;
    displayName: string | null;
    schoolName: string;
    schoolYear: number;
    grade: number;
    classNumber: number;
    status: string;
  };
  sourcePeriod: null | {
    id: string;
    assignmentYear: number;
    assignmentMonth: number;
    assignmentType: string;
    revision: number;
    confirmedAt: number | null;
    assignmentCount: number;
  };
  targetMonth: null | {
    year: number;
    month: number;
  };
  gradePreview: Array<{
    classJobId: string;
    name: string;
    studentCount: number;
    suggestedGrade: JobGrade;
  }>;
  evaluation: null | {
    id: string;
    sourcePeriodId: string;
    sourceYear: number;
    sourceMonth: number;
    status: "open" | "closed" | "finalized";
    revision: number;
    responseRevision: number;
    calculatedResponseRevision: number | null;
    algorithmVersion: string;
    openedAt: number;
    closedAt: number | null;
    finalizedAt: number | null;
    studentCountSnapshot: number;
    submittedCount: number;
    missingStudents: Array<{
      id: string;
      studentNumber: number | null;
      name: string;
    }>;
    rosterChanged: boolean;
    jobsChanged: boolean;
    cutoffTie: boolean;
    jobs: Array<{
      classJobId: string;
      name: string;
      description: string;
      sortOrder: number;
      responseCount: number;
      hardAverage: number | null;
      responsibilityAverage: number | null;
      consistencyAverage: number | null;
      burdenAverage: number | null;
      totalAverage: number | null;
      rank: number | null;
      recommendedGrade: JobGrade | null;
      finalGrade: JobGrade | null;
      cutoffTie: boolean;
    }>;
  };
  closure: null | {
    id: string;
    sourceYear: number;
    sourceMonth: number;
    evaluationSessionId?: string | null;
    evaluationRevision?: number | null;
  };
  session: null | {
    id: string;
    status: "draft" | "confirmed";
    revision: number;
    orderMode: string;
    order: ChoiceStudent[];
    studentCountSnapshot: number;
    jobSetupRevision: number;
  };
  students: Array<{
    id: string;
    studentNumber: number;
    studentName: string;
    status: string;
  }>;
  jobs: Array<{
    id: string;
    name: string;
    description: string;
    capacity: number;
    category: string;
    sortOrder: number;
  }>;
  confirmedAssignments: Array<{
    studentId: string;
    studentNumber: number;
    studentName: string;
    classJobId: string;
    jobName: string;
    assignmentSequence: number;
  }>;
  latestConfirmedSession: null | {
    id: string;
    closureId: string;
    targetYear: number;
    targetMonth: number;
    confirmedPeriodId: string | null;
    confirmedAt: number | null;
  };
  blockingReason: null | {
    code: string;
    message: string;
  };
};

type LocalChoiceDraft = {
  version: 1;
  sessionId: string;
  sessionRevision: number;
  jobSetupRevision: number;
  rosterSignature: string;
  jobSignature: string;
  assignments: Record<string, string>;
  history: string[];
};

type ApiPayload = {
  data?: unknown;
  error?: string;
  message?: string;
  code?: string;
};

class MonthlyChoiceError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

const gradeOptions: Array<{ value: JobGrade; label: string }> = [
  { value: "C", label: "C · 먼저 선택" },
  { value: "B", label: "B · 다음 선택" },
  { value: "A", label: "A · 마지막 선택" },
];

function monthLabel(month: ChoiceBoard["targetMonth"]) {
  return month ? `${month.year}년 ${month.month}월` : "다음 달";
}

function sourceLabel(source: ChoiceBoard["sourcePeriod"]) {
  return source ? `${source.assignmentYear}년 ${source.assignmentMonth}월` : "지난달";
}

function classLabel(board: ChoiceBoard) {
  return board.classroom.displayName
    || `${board.classroom.schoolName} ${board.classroom.grade}학년 ${board.classroom.classNumber}반`;
}

function previousGradeLabel(grade: PreviousChoiceGrade) {
  return grade === "NEW" ? "새 학생" : `${grade}등급`;
}

function formatError(reason: unknown) {
  if (reason instanceof MonthlyChoiceError) {
    return reason.code ? `${reason.message} (${reason.code})` : reason.message;
  }
  return reason instanceof Error ? reason.message : "잠시 문제가 생겼어요. 다시 시도해 주세요.";
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const raw = await response.json().catch(() => ({
    error: "응답을 읽을 수 없습니다.",
  })) as ApiPayload;
  if (!response.ok) {
    throw new MonthlyChoiceError(
      raw.error || raw.message || "잠시 문제가 생겼어요. 다시 시도해 주세요.",
      raw.code,
    );
  }
  if (raw && typeof raw === "object" && "data" in raw && raw.data !== undefined) {
    return raw.data as T;
  }
  return raw as T;
}

function post<T>(url: string, body: unknown) {
  return request<T>(url, { method: "POST", body: JSON.stringify(body) });
}

function storagePrefix(classId: string) {
  return `job_classroom_monthly_choice_v1:${classId}:`;
}

function storageKey(classId: string, session: NonNullable<ChoiceBoard["session"]>) {
  return `${storagePrefix(classId)}${session.id}:${session.revision}`;
}

function gradeDraftKey(
  classId: string,
  evaluation: NonNullable<ChoiceBoard["evaluation"]>,
) {
  return `job_classroom_job_grade_draft_v1:${classId}:${evaluation.id}:${evaluation.revision}`;
}

function evaluationGrades(classId: string, board: ChoiceBoard) {
  const evaluation = board.evaluation;
  const defaults = Object.fromEntries(
    evaluation?.jobs.map((item) => [
      item.classJobId,
      item.finalGrade ?? item.recommendedGrade ?? "C",
    ]) ?? board.gradePreview.map((item) => [item.classJobId, item.suggestedGrade]),
  ) as Record<string, JobGrade>;
  if (!evaluation || evaluation.status !== "closed") return defaults;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(gradeDraftKey(classId, evaluation)) || "null") as {
      grades?: Record<string, unknown>;
    } | null;
    const stored = parsed?.grades;
    if (
      !stored
      || Object.keys(stored).length !== evaluation.jobs.length
      || evaluation.jobs.some((job) => !["A", "B", "C"].includes(String(stored[job.classJobId])))
    ) {
      return defaults;
    }
    return Object.fromEntries(
      evaluation.jobs.map((job) => [job.classJobId, stored[job.classJobId] as JobGrade]),
    );
  } catch {
    return defaults;
  }
}

function rosterSignature(board: ChoiceBoard) {
  return board.students
    .map((student) => student.id)
    .sort()
    .join("|");
}

function jobSignature(board: ChoiceBoard) {
  return board.jobs
    .map((job) => `${job.id}:${job.capacity}`)
    .sort()
    .join("|");
}

function emptyDraft(board: ChoiceBoard): LocalChoiceDraft {
  const session = board.session;
  if (!session) throw new Error("선택 순서가 아직 준비되지 않았어요.");
  return {
    version: 1,
    sessionId: session.id,
    sessionRevision: session.revision,
    jobSetupRevision: session.jobSetupRevision,
    rosterSignature: rosterSignature(board),
    jobSignature: jobSignature(board),
    assignments: {},
    history: [],
  };
}

function clearStoredDrafts(classId: string, exceptKey?: string) {
  const prefix = storagePrefix(classId);
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(prefix) && key !== exceptKey) window.localStorage.removeItem(key);
  }
}

function restoreDraft(
  classId: string,
  board: ChoiceBoard,
): { draft: LocalChoiceDraft; warning: string } {
  const session = board.session;
  if (!session) return { draft: emptyDraft(board), warning: "" };
  const key = storageKey(classId, session);
  const fallback = emptyDraft(board);
  const staleKeys: string[] = [];
  const prefix = storagePrefix(classId);
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const storedKey = window.localStorage.key(index);
    if (storedKey?.startsWith(prefix) && storedKey !== key) staleKeys.push(storedKey);
  }
  staleKeys.forEach((storedKey) => window.localStorage.removeItem(storedKey));

  const raw = window.localStorage.getItem(key);
  if (!raw) {
    window.localStorage.setItem(key, JSON.stringify(fallback));
    return {
      draft: fallback,
      warning: staleKeys.length
        ? "학생 명단이나 선택 순서가 바뀌어 이전 브라우저 초안을 안전하게 초기화했어요."
        : "",
    };
  }

  try {
    const parsed = JSON.parse(raw) as LocalChoiceDraft;
    const metadataMatches = parsed.version === 1
      && parsed.sessionId === session.id
      && parsed.sessionRevision === session.revision
      && parsed.jobSetupRevision === session.jobSetupRevision
      && parsed.rosterSignature === rosterSignature(board)
      && parsed.jobSignature === jobSignature(board);
    const studentIds = new Set(board.students.map((student) => student.id));
    const jobIds = new Set(board.jobs.map((job) => job.id));
    const entries = Object.entries(parsed.assignments ?? {});
    const assignmentsValid = entries.every(
      ([studentId, classJobId]) => studentIds.has(studentId) && jobIds.has(classJobId),
    );
    const counts = entries.reduce<Record<string, number>>((result, [, classJobId]) => {
      result[classJobId] = (result[classJobId] ?? 0) + 1;
      return result;
    }, {});
    const capacitiesValid = board.jobs.every(
      (job) => (counts[job.id] ?? 0) <= job.capacity,
    );
    if (!metadataMatches || !assignmentsValid || !capacitiesValid) {
      throw new Error("STALE_LOCAL_DRAFT");
    }
    return {
      draft: {
        ...parsed,
        history: (parsed.history ?? []).filter((studentId) => studentIds.has(studentId)),
      },
      warning: staleKeys.length
        ? "서버의 최신 선택 순서를 기준으로 이 브라우저 초안을 복원했어요."
        : "",
    };
  } catch {
    window.localStorage.setItem(key, JSON.stringify(fallback));
    return {
      draft: fallback,
      warning: "학생 명단·직업 정원·선택 순서가 달라져 이전 브라우저 초안을 안전하게 초기화했어요.",
    };
  }
}

export function MonthlyJobChoicePortal({ classId }: { classId: string }) {
  const [board, setBoard] = useState<ChoiceBoard | null>(null);
  const [grades, setGrades] = useState<Record<string, JobGrade>>({});
  const [draft, setDraft] = useState<LocalChoiceDraft | null>(null);
  const [currentStudentId, setCurrentStudentId] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const [prepareNextMonth, setPrepareNextMonth] = useState(false);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const next = await request<ChoiceBoard | { board: ChoiceBoard }>(
        `/api/classes/${classId}/monthly-job-choice`,
      );
      const nextBoard = "board" in next ? next.board : next;
      setBoard(nextBoard);
      setPrepareNextMonth(false);
      setGrades(evaluationGrades(classId, nextBoard));
      if (nextBoard.session?.status === "draft") {
        const restored = restoreDraft(classId, nextBoard);
        setDraft(restored.draft);
        setStorageWarning(restored.warning);
        const firstUnfinished = nextBoard.session.order.find(
          (student) => !restored.draft.assignments[student.studentId],
        );
        setCurrentStudentId(firstUnfinished?.studentId ?? "");
      } else {
        clearStoredDrafts(classId);
        setDraft(null);
        setCurrentStudentId("");
        setStorageWarning("");
      }
      setSelectedJobId("");
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(true), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const evaluation = board?.evaluation;
    if (!evaluation || evaluation.status !== "closed" || !Object.keys(grades).length) return;
    window.localStorage.setItem(
      gradeDraftKey(classId, evaluation),
      JSON.stringify({ grades, updatedAt: Date.now() }),
    );
  }, [board?.evaluation, classId, grades]);

  const saveDraft = useCallback((next: LocalChoiceDraft) => {
    if (!board?.session) return;
    setDraft(next);
    window.localStorage.setItem(storageKey(classId, board.session), JSON.stringify(next));
  }, [board, classId]);

  const orderedStudents = board?.session?.order ?? [];
  const assignments = useMemo(() => draft?.assignments ?? {}, [draft?.assignments]);
  const currentStudent = orderedStudents.find(
    (student) => student.studentId === currentStudentId && !assignments[student.studentId],
  ) ?? orderedStudents.find((student) => !assignments[student.studentId]) ?? null;
  const currentIndex = currentStudent
    ? orderedStudents.findIndex((student) => student.studentId === currentStudent.studentId)
    : -1;
  const unfinishedAfterCurrent = currentIndex < 0 ? [] : [
    ...orderedStudents.slice(currentIndex + 1),
    ...orderedStudents.slice(0, currentIndex),
  ].filter((student) => !assignments[student.studentId]);
  const nextStudent = unfinishedAfterCurrent[0] ?? null;
  const selectedJob = board?.jobs.find((job) => job.id === selectedJobId) ?? null;
  const jobCounts = useMemo(
    () => Object.values(assignments).reduce<Record<string, number>>((result, classJobId) => {
      result[classJobId] = (result[classJobId] ?? 0) + 1;
      return result;
    }, {}),
    [assignments],
  );
  const assignedCount = Object.keys(assignments).length;
  const remainingSeats = (board?.jobs ?? []).reduce(
    (total, job) => total + Math.max(0, job.capacity - (jobCounts[job.id] ?? 0)),
    0,
  );
  const rosterMismatch = Boolean(
    board?.session && board.session.studentCountSnapshot !== board.students.length,
  );
  const capacityExceeded = (board?.jobs ?? []).some(
    (job) => (jobCounts[job.id] ?? 0) > job.capacity,
  );
  const everyStudentAssigned = Boolean(
    board?.session
    && board.session.order.length === board.students.length
    && board.session.order.every((student) => assignments[student.studentId]),
  );
  const canComplete = everyStudentAssigned
    && !capacityExceeded
    && !rosterMismatch
    && remainingSeats === 0;

  function chooseNextStudent(afterStudentId: string, nextAssignments: Record<string, string>) {
    const index = orderedStudents.findIndex((student) => student.studentId === afterStudentId);
    const candidates = index < 0
      ? orderedStudents
      : [...orderedStudents.slice(index + 1), ...orderedStudents.slice(0, index)];
    return candidates.find((student) => !nextAssignments[student.studentId])?.studentId ?? "";
  }

  function confirmLocalChoice() {
    if (!board?.session || !draft || !currentStudent || !selectedJob) return;
    if (assignments[currentStudent.studentId]) {
      setError("이미 직업을 선택한 학생이에요.");
      return;
    }
    if ((jobCounts[selectedJob.id] ?? 0) >= selectedJob.capacity) {
      setError(`${selectedJob.name}은 남은 자리가 없어요.`);
      return;
    }
    const nextAssignments = {
      ...draft.assignments,
      [currentStudent.studentId]: selectedJob.id,
    };
    saveDraft({
      ...draft,
      assignments: nextAssignments,
      history: [...draft.history, currentStudent.studentId],
    });
    const nextStudentId = chooseNextStudent(currentStudent.studentId, nextAssignments);
    setCurrentStudentId(nextStudentId);
    setSelectedJobId("");
    setError("");
    setMessage(
      `${currentStudent.studentNumber}번 ${currentStudent.studentName} 학생이 ${selectedJob.name}을 선택했어요.${nextStudent ? ` 다음 학생을 확인해 주세요.` : ""}`,
    );
  }

  function undoLastChoice() {
    if (!draft?.history.length) return;
    const studentId = draft.history.at(-1);
    if (!studentId) return;
    const nextAssignments = { ...draft.assignments };
    delete nextAssignments[studentId];
    saveDraft({
      ...draft,
      assignments: nextAssignments,
      history: draft.history.slice(0, -1),
    });
    setCurrentStudentId(studentId);
    setSelectedJobId("");
    const student = orderedStudents.find((item) => item.studentId === studentId);
    setMessage(`${student?.studentName ?? "마지막 학생"}의 선택을 되돌렸어요.`);
  }

  async function closeAndStart() {
    if (!board?.sourcePeriod || board.evaluation?.status !== "finalized") return;
    setBusy(true);
    setError("");
    setMessage("");
    let closed = false;
    try {
      await post(
        `/api/classes/${classId}/monthly-job-choice/close`,
        {
          expectedSourcePeriodId: board.sourcePeriod.id,
        },
      );
      closed = true;
      await post(`/api/classes/${classId}/monthly-job-choice/start`, {});
      setMessage(`${monthLabel(board.targetMonth)} 직업 선택 순서를 만들었어요.`);
      await load();
    } catch (reason) {
      setError(formatError(reason));
      if (closed) await load();
    } finally {
      setBusy(false);
    }
  }

  async function openEvaluation() {
    if (!board?.sourcePeriod) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await post(`/api/classes/${classId}/job-evaluation/open`, {
        expectedSourcePeriodId: board.sourcePeriod.id,
        expectedSourcePeriodRevision: board.sourcePeriod.revision,
      });
      setMessage(`${sourceLabel(board.sourcePeriod)} 학생 직업평가를 열었어요.`);
      await load();
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function closeEvaluation() {
    if (!board?.evaluation || board.evaluation.status !== "open") return;
    const missing = board.evaluation.missingStudents.length;
    if (missing > 0 && !window.confirm(
      `아직 ${missing}명이 제출하지 않았어요. 현재 제출된 ${board.evaluation.submittedCount}명의 평가로 마감할까요?`,
    )) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await post(`/api/classes/${classId}/job-evaluation/close`, {
        evaluationId: board.evaluation.id,
        expectedRevision: board.evaluation.revision,
        expectedResponseRevision: board.evaluation.responseRevision,
        allowIncomplete: missing > 0,
      });
      setMessage("학생 평가를 마감하고 직업별 추천등급을 계산했어요.");
      await load();
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function finalizeEvaluation() {
    if (!board?.evaluation || board.evaluation.status !== "closed") return;
    if (!window.confirm("화면에 표시된 직업별 최종등급을 확정할까요? 확정 후에는 평가 결과를 바꿀 수 없어요.")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await post(`/api/classes/${classId}/job-evaluation/finalize`, {
        evaluationId: board.evaluation.id,
        expectedRevision: board.evaluation.revision,
        finalGrades: Object.fromEntries(
          board.evaluation.jobs.map((item) => [
            item.classJobId,
            grades[item.classJobId] ?? item.recommendedGrade ?? "C",
          ]),
        ),
      });
      setMessage("이번 달 직업의 최종등급을 확정했어요.");
      await load();
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function startAfterClosure() {
    setBusy(true);
    setError("");
    try {
      await post(`/api/classes/${classId}/monthly-job-choice/start`, {});
      await load();
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function shuffleOrder() {
    if (!board?.session || assignedCount > 0) return;
    setBusy(true);
    setError("");
    try {
      await post(
        `/api/classes/${classId}/monthly-job-choice/shuffle`,
        { expectedRevision: board.session.revision },
      );
      setMessage("같은 등급 학생들의 순서를 다시 섞었어요.");
      await load();
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function completeChoice() {
    if (!board?.session || !draft || !canComplete) return;
    if (!window.confirm(
      `${monthLabel(board.targetMonth)} 직업 선택 ${assignedCount}건을 최종 확정할까요?`,
    )) return;
    setBusy(true);
    setError("");
    try {
      await post(
        `/api/classes/${classId}/monthly-job-choice/complete`,
        {
          expectedRevision: board.session.revision,
          expectedJobSetupRevision: board.session.jobSetupRevision,
          requestId: crypto.randomUUID(),
          assignments: board.session.order.map((student) => ({
            studentId: student.studentId,
            classJobId: draft.assignments[student.studentId],
          })),
        },
      );
      window.localStorage.removeItem(storageKey(classId, board.session));
      setMessage(`${monthLabel(board.targetMonth)} 직업 선정을 확정했어요.`);
      await load();
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  }

  if (loading || !board) {
    return (
      <main className="job-page job-loading" aria-busy={loading || undefined}>
        <Logo />
        <Notice message={error} tone="error" />
        {error
          ? <div className="button-row">
              <button className="button button-primary" type="button" onClick={() => void load(true)}>다시 시도</button>
              <a className="button button-light" href="/teacher">교사 대시보드로</a>
            </div>
          : <p role="status">지난달 결과와 다음 달 선택 순서를 준비하고 있어요…</p>}
      </main>
    );
  }

  const recentConfirmationMatchesSource = Boolean(
    !board.session
    && !board.closure
    && !board.evaluation
    && board.sourcePeriod
    && board.latestConfirmedSession
    && board.latestConfirmedSession.targetYear === board.sourcePeriod.assignmentYear
    && board.latestConfirmedSession.targetMonth === board.sourcePeriod.assignmentMonth
    && board.confirmedAssignments.length > 0,
  );
  const topbarMonth = recentConfirmationMatchesSource && !prepareNextMonth
    ? {
        year: board.latestConfirmedSession!.targetYear,
        month: board.latestConfirmedSession!.targetMonth,
      }
    : board.targetMonth;

  const topbar = (
    <header className="job-topbar">
      <Logo compact />
      <div>
        <strong>{classLabel(board)}</strong>
        <span>{monthLabel(topbarMonth)} {recentConfirmationMatchesSource && !prepareNextMonth ? "확정 결과" : "직업 선정"}</span>
      </div>
      <div className="job-topbar-actions">
        <ThemeToggle compact />
        <a className="button button-light" href="/teacher">
          <ArrowLeft aria-hidden="true" />대시보드
        </a>
      </div>
    </header>
  );

  if (!board.sourcePeriod) {
    return (
      <div className="job-page monthly-choice-page">
        {topbar}
        <main className="job-main monthly-choice-main">
          <section className="panel monthly-choice-blocked">
            <span className="mode-icon" aria-hidden="true"><BriefcaseBusiness /></span>
            <p className="eyebrow">지난달 결과가 필요해요</p>
            <h1>첫 직업 배정을 먼저 확정해 주세요</h1>
            <p>확정된 첫 배정이 있어야 지난달 직업 등급을 정하고 다음 달 선택 순서를 만들 수 있어요.</p>
            <div className="button-row">
              <a className="button button-primary" href={`/teacher/classes/${classId}/job-assignments`}>
                첫 직업 배정으로
              </a>
              <a className="button button-light" href="/teacher">대시보드로</a>
            </div>
          </section>
        </main>
      </div>
    );
  }

  if (recentConfirmationMatchesSource && !prepareNextMonth) {
    const confirmedMonth = {
      year: board.latestConfirmedSession!.targetYear,
      month: board.latestConfirmedSession!.targetMonth,
    };
    const confirmedByJob = board.confirmedAssignments.reduce<Record<string, number>>(
      (result, assignment) => {
        result[assignment.classJobId] = (result[assignment.classJobId] ?? 0) + 1;
        return result;
      },
      {},
    );
    return (
      <div className="job-page monthly-choice-page">
        {topbar}
        <main className="job-main monthly-choice-main">
          <section className="panel monthly-confirmed-hero">
            <span aria-hidden="true"><Check /></span>
            <p className="eyebrow">최근 선정 완료</p>
            <h1>{monthLabel(confirmedMonth)} 직업을 확정했어요</h1>
            <p>{board.confirmedAssignments.length}명의 결과가 안전하게 저장되어 있어요.</p>
            <div className="button-row">
              <a className="button button-primary button-large" href="/teacher">교사 대시보드로</a>
              <button
                className="button button-light button-large"
                onClick={() => setPrepareNextMonth(true)}
              >
                그다음 달 준비하기
              </button>
            </div>
          </section>
          <section className="monthly-confirmed-grid">
            <div className="panel">
              <p className="eyebrow">직업별 결과</p>
              <h2>자리 배정</h2>
              <div className="monthly-confirmed-jobs">
                {board.jobs.map((job) => (
                  <span key={job.id}>
                    <b>{job.name}</b>
                    <small>{confirmedByJob[job.id] ?? 0}/{job.capacity}명</small>
                  </span>
                ))}
              </div>
            </div>
            <div className="panel">
              <p className="eyebrow">학생별 결과</p>
              <h2>선택 완료 학생</h2>
              <div className="monthly-confirmed-students">
                {board.confirmedAssignments.map((assignment) => (
                  <span key={assignment.studentId}>
                    <b>{assignment.studentNumber}번 {assignment.studentName}</b>
                    <small>{assignment.jobName}</small>
                  </span>
                ))}
              </div>
            </div>
          </section>
        </main>
      </div>
    );
  }

  if (!board.closure) {
    const evaluation = board.evaluation;
    const evaluationOpen = evaluation?.status === "open";
    const evaluationClosed = evaluation?.status === "closed";
    const evaluationFinalized = evaluation?.status === "finalized";
    const sortedEvaluationJobs = [...(evaluation?.jobs ?? [])].sort((left, right) => (
      (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER)
      || left.sortOrder - right.sortOrder
    ));
    return (
      <div className="job-page monthly-choice-page">
        {topbar}
        <main className="job-main monthly-choice-main">
          <Notice message={error} tone="error" />
          <Notice message={message} tone="success" />
          {!evaluationFinalized && board.blockingReason?.code !== "JOB_CAPACITY_MISMATCH" && (
            <Notice message={board.blockingReason?.message} tone="error" />
          )}
          <section className="monthly-prep-heading">
            <div>
              <p className="eyebrow">
                {!evaluation
                  ? "1단계 · 학생 직업평가 열기"
                  : evaluationOpen
                    ? "2단계 · 제출 확인과 평가 마감"
                    : "3단계 · 직업등급 검토와 순서 생성"}
              </p>
              <h1>
                {!evaluation
                  ? "학생들의 평가로 직업등급을 정해요"
                  : evaluationOpen
                    ? "제출 현황을 보고 평가를 마감해요"
                    : evaluationClosed
                      ? "추천등급을 검토하고 최종 확정해요"
                      : "평가와 최종등급이 준비됐어요"}
              </h1>
              <p>지난달 배정·학생 명단·직업 목록은 저장된 기록을 그대로 연결해 사용합니다.</p>
            </div>
            <div className="monthly-period-arrow" aria-label={`${sourceLabel(board.sourcePeriod)}에서 ${monthLabel(board.targetMonth)}로`}>
              <span><small>기준 결과</small><b>{sourceLabel(board.sourcePeriod)}</b></span>
              <ChevronRight aria-hidden="true" />
              <span><small>선정 대상</small><b>{monthLabel(board.targetMonth)}</b></span>
            </div>
          </section>

          <section className="monthly-prep-summary" aria-label="자동으로 불러온 운영 정보">
            <div><UsersRound aria-hidden="true" /><span>학생<strong>{evaluation?.studentCountSnapshot ?? board.students.length}명</strong></span></div>
            <div><BriefcaseBusiness aria-hidden="true" /><span>평가 직업<strong>{evaluation?.jobs.length ?? board.gradePreview.length}개</strong></span></div>
            <div><Check aria-hidden="true" /><span>제출 현황<strong>{evaluation ? `${evaluation.submittedCount}/${evaluation.studentCountSnapshot}명` : "열기 전"}</strong></span></div>
          </section>

          {!evaluation && (
            <section className="panel monthly-evaluation-start">
              <span className="mode-icon" aria-hidden="true"><UsersRound /></span>
              <div>
                <p className="eyebrow">학생들은 직업을 하나씩 평가해요</p>
                <h2>힘듦 · 책임감 · 꾸준함 · 개인 부담</h2>
                <p>각 항목을 1~5점으로 평가하면 직업별 평균과 A/B/C 추천등급이 자동으로 계산됩니다.</p>
              </div>
              <button
                className="button button-primary button-large"
                disabled={busy || !board.sourcePeriod || board.gradePreview.length === 0}
                onClick={openEvaluation}
              >
                <Check aria-hidden="true" />
                {busy ? "평가를 열고 있어요…" : `${sourceLabel(board.sourcePeriod)} 직업평가 열기`}
              </button>
            </section>
          )}

          {evaluationOpen && evaluation && (
            <section className="panel monthly-evaluation-status">
              <div className="monthly-evaluation-status-heading">
                <div>
                  <p className="eyebrow">실시간 제출 현황</p>
                  <h2>{evaluation.submittedCount}/{evaluation.studentCountSnapshot}명 제출</h2>
                  <p>학생은 로그인한 뒤 자기 화면에서 모든 직업을 평가할 수 있어요.</p>
                </div>
                <button className="button button-light" disabled={busy} onClick={() => load()}>
                  <RefreshCw aria-hidden="true" />최신 정보
                </button>
              </div>
              <div className="monthly-evaluation-meter" aria-label={`제출 ${evaluation.submittedCount}/${evaluation.studentCountSnapshot}명`}>
                <span style={{
                  width: `${evaluation.studentCountSnapshot
                    ? Math.round((evaluation.submittedCount / evaluation.studentCountSnapshot) * 100)
                    : 0}%`,
                }} />
              </div>
              <div className="monthly-missing-students">
                <b>{evaluation.missingStudents.length ? "아직 제출하지 않은 학생" : "모든 학생이 제출했어요"}</b>
                <div>
                  {evaluation.missingStudents.length
                    ? evaluation.missingStudents.map((student) => (
                      <span key={student.id}>
                        {student.studentNumber ? `${student.studentNumber}번 ` : ""}{student.name}
                      </span>
                    ))
                    : <span className="complete"><Check aria-hidden="true" />제출 완료</span>}
                </div>
              </div>
              {evaluation.rosterChanged && (
                <div className="monthly-stale-warning" role="alert">
                  <CircleAlert aria-hidden="true" />
                  <span>
                    <b>평가를 연 뒤 학생 명단이 달라졌어요.</b>
                    평가는 개설 당시 학생 명단을 기준으로 마감됩니다.
                  </span>
                </div>
              )}
              {evaluation.jobsChanged && (
                <div className="monthly-stale-warning" role="alert">
                  <CircleAlert aria-hidden="true" />
                  <span>
                    <b>평가를 연 뒤 우리 반 직업 설정이 달라졌어요.</b>
                    평가를 열 때 저장한 직업 목록과 결과는 그대로 보존됩니다. 다음 단계 전에 현재 직업 설정을 확인해 주세요.
                  </span>
                </div>
              )}
              <div className="monthly-prep-action">
                <span>{evaluation.missingStudents.length
                  ? "미제출 학생이 있어도 선생님 확인 후 현재 제출분으로 마감할 수 있습니다."
                  : "모든 학생이 제출했습니다. 평가를 마감하면 추천등급이 계산됩니다."}</span>
                <button
                  className="button button-primary button-large"
                  disabled={busy || evaluation.submittedCount === 0}
                  onClick={closeEvaluation}
                >
                  <Check aria-hidden="true" />
                  {busy ? "결과를 계산하고 있어요…" : "평가 마감하고 추천등급 계산"}
                </button>
              </div>
            </section>
          )}

          {(evaluationClosed || evaluationFinalized) && evaluation && (
            <section className="panel monthly-grade-panel">
              <div className="monthly-grade-intro">
                <div>
                  <p className="eyebrow">선택 순서 규칙</p>
                  <h2>C → B → A 순서 · 같은 등급은 자동 무작위</h2>
                  <p>총점 상위 3개 직업은 A, 4~8위는 B, 나머지는 C 추천등급입니다.</p>
                </div>
                <ol aria-label="직업 등급별 선택 순서">
                  {gradeOptions.map((option, index) => (
                    <li key={option.value}><b>{index + 1}</b><span>{option.label}</span></li>
                  ))}
                </ol>
              </div>
              {evaluation.rosterChanged && (
                <div className="monthly-stale-warning" role="alert">
                  <CircleAlert aria-hidden="true" />
                  <span>
                    <b>평가를 연 뒤 학생 명단이 달라졌어요.</b>
                    최종등급은 평가 당시 명단을 기준으로 보존되며, 다음 달 순서를 만들기 전 현재 명단을 다시 확인해야 합니다.
                  </span>
                </div>
              )}
              {evaluation.jobsChanged && (
                <div className="monthly-stale-warning" role="alert">
                  <CircleAlert aria-hidden="true" />
                  <span>
                    <b>평가를 연 뒤 우리 반 직업 설정이 달라졌어요.</b>
                    평가 당시 직업 결과는 보존됩니다. 다음 단계 전에 현재 직업 설정을 다시 확인해 주세요.
                  </span>
                </div>
              )}
              {evaluation.cutoffTie && (
                <div className="monthly-evaluation-tie" role="status">
                  <CircleAlert aria-hidden="true" />
                  <span><b>등급 경계에 동점 직업이 있어요.</b> 점수와 업무 내용을 보고 최종등급을 확인해 주세요.</span>
                </div>
              )}
              <div className="monthly-evaluation-results">
                {sortedEvaluationJobs.map((item) => (
                  <label key={item.classJobId} className={item.cutoffTie ? "has-tie" : ""}>
                    <span className="monthly-evaluation-rank">{item.rank ?? "-"}</span>
                    <span className="monthly-evaluation-job-name">
                      <b>{item.name}</b>
                      <small>{item.responseCount}명 평가 · 총점 {item.totalAverage?.toFixed(2) ?? "-"} / 20</small>
                    </span>
                    <span className="monthly-evaluation-metrics">
                      <small>힘듦 <b>{item.hardAverage?.toFixed(2) ?? "-"}</b></small>
                      <small>책임 <b>{item.responsibilityAverage?.toFixed(2) ?? "-"}</b></small>
                      <small>꾸준함 <b>{item.consistencyAverage?.toFixed(2) ?? "-"}</b></small>
                      <small>부담 <b>{item.burdenAverage?.toFixed(2) ?? "-"}</b></small>
                    </span>
                    <span className="monthly-evaluation-grade">
                      <small>추천 {item.recommendedGrade ?? "-"}등급</small>
                      <select
                        aria-label={`${item.name} 최종 직업 등급`}
                        disabled={evaluationFinalized}
                        value={grades[item.classJobId] ?? item.recommendedGrade ?? "C"}
                        onChange={(event) => setGrades((current) => ({
                          ...current,
                          [item.classJobId]: event.target.value as JobGrade,
                        }))}
                      >
                        {gradeOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </span>
                  </label>
                ))}
              </div>
              <div className="monthly-prep-action">
                <span>{evaluationFinalized
                  ? "최종등급이 평가 기록에 고정됐습니다. 동급 학생은 자동으로 무작위 추첨됩니다."
                  : "추천등급을 수정할 수 있으며, 최종 확정 뒤에는 평가 결과가 바뀌지 않습니다."}</span>
                {evaluationFinalized ? (
                  <button
                    className="button button-primary button-large"
                    disabled={busy || Boolean(board.blockingReason)}
                    onClick={closeAndStart}
                  >
                    <Shuffle aria-hidden="true" />
                    {busy ? "월마감과 순서를 준비하고 있어요…" : "지난달 마감하고 무작위 순서 만들기"}
                  </button>
                ) : (
                  <button
                    className="button button-primary button-large"
                    disabled={busy || sortedEvaluationJobs.length === 0}
                    onClick={finalizeEvaluation}
                  >
                    <Check aria-hidden="true" />
                    {busy ? "최종등급을 저장하고 있어요…" : "직업별 최종등급 확정"}
                  </button>
                )}
              </div>
            </section>
          )}

          {evaluationFinalized && board.blockingReason && (
            <Notice message={board.blockingReason.message} tone="error" />
          )}
        </main>
      </div>
    );
  }

  if (!board.session) {
    return (
      <div className="job-page monthly-choice-page">
        {topbar}
        <main className="job-main monthly-choice-main">
          <Notice message={error} tone="error" />
          <Notice message={board.blockingReason?.message} tone="error" />
          <section className="panel monthly-choice-blocked">
            <span className="mode-icon" aria-hidden="true"><Check /></span>
            <p className="eyebrow">지난달 마감 완료</p>
            <h1>{monthLabel(board.targetMonth)} 선택 순서를 만들 차례예요</h1>
            <p>지난달 마감 기록은 안전하게 저장됐습니다. 같은 정보를 다시 입력할 필요가 없어요.</p>
            <button
              className="button button-primary button-large"
              disabled={busy || Boolean(board.blockingReason)}
              onClick={startAfterClosure}
            >
              {busy ? "순서를 만들고 있어요…" : "선택 순서 만들고 교실 화면 열기"}
            </button>
          </section>
        </main>
      </div>
    );
  }

  if (board.session.status === "confirmed") {
    const studentById = new Map(board.students.map((student) => [student.id, student]));
    const jobById = new Map(board.jobs.map((job) => [job.id, job]));
    const confirmedByJob = board.confirmedAssignments.reduce<Record<string, number>>(
      (result, assignment) => {
        result[assignment.classJobId] = (result[assignment.classJobId] ?? 0) + 1;
        return result;
      },
      {},
    );
    return (
      <div className="job-page monthly-choice-page">
        {topbar}
        <main className="job-main monthly-choice-main">
          <Notice message={message} tone="success" />
          <section className="panel monthly-confirmed-hero">
            <span aria-hidden="true"><Check /></span>
            <p className="eyebrow">선정 완료</p>
            <h1>{monthLabel(board.targetMonth)} 직업을 확정했어요</h1>
            <p>{board.confirmedAssignments.length}명의 선택이 저장됐습니다. 학생 화면에도 확정된 직업이 표시돼요.</p>
            <a className="button button-primary button-large" href="/teacher">교사 대시보드로</a>
          </section>
          <section className="monthly-confirmed-grid">
            <div className="panel">
              <p className="eyebrow">직업별 결과</p>
              <h2>자리 배정</h2>
              <div className="monthly-confirmed-jobs">
                {board.jobs.map((job) => (
                  <span key={job.id}><b>{job.name}</b><small>{confirmedByJob[job.id] ?? 0}/{job.capacity}명</small></span>
                ))}
              </div>
            </div>
            <div className="panel">
              <p className="eyebrow">학생별 결과</p>
              <h2>선택 완료 학생</h2>
              <div className="monthly-confirmed-students">
                {board.confirmedAssignments.map((assignment) => {
                  const student = studentById.get(assignment.studentId);
                  const job = jobById.get(assignment.classJobId);
                  return (
                    <span key={assignment.studentId}>
                      <b>{student ? `${student.studentNumber}번 ${student.studentName}` : assignment.studentName}</b>
                      <small>{job?.name ?? "직업"}</small>
                    </span>
                  );
                })}
              </div>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const completedStudents = orderedStudents.filter((student) => assignments[student.studentId]);
  const selectedJobRemaining = selectedJob
    ? selectedJob.capacity - (jobCounts[selectedJob.id] ?? 0)
    : 0;

  return (
    <div className="job-page monthly-choice-page">
      {topbar}
      <main className="job-main monthly-choice-main">
        <section className="monthly-live-heading">
          <div>
            <p className="eyebrow">4단계 · 교실에서 한 명씩 선택</p>
            <h1>{monthLabel(board.targetMonth)} 직업 선정</h1>
            <p>선택은 이 브라우저에 즉시 저장되고, 모두 끝난 뒤 한 번만 서버로 전송됩니다.</p>
          </div>
          <div className="monthly-live-tools">
            <span>선택 순서: <b>{board.session.orderMode === "shuffled" ? "동급 자동 무작위" : "동급 순서 재추첨 필요"}</b></span>
            <button disabled={busy || assignedCount > 0} onClick={shuffleOrder}>
              <Shuffle aria-hidden="true" />동급 순서 다시 섞기
            </button>
            <button disabled={busy} onClick={() => load()}>
              <RefreshCw aria-hidden="true" />최신 정보
            </button>
          </div>
        </section>

        <Notice message={error} tone="error" />
        <Notice message={storageWarning} tone="info" />
        <div className="visually-hidden" aria-live="polite" aria-atomic="true">{message}</div>
        {rosterMismatch && (
          <div className="monthly-stale-warning" role="alert">
            <CircleAlert aria-hidden="true" />
            <span>
              <b>학생 명단이 선택 시작 당시와 달라졌어요.</b>
              대시보드에서 학생 명단과 다음 달 선택 세션을 다시 확인해 주세요.
            </span>
          </div>
        )}

        <section className="monthly-live-summary" aria-label="월별 직업 선정 현황">
          <div><UsersRound aria-hidden="true" /><span>전체 학생<strong>{orderedStudents.length}명</strong></span></div>
          <div><Check aria-hidden="true" /><span>선택 완료<strong>{assignedCount}명</strong></span></div>
          <div><UserRound aria-hidden="true" /><span>선택 대기<strong>{Math.max(0, orderedStudents.length - assignedCount)}명</strong></span></div>
          <div className={remainingSeats === 0 ? "complete" : ""}><BriefcaseBusiness aria-hidden="true" /><span>남은 자리<strong>{remainingSeats}개</strong></span></div>
        </section>

        <section className="monthly-live-grid">
          <aside className="monthly-turn-column">
            <div className="panel monthly-current-student" aria-live="polite" aria-atomic="true">
              <p className="eyebrow">현재 차례</p>
              {currentStudent ? (
                <>
                  <span className="monthly-student-number">{currentStudent.studentNumber}</span>
                  <h2>{currentStudent.studentName}</h2>
                  <div className="monthly-grade-badge">{previousGradeLabel(currentStudent.previousGrade)} 순서</div>
                  <p>지난달 직업 <b>{currentStudent.previousJobName || "기록 없음"}</b></p>
                  <small>가운데에서 원하는 직업을 고른 뒤 아래 확인 버튼을 눌러 주세요.</small>
                </>
              ) : (
                <div className="monthly-all-chosen">
                  <Check aria-hidden="true" />
                  <h2>모두 선택했어요</h2>
                  <p>아래에서 전체 배정표를 확정해 주세요.</p>
                </div>
              )}
            </div>
            <div className="panel monthly-next-student">
              <p className="eyebrow">다음 학생</p>
              {nextStudent
                ? <><b>{nextStudent.studentNumber}번 {nextStudent.studentName}</b><small>{previousGradeLabel(nextStudent.previousGrade)} · 지난달 {nextStudent.previousJobName || "기록 없음"}</small></>
                : <><b>마지막 차례예요</b><small>현재 학생이 선택하면 검토 단계로 이동합니다.</small></>}
            </div>
          </aside>

          <section className="panel monthly-job-choice-column">
            <div className="monthly-section-heading">
              <div>
                <p className="eyebrow">선택 가능한 직업</p>
                <h2>남은 자리를 보고 골라요</h2>
              </div>
              <span>{selectedJob ? `${selectedJob.name} 선택 중` : "직업을 선택해 주세요"}</span>
            </div>
            <div className="monthly-job-grid">
              {[...board.jobs].sort((left, right) => left.sortOrder - right.sortOrder).map((job) => {
                const count = jobCounts[job.id] ?? 0;
                const remaining = Math.max(0, job.capacity - count);
                const full = remaining === 0;
                return (
                  <button
                    key={job.id}
                    className={[
                      "monthly-job-card",
                      selectedJobId === job.id ? "selected" : "",
                      full ? "is-full" : "",
                    ].filter(Boolean).join(" ")}
                    disabled={busy || rosterMismatch || full || !currentStudent}
                    aria-pressed={selectedJobId === job.id}
                    onClick={() => setSelectedJobId(job.id)}
                  >
                    <span aria-hidden="true"><BriefcaseBusiness /></span>
                    <b>{job.name}</b>
                    <small>{job.description}</small>
                    <em>{full ? "마감 · 0자리" : `${remaining}자리 남음`} · {count}/{job.capacity}명</em>
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="panel monthly-progress-column">
            <div className="monthly-section-heading">
              <div>
                <p className="eyebrow">진행 현황</p>
                <h2>{assignedCount}/{orderedStudents.length}명 완료</h2>
              </div>
              <button
                className="monthly-undo-button"
                disabled={busy || !draft?.history.length}
                onClick={undoLastChoice}
              >
                <RotateCcw aria-hidden="true" />마지막 선택 취소
              </button>
            </div>
            <div className="monthly-student-queue" aria-label="학생 선택 순서">
              {orderedStudents.map((student, index) => {
                const classJobId = assignments[student.studentId];
                const job = board.jobs.find((item) => item.id === classJobId);
                const isCurrent = currentStudent?.studentId === student.studentId;
                return (
                  <button
                    key={student.studentId}
                    className={classJobId ? "done" : isCurrent ? "current" : ""}
                    disabled={Boolean(classJobId) || busy || rosterMismatch}
                    aria-current={isCurrent ? "step" : undefined}
                    onClick={() => {
                      setCurrentStudentId(student.studentId);
                      setSelectedJobId("");
                    }}
                  >
                    <span>{index + 1}</span>
                    <b>{student.studentNumber}번 {student.studentName}</b>
                    <small>{job ? `완료 · ${job.name}` : isCurrent ? "현재 차례" : `${previousGradeLabel(student.previousGrade)} · 차례 이동`}</small>
                  </button>
                );
              })}
            </div>
            <div className="monthly-completed-note">
              <Check aria-hidden="true" />
              <span><b>완료 학생 {completedStudents.length}명</b><small>선택한 학생은 다시 선택되지 않아요.</small></span>
            </div>
          </aside>
        </section>

        <section className="monthly-choice-action" aria-label="현재 선택 확인">
          <div>
            {currentStudent && selectedJob ? (
              <>
                <small>확정할 선택</small>
                <b>{currentStudent.studentNumber}번 {currentStudent.studentName} → {selectedJob.name}</b>
                <span>{selectedJobRemaining}자리 중 1자리를 사용합니다.</span>
              </>
            ) : (
              <>
                <small>현재 단계</small>
                <b>{currentStudent ? "직업을 하나 선택해 주세요" : "모든 학생의 선택을 확인해 주세요"}</b>
                <span>확정 전에는 서버로 전송되지 않아요.</span>
              </>
            )}
          </div>
          {currentStudent ? (
            <button
              className="button button-primary button-large"
              disabled={busy || rosterMismatch || !selectedJob}
              onClick={confirmLocalChoice}
            >
              <Check aria-hidden="true" />
              {selectedJob ? `${selectedJob.name}으로 선택 확정` : "직업을 선택해 주세요"}
            </button>
          ) : (
            <button
              className="button button-primary button-large"
              disabled={busy || !canComplete}
              onClick={completeChoice}
            >
              <Check aria-hidden="true" />
              {busy
                ? "전체 배정표를 저장하고 있어요…"
                : canComplete
                  ? `${assignedCount}명 전체 선택 확정·서버 저장`
                  : `미완료 ${orderedStudents.length - assignedCount}명 · 남은 자리 ${remainingSeats}개`}
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
