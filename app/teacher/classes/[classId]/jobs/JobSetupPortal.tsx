"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  PencilLine,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { Logo } from "@/app/components/Logo";
import { Notice } from "@/app/components/Notice";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { api, ClientApiError, postJson } from "@/lib/client-api";
import type {
  ClassJobDraft,
  JobCategory,
  JobTemplate,
  SetupMode,
  SurveyAnswers,
} from "@/lib/job-catalog";

type JobSetupState = {
  status: "not_started" | "draft" | "completed";
  setupMode: SetupMode | null;
  surveyAnswers: SurveyAnswers;
  draftJobs: ClassJobDraft[];
  studentCountSnapshot: number;
  selectedJobCount: number;
  selectedCapacity: number;
  lastStep: number;
  revision: number;
  completedAt: number | null;
  updatedAt: number;
};

type SetupResponse = {
  class: {
    id: string;
    school_name: string;
    school_year: number;
    grade: number;
    class_number: number;
    display_name: string | null;
  };
  studentCount: number;
  templates: JobTemplate[];
  categories: Record<JobCategory, string>;
  setup: JobSetupState;
  studentCountChanged: boolean;
  assignmentStatus: "not_started" | "draft" | "confirmed";
  assignmentCount: number;
};

type OverviewStudent = {
  id: string;
  studentNumber: number;
  name: string;
};

type OverviewJob = ClassJobDraft & {
  isActive: boolean;
  retired: boolean;
  assignedStudents: OverviewStudent[];
  assignedCount: number;
  vacancies: number;
  overCapacity: boolean;
  overCapacityCount: number;
};

type JobOverview = {
  period: null | {
    id: string;
    year: number;
    month: number;
    assignmentType: "initial" | "monthly" | string;
    confirmedAt: number | null;
    isScheduled: boolean;
  };
  jobs: OverviewJob[];
  unassignedStudents: OverviewStudent[];
  studentCount: number;
  setupRevision: number;
  configurationJobs: ClassJobDraft[];
  futureConfirmedPeriod: null | {
    id: string;
    year: number;
    month: number;
    assignmentType: "initial" | "monthly" | string;
  };
  nextTarget: null | { year: number; month: number };
  nextPlan: null | {
    revision: number;
    jobs: ClassJobDraft[];
    updatedAt: number;
    targetYear: number;
    targetMonth: number;
    status: "draft" | "applied";
    baseSetupRevision: number;
    appliedAt: number | null;
  };
  nextSession: null | {
    id: string;
    status: string;
    targetYear: number;
    targetMonth: number;
  };
};

type OverviewView = "students" | "jobs";
type EditTarget = "current" | "next";

const emptySurvey: SurveyAnswers = {
  areas: [],
  economy: "later",
  checks: [],
  distribution: "balanced",
  includeJobIds: [],
  excludeJobIds: [],
};

const areaOptions = [
  ["cleaning", "청소·환경"],
  ["life", "생활·확인"],
  ["learning", "학습·수업"],
  ["facilities", "물품·시설"],
  ["records", "기록·행사"],
];

const checkOptions = [
  ["routine", "알림장·준비물 확인"],
  ["meal", "급식·우유 확인"],
];

function sumCapacity(jobs: ClassJobDraft[]) {
  return jobs.reduce((sum, job) => sum + job.memberCapacity, 0);
}

function cloneJobs(jobs: ClassJobDraft[]) {
  return jobs.map((job) => ({ ...job }));
}

function classLabel(classRoom: SetupResponse["class"] | null) {
  if (!classRoom) return "우리 반";
  return classRoom.display_name || `${classRoom.school_name} ${classRoom.grade}학년 ${classRoom.class_number}반`;
}

function monthLabel(period: { year: number; month: number } | null) {
  return period ? `${period.year}년 ${period.month}월` : "다음 달";
}

function savedTimeLabel(epochMs: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(epochMs));
}

function overviewNextTarget(overview: JobOverview) {
  return overview.nextPlan
    ? { year: overview.nextPlan.targetYear, month: overview.nextPlan.targetMonth }
    : overview.nextTarget;
}

function hasMatchingNextSession(overview: JobOverview) {
  const target = overviewNextTarget(overview);
  return Boolean(
    target
    && overview.nextSession
    && overview.nextSession.targetYear === target.year
    && overview.nextSession.targetMonth === target.month,
  );
}

export function JobSetupPortal({ classId }: { classId: string }) {
  const router = useRouter();
  const [data, setData] = useState<SetupResponse | null>(null);
  const [overview, setOverview] = useState<JobOverview | null>(null);
  const [overviewView, setOverviewView] = useState<OverviewView>("students");
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [mode, setMode] = useState<SetupMode | null>(null);
  const [step, setStep] = useState(1);
  const [surveyPage, setSurveyPage] = useState(0);
  const [survey, setSurvey] = useState<SurveyAnswers>(emptySurvey);
  const [jobs, setJobs] = useState<ClassJobDraft[]>([]);
  const [reasons, setReasons] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | JobCategory>("all");
  const [preview, setPreview] = useState<{ jobs: ClassJobDraft[]; reasons: string[] } | null>(null);
  const [undoJobs, setUndoJobs] = useState<ClassJobDraft[] | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState({ name: "", description: "", category: "life" as JobCategory, memberCapacity: 1 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const adjustmentDialogRef = useRef<HTMLDivElement>(null);
  const adjustmentCancelRef = useRef<HTMLButtonElement>(null);

  const hydrate = useCallback((next: SetupResponse) => {
    setData(next);
    setMode(next.setup.setupMode);
    setSurvey(next.setup.surveyAnswers || emptySurvey);
    setJobs(next.setup.draftJobs || []);
    setStep(next.setup.status === "not_started" ? 1 : Math.min(3, Math.max(1, next.setup.lastStep)));
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const next = await api<SetupResponse>(`/api/classes/${classId}/job-setup`);
      hydrate(next);
      if (next.setup.status === "completed") {
        setOverview(null);
        const currentOverview = await api<JobOverview>(`/api/classes/${classId}/jobs/overview`);
        setOverview(currentOverview);
      } else {
        setOverview(null);
        setEditTarget(null);
      }
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }, [classId, hydrate]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      load();
    });
    return () => cancelAnimationFrame(frame);
  }, [load]);

  useEffect(() => {
    if (!preview) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusFrame = window.requestAnimationFrame(() => adjustmentCancelRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPreview(null);
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        adjustmentDialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (!controls.length) return;
      const first = controls[0];
      const last = controls.at(-1)!;
      if (!adjustmentDialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [preview]);

  const capacity = useMemo(() => sumCapacity(jobs), [jobs]);
  const capacityGap = data ? data.studentCount - capacity : 0;
  const nextPlanEditingLocked = Boolean(
    overview
    && (overview.nextPlan?.status === "applied" || hasMatchingNextSession(overview)),
  );
  const filteredTemplates = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return (data?.templates ?? []).filter((template) => {
      const categoryMatch = category === "all" || template.category === category;
      const keywordMatch = !keyword || `${template.name} ${template.shortDescription}`.toLowerCase().includes(keyword);
      return categoryMatch && keywordMatch;
    });
  }, [data, search, category]);

  function toggleList(field: "areas" | "checks" | "includeJobIds" | "excludeJobIds", value: string) {
    setSurvey((current) => {
      const exists = current[field].includes(value);
      const next = exists ? current[field].filter((item) => item !== value) : [...current[field], value];
      const opposite = field === "includeJobIds" ? "excludeJobIds" : field === "excludeJobIds" ? "includeJobIds" : null;
      return {
        ...current,
        [field]: next,
        ...(opposite ? { [opposite]: current[opposite].filter((item) => item !== value) } : {}),
      };
    });
  }

  async function recommend() {
    setBusy(true);
    setError("");
    try {
      const result = await postJson<{ jobs: ClassJobDraft[]; reasons: string[] }>(
        `/api/classes/${classId}/job-setup/recommend`,
        { surveyAnswers: survey },
      );
      setJobs(result.jobs);
      setReasons(result.reasons);
      setStep(3);
      setUndoJobs(null);
      setPreview(null);
      setMessage("우리 반에 맞춘 직업 구성을 준비했어요.");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(nextStep = step) {
    if (!data || !mode) return false;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ setup: JobSetupState; studentCount: number }>(
        `/api/classes/${classId}/job-setup/draft`,
        {
          method: "PUT",
          body: JSON.stringify({
            expectedRevision: data.setup.revision,
            setupMode: mode,
            surveyAnswers: survey,
            jobs,
            lastStep: nextStep,
          }),
        },
      );
      setData((current) => current ? {
        ...current,
        setup: result.setup,
        studentCount: result.studentCount,
        studentCountChanged: false,
      } : current);
      setMessage("초안을 저장했어요. 나중에 다시 이어서 할 수 있어요.");
      return true;
    } catch (reason) {
      setError((reason as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function updateJob(id: string, patch: Partial<ClassJobDraft>) {
    setJobs((current) => current.map((job) => job.id === id ? { ...job, ...patch } : job));
    setPreview(null);
  }

  function removeJob(id: string) {
    setJobs((current) => current.filter((job) => job.id !== id).map((job, index) => ({ ...job, sortOrder: index })));
    setPreview(null);
  }

  function addTemplate(template: JobTemplate) {
    const id = `${classId}:${template.id}`;
    if (jobs.some((job) => job.id === id)) {
      setMessage(`${template.name}은 이미 담겨 있어요.`);
      return;
    }
    setJobs((current) => [...current, {
      id,
      templateId: template.id,
      name: template.name,
      description: template.shortDescription,
      memberCapacity: template.recommendedMinMembers,
      category: template.category,
      source: "template",
      sortOrder: current.length,
    }]);
    setMessage(`${template.name}을 추가했어요.`);
  }

  function addCustomJob() {
    if (!custom.name.trim() || !custom.description.trim()) {
      setError("사용자 정의 직업의 이름과 설명을 입력해 주세요.");
      return;
    }
    setJobs((current) => [...current, {
      id: `${classId}:custom:${crypto.randomUUID()}`,
      templateId: null,
      name: custom.name.trim(),
      description: custom.description.trim(),
      memberCapacity: Math.max(1, Math.min(60, custom.memberCapacity)),
      category: custom.category,
      source: "custom",
      sortOrder: current.length,
    }]);
    setCustom({ name: "", description: "", category: "life", memberCapacity: 1 });
    setCustomOpen(false);
    setMessage("새 직업을 만들었어요.");
  }

  async function requestAdjustment() {
    setBusy(true);
    setError("");
    try {
      const result = await postJson<{ jobs: ClassJobDraft[]; reasons: string[] }>(
        `/api/classes/${classId}/job-setup/adjust`,
        { jobs },
      );
      setPreview(result);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function applyAdjustment() {
    if (!preview) return;
    setUndoJobs(cloneJobs(jobs));
    setJobs(cloneJobs(preview.jobs));
    setReasons(preview.reasons);
    setPreview(null);
    setMessage("자동 맞춤 변경안을 적용했어요. 한 번 되돌릴 수 있어요.");
  }

  function undoAdjustment() {
    if (!undoJobs) return;
    setJobs(cloneJobs(undoJobs));
    setUndoJobs(null);
    setMessage("자동 맞춤 전 상태로 되돌렸어요.");
  }

  function beginCompletedEdit(target: EditTarget) {
    if (!data || !overview) return;
    const sourceJobs = target === "next" && overview.nextPlan
      ? overview.nextPlan.jobs
      : overview.configurationJobs;
    setJobs(cloneJobs(sourceJobs));
    setMode(data.setup.setupMode ?? "manual");
    setEditTarget(target);
    setUndoJobs(null);
    setPreview(null);
    setCustomOpen(false);
    setError("");
    setMessage("");
  }

  function cancelCompletedEdit() {
    setEditTarget(null);
    setUndoJobs(null);
    setPreview(null);
    setCustomOpen(false);
    setError("");
    setMessage("");
  }

  function needsAssignmentImpactConfirmation(reason: unknown) {
    return reason instanceof ClientApiError
      && reason.status === 409
      && reason.code === "JOB_CONFIG_IMPACT_CONFIRMATION_REQUIRED";
  }

  async function applyCurrentConfiguration() {
    if (!overview || !jobs.length) return;
    const requestId = crypto.randomUUID();
    const submit = (acknowledgeImpact: boolean) => postJson(
      `/api/classes/${classId}/jobs/apply-current`,
      {
        expectedSetupRevision: overview.setupRevision,
        requestId,
        jobs,
        acknowledgeImpact,
      },
    );
    setBusy(true);
    setError("");
    setMessage("");
    try {
      try {
        await submit(false);
      } catch (reason) {
        if (!needsAssignmentImpactConfirmation(reason)) throw reason;
        const confirmed = window.confirm(
          `${(reason as Error).message}\n\n현재 배정과 권한은 유지됩니다. 구성에서 뺀 직업은 이번 배정이 끝날 때까지 ‘현재 배정 유지’로 표시되고, 줄인 정원보다 현재 인원이 많을 수도 있습니다. 이대로 지금 반영할까요?`,
        );
        if (!confirmed) {
          setMessage("현재 구성은 바꾸지 않았어요. 수정 내용은 화면에 그대로 남아 있습니다.");
          return;
        }
        await submit(true);
      }
      setEditTarget(null);
      await load();
      setMessage("수정한 직업 구성을 지금 운영에 반영했어요.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "현재 구성을 반영하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function saveNextConfiguration() {
    if (!overview || !jobs.length) return;
    const target = overviewNextTarget(overview);
    if (!target) {
      setError("다음 달을 정할 수 없어요. 첫 직업 배정을 확정한 뒤 다시 준비해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`/api/classes/${classId}/jobs/plan`, {
        method: "PUT",
        body: JSON.stringify({
          expectedRevision: overview.nextPlan?.revision ?? 0,
          expectedSetupRevision: overview.setupRevision,
          expectedTargetYear: target.year,
          expectedTargetMonth: target.month,
          requestId: crypto.randomUUID(),
          jobs,
        }),
      });
      setEditTarget(null);
      await load();
      setMessage("다음 달 직업 구성을 저장했어요. 현재 직업과 배정은 바뀌지 않았습니다.");
    } catch (reason) {
      const stalePlan = reason instanceof ClientApiError
        && (reason.code === "JOB_PLAN_BASE_STALE" || reason.code === "JOB_PLAN_STALE");
      const workflowStarted = reason instanceof ClientApiError
        && reason.code === "JOB_PLAN_WORKFLOW_STARTED";
      setError(workflowStarted
        ? `${reason.message} 이미 시작한 다음 달 직업 선정 화면에서 이어서 진행해 주세요.`
        : stalePlan
          ? `${reason.message} 현황으로 돌아간 뒤 브라우저의 새로고침을 눌러 최신 내용을 확인하고 다시 수정해 주세요.`
        : reason instanceof Error
          ? reason.message
          : "다음 달 구성을 저장하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    if (!data || !mode) return;
    if (data.assignmentStatus === "confirmed") {
      setError("첫 직업 배정이 이미 확정되어 초기 설정에서 직업과 정원을 바꿀 수 없어요.");
      return;
    }
    const acknowledgeAssignmentImpact = data.assignmentCount > 0
      ? confirm(`진행 중인 첫 직업 배정 ${data.assignmentCount}건이 있어요.\n직업과 정원을 다시 확정하면 임시 배정이 초기화됩니다. 계속할까요?`)
      : false;
    if (data.assignmentCount > 0 && !acknowledgeAssignmentImpact) return;
    setBusy(true);
    setError("");
    try {
      await postJson(`/api/classes/${classId}/job-setup/complete`, {
        expectedRevision: data.setup.revision,
        setupMode: mode,
        surveyAnswers: survey,
        jobs,
        acknowledgeAssignmentImpact,
      });
      router.replace(`/teacher/classes/${classId}/job-assignments`);
      router.refresh();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <main className="job-page job-loading" aria-busy={busy || undefined}>
        <Logo />
        <Notice message={error} tone="error" />
        {error ? (
          <div className="button-row">
            <button className="button button-primary" type="button" disabled={busy} onClick={load}>다시 시도</button>
            <a className="button button-light" href="/teacher">교사 대시보드로</a>
          </div>
        ) : <p role="status">우리 반 직업을 불러오고 있어요…</p>}
      </main>
    );
  }

  if (data.setup.status === "completed" && !overview) {
    return (
      <main className="job-page job-loading" aria-busy={busy || undefined}>
        <Logo />
        <Notice message={error} tone="error" />
        {error ? (
          <div className="button-row">
            <button className="button button-primary" type="button" disabled={busy} onClick={load}>다시 시도</button>
            <a className="button button-light" href="/teacher">교사 대시보드로</a>
          </div>
        ) : <p role="status">현재 직업 현황을 불러오고 있어요…</p>}
      </main>
    );
  }

  return (
    <div className="job-page">
      <header className="job-topbar">
        <Logo compact />
        <div>
          <strong>{classLabel(data.class)}</strong>
          <span>{data.setup.status === "completed"
            ? editTarget === "current"
              ? "현재 직업 구성 수정"
              : editTarget === "next"
                ? "다음 달 직업 구성"
                : "우리 반 직업 현황"
            : "우리 반 직업 설정"}</span>
        </div>
        <div className="job-topbar-actions"><ThemeToggle compact /><a className="button button-light" href="/teacher">나가기</a></div>
      </header>

      <main className="job-main">
        {data.setup.status !== "completed" && <section className="job-progress" aria-label="직업 설정 진행 단계">
          {["방식 선택", "우리 반 질문", "직업 설정·저장"].map((label, index) => {
            const number = index + 1;
            return (
              <div key={label} className={number < step ? "done" : number === step ? "current" : ""}>
                <b>{number < step ? "✓" : number}</b><span>{label}</span>
              </div>
            );
          })}
        </section>}

        <Notice message={error} tone="error" />
        <Notice message={message} tone="success" />
        {data.studentCountChanged && (data.setup.status !== "completed" || Boolean(editTarget)) && (
          <div className="job-warning" role="status">
            <b>학생 명단이 달라졌어요.</b>
            <span>저장 당시 {data.setup.studentCountSnapshot}명, 현재 {data.studentCount}명이에요. 공석이나 역할 없는 학생을 두어도 되므로 원하는 자리 수 그대로 저장할 수 있어요.</span>
          </div>
        )}

        {data.setup.status === "completed" && !editTarget && overview && (
          <CompletedJobOverview
            classId={classId}
            overview={overview}
            view={overviewView}
            onViewChange={setOverviewView}
            onEditCurrent={() => beginCompletedEdit("current")}
            onEditNext={() => beginCompletedEdit("next")}
          />
        )}

        {data.setup.status !== "completed" && step === 1 && (
          <section className="job-stage job-intro">
            <p className="eyebrow">1단계 · 시작하기</p>
            <h1>우리 반에 꼭 맞는 일을 준비해 볼까요?</h1>
            <p>현재 직업에 참여할 학생은 <strong>{data.studentCount}명</strong>이에요. 추천을 받거나 필요한 직업을 직접 골라 시작할 수 있어요.</p>
            {data.studentCount === 0 && <Notice message="학생 명단을 먼저 등록해야 추천과 확정을 진행할 수 있어요." tone="info" />}
            <div className="job-mode-grid">
              <button disabled={data.studentCount === 0} onClick={() => { setMode("recommended"); setStep(2); setSurveyPage(0); }}>
                <span className="mode-icon" aria-hidden="true"><Sparkles /></span>
                <b>추천받기</b>
                <small>짧은 질문에 답하면 학생 수에 맞춘 구성을 제안해요.</small>
              </button>
              <button onClick={() => { setMode("manual"); setStep(3); setJobs([]); }}>
                <span className="mode-icon" aria-hidden="true"><PencilLine /></span>
                <b>직접 만들기</b>
                <small>기본 직업을 골라 담거나 우리 반만의 직업을 만들어요.</small>
              </button>
            </div>
            {data.setup.status !== "not_started" && (
              <button className="text-button" onClick={() => {
                setMode(data.setup.setupMode);
                setSurvey(data.setup.surveyAnswers);
                setJobs(data.setup.draftJobs);
                setStep(Math.min(3, data.setup.lastStep));
              }}>저장한 초안 이어서 보기</button>
            )}
          </section>
        )}

        {data.setup.status !== "completed" && step === 2 && (
          <section className="job-stage survey-stage">
            <div className="stage-heading">
              <div><p className="eyebrow">2단계 · 질문 {surveyPage + 1}/3</p><h1>우리 반 운영 방식을 알려 주세요</h1></div>
              <span className="question-count">{surveyPage + 1} / 3</span>
            </div>
            {surveyPage === 0 && (
              <div className="question-stack">
                <fieldset>
                  <legend>어떤 영역의 일을 중요하게 생각하나요?</legend>
                  <p>여러 개를 선택할 수 있어요.</p>
                  <div className="option-grid">
                    {areaOptions.map(([value, label]) => (
                      <label className="choice-card" key={value}>
                        <input type="checkbox" checked={survey.areas.includes(value)} onChange={() => toggleList("areas", value)} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>학급 경제를 운영하나요?</legend>
                  <div className="option-grid option-grid-compact">
                    {[
                      ["both", "은행과 마트 모두"],
                      ["mart", "마트만"],
                      ["bank", "은행만"],
                      ["none", "운영하지 않음"],
                      ["later", "나중에 정하기"],
                    ].map(([value, label]) => (
                      <label className="choice-card" key={value}>
                        <input type="radio" name="economy" value={value} checked={survey.economy === value} onChange={() => setSurvey((current) => ({ ...current, economy: value as SurveyAnswers["economy"] }))} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            )}
            {surveyPage === 1 && (
              <div className="question-stack">
                <fieldset>
                  <legend>매일 확인하는 역할이 필요한가요?</legend>
                  <p>선택하지 않으면 확인원은 자동으로 넣지 않아요.</p>
                  <div className="option-grid">
                    {checkOptions.map(([value, label]) => (
                      <label className="choice-card" key={value}>
                        <input type="checkbox" checked={survey.checks.includes(value)} onChange={() => toggleList("checks", value)} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>직업 수와 함께 맡는 인원을 어떻게 할까요?</legend>
                  <div className="option-grid">
                    {[
                      ["shared", "함께 맡기기", "직업 수는 적게, 한 일을 여러 명이 함께해요."],
                      ["balanced", "균형형", "8~12가지 일을 중심으로 고르게 구성해요."],
                      ["diverse", "다양형", "직업 수를 늘리고 1~2명씩 맡아요."],
                    ].map(([value, label, description]) => (
                      <label className="choice-card choice-detail" key={value}>
                        <input type="radio" name="distribution" value={value} checked={survey.distribution === value} onChange={() => setSurvey((current) => ({ ...current, distribution: value as SurveyAnswers["distribution"] }))} />
                        <span><b>{label}</b><small>{description}</small></span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            )}
            {surveyPage === 2 && (
              <fieldset>
                <legend>꼭 넣거나 빼고 싶은 직업이 있나요?</legend>
                <p>건너뛰어도 괜찮아요. 추천 결과에서 다시 고칠 수 있어요.</p>
                <div className="survey-template-list">
                  {data.templates.map((template) => (
                    <div key={template.id}>
                      <span><b>{template.name}</b><small>{data.categories[template.category]}</small></span>
                      <div>
                        <button className={survey.includeJobIds.includes(template.id) ? "selected include" : ""} onClick={() => toggleList("includeJobIds", template.id)}>꼭 포함</button>
                        <button className={survey.excludeJobIds.includes(template.id) ? "selected exclude" : ""} onClick={() => toggleList("excludeJobIds", template.id)}>제외</button>
                      </div>
                    </div>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="stage-actions">
              <button className="button button-light" onClick={() => surveyPage === 0 ? setStep(1) : setSurveyPage((value) => value - 1)}>이전</button>
              <button className="text-button" onClick={() => surveyPage < 2 ? setSurveyPage((value) => value + 1) : recommend()}>이 질문 건너뛰기</button>
              <button className="button button-primary" disabled={busy} onClick={() => surveyPage < 2 ? setSurveyPage((value) => value + 1) : recommend()}>
                {surveyPage < 2 ? "다음" : busy ? "추천 만드는 중…" : "추천 결과 보기"}
              </button>
            </div>
          </section>
        )}

        {(editTarget || (data.setup.status !== "completed" && step === 3)) && (
          <section className="job-editor-layout">
            <div className="job-editor-main">
              <div className="stage-heading">
                <div>
                  <p className="eyebrow">{editTarget ? "직업 구성 수정" : "3단계 · 직업 다듬기"}</p>
                  <h1>{editTarget
                    ? "직업 구성을 우리 반 상황에 맞게 바꿔요"
                    : mode === "recommended"
                      ? "추천 결과를 우리 반답게 다듬어요"
                      : "우리 반 직업을 직접 만들어요"}</h1>
                </div>
                {editTarget ? (
                  <button className="button button-light" disabled={busy} onClick={cancelCompletedEdit}>
                    <ArrowLeft aria-hidden="true" />현황으로 돌아가기
                  </button>
                ) : (
                  <button className="button button-light" disabled={busy || !mode} onClick={() => saveDraft(3)}>{busy ? "저장 중…" : "초안 저장"}</button>
                )}
              </div>
              {editTarget && (
                <fieldset className="job-apply-timing">
                  <legend>수정한 내용을 언제부터 사용할까요?</legend>
                  <label className={editTarget === "current" ? "selected" : ""}>
                    <input
                      type="radio"
                      name="job-apply-timing"
                      value="current"
                      checked={editTarget === "current"}
                      onChange={() => setEditTarget("current")}
                    />
                    <span><b>지금 바로 반영</b><small>현재 직업과 학생 화면에 바로 적용해요. 배정에 영향이 있으면 저장 전에 한 번 더 확인합니다.</small></span>
                  </label>
                  <label className={`${editTarget === "next" ? "selected" : ""} ${nextPlanEditingLocked ? "disabled" : ""}`.trim()}>
                    <input
                      type="radio"
                      name="job-apply-timing"
                      value="next"
                      checked={editTarget === "next"}
                      disabled={nextPlanEditingLocked}
                      onChange={() => setEditTarget("next")}
                    />
                    <span><b>다음 달부터 반영</b><small>{nextPlanEditingLocked
                      ? "이미 다음 달 직업 선정을 시작한 구성이라 이곳에서는 다시 수정할 수 없어요."
                      : "현재 직업과 배정은 그대로 두고, 다음 달 준비 내용으로 안전하게 저장해요."}</small></span>
                  </label>
                </fieldset>
              )}
              {reasons.length > 0 && <div className="recommend-reasons">{reasons.map((reason) => <p key={reason}>✓ {reason}</p>)}</div>}
              {jobs.length === 0 ? (
                <div className="empty-jobs"><span className="mode-icon" aria-hidden="true"><BriefcaseBusiness /></span><h2>아직 담은 직업이 없어요</h2><p>오른쪽 목록에서 기본 직업을 담거나 새 직업을 만들어 주세요.</p></div>
              ) : (
                <div className="job-card-list">
                  {jobs.map((job, index) => (
                    <article className="job-edit-card" key={job.id}>
                      <div className="job-card-number">{index + 1}</div>
                      <div className="job-card-fields">
                        <label>직업 이름<input value={job.name} maxLength={40} onChange={(event) => updateJob(job.id, { name: event.target.value })} /></label>
                        <label>하는 일<input value={job.description} maxLength={240} onChange={(event) => updateJob(job.id, { description: event.target.value })} /></label>
                      </div>
                      <div className="capacity-control" aria-label={`${job.name} 정원`}>
                        <span>정원</span>
                        <button aria-label="정원 한 명 줄이기" disabled={job.memberCapacity <= 1} onClick={() => updateJob(job.id, { memberCapacity: Math.max(1, job.memberCapacity - 1) })}>−</button>
                        <b>{job.memberCapacity}</b>
                        <button aria-label="정원 한 명 늘리기" onClick={() => updateJob(job.id, { memberCapacity: Math.min(60, job.memberCapacity + 1) })}>＋</button>
                      </div>
                      <button className="job-remove" aria-label={`${job.name} 제외`} onClick={() => removeJob(job.id)}>제외</button>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <aside className="job-toolbox">
              <div className={`capacity-summary ${capacityGap === 0 ? "matched" : ""}`}>
                <span>학생 {data.studentCount}명</span>
                <strong>{capacity}자리</strong>
                <small>{capacityGap === 0
                  ? "학생 수와 같아요"
                  : capacityGap > 0
                    ? `역할 없는 학생 ${capacityGap}명 가능`
                    : `공석 ${Math.abs(capacityGap)}자리 가능`}</small>
              </div>
              {data.studentCount > 0 && capacityGap !== 0 && (
                <button className="button button-primary toolbox-full" disabled={busy} onClick={requestAdjustment}>자동 맞춤 미리보기</button>
              )}
              {undoJobs && <button className="button button-light toolbox-full" onClick={undoAdjustment}>자동 맞춤 1회 되돌리기</button>}
              <div className="toolbox-divider" />
              <h2>기본 직업 찾기</h2>
              <label className="visually-hidden" htmlFor="job-search">직업 검색</label>
              <input id="job-search" type="search" placeholder="직업 이름 검색" value={search} onChange={(event) => setSearch(event.target.value)} />
              <label className="visually-hidden" htmlFor="job-category">직업 분류</label>
              <select id="job-category" value={category} onChange={(event) => setCategory(event.target.value as "all" | JobCategory)}>
                <option value="all">모든 분류</option>
                {Object.entries(data.categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <div className="template-picker">
                {filteredTemplates.map((template) => {
                  const added = jobs.some((job) => (
                    job.id === `${classId}:${template.id}` || job.templateId === template.id
                  ));
                  return (
                    <button key={template.id} disabled={added} onClick={() => addTemplate(template)}>
                      <span><b>{template.name}</b><small>{data.categories[template.category]} · 권장 {template.recommendedMinMembers}~{template.recommendedMaxMembers}명</small></span>
                      <strong>{added ? "담음" : "+ 담기"}</strong>
                    </button>
                  );
                })}
              </div>
              <button className="button button-light toolbox-full" onClick={() => setCustomOpen((value) => !value)}>+ 우리 반 직업 만들기</button>
              {customOpen && (
                <div className="custom-job-form">
                  <label>직업 이름<input value={custom.name} maxLength={40} onChange={(event) => setCustom((current) => ({ ...current, name: event.target.value }))} /></label>
                  <label>하는 일<input value={custom.description} maxLength={240} onChange={(event) => setCustom((current) => ({ ...current, description: event.target.value }))} /></label>
                  <label>분류<select value={custom.category} onChange={(event) => setCustom((current) => ({ ...current, category: event.target.value as JobCategory }))}>{Object.entries(data.categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label>정원<input type="number" min={1} max={60} value={custom.memberCapacity} onChange={(event) => setCustom((current) => ({ ...current, memberCapacity: Number(event.target.value) }))} /></label>
                  <button className="button button-primary" onClick={addCustomJob}>직업 추가</button>
                </div>
              )}
            </aside>

            {preview && (
              <div
                ref={adjustmentDialogRef}
                className="adjust-preview"
                role="dialog"
                aria-modal="true"
                aria-labelledby="adjust-title"
                aria-describedby="adjust-description"
              >
                <div>
                  <p className="eyebrow">변경안 미리보기</p>
                  <h2 id="adjust-title">학생 {data.studentCount}명에 맞춘 결과예요</h2>
                  <ul id="adjust-description">{preview.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                  <div className="preview-comparison">
                    <span>현재 <b>{capacity}자리</b></span><i>→</i><span>변경 후 <b>{sumCapacity(preview.jobs)}자리</b></span>
                  </div>
                  <div className="stage-actions">
                    <button ref={adjustmentCancelRef} className="button button-light" onClick={() => setPreview(null)}>취소</button>
                    <button className="button button-primary" onClick={applyAdjustment}>이 변경안 적용</button>
                  </div>
                </div>
              </div>
            )}

            <div className="editor-footer">
              <button className="button button-light" onClick={() => editTarget ? cancelCompletedEdit() : mode === "recommended" ? setStep(2) : setStep(1)}>
                {editTarget ? "수정 취소" : "이전"}
              </button>
              <span>{jobs.length}개 직업 · {capacity}자리 · 공석과 미배정 허용</span>
              <button
                className="button button-primary"
                disabled={busy || !jobs.length}
                onClick={editTarget === "current"
                  ? applyCurrentConfiguration
                  : editTarget === "next"
                    ? saveNextConfiguration
                    : complete}
              >
                {busy
                  ? "저장 중…"
                  : editTarget === "current"
                    ? "지금 바로 반영"
                    : editTarget === "next"
                      ? "다음 달부터 반영"
                      : "저장하고 직업 배정으로"}
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function CompletedJobOverview({
  classId,
  overview,
  view,
  onViewChange,
  onEditCurrent,
  onEditNext,
}: {
  classId: string;
  overview: JobOverview;
  view: OverviewView;
  onViewChange: (view: OverviewView) => void;
  onEditCurrent: () => void;
  onEditNext: () => void;
}) {
  const sortedJobs = [...overview.jobs].sort((left, right) => left.sortOrder - right.sortOrder);
  const assignedStudents = sortedJobs.flatMap((job) => job.assignedStudents.map((student) => ({
    ...student,
    jobId: job.id,
    jobName: job.name,
    retiredJob: job.retired,
  }))).sort((left, right) => left.studentNumber - right.studentNumber);
  const nextMonth = overviewNextTarget(overview);
  const nextWorkflowStarted = hasMatchingNextSession(overview);
  const scheduledOnly = Boolean(overview.period?.isScheduled);
  const futurePeriodPending = Boolean(overview.futureConfirmedPeriod);
  const nextPlanNeedsReview = Boolean(
    overview.nextPlan?.status === "draft"
    && overview.nextPlan.baseSetupRevision !== overview.setupRevision,
  );
  const currentEditLocked = overview.nextPlan?.status === "applied"
    || nextWorkflowStarted
    || futurePeriodPending;
  const futurePeriodHref = overview.futureConfirmedPeriod?.assignmentType === "monthly"
    ? `/teacher/classes/${classId}/monthly-jobs`
    : `/teacher/classes/${classId}/job-assignments`;
  const totalVacancies = sortedJobs.reduce(
    (sum, job) => sum + (job.isActive && !job.retired ? Math.max(0, Number(job.vacancies)) : 0),
    0,
  );
  const totalOverCapacity = sortedJobs.reduce(
    (sum, job) => sum + (job.overCapacity ? Math.max(0, Number(job.overCapacityCount)) : 0),
    0,
  );
  const currentJobCount = sortedJobs.filter((job) => !job.retired).length;
  const retiredJobCount = sortedJobs.filter((job) => job.retired).length;
  const nextCapacity = overview.nextPlan?.jobs.reduce((sum, job) => sum + job.memberCapacity, 0) ?? 0;

  return (
    <section className="job-overview" aria-labelledby="job-overview-title">
      <div className="job-overview-hero">
        <div>
          <p className="eyebrow">현재 우리 반</p>
          <h1 id="job-overview-title">우리 반 직업 현황</h1>
          <p>{overview.period
            ? overview.period.isScheduled
              ? `${overview.period.year}년 ${overview.period.month}월부터 시작할 확정 배정표예요. 학생 화면에는 시작 월이 되면 표시됩니다.`
              : `${overview.period.year}년 ${overview.period.month}월에 확정한 배정을 보여 드려요.`
            : "직업 구성은 저장되어 있어요. 학생 배정을 마치면 이곳에서 전체 현황을 바로 볼 수 있습니다."}</p>
        </div>
        <div className="job-overview-actions">
          <button
            className="button button-light"
            type="button"
            disabled={currentEditLocked}
            aria-describedby={currentEditLocked ? "current-job-edit-lock" : undefined}
            onClick={onEditCurrent}
          >
            <PencilLine aria-hidden="true" />현재 구성 수정
          </button>
          {scheduledOnly ? (
            <a className="button button-primary" href={futurePeriodHref}>
              <CalendarDays aria-hidden="true" />배정 예정표 보기
            </a>
          ) : overview.period ? (
            nextWorkflowStarted || overview.nextPlan?.status === "applied" ? (
              <a className="button button-primary" href={`/teacher/classes/${classId}/monthly-jobs`}>
                <CalendarDays aria-hidden="true" />다음 달 선정 이어가기
              </a>
            ) : futurePeriodPending ? (
              <a className="button button-primary" href={futurePeriodHref}>
                <CalendarDays aria-hidden="true" />예정 배정 보기
              </a>
            ) : (
              <button className="button button-primary" type="button" onClick={onEditNext}>
                <CalendarDays aria-hidden="true" />{nextPlanNeedsReview
                  ? "다음 달 구성 다시 검토"
                  : overview.nextPlan ? "다음 달 구성 이어 수정" : "다음 달 구성 준비"}
              </button>
            )
          ) : (
            <a className="button button-primary" href={`/teacher/classes/${classId}/job-assignments`}>
              <UsersRound aria-hidden="true" />첫 직업 배정하기
            </a>
          )}
          {currentEditLocked && (
            <small className="job-current-edit-lock" id="current-job-edit-lock" role="status">
              {futurePeriodPending
                ? "앞으로 시작할 배정이 이미 확정되어 있어요. 예정 월이 시작된 뒤 다음 달 구성으로 수정할 수 있습니다."
                : "다음 달 선정이 진행 중이라 현재 구성 수정은 다음 운영 월부터 가능합니다."}
            </small>
          )}
        </div>
      </div>

      <div className="job-overview-summary" aria-label="현재 직업 배정 요약">
        <div><CalendarDays aria-hidden="true" /><span>{scheduledOnly ? "예정 월" : "적용 월"}<strong>{overview.period ? `${overview.period.year}년 ${overview.period.month}월` : "첫 배정 전"}</strong></span></div>
        <div><UsersRound aria-hidden="true" /><span>배정 학생<strong>{assignedStudents.length}/{overview.studentCount}명</strong></span></div>
        <div><BriefcaseBusiness aria-hidden="true" /><span>운영 직업<strong>{currentJobCount}개</strong></span></div>
        <div className={overview.unassignedStudents.length ? "needs-attention" : "complete"}>
          <CheckCircle2 aria-hidden="true" /><span>직업이 없는 학생<strong>{overview.unassignedStudents.length}명</strong></span>
        </div>
      </div>

      <div className="job-overview-notices">
        {totalVacancies > 0 && <p><b>공석 {totalVacancies}자리</b><span>빈자리는 그대로 두어도 괜찮아요.</span></p>}
        {totalOverCapacity > 0 && <p className="warning"><b>정원보다 {totalOverCapacity}명 많음</b><span>현재 배정은 유지되며, 다음 수정 때 정원을 확인해 주세요.</span></p>}
        {retiredJobCount > 0 && <p className="retired"><b>이전 구성의 직업 {retiredJobCount}개</b><span>퇴역했지만 현재 배정은 유지 중입니다.</span></p>}
      </div>

      {overview.period && !scheduledOnly && !futurePeriodPending && <section className="job-next-plan-card" aria-labelledby="job-next-plan-title">
        <div>
          <p className="eyebrow">생각날 때마다 준비</p>
          <h2 id="job-next-plan-title">{monthLabel(nextMonth)} 직업 구성</h2>
          {nextWorkflowStarted ? (
            <p><b>다음 달 직업 선정을 시작했어요.</b><span>선정 화면에서 학생 배정을 이어서 진행해 주세요.</span></p>
          ) : nextPlanNeedsReview ? (
            <p className="warning">
              <b>현재 구성이 바뀌어 다시 확인이 필요해요.</b>
              <span>저장해 둔 다음 달 구성을 열어 한 번 확인하고 다시 저장해 주세요.</span>
            </p>
          ) : overview.nextPlan ? (
            <p>
              <b>{overview.nextPlan.jobs.length}개 직업 · {nextCapacity}자리</b>
              <span>{overview.nextPlan.status === "applied"
                ? "다음 달 직업 선정에 반영했어요. 선정 화면에서 학생 배정을 이어가 주세요."
                : `${savedTimeLabel(overview.nextPlan.updatedAt)} 저장 · 현재 배정에는 아직 반영되지 않았어요.`}</span>
            </p>
          ) : (
            <p><b>아직 저장한 다음 달 구성이 없어요.</b><span>직업을 늘리거나 줄일 생각이 날 때마다 열어 수정할 수 있어요.</span></p>
          )}
        </div>
        {nextWorkflowStarted || overview.nextPlan?.status === "applied" ? (
          <a className="button button-light" href={`/teacher/classes/${classId}/monthly-jobs`}>다음 달 선정 화면으로</a>
        ) : (
          <button className="button button-light" type="button" onClick={onEditNext}>
            {nextPlanNeedsReview
              ? "구성 다시 검토"
              : overview.nextPlan ? "저장한 구성 이어 수정" : "다음 달 구성 만들기"}
          </button>
        )}
      </section>}

      <div className="job-overview-heading">
        <div>
          <p className="eyebrow">{scheduledOnly ? "시작을 기다리는 배정표" : "확정된 배정표"}</p>
          <h2>{scheduledOnly ? "친구들의 예정 직업" : "친구들의 현재 직업"}</h2>
        </div>
        <div className="job-overview-view-toggle" role="group" aria-label="직업 현황 보기 방식">
          <button type="button" aria-pressed={view === "students"} onClick={() => onViewChange("students")}>학생별 보기</button>
          <button type="button" aria-pressed={view === "jobs"} onClick={() => onViewChange("jobs")}>직업별 보기</button>
        </div>
      </div>

      <div className="job-overview-results" role="region" aria-live="polite" aria-label={view === "students" ? "학생별 직업 현황" : "직업별 학생 현황"}>
        {view === "students" ? (
          <div className="job-overview-students">
            {assignedStudents.map((student) => (
              <article key={`${student.jobId}:${student.id}`}>
                <span className="job-overview-student-number">{student.studentNumber}</span>
                <div><b>{student.name}</b><small>{student.jobName}</small></div>
                {student.retiredJob && <em>현재 배정 유지</em>}
              </article>
            ))}
            {overview.unassignedStudents
              .slice()
              .sort((left, right) => left.studentNumber - right.studentNumber)
              .map((student) => (
                <article className="unassigned" key={student.id}>
                  <span className="job-overview-student-number">{student.studentNumber}</span>
                  <div><b>{student.name}</b><small>직업이 없는 학생</small></div>
                  <em>미배정</em>
                </article>
              ))}
            {!assignedStudents.length && !overview.unassignedStudents.length && (
              <div className="job-overview-empty"><UsersRound aria-hidden="true" /><b>표시할 학생이 없어요.</b><span>학생 명단을 확인해 주세요.</span></div>
            )}
          </div>
        ) : (
          <div className="job-overview-jobs">
            {sortedJobs.map((job) => (
              <article className={job.retired ? "retired" : job.overCapacity ? "over-capacity" : ""} key={job.id}>
                <header>
                  <span><BriefcaseBusiness aria-hidden="true" /></span>
                  <div><h3>{job.name}</h3><p>{job.description}</p></div>
                  <strong>{job.assignedCount}/{job.memberCapacity}명</strong>
                </header>
                <div className="job-overview-job-status">
                  {job.retired && <em>퇴역 · 현재 배정은 유지 중</em>}
                  {job.overCapacity && <em className="warning">정원보다 {job.overCapacityCount}명 많음</em>}
                  {!job.retired && !job.overCapacity && job.vacancies > 0 && <em>공석 {job.vacancies}자리</em>}
                  {!job.retired && !job.overCapacity && job.vacancies === 0 && <em className="complete">정원 확인 완료</em>}
                </div>
                {job.assignedStudents.length ? (
                  <ul>{job.assignedStudents
                    .slice()
                    .sort((left, right) => left.studentNumber - right.studentNumber)
                    .map((student) => <li key={student.id}><b>{student.studentNumber}번</b> {student.name}</li>)}</ul>
                ) : <p className="job-overview-job-empty">배정된 학생이 없어요. 공석으로 두어도 괜찮습니다.</p>}
              </article>
            ))}
            {!sortedJobs.length && (
              <div className="job-overview-empty"><BriefcaseBusiness aria-hidden="true" /><b>표시할 직업이 없어요.</b><span>현재 구성을 수정해 직업을 추가해 주세요.</span></div>
            )}
          </div>
        )}
      </div>

      <div className="job-overview-footer">
        <span>{scheduledOnly
          ? "예정 월이 되면 학생 화면에도 자신의 직업이 자동으로 표시됩니다."
          : overview.period
          ? "현재 결과를 확인한 뒤, 다음 달 직업 평가와 선정을 이어갈 수 있어요."
          : "첫 직업을 배정하면 학생 화면에도 자신의 직업이 표시됩니다."}</span>
        <a className="button button-primary" href={scheduledOnly
          ? futurePeriodHref
          : overview.period
          ? futurePeriodPending
            ? futurePeriodHref
            : `/teacher/classes/${classId}/monthly-jobs`
          : `/teacher/classes/${classId}/job-assignments`}>
          {scheduledOnly
            ? "배정 예정표 보기"
            : overview.period
            ? futurePeriodPending ? "예정 배정 보기" : "다음 달 직업 선정으로"
            : "첫 직업 배정하기"}
        </a>
      </div>
    </section>
  );
}
