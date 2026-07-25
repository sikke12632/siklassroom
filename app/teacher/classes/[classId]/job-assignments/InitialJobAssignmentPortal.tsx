"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  Check,
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
    serverTime: {
      epochMs: number;
      iso: string;
      date: string;
      year: number;
      month: number;
      day: number;
      monthValue: string;
      label: string;
      timeZone: "Asia/Seoul";
    };
  };
  setupReady: boolean;
  setupStatus: "not_started" | "draft" | "completed";
  students: Student[];
  availableStudents: Student[];
  assignments: Assignment[];
  jobs: Job[];
};

type Mode = "random" | "manual";

function classLabel(classRoom: AssignmentResponse["class"] | null) {
  if (!classRoom) return "우리 반";
  return classRoom.display_name
    || `${classRoom.school_name} ${classRoom.grade}학년 ${classRoom.class_number}반`;
}

export function InitialJobAssignmentPortal({ classId }: { classId: string }) {
  const [data, setData] = useState<AssignmentResponse | null>(null);
  const [monthValue, setMonthValue] = useState("");
  const [mode, setMode] = useState<Mode>("random");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [candidateIds, setCandidateIds] = useState<string[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [drawnStudent, setDrawnStudent] = useState<{ name: string; number: number; job: string } | null>(null);

  const load = useCallback(async (requestedMonth?: string) => {
    setBusy(true);
    setError("");
    try {
      const [year, month] = requestedMonth?.split("-") ?? [];
      const query = year && month ? `?year=${year}&month=${month}` : "";
      const next = await api<AssignmentResponse>(
        `/api/classes/${classId}/job-assignments${query}`,
      );
      setData(next);
      setMonthValue(next.period.monthValue);
      setSelectedJobId((current) => {
        const selected = next.jobs.find((job) => job.id === current && job.remainingCapacity > 0);
        return selected ? selected.id : next.jobs.find((job) => job.remainingCapacity > 0)?.id ?? "";
      });
      setCandidateIds([]);
      setSelectedStudentId("");
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

  const selectedJob = useMemo(
    () => data?.jobs.find((job) => job.id === selectedJobId) ?? null,
    [data, selectedJobId],
  );
  const assignedCount = data?.assignments.length ?? 0;
  const totalStudents = data?.students.length ?? 0;

  function toggleCandidate(studentId: string) {
    setCandidateIds((current) => current.includes(studentId)
      ? current.filter((id) => id !== studentId)
      : [...current, studentId]);
  }

  async function drawRandom() {
    if (!data || !selectedJob) return;
    setBusy(true);
    setError("");
    setMessage("");
    setDrawnStudent(null);
    try {
      const result = await postJson<{
        assignment: {
          job: { name: string };
          student: { student_number: number; official_name: string };
          candidateCount: number;
        };
      }>(`/api/classes/${classId}/job-assignments/random`, {
        year: data.period.year,
        month: data.period.month,
        classJobId: selectedJob.id,
        candidateStudentIds: candidateIds,
      });
      setDrawnStudent({
        name: result.assignment.student.official_name,
        number: result.assignment.student.student_number,
        job: result.assignment.job.name,
      });
      setMessage(`${result.assignment.candidateCount}명의 희망자 중 한 명을 공정하게 뽑아 저장했어요.`);
      await load(data.period.monthValue);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function assignManual() {
    if (!data || !selectedJob || !selectedStudentId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const student = data.availableStudents.find((item) => item.id === selectedStudentId);
      await postJson(`/api/classes/${classId}/job-assignments/manual`, {
        year: data.period.year,
        month: data.period.month,
        classJobId: selectedJob.id,
        studentId: selectedStudentId,
      });
      setMessage(`${student?.student_number}번 ${student?.official_name} 학생을 ${selectedJob.name}에 배정하고 저장했어요.`);
      await load(data.period.monthValue);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeAssignment(assignment: Assignment) {
    if (!confirm(`${assignment.student_number}번 ${assignment.student_name} 학생의 ${assignment.job_name} 배정을 취소할까요?`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/classes/${classId}/job-assignments/${assignment.id}`, { method: "DELETE" });
      setMessage("배정을 취소했어요. 학생이 다시 배정 풀에 들어왔어요.");
      await load(data?.period.monthValue);
    } catch (reason) {
      setError((reason as Error).message);
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
          : <p>첫 직업 배정 화면을 준비하고 있어요…</p>}
      </main>
    );
  }

  return (
    <div className="job-page assignment-page">
      <header className="job-topbar">
        <Logo compact />
        <div>
          <strong>{classLabel(data.class)}</strong>
          <span>첫 직업 배정</span>
        </div>
        <div className="job-topbar-actions">
          <ThemeToggle compact />
          <a className="button button-light" href="/teacher"><ArrowLeft aria-hidden="true" />대시보드</a>
        </div>
      </header>

      <main className="job-main assignment-main">
        <section className="assignment-heading">
          <div>
            <p className="eyebrow">달력과 연결된 첫 배정</p>
            <h1>{data.period.label} 첫 직업을 정해요</h1>
            <p>
              서버 표준시를 서울 시간으로 확인해 현재 월을 자동 선택했어요.
              배정된 학생은 다음 선택과 추첨 풀에서 자동으로 빠집니다.
            </p>
          </div>
          <div className="assignment-calendar">
            <label htmlFor="assignment-month"><CalendarDays aria-hidden="true" />배정 월</label>
            <input
              id="assignment-month"
              type="month"
              min="2020-01"
              max="2100-12"
              value={monthValue}
              disabled={busy}
              onChange={(event) => {
                const next = event.target.value;
                setMonthValue(next);
                setDrawnStudent(null);
                load(next);
              }}
            />
            <small>
              <Check aria-hidden="true" />
              서버 확인: {data.period.serverTime.label} · {data.period.serverTime.timeZone}
            </small>
          </div>
        </section>

        <Notice message={error} tone="error" />
        <Notice message={message} tone="success" />

        {!data.setupReady ? (
          <section className="assignment-blocked panel">
            <span className="mode-icon" aria-hidden="true"><BriefcaseBusiness /></span>
            <p className="eyebrow">먼저 할 일</p>
            <h2>우리 반 직업을 확정해 주세요</h2>
            <p>
              {data.setupStatus === "draft"
                ? "저장한 직업 초안을 학생 수에 맞춰 확정하면 바로 첫 배정을 시작할 수 있어요."
                : "배정할 직업이 아직 없어요. 추천받거나 직접 만든 뒤 최종 확정해 주세요."}
            </p>
            <a className="button button-primary" href={`/teacher/classes/${classId}/jobs`}>
              직업 설정으로 이동
            </a>
          </section>
        ) : (
          <>
            <section className="assignment-status" aria-label="배정 현황">
              <div><UsersRound aria-hidden="true" /><span>전체 학생<strong>{totalStudents}명</strong></span></div>
              <div><UserCheck aria-hidden="true" /><span>배정 완료<strong>{assignedCount}명</strong></span></div>
              <div><RefreshCw aria-hidden="true" /><span>배정 대기<strong>{data.availableStudents.length}명</strong></span></div>
              <div className={assignedCount === totalStudents && totalStudents > 0 ? "complete" : ""}>
                <Check aria-hidden="true" /><span>진행률<strong>{totalStudents ? Math.round(assignedCount / totalStudents * 100) : 0}%</strong></span>
              </div>
            </section>

            <section className="assignment-layout">
              <div className="assignment-workspace panel">
                <div className="assignment-mode-tabs" role="tablist" aria-label="배정 방법">
                  <button
                    role="tab"
                    aria-selected={mode === "random"}
                    className={mode === "random" ? "active" : ""}
                    onClick={() => {
                      setMode("random");
                      setSelectedStudentId("");
                      setMessage("");
                    }}
                  >
                    <Dices aria-hidden="true" />랜덤으로 뽑기
                  </button>
                  <button
                    role="tab"
                    aria-selected={mode === "manual"}
                    className={mode === "manual" ? "active" : ""}
                    onClick={() => {
                      setMode("manual");
                      setCandidateIds([]);
                      setMessage("");
                    }}
                  >
                    <UserCheck aria-hidden="true" />선생님이 선택
                  </button>
                </div>

                <div className="assignment-step">
                  <span>1</span>
                  <div><h2>직업 선택</h2><p>남은 자리가 있는 직업을 골라 주세요.</p></div>
                </div>
                <div className="assignment-job-grid">
                  {data.jobs.map((job) => (
                    <button
                      key={job.id}
                      className={selectedJobId === job.id ? "selected" : ""}
                      disabled={job.remainingCapacity === 0 || busy}
                      onClick={() => {
                        setSelectedJobId(job.id);
                        setCandidateIds([]);
                        setSelectedStudentId("");
                        setDrawnStudent(null);
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
                    <h2>{mode === "random" ? "희망자 체크" : "학생 선택"}</h2>
                    <p>
                      {mode === "random"
                        ? "이 직업을 희망한 학생만 체크하면 그 안에서 한 명을 뽑아요."
                        : "직업에 배정할 학생 한 명을 직접 선택해요."}
                    </p>
                  </div>
                </div>

                {data.availableStudents.length ? (
                  <div className="assignment-student-grid">
                    {data.availableStudents.map((student) => {
                      const checked = mode === "random"
                        ? candidateIds.includes(student.id)
                        : selectedStudentId === student.id;
                      return (
                        <label key={student.id} className={checked ? "selected" : ""}>
                          <input
                            type={mode === "random" ? "checkbox" : "radio"}
                            name={mode === "manual" ? "assignment-student" : undefined}
                            checked={checked}
                            disabled={busy || !selectedJob}
                            onChange={() => mode === "random"
                              ? toggleCandidate(student.id)
                              : setSelectedStudentId(student.id)}
                          />
                          <span>{student.student_number}</span>
                          <b>{student.official_name}</b>
                          <Check aria-hidden="true" />
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="assignment-empty">
                    <Check aria-hidden="true" />
                    <h3>{totalStudents ? "모든 학생의 첫 직업을 배정했어요" : "등록된 학생이 없어요"}</h3>
                    <p>{totalStudents ? "아래 배정표에서 결과를 확인할 수 있어요." : "학생 명단을 먼저 등록해 주세요."}</p>
                  </div>
                )}

                {drawnStudent && (
                  <div className="draw-result" role="status">
                    <Dices aria-hidden="true" />
                    <span><small>{drawnStudent.job} 당첨</small><strong>{drawnStudent.number}번 {drawnStudent.name}</strong></span>
                  </div>
                )}

                <div className="assignment-action">
                  <span>
                    {selectedJob
                      ? `${selectedJob.name} · ${selectedJob.remainingCapacity}자리 남음`
                      : "남은 자리가 있는 직업을 선택해 주세요"}
                  </span>
                  {mode === "random" ? (
                    <button
                      className="button button-primary button-large"
                      disabled={busy || !selectedJob || candidateIds.length === 0}
                      onClick={drawRandom}
                    >
                      <Dices aria-hidden="true" />
                      {busy ? "뽑는 중…" : `희망자 ${candidateIds.length}명 중 1명 뽑기`}
                    </button>
                  ) : (
                    <button
                      className="button button-primary button-large"
                      disabled={busy || !selectedJob || !selectedStudentId}
                      onClick={assignManual}
                    >
                      <UserCheck aria-hidden="true" />
                      {busy ? "저장 중…" : "선택한 학생 배정·저장"}
                    </button>
                  )}
                </div>
              </div>

              <aside className="assignment-roster panel">
                <div>
                  <p className="eyebrow">{data.period.label}</p>
                  <h2>현재 첫 배정표</h2>
                  <p>학생을 취소하면 즉시 배정 풀로 돌아옵니다.</p>
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
                            <span><b>{student.studentNumber}번</b> {student.name}<small>{student.method === "random" ? "랜덤" : "선택"}</small></span>
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
          </>
        )}
      </main>
    </div>
  );
}
