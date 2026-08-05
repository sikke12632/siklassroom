"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ClipboardList, KeyRound, LogOut, Megaphone, School, Settings2, ShieldCheck, UsersRound } from "lucide-react";
import { Logo } from "@/app/components/Logo";
import { Notice } from "@/app/components/Notice";
import { ThemeToggle } from "@/app/components/ThemeToggle";

type Tab = "home" | "invites" | "teachers" | "schools" | "jobs" | "notice" | "logs";
type Summary = {
  pendingTeachers: number;
  activeTeachers: number;
  revokedTeachers: number;
  pendingSchools: number;
  activeInviteCodes: number;
  activeAnnouncements: number;
};
type InviteCode = {
  id: string; status: string; expires_at: number; used_at: number | null;
  used_by_email: string | null; created_at: number; memo: string | null;
};
type Teacher = {
  id: string; email: string; status: string; email_verified_at: number | null;
  teacher_access_status: string; teacher_access_note: string | null; created_at: number;
  school_name: string | null; joined_with_invite: number; credential_revision: number;
};
type SchoolRequest = {
  id: string; entered_name: string; province_name: string; school_level: string;
  district_or_address: string | null; note: string | null; status: string;
  teacher_email: string; created_at: number; linked_school_id: string | null;
};
type SchoolOption = { id: string; official_name: string; province_name: string; school_level: string; district_name: string | null };
type JobTemplate = {
  id: string; name: string; category: string; recommended_min_members: number;
  recommended_max_members: number; default_priority: number; is_active: number;
};
type Announcement = { title: string; body: string; audience: string; is_active: number } | null;
type AuditLog = {
  id: string; admin_key: string; action: string; target_type: string | null;
  target_id: string | null; success: number; created_at: number;
};

const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: "home", label: "운영 현황", icon: <ShieldCheck /> },
  { id: "invites", label: "초대코드", icon: <KeyRound /> },
  { id: "teachers", label: "교사 권한", icon: <UsersRound /> },
  { id: "schools", label: "학교 확인", icon: <School /> },
  { id: "jobs", label: "기본 직업", icon: <Settings2 /> },
  { id: "notice", label: "전체 공지", icon: <Megaphone /> },
  { id: "logs", label: "작업 기록", icon: <ClipboardList /> },
];

const SEOUL_TIME_ZONE = "Asia/Seoul";
const DAY_MS = 24 * 60 * 60 * 1000;

function when(value: number | null) {
  return value
    ? new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: SEOUL_TIME_ZONE,
      }).format(value)
    : "—";
}

function seoulDateInput(value: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SEOUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function AdminPortal() {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [csrfToken, setCsrfToken] = useState("");
  const [tab, setTab] = useState<Tab>("home");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [sessionRetryKey, setSessionRetryKey] = useState(0);

  const request = useCallback(async <T,>(url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (init.body) headers.set("Content-Type", "application/json");
    if (init.method && init.method !== "GET") headers.set("x-admin-csrf", csrfToken);
    const response = await fetch(url, { ...init, headers, credentials: "same-origin", cache: "no-store" });
    const data = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
    return data;
  }, [csrfToken]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/auth/session", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) return null;
        if (!response.ok) throw new Error("관리자 접속 상태를 확인하지 못했습니다.");
        return response.json() as Promise<{ csrfToken: string }>;
      })
      .then((data) => {
        setSessionError("");
        if (data) {
          setCsrfToken(data.csrfToken);
          setAuthenticated(true);
        }
      })
      .catch((reason) => {
        if ((reason as Error).name !== "AbortError") {
          setSessionError("관리자 접속 상태를 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [sessionRetryKey]);

  async function logout() {
    await request("/api/admin/auth/session", { method: "DELETE" }).catch(() => null);
    setAuthenticated(false);
    setCsrfToken("");
  }

  if (loading) return <main className="admin-loading"><p>관리자 세션을 확인하고 있습니다.</p></main>;
  if (sessionError) return (
    <main className="admin-loading">
      <p role="alert">{sessionError}</p>
      <button className="button button-light" type="button" onClick={() => {
        setLoading(true);
        setSessionError("");
        setSessionRetryKey((value) => value + 1);
      }}>접속 상태 다시 확인</button>
    </main>
  );
  if (!authenticated) {
    return <AdminLogin onLogin={(token) => { setCsrfToken(token); setAuthenticated(true); }} />;
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Logo compact />
        <div className="admin-badge">SYSTEM ADMIN</div>
        <nav aria-label="관리자 메뉴">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? "active" : ""}
              aria-label={item.label}
              aria-pressed={tab === item.id}
              onClick={() => { setTab(item.id); setError(""); setMessage(""); }}
            >
              <span aria-hidden="true">{item.icon}</span><span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="admin-account"><ThemeToggle /><button type="button" onClick={logout}><LogOut aria-hidden="true" />로그아웃</button></div>
      </aside>
      <main className="admin-main">
        <header><div><p className="eyebrow">서비스 운영자 전용</p><h1>{tabs.find((item) => item.id === tab)?.label}</h1></div></header>
        <Notice message={error} tone="error" />
        <Notice message={message} tone="success" />
        {tab === "home" && <AdminHome request={request} onMove={setTab} onError={setError} />}
        {tab === "invites" && <InviteManager request={request} onError={setError} onMessage={setMessage} />}
        {tab === "teachers" && <TeacherManager request={request} onError={setError} onMessage={setMessage} />}
        {tab === "schools" && <SchoolManager request={request} onError={setError} onMessage={setMessage} />}
        {tab === "jobs" && <JobManager request={request} onError={setError} onMessage={setMessage} />}
        {tab === "notice" && <NoticeManager request={request} onError={setError} onMessage={setMessage} />}
        {tab === "logs" && <AuditManager request={request} onError={setError} />}
      </main>
    </div>
  );
}

function AdminLogin({ onLogin }: { onLogin: (csrfToken: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json() as { csrfToken?: string; error?: string };
      if (!response.ok || !data.csrfToken) throw new Error(data.error || "로그인하지 못했습니다.");
      setPassword("");
      onLogin(data.csrfToken);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="admin-login-page">
      <section className="admin-login-card">
        <Logo />
        <div className="admin-login-icon"><ShieldCheck /></div>
        <p className="eyebrow">서비스 운영자 전용</p>
        <h1>관리자 로그인</h1>
        <p>등록된 운영자 계정으로만 들어갈 수 있습니다.</p>
        <form onSubmit={submit} className="form-stack">
          <label>관리자 아이디<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label>
          <label>비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
          <Notice message={error} tone="error" />
          <button className="button button-primary button-large" disabled={busy}>{busy ? "확인 중…" : "로그인"}</button>
        </form>
      </section>
    </main>
  );
}

type Requester = <T>(url: string, init?: RequestInit) => Promise<T>;

type AdminLoadStatus = "loading" | "ready" | "error";

function adminLoadError(reason: unknown) {
  return reason instanceof Error && reason.message
    ? reason.message
    : "자료를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
}

function useAdminLoader(load: () => Promise<void>, onError: (value: string) => void) {
  const [status, setStatus] = useState<AdminLoadStatus>("loading");
  const retry = useCallback(async () => {
    setStatus("loading");
    onError("");
    try {
      await load();
      setStatus("ready");
    } catch (reason) {
      onError(adminLoadError(reason));
      setStatus("error");
    }
  }, [load, onError]);

  useEffect(() => {
    let active = true;
    void load()
      .then(() => {
        if (active) setStatus("ready");
      })
      .catch((reason) => {
        if (!active) return;
        onError(adminLoadError(reason));
        setStatus("error");
      });
    return () => { active = false; };
  }, [load, onError]);

  return { status, retry };
}

function AdminLoadState({ status, label, onRetry }: {
  status: AdminLoadStatus;
  label: string;
  onRetry: () => Promise<void>;
}) {
  if (status === "ready") return null;
  if (status === "loading") {
    return <div className="notice notice-info" role="status">{label} 불러오는 중…</div>;
  }
  return (
    <div className="notice notice-error" role="alert">
      <div className="button-row">
        <span>{label} 불러오지 못했습니다.</span>
        <button className="button button-light" type="button" onClick={() => void onRetry()}>다시 불러오기</button>
      </div>
    </div>
  );
}

function AdminHome({ request, onMove, onError }: { request: Requester; onMove: (tab: Tab) => void; onError: (value: string) => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const load = useCallback(async () => {
    const data = await request<{ summary: Summary }>("/api/admin/dashboard");
    setSummary(data.summary);
  }, [request]);
  const loader = useAdminLoader(load, onError);
  const cards: Array<[keyof Summary, string, Tab]> = [
    ["pendingTeachers", "승인 대기 교사", "teachers"],
    ["activeTeachers", "이용 중 교사", "teachers"],
    ["revokedTeachers", "권한 회수 교사", "teachers"],
    ["pendingSchools", "확인 대기 학교", "schools"],
    ["activeInviteCodes", "사용 가능한 초대코드", "invites"],
    ["activeAnnouncements", "활성 공지", "notice"],
  ];
  return <><AdminLoadState status={loader.status} label="운영 현황을" onRetry={loader.retry} /><section className="admin-summary-grid">{cards.map(([key, label, target]) => <button key={key} type="button" onClick={() => onMove(target)}><span>{label}</span><strong>{summary ? summary[key] : "…"}</strong><small>확인하기</small></button>)}</section></>;
}

function InviteManager({ request, onError, onMessage }: { request: Requester; onError: (v: string) => void; onMessage: (v: string) => void }) {
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [expiresAt, setExpiresAt] = useState(() => seoulDateInput(Date.now() + 30 * DAY_MS));
  const [memo, setMemo] = useState("");
  const [newCode, setNewCode] = useState("");
  const load = useCallback(async () => {
    const data = await request<{ codes: InviteCode[] }>("/api/admin/invite-codes");
    setCodes(data.codes);
  }, [request]);
  const loader = useAdminLoader(load, onError);
  async function create(event: FormEvent) {
    event.preventDefault(); onError(""); setNewCode("");
    try {
      const data = await request<{ code: string }>("/api/admin/invite-codes", { method: "POST", body: JSON.stringify({ expiresAt: new Date(`${expiresAt}T23:59:59+09:00`).getTime(), memo }) });
      setNewCode(data.code); setMemo(""); onMessage("초대코드를 만들었습니다. 원문은 지금 한 번만 표시됩니다."); await loader.retry();
    } catch (reason) { onError((reason as Error).message); }
  }
  async function revoke(id: string) {
    try { await request("/api/admin/invite-codes", { method: "DELETE", body: JSON.stringify({ id }) }); onMessage("초대코드를 폐기했습니다."); await loader.retry(); }
    catch (reason) { onError((reason as Error).message); }
  }
  return <section className="admin-section"><AdminLoadState status={loader.status} label="초대코드를" onRetry={loader.retry} /><form className="admin-inline-form" onSubmit={create}><label>만료일<input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} required /></label><label>용도·메모<input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={120} /></label><button className="button button-primary">새 코드 발급</button></form>{newCode && <div className="one-time-secret"><b>한 번만 표시되는 코드</b><code>{newCode}</code><button type="button" onClick={() => navigator.clipboard.writeText(newCode)}>복사</button></div>}<div className="admin-table-wrap"><table><thead><tr><th>상태</th><th>메모</th><th>만료</th><th>사용 계정</th><th></th></tr></thead><tbody>{codes.map((code) => <tr key={code.id}><td>{code.status}</td><td>{code.memo || "—"}</td><td>{when(code.expires_at)}</td><td>{code.used_by_email || "—"}</td><td>{code.status === "active" && <button type="button" className="danger-link" onClick={() => revoke(code.id)}>폐기</button>}</td></tr>)}</tbody></table></div></section>;
}

function TeacherManager({ request, onError, onMessage }: { request: Requester; onError: (v: string) => void; onMessage: (v: string) => void }) {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const actionInFlight = useRef<string | null>(null);
  const [busyTeacherId, setBusyTeacherId] = useState<string | null>(null);
  const load = useCallback(async () => {
    const data = await request<{ teachers: Teacher[] }>(`/api/admin/teachers?q=${encodeURIComponent(query)}&status=${status}`);
    setTeachers(data.teachers);
  }, [request, query, status]);
  const loader = useAdminLoader(load, onError);
  async function change(id: string, action: string, expectedRevision: number) {
    if (actionInFlight.current) return;
    const note = prompt("관리자 메모(선택)");
    if (note === null) return;
    actionInFlight.current = id;
    setBusyTeacherId(id);
    try { await request("/api/admin/teachers", { method: "PATCH", body: JSON.stringify({ id, action, note, expectedRevision }) }); onMessage("교사 이용 권한을 변경했습니다."); await loader.retry(); }
    catch (reason) { onError((reason as Error).message); }
    finally {
      actionInFlight.current = null;
      setBusyTeacherId(null);
    }
  }
  return <section className="admin-section"><AdminLoadState status={loader.status} label="교사 목록을" onRetry={loader.retry} /><div className="admin-filters"><input aria-label="교사 이메일 검색" placeholder="이메일 검색" value={query} onChange={(e) => setQuery(e.target.value)} /><select aria-label="교사 이용 상태 필터" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">전체 상태</option><option value="pending">승인 대기</option><option value="invite_verified">이용 중</option><option value="revoked">권한 회수</option></select></div><div className="admin-table-wrap"><table><thead><tr><th>교사</th><th>학교</th><th>가입일</th><th>이메일 확인</th><th>상태</th><th>처리</th></tr></thead><tbody>{teachers.map((teacher) => <tr key={teacher.id}><td><b>{teacher.email}</b><small>{teacher.joined_with_invite ? "초대코드 사용" : "공개 가입 또는 관리자 승인"}</small></td><td>{teacher.school_name || "미선택"}</td><td>{when(teacher.created_at)}</td><td>{teacher.email_verified_at ? "완료" : "대기"}</td><td>{teacher.teacher_access_status}</td><td aria-busy={busyTeacherId === teacher.id}>{teacher.teacher_access_status === "pending" ? <button type="button" disabled={busyTeacherId !== null} onClick={() => change(teacher.id, "approve", teacher.credential_revision)}>{busyTeacherId === teacher.id ? "처리 중…" : "승인"}</button> : teacher.teacher_access_status === "revoked" ? <button type="button" disabled={busyTeacherId !== null} onClick={() => change(teacher.id, "reapprove", teacher.credential_revision)}>{busyTeacherId === teacher.id ? "처리 중…" : "재승인"}</button> : <button type="button" disabled={busyTeacherId !== null} className="danger-link" onClick={() => change(teacher.id, "revoke", teacher.credential_revision)}>{busyTeacherId === teacher.id ? "처리 중…" : "권한 회수"}</button>}</td></tr>)}</tbody></table></div></section>;
}

function SchoolManager({ request, onError, onMessage }: { request: Requester; onError: (v: string) => void; onMessage: (v: string) => void }) {
  const [items, setItems] = useState<SchoolRequest[]>([]);
  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const data = await request<{ requests: SchoolRequest[]; schools: SchoolOption[] }>("/api/admin/school-requests");
    setItems(data.requests);
    setSchools(data.schools);
  }, [request]);
  const loader = useAdminLoader(load, onError);
  async function review(id: string, action: string) {
    const note = prompt("검토 메모(선택)") || "";
    try { await request("/api/admin/school-requests", { method: "PATCH", body: JSON.stringify({ id, action, schoolId: selected[id], note }) }); onMessage("학교 확인 요청을 처리했습니다."); await loader.retry(); }
    catch (reason) { onError((reason as Error).message); }
  }
  return <section className="admin-section school-review-list"><AdminLoadState status={loader.status} label="학교 확인 요청을" onRetry={loader.retry} />{items.map((item) => <article key={item.id} className="admin-review-card"><div><span className={`status-badge status-${item.status}`}>{item.status}</span><h2>{item.entered_name}</h2><p>{item.province_name} · {item.school_level} · {item.district_or_address || "지역 정보 없음"}</p><small>{item.teacher_email} · {when(item.created_at)}</small>{item.note && <blockquote>{item.note}</blockquote>}</div>{item.status === "pending" && <div className="admin-review-actions"><select aria-label={`${item.entered_name} 요청에 연결할 공식 학교`} value={selected[item.id] || ""} onChange={(e) => setSelected((current) => ({ ...current, [item.id]: e.target.value }))}><option value="">기존 공식 학교 선택</option>{schools.filter((school) => school.province_name === item.province_name && school.school_level === item.school_level).map((school) => <option value={school.id} key={school.id}>{school.official_name} · {school.district_name || ""}</option>)}</select><button type="button" disabled={!selected[item.id]} onClick={() => review(item.id, "link")}>공식 학교와 연결</button><button type="button" onClick={() => review(item.id, "approve_new")}>신규 학교 승인</button><button type="button" className="danger-link" onClick={() => review(item.id, "reject")}>반려</button></div>}</article>)}</section>;
}

function JobManager({ request, onError, onMessage }: { request: Requester; onError: (v: string) => void; onMessage: (v: string) => void }) {
  const [templates, setTemplates] = useState<JobTemplate[]>([]);
  const load = useCallback(async () => {
    const data = await request<{ templates: JobTemplate[] }>("/api/admin/job-templates");
    setTemplates(data.templates);
  }, [request]);
  const loader = useAdminLoader(load, onError);
  function updateLocal(id: string, patch: Partial<JobTemplate>) { setTemplates((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item)); }
  async function save(item: JobTemplate) {
    try { await request("/api/admin/job-templates", { method: "PATCH", body: JSON.stringify({ id: item.id, isActive: Boolean(item.is_active), recommendedMinMembers: item.recommended_min_members, recommendedMaxMembers: item.recommended_max_members, defaultPriority: item.default_priority }) }); onMessage(`${item.name} 설정을 저장했습니다.`); await loader.retry(); }
    catch (reason) { onError((reason as Error).message); }
  }
  return <section className="admin-section"><AdminLoadState status={loader.status} label="기본 직업을" onRetry={loader.retry} /><p className="admin-help">이 설정은 앞으로 새로 직업 구성을 시작하는 학급에만 적용됩니다.</p><div className="admin-table-wrap"><table><thead><tr><th>기본 직업</th><th>활성</th><th>최소 인원</th><th>최대 인원</th><th>우선순위</th><th>저장</th></tr></thead><tbody>{templates.map((item) => <tr key={item.id}><td><b>{item.name}</b><small>{item.category}</small></td><td><input type="checkbox" aria-label={`${item.name} 기본 직업 활성화`} checked={Boolean(item.is_active)} onChange={(e) => updateLocal(item.id, { is_active: e.target.checked ? 1 : 0 })} /></td><td><input type="number" aria-label={`${item.name} 권장 최소 인원`} min="1" max="60" value={item.recommended_min_members} onChange={(e) => updateLocal(item.id, { recommended_min_members: Number(e.target.value) })} /></td><td><input type="number" aria-label={`${item.name} 권장 최대 인원`} min="1" max="60" value={item.recommended_max_members} onChange={(e) => updateLocal(item.id, { recommended_max_members: Number(e.target.value) })} /></td><td><input type="number" aria-label={`${item.name} 기본 우선순위`} min="1" max="999" value={item.default_priority} onChange={(e) => updateLocal(item.id, { default_priority: Number(e.target.value) })} /></td><td><button type="button" aria-label={`${item.name} 설정 저장`} onClick={() => save(item)}>저장</button></td></tr>)}</tbody></table></div></section>;
}

function NoticeManager({ request, onError, onMessage }: { request: Requester; onError: (v: string) => void; onMessage: (v: string) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("all");
  const [active, setActive] = useState(false);
  const load = useCallback(async () => {
    const { announcement } = await request<{ announcement: Announcement }>("/api/admin/announcement");
    setTitle(announcement?.title || "");
    setBody(announcement?.body || "");
    setAudience(announcement?.audience || "all");
    setActive(Boolean(announcement?.is_active));
  }, [request]);
  const loader = useAdminLoader(load, onError);
  async function save(event: FormEvent) {
    event.preventDefault();
    try { await request("/api/admin/announcement", { method: "PATCH", body: JSON.stringify({ title, body, audience, isActive: active }) }); onMessage("전체 공지를 저장했습니다."); await loader.retry(); }
    catch (reason) { onError((reason as Error).message); }
  }
  return <section className="admin-section admin-form-card"><AdminLoadState status={loader.status} label="전체 공지를" onRetry={loader.retry} /><form onSubmit={save} className="form-stack"><label>제목<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required /></label><label>본문<textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} rows={6} required /></label><label>대상<select value={audience} onChange={(e) => setAudience(e.target.value)}><option value="all">전체</option><option value="teacher">교사</option><option value="student">학생</option></select></label><label className="check-row"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> 공지 사용</label><button className="button button-primary">공지 저장</button></form></section>;
}

function AuditManager({ request, onError }: { request: Requester; onError: (v: string) => void }) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const load = useCallback(async () => {
    const data = await request<{ logs: AuditLog[] }>("/api/admin/audit-logs");
    setLogs(data.logs);
  }, [request]);
  const loader = useAdminLoader(load, onError);
  return <section className="admin-section"><AdminLoadState status={loader.status} label="감사 기록을" onRetry={loader.retry} /><div className="admin-table-wrap"><table><thead><tr><th>시각</th><th>행동</th><th>대상</th><th>결과</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td>{when(log.created_at)}</td><td><code>{log.action}</code></td><td>{log.target_type || "—"} {log.target_id ? `· ${log.target_id.slice(0, 10)}` : ""}</td><td>{log.success ? "성공" : "실패"}</td></tr>)}</tbody></table></div></section>;
}
