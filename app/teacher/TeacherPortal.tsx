"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, BriefcaseBusiness, Home, LogOut, Plus, RefreshCw, UsersRound } from "lucide-react";
import { Logo } from "@/app/components/Logo";
import { Notice } from "@/app/components/Notice";
import { PrintCards, RegistrationCard } from "@/app/components/PrintCards";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { api, friendlyStatus, patchJson, postJson } from "@/lib/client-api";

type TeacherActor = { type: "teacher"; id: string; email: string };
type ClassRoom = {
  id: string; school_name: string; school_year: number; grade: number; class_number: number;
  display_name: string | null; status: string; student_count?: number; active_count?: number; action_count?: number;
  job_student_count?: number; job_status?: "not_started" | "draft" | "completed";
  job_count?: number; job_capacity?: number; job_student_snapshot?: number; job_student_count_changed?: number;
};
type Student = {
  id: string; student_number: number; official_name: string; status: string;
  qr_generation: number; activated_at: number | null;
};
type DraftStudent = { key: string; number: string; name: string };

const currentYear = new Date().getFullYear();
const emptyDraft = (number = ""): DraftStudent => ({ key: crypto.randomUUID(), number, name: "" });

export function TeacherPortal() {
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadClasses = useCallback(async (preferredId?: string) => {
    const data = await api<{ classes: ClassRoom[] }>("/api/classes");
    setClasses(data.classes);
    const id = preferredId || selectedClassId || data.classes[0]?.id || null;
    setSelectedClassId(id);
    setShowClassForm(data.classes.length === 0);
    return id;
  }, [selectedClassId]);

  const loadClass = useCallback(async (id: string) => {
    const data = await api<{ class: ClassRoom; students: Student[] }>(`/api/classes/${id}/students`);
    setClassRoom(data.class);
    setStudents(data.students);
  }, []);

  useEffect(() => {
    api<{ actor: TeacherActor | { type: "student" } | null }>("/api/session")
      .then(async ({ actor: sessionActor }) => {
        if (sessionActor?.type === "teacher") {
          setActor(sessionActor);
          await loadClasses();
        } else if (sessionActor?.type === "student") {
          setWrongEntrance(true);
        }
      })
      .catch(() => setError("접속 상태를 확인하지 못했어요. 새로고침해 주세요."))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!actor || !selectedClassId) return;
    const frame = requestAnimationFrame(() => loadClass(selectedClassId).catch((reason) => setError(reason.message)));
    return () => cancelAnimationFrame(frame);
  }, [actor, selectedClassId, loadClass]);

  async function logout() {
    await api("/api/session", { method: "DELETE" });
    window.location.href = "/teacher";
  }

  if (loading) return <LoadingScreen label="교사 화면을 준비하고 있어요" />;
  if (wrongEntrance) return (
    <CenteredCard>
      <Logo />
      <h1>학생으로 로그인되어 있어요</h1>
      <p>학생 화면으로 이동하거나 로그아웃한 뒤 교사 계정으로 들어와 주세요.</p>
      <div className="button-stack"><a className="button button-primary" href="/student">학생 화면으로</a><button className="button button-light" onClick={logout}>로그아웃</button></div>
    </CenteredCard>
  );
  if (!actor) return <TeacherAuth mode={authMode} setMode={setAuthMode} onAuthenticated={(teacher) => { setActor(teacher); loadClasses(); }} />;

  const selectedSummary = classes.find((item) => item.id === selectedClassId);
  const classLabel = classRoom ? (classRoom.display_name || `${classRoom.school_name} ${classRoom.grade}학년 ${classRoom.class_number}반`) : "우리 반";
  const pendingCount = students.filter((student) => student.status === "pending").length;
  const activeCount = students.filter((student) => student.status === "active").length;
  const attentionCount = students.filter((student) => student.status === "reset_required" || student.status === "locked").length;

  return (
    <div className="teacher-shell">
      <aside className="teacher-sidebar">
        <Logo compact />
        <nav className="primary-nav" aria-label="주요 메뉴">
          <a className="active" href="#dashboard"><Home aria-hidden="true" /><span>홈</span></a>
          <a href="#students"><UsersRound aria-hidden="true" /><span>학생 관리</span></a>
          {selectedClassId && <a href={`/teacher/classes/${selectedClassId}/jobs`}><BriefcaseBusiness aria-hidden="true" /><span>우리 반 직업</span></a>}
        </nav>
        <div className="sidebar-section-title">내 학급</div>
        <nav className="class-nav">
          {classes.map((item) => (
            <button key={item.id} className={selectedClassId === item.id && !showClassForm ? "active" : ""} onClick={() => { setShowClassForm(false); setSelectedClassId(item.id); }}>
              <span>{item.display_name || `${item.grade}학년 ${item.class_number}반`}</span>
              <small>{item.school_name} · {item.school_year}</small>
            </button>
          ))}
        </nav>
        <button className="sidebar-add" onClick={() => setShowClassForm(true)}><Plus aria-hidden="true" /> 새 학급 만들기</button>
        <div className="sidebar-account">
          <ThemeToggle />
          <span>{actor.email}</span>
          <button onClick={logout}><LogOut aria-hidden="true" />로그아웃</button>
        </div>
      </aside>

      <main className="teacher-main">
        <header className="mobile-teacher-header"><Logo compact /><div><ThemeToggle compact /><button onClick={logout} aria-label="로그아웃"><LogOut aria-hidden="true" /></button></div></header>
        <Notice message={error} tone="error" />
        <Notice message={message} tone="success" />

        {showClassForm ? (
          <ClassCreateForm busy={busy} onSubmit={async (input) => {
            setBusy(true); setError("");
            try {
              const data = await postJson<{ class: ClassRoom }>("/api/classes", input);
              await loadClasses(data.class.id);
              setShowClassForm(false);
              setSelectedClassId(data.class.id);
              setMessage("학급을 만들었어요. 이제 학생 명단을 입력해 주세요.");
            } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
          }} />
        ) : classRoom && selectedSummary ? (
          <>
            <section className="dashboard-heading" id="dashboard">
              <div><p className="eyebrow">{classRoom.school_year}학년도</p><h1>{classLabel}</h1><p>{classRoom.school_name} · {classRoom.grade}학년 {classRoom.class_number}반</p></div>
              <button className="button button-light" onClick={() => loadClass(classRoom.id)}><RefreshCw aria-hidden="true" />새로고침</button>
            </section>
            <section className="setup-progress" aria-label="학급 준비 단계">
              <div className="done"><b>1</b><span>학급 만들기<small>완료</small></span></div>
              <i />
              <div className={students.length ? "done" : "current"}><b>2</b><span>학생 명단<small>{students.length ? `${students.length}명` : "입력 중"}</small></span></div>
              <i />
              <div className={activeCount === students.length && students.length ? "done" : students.length ? "current" : ""}><b>3</b><span>QR 등록<small>{students.length ? `${activeCount}/${students.length}명` : "대기"}</small></span></div>
            </section>

            <section className={`job-dashboard-card ${selectedSummary.job_student_count_changed ? "needs-review" : selectedSummary.job_status || "not_started"}`}>
              <div className="job-dashboard-icon" aria-hidden="true"><BriefcaseBusiness /></div>
              <div>
                <p className="eyebrow">우리 반 운영</p>
                <h2>우리 반 직업</h2>
                {selectedSummary.job_student_count_changed ? (
                  <p><b>학생 명단이 달라졌어요.</b> 저장 당시 {selectedSummary.job_student_snapshot}명에서 현재 {selectedSummary.job_student_count}명으로 바뀌었어요.</p>
                ) : selectedSummary.job_status === "completed" ? (
                  <p><b>직업 구성이 확정됐어요.</b> {selectedSummary.job_count}개 직업, {selectedSummary.job_capacity}자리를 운영해요.</p>
                ) : selectedSummary.job_status === "draft" ? (
                  <p><b>저장한 초안이 있어요.</b> {selectedSummary.job_count}개 직업, {selectedSummary.job_capacity}자리부터 이어서 만들 수 있어요.</p>
                ) : (
                  <p><b>아직 직업을 정하지 않았어요.</b> 간단한 질문으로 추천받거나 직접 만들 수 있어요.</p>
                )}
              </div>
              <a className="button button-primary" href={`/teacher/classes/${classRoom.id}/jobs`}>
                {selectedSummary.job_student_count_changed ? "자리 다시 맞추기" : selectedSummary.job_status === "completed" ? "확인·수정" : selectedSummary.job_status === "draft" ? "초안 이어서" : "직업 설정하기"}
              </a>
            </section>

            {students.length === 0 ? (
              <RosterEditor onSaved={(newCards) => { setCards(newCards); setAddingStudents(false); loadClass(classRoom.id); loadClasses(classRoom.id); }} classId={classRoom.id} />
            ) : (
              <>
                <section className="stat-grid">
                  <div><span>전체 학생</span><strong>{students.length}</strong><small>명</small></div>
                  <div><span>등록 완료</span><strong>{activeCount}</strong><small>명</small></div>
                  <div><span>등록 전</span><strong>{pendingCount}</strong><small>명</small></div>
                  <div className={attentionCount ? "attention" : ""}><span>확인 필요</span><strong>{attentionCount}</strong><small>명</small></div>
                </section>
                {addingStudents && (
                  <RosterEditor
                    classId={classRoom.id}
                    onCancel={() => setAddingStudents(false)}
                    onSaved={(newCards) => {
                      setCards(newCards);
                      setAddingStudents(false);
                      loadClass(classRoom.id);
                      loadClasses(classRoom.id);
                    }}
                  />
                )}
                <section className="panel roster-panel" id="students">
                  <div className="panel-heading">
                    <div><p className="eyebrow">학생 계정</p><h2>우리 반 명단</h2><p>이름이나 번호를 고쳐도 같은 학생의 기록으로 이어집니다.</p></div>
                    <div className="button-row">
                      <button className="button button-light" onClick={() => setAddingStudents((value) => !value)}>{addingStudents ? "추가 취소" : "전입생 추가"}</button>
                      <button className="button button-primary" disabled={!pendingCount && !students.some((s) => s.status === "reset_required")} onClick={async () => {
                        if (!confirm("등록 전 학생의 기존 QR을 모두 무효로 하고 새 QR을 만들까요?")) return;
                        setBusy(true); setError("");
                        try {
                          const data = await postJson<{ cards: RegistrationCard[] }>(`/api/classes/${classRoom.id}/registration-tokens`, {});
                          setCards(data.cards);
                          setMessage(`${data.cards.length}명의 새 QR 카드를 만들었어요.`);
                        } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
                      }}>{busy ? "만드는 중…" : "미등록 QR 인쇄"}</button>
                    </div>
                  </div>
                  <StudentTable students={students} busy={busy} onBusy={setBusy} onError={setError} onMessage={setMessage} onCards={setCards} onReload={() => { loadClass(classRoom.id); loadClasses(classRoom.id); }} />
                </section>
              </>
            )}
          </>
        ) : <LoadingScreen label="학급 정보를 불러오고 있어요" />}
      </main>
      {cards.length > 0 && <PrintCards cards={cards} classLabel={classLabel} onClose={() => setCards([])} />}
    </div>
  );
}

function TeacherAuth({ mode, setMode, onAuthenticated }: { mode: "login" | "signup" | "forgot"; setMode: (mode: "login" | "signup" | "forgot") => void; onAuthenticated: (teacher: TeacherActor) => void }) {
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
        const data = await postJson<{ message: string; developmentResetUrl?: string; emailConfigured: boolean }>("/api/teacher/password/request", { email });
        setMessage(data.message + (!data.emailConfigured && !data.developmentResetUrl ? " 이메일 발송 설정이 끝나면 메일로 받을 수 있어요." : ""));
        setDevelopmentUrl(data.developmentResetUrl || "");
      } else {
        if (mode === "signup" && password !== confirmPassword) throw new Error("비밀번호가 서로 달라요.");
        const data = await postJson<{ teacher: TeacherActor }>(`/api/teacher/${mode}`, { email, password });
        onAuthenticated({ ...data.teacher, type: "teacher" });
      }
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="auth-page">
      <header><Logo /><div className="header-actions"><ThemeToggle compact /><a href="/student">학생 로그인</a></div></header>
      <main className="auth-layout">
        <section className="auth-promise"><p className="eyebrow">교사 계정</p><h1>{mode === "signup" ? "반가워요, 선생님." : mode === "forgot" ? "비밀번호를 다시 만들어요." : "우리 반 준비를 이어갈까요?"}</h1><p>학급과 학생 계정은 선생님 계정 안에서 안전하게 관리됩니다.</p><ul><li>여러 학급을 한 계정에서 관리</li><li>학생 비밀번호는 선생님도 볼 수 없음</li><li>이름·번호 수정 후에도 기록 유지</li></ul></section>
        <section className="auth-card">
          {mode !== "forgot" && <div className="segmented"><button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>로그인</button><button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>처음 가입</button></div>}
          <h2>{mode === "login" ? "교사 로그인" : mode === "signup" ? "교사 가입" : "비밀번호 찾기"}</h2>
          <form onSubmit={submit} className="form-stack">
            <label>이메일<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teacher@school.kr" autoComplete="email" required /></label>
            {mode !== "forgot" && <label>비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "signup" ? "8자 이상" : "비밀번호"} autoComplete={mode === "signup" ? "new-password" : "current-password"} required /></label>}
            {mode === "signup" && <label>비밀번호 확인<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required /></label>}
            <Notice message={error} tone="error" /><Notice message={message} tone="success" />
            {developmentUrl && <a className="dev-reset-link" href={developmentUrl}>개발 확인용 재설정 링크 열기</a>}
            <button className="button button-primary button-large" disabled={busy}>{busy ? "확인 중…" : mode === "login" ? "로그인" : mode === "signup" ? "가입하고 학급 만들기" : "재설정 메일 받기"}</button>
          </form>
          {mode === "login" && <button className="text-button" onClick={() => setMode("forgot")}>비밀번호를 잊었어요</button>}
          {mode === "forgot" && <button className="text-button" onClick={() => setMode("login")}>로그인으로 돌아가기</button>}
        </section>
      </main>
    </div>
  );
}

function ClassCreateForm({ busy, onSubmit }: { busy: boolean; onSubmit: (input: Record<string, string | number>) => Promise<void> }) {
  const [schoolName, setSchoolName] = useState("");
  const [schoolYear, setSchoolYear] = useState(String(currentYear));
  const [grade, setGrade] = useState("");
  const [classNumber, setClassNumber] = useState("");
  const [displayName, setDisplayName] = useState("");
  return (
    <section className="onboarding-card">
      <div className="onboarding-step">1 / 3</div><p className="eyebrow">첫 학급 만들기</p><h1>우리 반을 알려 주세요</h1><p>학생에게는 학교·학년·반만 보여요. 내부에서는 학급마다 안전한 고유 번호를 따로 사용합니다.</p>
      <form className="class-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ schoolName, schoolYear: Number(schoolYear), grade: Number(grade), classNumber: Number(classNumber), displayName }); }}>
        <label className="wide">학교명<input value={schoolName} onChange={(event) => setSchoolName(event.target.value)} placeholder="예: 새봄초등학교" autoFocus required /></label>
        <label>학년도<input type="number" min="2020" max="2100" value={schoolYear} onChange={(event) => setSchoolYear(event.target.value)} required /></label>
        <label>학년<select value={grade} onChange={(event) => setGrade(event.target.value)} required><option value="">선택</option>{[1,2,3,4,5,6].map((item) => <option key={item} value={item}>{item}학년</option>)}</select></label>
        <label>반<input type="number" min="1" max="30" value={classNumber} onChange={(event) => setClassNumber(event.target.value)} placeholder="예: 3" required /></label>
        <label className="wide">학급 표시 이름 <small>선택</small><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="예: 별빛반 (비워도 괜찮아요)" /></label>
        <button className="button button-primary button-large wide" disabled={busy}>{busy ? "만드는 중…" : "학급 만들고 학생 입력하기 →"}</button>
      </form>
    </section>
  );
}

function RosterEditor({ classId, onSaved, onCancel }: { classId: string; onSaved: (cards: RegistrationCard[]) => void; onCancel?: () => void }) {
  const [rows, setRows] = useState<DraftStudent[]>(() => Array.from({ length: 5 }, (_, index) => emptyDraft(String(index + 1))));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const validCount = rows.filter((row) => row.number.trim() && row.name.trim()).length;
  const duplicateNumbers = useMemo(() => rows.filter((row) => row.number.trim()).filter((row, index, source) => source.findIndex((other) => other.number === row.number) !== index).map((row) => row.number), [rows]);

  function update(key: string, field: "number" | "name", value: string) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, [field]: value } : row));
  }
  function handleEnter(event: KeyboardEvent<HTMLInputElement>, index: number, field: "number" | "name") {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (field === "number") {
      document.querySelector<HTMLInputElement>(`[data-roster-name="${rows[index].key}"]`)?.focus();
      return;
    }
    if (index === rows.length - 1) {
      const next = emptyDraft(String((Number(rows.at(-1)?.number) || rows.length) + 1));
      setRows((current) => [...current, next]);
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-roster-number="${next.key}"]`)?.focus());
      return;
    }
    document.querySelector<HTMLInputElement>(`[data-roster-number="${rows[index + 1].key}"]`)?.focus();
  }

  async function save() {
    setError("");
    const complete = rows.filter((row) => row.number.trim() || row.name.trim());
    if (!complete.length) return setError("학생을 한 명 이상 입력해 주세요.");
    if (complete.some((row) => !row.number.trim() || !row.name.trim())) return setError("번호나 이름이 빈 줄이 있어요.");
    if (duplicateNumbers.length) return setError(`${[...new Set(duplicateNumbers)].join(", ")}번이 두 번 입력되었어요.`);
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
      <div className="panel-heading"><div><p className="eyebrow">2 / 3 · 학생 명단</p><h2>{onCancel ? "추가할 학생을 입력해 주세요" : "번호와 이름을 차례로 입력해 주세요"}</h2><p>Enter 키로 다음 칸으로 이동할 수 있어요. 같은 이름은 괜찮지만 번호는 겹치면 안 돼요.</p></div><div className="button-row"><span className="count-chip">{validCount}명 입력</span>{onCancel && <button className="text-button" onClick={onCancel}>취소</button>}</div></div>
      <div className="roster-entry-list">
        <div className="roster-entry-head"><span>번호</span><span>공식 이름</span><span /></div>
        {rows.map((row, index) => (
          <div className="roster-entry-row" key={row.key}>
            <input data-roster-number={row.key} inputMode="numeric" value={row.number} onChange={(event) => update(row.key, "number", event.target.value.replace(/\D/g, "").slice(0, 2))} onKeyDown={(event) => handleEnter(event, index, "number")} aria-label={`${index + 1}번째 학생 번호`} />
            <input data-roster-name={row.key} value={row.name} onChange={(event) => update(row.key, "name", event.target.value)} onKeyDown={(event) => handleEnter(event, index, "name")} placeholder="학생 이름" aria-label={`${index + 1}번째 학생 이름`} />
            <button aria-label="이 행 지우기" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}>×</button>
          </div>
        ))}
      </div>
      <button className="add-row-button" onClick={() => setRows((current) => [...current, emptyDraft(String((Number(current.at(-1)?.number) || current.length) + 1))])}>+ 학생 행 추가</button>
      <Notice message={error} tone="error" />
      <div className="panel-footer"><p>저장하면 학생마다 일회용 등록 QR이 만들어집니다.</p><button className="button button-primary button-large" disabled={busy} onClick={save}>{busy ? "계정을 만드는 중…" : `${validCount || "학생"}명 계정 만들고 QR 보기 →`}</button></div>
    </section>
  );
}

function StudentTable({ students, busy, onBusy, onError, onMessage, onCards, onReload }: {
  students: Student[]; busy: boolean; onBusy: (value: boolean) => void; onError: (value: string) => void;
  onMessage: (value: string) => void; onCards: (cards: RegistrationCard[]) => void; onReload: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNumber, setEditNumber] = useState("");
  const [editName, setEditName] = useState("");

  async function updateStudent(student: Student, input: Record<string, string | number>) {
    onBusy(true); onError("");
    try { await patchJson(`/api/students/${student.id}`, input); onMessage("학생 정보를 고쳤어요."); setEditingId(null); onReload(); }
    catch (reason) { onError((reason as Error).message); } finally { onBusy(false); }
  }
  async function issueCard(student: Student) {
    const isReset = student.status === "active";
    if (isReset && !confirm(`${student.student_number}번 ${student.official_name} 학생의 기존 비밀번호를 초기화할까요? 학생은 새 QR로 비밀번호를 다시 정하게 됩니다.`)) return;
    onBusy(true); onError("");
    try {
      const data = await postJson<{ card: RegistrationCard }>(`/api/students/${student.id}/registration-token`, {});
      onCards([data.card]);
      onMessage(isReset ? "기존 로그인은 종료했고 새 비밀번호 설정 QR을 만들었어요." : "이전 QR을 무효로 하고 새 QR을 만들었어요.");
      onReload();
    } catch (reason) { onError((reason as Error).message); } finally { onBusy(false); }
  }

  return (
    <div className="student-table-wrap">
      <table className="student-table"><thead><tr><th>번호</th><th>공식 이름</th><th>계정 상태</th><th>관리</th></tr></thead><tbody>
        {students.map((student) => (
          <tr key={student.id} className={student.status === "excluded" ? "muted-row" : ""}>
            <td>{editingId === student.id ? <input className="table-input number" inputMode="numeric" value={editNumber} onChange={(event) => setEditNumber(event.target.value.replace(/\D/g, ""))} /> : <b>{student.student_number}</b>}</td>
            <td>{editingId === student.id ? <input className="table-input" value={editName} onChange={(event) => setEditName(event.target.value)} /> : <strong>{student.official_name}</strong>}</td>
            <td><span className={`status-badge status-${student.status}`}>{friendlyStatus(student.status)}</span></td>
            <td><div className="table-actions">
              {editingId === student.id ? <><button onClick={() => updateStudent(student, { number: Number(editNumber), name: editName })}>저장</button><button onClick={() => setEditingId(null)}>취소</button></> : <>
                <button onClick={() => { setEditingId(student.id); setEditNumber(String(student.student_number)); setEditName(student.official_name); }}>수정</button>
                {student.status !== "excluded" && <button onClick={() => issueCard(student)}>{student.status === "active" ? "비밀번호 초기화" : "QR 재발급"}</button>}
                {student.status === "locked" ? <button onClick={() => updateStudent(student, { status: student.activated_at ? "active" : "pending" })}>잠금 해제</button> : student.status !== "excluded" && <button onClick={() => updateStudent(student, { status: "locked" })}>잠금</button>}
                {student.status !== "excluded" && <button className="danger-link" onClick={() => { if (confirm("학생을 명단에서 제외할까요? 기록은 삭제하지 않고 보존합니다.")) updateStudent(student, { status: "excluded" }); }}>제외</button>}
              </>}
            </div></td>
          </tr>
        ))}
      </tbody></table>
      {busy && <div className="table-busy">변경 내용을 안전하게 저장하고 있어요…</div>}
    </div>
  );
}

function LoadingScreen({ label }: { label: string }) { return <div className="loading-screen"><span className="loading-mark"><BookOpen aria-hidden="true" /></span><p>{label}</p></div>; }
function CenteredCard({ children }: { children: React.ReactNode }) { return <main className="centered-page"><section className="centered-card">{children}</section></main>; }
