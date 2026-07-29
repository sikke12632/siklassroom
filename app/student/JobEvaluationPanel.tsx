"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  RefreshCw,
  Send,
} from "lucide-react";
import { api, postJson } from "@/lib/client-api";
import { Notice } from "@/app/components/Notice";

type ScoreKey = "hard" | "responsibility" | "consistency" | "burden";
type Score = Record<ScoreKey, number>;

type Evaluation = {
  id: string;
  sourcePeriodId: string;
  year: number;
  month: number;
  status: "open" | "closed" | "finalized";
  revision: number;
  jobs: Array<{
    classJobId: string;
    name: string;
    description: string;
    sortOrder: number;
  }>;
  submission: null | {
    submittedAt: number;
    revision: number;
    scores: Array<{ classJobId: string } & Score>;
  };
};

const criteria: Array<{ key: ScoreKey; label: string; question: string }> = [
  { key: "hard", label: "힘듦", question: "몸이나 시간을 얼마나 써야 하나요?" },
  { key: "responsibility", label: "책임감", question: "실수하면 학급에 미치는 영향이 큰가요?" },
  { key: "consistency", label: "꾸준함", question: "매일 또는 자주 해야 하나요?" },
  { key: "burden", label: "개인 부담", question: "담당 인원에 비해 한 사람의 부담이 큰가요?" },
];

const scoreLabels: Record<number, string> = {
  1: "매우 낮음",
  2: "낮음",
  3: "보통",
  4: "높음",
  5: "매우 높음",
};

function isStoredScore(value: unknown): value is Score {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const score = value as Record<string, unknown>;
  return criteria.every(({ key }) => (
    Number.isInteger(score[key])
    && Number(score[key]) >= 1
    && Number(score[key]) <= 5
  ));
}

function defaultScores(evaluation: Evaluation) {
  const stored = new Map(
    (evaluation.submission?.scores ?? []).map(({ classJobId, ...score }) => [classJobId, score]),
  );
  return Object.fromEntries(
    evaluation.jobs.map((job) => [
      job.classJobId,
      stored.get(job.classJobId) ?? { hard: 3, responsibility: 3, consistency: 3, burden: 3 },
    ]),
  ) as Record<string, Score>;
}

function storageKey(studentId: string, evaluation: Evaluation) {
  return `job_classroom_job_evaluation_v1:${studentId}:${evaluation.id}:${evaluation.revision}`;
}

export function JobEvaluationPanel({ studentId }: { studentId: string }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [scores, setScores] = useState<Record<string, Score>>({});
  const [confirmedJobIds, setConfirmedJobIds] = useState<string[]>([]);
  const [jobIndex, setJobIndex] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const jobTitleRef = useRef<HTMLHeadingElement>(null);

  const applyEvaluation = useCallback((next: Evaluation | null) => {
    setEvaluation(next);
    if (!next) {
      setScores({});
      setConfirmedJobIds([]);
      setJobIndex(0);
      return;
    }
    const initial = defaultScores(next);
    let initialConfirmedJobIds = next.submission
      ? next.jobs.map((job) => job.classJobId)
      : [];
    if (next.status === "open") {
      try {
        const local = JSON.parse(localStorage.getItem(storageKey(studentId, next)) || "null") as {
          scores?: Record<string, Score>;
          confirmedJobIds?: string[];
          baseResponseRevision?: number;
          jobIndex?: number;
        } | null;
        const serverResponseRevision = next.submission?.revision ?? 0;
        const localScoresAreCurrent = Boolean(
          local?.scores
          && local.baseResponseRevision === serverResponseRevision
          && Object.keys(local.scores).length === next.jobs.length
          && next.jobs.every((job) => isStoredScore(local.scores?.[job.classJobId])),
        );
        if (localScoresAreCurrent && local?.scores) {
          for (const job of next.jobs) {
            const saved = local.scores[job.classJobId];
            if (saved) initial[job.classJobId] = saved;
          }
        }
        if (!next.submission && localScoresAreCurrent && Array.isArray(local?.confirmedJobIds)) {
          const jobIds = new Set(next.jobs.map((job) => job.classJobId));
          initialConfirmedJobIds = local.confirmedJobIds.filter((jobId) => jobIds.has(jobId));
        }
        setJobIndex(localScoresAreCurrent
          ? Math.max(0, Math.min(Number(local?.jobIndex ?? 0), next.jobs.length - 1))
          : 0);
      } catch {
        setJobIndex(0);
      }
    } else {
      setJobIndex(0);
    }
    setScores(initial);
    setConfirmedJobIds(initialConfirmedJobIds);
  }, [studentId]);

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await api<{ evaluation: Evaluation | null }>("/api/student/job-evaluation");
      applyEvaluation(data.evaluation);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }, [applyEvaluation]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!evaluation || evaluation.status !== "open" || !Object.keys(scores).length) return;
    try {
      localStorage.setItem(
        storageKey(studentId, evaluation),
        JSON.stringify({
          scores,
          confirmedJobIds,
          jobIndex,
          baseResponseRevision: evaluation.submission?.revision ?? 0,
          updatedAt: Date.now(),
        }),
      );
    } catch {}
  }, [confirmedJobIds, evaluation, jobIndex, scores, studentId]);

  const currentJob = evaluation?.jobs[jobIndex] ?? null;
  const progress = evaluation?.jobs.length
    ? Math.round(((jobIndex + 1) / evaluation.jobs.length) * 100)
    : 0;
  const serializedScores = useMemo(() => (
    evaluation?.jobs.map((job) => ({
      classJobId: job.classJobId,
      ...(scores[job.classJobId] ?? {
        hard: 3,
        responsibility: 3,
        consistency: 3,
        burden: 3,
      }),
    })) ?? []
  ), [evaluation, scores]);

  function goToJob(nextIndex: number) {
    if (!evaluation) return;
    setJobIndex(Math.max(0, Math.min(nextIndex, evaluation.jobs.length - 1)));
    window.requestAnimationFrame(() => {
      jobTitleRef.current?.scrollIntoView({ block: "center" });
      jobTitleRef.current?.focus();
    });
  }

  function setScore(key: ScoreKey, value: number) {
    if (!currentJob) return;
    setConfirmedJobIds((current) => current.filter((jobId) => jobId !== currentJob.classJobId));
    setScores((current) => ({
      ...current,
      [currentJob.classJobId]: {
        ...(current[currentJob.classJobId] ?? {
          hard: 3,
          responsibility: 3,
          consistency: 3,
          burden: 3,
        }),
        [key]: value,
      },
    }));
  }

  function confirmCurrentAndNext() {
    if (!evaluation || !currentJob) return;
    setError("");
    setConfirmedJobIds((current) => (
      current.includes(currentJob.classJobId)
        ? current
        : [...current, currentJob.classJobId]
    ));
    goToJob(jobIndex + 1);
  }

  async function submit() {
    if (!evaluation || !currentJob) return;
    const confirmed = new Set(confirmedJobIds);
    confirmed.add(currentJob.classJobId);
    const missingIndex = evaluation.jobs.findIndex((job) => !confirmed.has(job.classJobId));
    setConfirmedJobIds([...confirmed]);
    if (missingIndex >= 0) {
      goToJob(missingIndex);
      setError("아직 확인하지 않은 직업이 있어요. 점수를 살펴본 뒤 ‘이 점수로 확인하고 다음’을 눌러 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await postJson<{
        evaluation: Evaluation;
      }>("/api/student/job-evaluation", {
        evaluationId: evaluation.id,
        expectedSessionRevision: evaluation.revision,
        expectedResponseRevision: evaluation.submission?.revision ?? 0,
        requestId: crypto.randomUUID(),
        scores: serializedScores,
      });
      try {
        localStorage.removeItem(storageKey(studentId, evaluation));
      } catch {}
      applyEvaluation(result.evaluation);
      setMessage(evaluation.submission ? "수정한 평가를 다시 제출했어요." : "직업평가를 제출했어요.");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="student-evaluation-card student-evaluation-loading" aria-live="polite">
        <RefreshCw aria-hidden="true" />
        <p>이번 달 평가를 확인하고 있어요.</p>
      </section>
    );
  }
  if (!evaluation) {
    if (!error) return null;
    return (
      <section className="student-evaluation-card" aria-live="polite">
        <div className="student-evaluation-heading">
          <span className="student-evaluation-icon"><ClipboardCheck aria-hidden="true" /></span>
          <div>
            <h2>직업평가를 불러오지 못했어요</h2>
            <p>인터넷 연결을 확인한 뒤 다시 시도해 주세요.</p>
          </div>
        </div>
        <Notice message={error} tone="error" />
        <button className="button button-light" onClick={() => void load()}>
          <RefreshCw aria-hidden="true" />다시 시도
        </button>
      </section>
    );
  }
  if (evaluation.status !== "open") {
    return (
      <section className="student-evaluation-card student-evaluation-closed">
        <span className="student-evaluation-icon"><CheckCircle2 aria-hidden="true" /></span>
        <div>
          <small>{evaluation.year}년 {evaluation.month}월 직업평가</small>
          <h2>{evaluation.submission ? "내 평가를 잘 제출했어요" : "이번 평가는 마감됐어요"}</h2>
          <p>{evaluation.submission
            ? "친구들의 평가와 선생님의 검토를 바탕으로 직업등급이 정해져요."
            : "다음 평가가 열리면 이곳에서 참여할 수 있어요."}</p>
        </div>
      </section>
    );
  }
  if (!currentJob) return null;

  const currentScore = scores[currentJob.classJobId] ?? {
    hard: 3,
    responsibility: 3,
    consistency: 3,
    burden: 3,
  };
  const isLast = jobIndex === evaluation.jobs.length - 1;
  return (
    <section className="student-evaluation-card" aria-labelledby="student-evaluation-title">
      <div className="student-evaluation-heading">
        <span className="student-evaluation-icon"><ClipboardCheck aria-hidden="true" /></span>
        <div>
          <small>{evaluation.year}년 {evaluation.month}월</small>
          <h2 id="student-evaluation-title">직업평가가 열렸어요</h2>
          <p>직업의 힘듦과 책임을 생각하며 1~5점으로 알려 주세요.</p>
        </div>
      </div>

      <div className="student-evaluation-progress" aria-label={`직업 ${jobIndex + 1}/${evaluation.jobs.length}`}>
        <div><b>직업 {jobIndex + 1} / {evaluation.jobs.length}</b><span>{progress}%</span></div>
        <div
          className="student-evaluation-progress-track"
          role="progressbar"
          aria-label="직업평가 진행률"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>

      <article className="student-evaluation-job" aria-live="polite">
        <p className="eyebrow">지금 평가할 직업</p>
        <h3 ref={jobTitleRef} tabIndex={-1}>{currentJob.name}</h3>
        <p>{currentJob.description}</p>
      </article>

      <div className="student-evaluation-questions">
        {criteria.map((criterion) => (
          <fieldset key={criterion.key}>
            <legend><b>{criterion.label}</b><span>{criterion.question}</span></legend>
            <div className="student-score-options">
              {[1, 2, 3, 4, 5].map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name={`${currentJob.classJobId}-${criterion.key}`}
                    value={value}
                    checked={currentScore[criterion.key] === value}
                    onChange={() => setScore(criterion.key, value)}
                  />
                  <b>{value}</b>
                  <span>{scoreLabels[value]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <Notice message={error || message} tone={error ? "error" : "success"} />
      <div className="student-evaluation-actions">
        <button
          className="button button-light"
          disabled={jobIndex === 0 || busy}
          onClick={() => goToJob(jobIndex - 1)}
        >
          <ChevronLeft aria-hidden="true" />이전 직업
        </button>
        {isLast ? (
          <button className="button button-student" disabled={busy} onClick={submit}>
            <Send aria-hidden="true" />
            {busy ? "제출하는 중…" : evaluation.submission ? "수정해서 다시 제출" : "전체 평가 제출"}
          </button>
        ) : (
          <button
            className="button button-student"
            disabled={busy}
            onClick={confirmCurrentAndNext}
          >
            이 점수로 확인하고 다음<ChevronRight aria-hidden="true" />
          </button>
        )}
      </div>
      {evaluation.submission && (
        <p className="student-evaluation-resubmit">이미 제출했지만 평가가 열려 있는 동안에는 수정할 수 있어요.</p>
      )}
    </section>
  );
}
