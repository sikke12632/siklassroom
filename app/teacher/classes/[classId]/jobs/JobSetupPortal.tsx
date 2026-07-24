"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, PencilLine, Sparkles } from "lucide-react";
import { Logo } from "@/app/components/Logo";
import { Notice } from "@/app/components/Notice";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { api, postJson } from "@/lib/client-api";
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
};

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

export function JobSetupPortal({ classId }: { classId: string }) {
  const [data, setData] = useState<SetupResponse | null>(null);
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

  const hydrate = useCallback((next: SetupResponse) => {
    setData(next);
    setMode(next.setup.setupMode);
    setSurvey(next.setup.surveyAnswers || emptySurvey);
    setJobs(next.setup.draftJobs || []);
    setStep(next.setup.status === "not_started" ? 1 : Math.max(1, next.setup.lastStep));
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      hydrate(await api<SetupResponse>(`/api/classes/${classId}/job-setup`));
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

  const capacity = useMemo(() => sumCapacity(jobs), [jobs]);
  const capacityGap = data ? data.studentCount - capacity : 0;
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

  async function complete() {
    if (!data || !mode) return;
    if (capacity !== data.studentCount) {
      setError(`자리 ${capacity}개를 학생 ${data.studentCount}명과 맞춘 뒤 확정해 주세요.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await postJson(`/api/classes/${classId}/job-setup/complete`, {
        expectedRevision: data.setup.revision,
        setupMode: mode,
        surveyAnswers: survey,
        jobs,
      });
      window.location.href = "/teacher";
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
        {error ? <a className="button button-primary" href="/teacher">교사 대시보드로</a> : <p>우리 반 직업을 불러오고 있어요…</p>}
      </main>
    );
  }

  return (
    <div className="job-page">
      <header className="job-topbar">
        <Logo compact />
        <div>
          <strong>{classLabel(data.class)}</strong>
          <span>우리 반 직업 설정</span>
        </div>
        <div className="job-topbar-actions"><ThemeToggle compact /><a className="button button-light" href="/teacher">나가기</a></div>
      </header>

      <main className="job-main">
        <section className="job-progress" aria-label="직업 설정 진행 단계">
          {["방식 선택", "우리 반 질문", "직업 다듬기", "최종 확인"].map((label, index) => {
            const number = index + 1;
            return (
              <div key={label} className={number < step ? "done" : number === step ? "current" : ""}>
                <b>{number < step ? "✓" : number}</b><span>{label}</span>
              </div>
            );
          })}
        </section>

        <Notice message={error} tone="error" />
        <Notice message={message} tone="success" />
        {data.studentCountChanged && (
          <div className="job-warning" role="alert">
            <b>학생 명단이 달라졌어요.</b>
            <span>저장 당시 {data.setup.studentCountSnapshot}명, 현재 {data.studentCount}명이에요. 자동 맞춤 후 다시 확정해 주세요.</span>
          </div>
        )}

        {step === 1 && (
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
                setStep(data.setup.lastStep);
              }}>저장한 {data.setup.status === "completed" ? "확정본" : "초안"} 이어서 보기</button>
            )}
          </section>
        )}

        {step === 2 && (
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

        {step === 3 && (
          <section className="job-editor-layout">
            <div className="job-editor-main">
              <div className="stage-heading">
                <div><p className="eyebrow">3단계 · 직업 다듬기</p><h1>{mode === "recommended" ? "추천 결과를 우리 반답게 다듬어요" : "우리 반 직업을 직접 만들어요"}</h1></div>
                <button className="button button-light" disabled={busy || !mode} onClick={() => saveDraft(3)}>{busy ? "저장 중…" : "초안 저장"}</button>
              </div>
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
                <small>{capacityGap === 0 ? "딱 맞아요" : capacityGap > 0 ? `${capacityGap}자리 부족` : `${Math.abs(capacityGap)}자리 초과`}</small>
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
                  const added = jobs.some((job) => job.id === `${classId}:${template.id}`);
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
              <div className="adjust-preview" role="dialog" aria-modal="true" aria-labelledby="adjust-title">
                <div>
                  <p className="eyebrow">변경안 미리보기</p>
                  <h2 id="adjust-title">학생 {data.studentCount}명에 맞춘 결과예요</h2>
                  <ul>{preview.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                  <div className="preview-comparison">
                    <span>현재 <b>{capacity}자리</b></span><i>→</i><span>변경 후 <b>{sumCapacity(preview.jobs)}자리</b></span>
                  </div>
                  <div className="stage-actions">
                    <button className="button button-light" onClick={() => setPreview(null)}>취소</button>
                    <button className="button button-primary" onClick={applyAdjustment}>이 변경안 적용</button>
                  </div>
                </div>
              </div>
            )}

            <div className="editor-footer">
              <button className="button button-light" onClick={() => mode === "recommended" ? setStep(2) : setStep(1)}>이전</button>
              <span>{jobs.length}개 직업 · {capacity}자리</span>
              <button className="button button-primary" disabled={!jobs.length || capacity !== data.studentCount} onClick={async () => {
                const saved = await saveDraft(4);
                if (saved) setStep(4);
              }}>최종 확인</button>
            </div>
          </section>
        )}

        {step === 4 && (
          <section className="job-stage confirm-stage">
            <p className="eyebrow">4단계 · 최종 확인</p>
            <h1>{data.setup.status === "completed" ? "확정한 우리 반 직업이에요" : "이대로 우리 반 직업을 확정할까요?"}</h1>
            <div className="confirm-summary">
              <div><span>참여 학생</span><strong>{data.studentCount}명</strong></div>
              <div><span>직업 종류</span><strong>{jobs.length}개</strong></div>
              <div className={capacity === data.studentCount ? "ok" : "bad"}><span>전체 자리</span><strong>{capacity}자리</strong></div>
            </div>
            {capacity !== data.studentCount && <Notice message={`학생 수와 자리가 ${Math.abs(data.studentCount - capacity)}개 달라요. 자동 맞춤 후 확정해 주세요.`} tone="error" />}
            <div className="confirm-job-grid">
              {jobs.map((job) => (
                <article key={job.id}>
                  <span>{data.categories[job.category]}</span>
                  <h2>{job.name}</h2>
                  <p>{job.description}</p>
                  <b>{job.memberCapacity}명</b>
                </article>
              ))}
            </div>
            <div className="stage-actions">
              <button className="button button-light" onClick={() => setStep(3)}>다시 편집</button>
              <button className="button button-primary button-large" disabled={busy || capacity !== data.studentCount || !jobs.length} onClick={complete}>
                {busy ? "확정 중…" : data.setup.status === "completed" ? "수정 내용 다시 확정" : "우리 반 직업 확정"}
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
