"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, BookOpen, BriefcaseBusiness, ClipboardCheck, GraduationCap, Landmark, School, ShoppingBasket } from "lucide-react";
import { Logo } from "@/app/components/Logo";
import { AnnouncementBanner } from "@/app/components/AnnouncementBanner";
import { StudentEntryIntro } from "@/app/components/EntryIntro";
import { Notice } from "@/app/components/Notice";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { api, ClientApiError, postJson } from "@/lib/client-api";
import { JobEvaluationPanel } from "./JobEvaluationPanel";

type StudentInfo = {
  id: string; official_name: string; student_number: number; class_id: string;
  school_name: string; school_year: number; grade: number; class_number: number; display_name: string | null;
  current_job?: {
    id: string; name: string; description: string;
    first_job_start_date: string | null; first_job_end_date: string | null;
    assignment_method: "random" | "manual" | "choice"; confirmed_at: number;
    assignmentYear: number; assignmentMonth: number; assignmentType: "initial" | "monthly";
  } | null;
};

const preferenceKey = "job_classroom_student_class_v2";
type StudentSessionStatus = "checking" | "ready";

export function StudentPortal() {
  const [sessionStatus, setSessionStatus] = useState<StudentSessionStatus>("checking");
  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [teacherSession, setTeacherSession] = useState(false);
  const [passwordResetRequired, setPasswordResetRequired] = useState(false);
  const [schoolCode, setSchoolCode] = useState("01");
  const [grade, setGrade] = useState("");
  const [classNumber, setClassNumber] = useState("");
  const [studentNumber, setStudentNumber] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [sessionRetryKey, setSessionRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const frame = requestAnimationFrame(() => {
    try {
      const remembered = JSON.parse(localStorage.getItem(preferenceKey) || "null");
      if (remembered) {
        setSchoolCode(remembered.schoolCode || "01");
        setGrade(String(remembered.grade || ""));
        setClassNumber(String(remembered.classNumber || ""));
      }
    } catch {}
    });
    api<{ actor:
      | (StudentInfo & { type: "student" | "student_password_reset" })
      | { type: "teacher" }
      | null
    }>("/api/session", { signal: controller.signal })
      .then(async ({ actor }) => {
        setSessionError("");
        setTeacherSession(actor?.type === "teacher");
        setPasswordResetRequired(actor?.type === "student_password_reset");
        if (actor?.type === "student") {
          try {
            const data = await api<{ student: StudentInfo }>("/api/student/me", { signal: controller.signal });
            setStudent(data.student);
          } catch (reason) {
            if ((reason as Error).name !== "AbortError") setStudent(actor);
          }
        } else {
          setStudent(null);
        }
      })
      .catch((reason) => {
        if ((reason as Error).name !== "AbortError") {
          setSessionError("접속 상태를 확인하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setSessionStatus("ready");
      });
    return () => {
      cancelAnimationFrame(frame);
      controller.abort();
    };
  }, [sessionRetryKey]);

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await postJson<{ ok: boolean; passwordResetRequired: boolean }>("/api/student/login", {
        schoolCode,
        grade: Number(grade),
        classNumber: Number(classNumber),
        studentNumber: Number(studentNumber),
        password,
      });
      try {
        localStorage.setItem(preferenceKey, JSON.stringify({
          schoolCode,
          grade: Number(grade),
          classNumber: Number(classNumber),
        }));
      } catch {
        // 브라우저가 로컬 저장소를 막아도 서버 로그인은 정상적으로 이어갑니다.
      }
      if (result.passwordResetRequired) {
        setPasswordResetRequired(true);
        setPassword("");
        setSessionError("");
        return;
      }
      const data = await api<{ student: StudentInfo }>("/api/student/me");
      setStudent(data.student); setPassword(""); setSessionError("");
    } catch (reason) {
      setError(
        reason instanceof ClientApiError && reason.code === "TOO_MANY_ATTEMPTS"
          ? "비밀번호를 여러 번 확인했어요. 잠시 뒤 다시 시도하거나 개인 QR 카드로 로그인해 주세요. 카드가 없으면 선생님께 다시 보여 달라고 해도 괜찮아요."
          : (reason as Error).message,
      );
    } finally { setBusy(false); }
  }

  async function changeTemporaryPassword(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (newPassword !== confirmPassword) throw new Error("새 비밀번호가 서로 달라요.");
      await postJson("/api/student/password", { password: newPassword });
      const data = await api<{ student: StudentInfo }>("/api/student/me");
      setStudent(data.student);
      setPasswordResetRequired(false);
      setNewPassword("");
      setConfirmPassword("");
      setSessionError("");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    setError("");
    try {
      await api("/api/session", { method: "DELETE" });
      setStudent(null); setTeacherSession(false); setPasswordResetRequired(false);
      setStudentNumber(""); setPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLogoutBusy(false);
    }
  }

  if (sessionStatus === "checking") return <div className="student-loading" role="status"><span><BookOpen aria-hidden="true" /></span><p>우리 반을 찾고 있어요</p></div>;
  if (teacherSession) return (
    <main className="student-page"><header><Logo compact /><ThemeToggle compact /></header><section className="student-message-card"><span className="message-icon"><GraduationCap aria-hidden="true" /></span><h1>선생님으로 로그인되어 있어요</h1><p>교사 화면으로 돌아가거나 로그아웃한 뒤 학생으로 들어와 주세요.</p><Notice message={error} tone="error" /><a className="button button-primary button-large" href="/teacher">교사 화면으로</a><button className="button button-light" disabled={logoutBusy} onClick={() => void logout()}>{logoutBusy ? "로그아웃 중…" : "로그아웃"}</button></section></main>
  );
  if (passwordResetRequired) return (
    <main className="student-login-page">
      <header><Logo compact /><div className="header-actions"><ThemeToggle compact /><button className="student-logout" disabled={logoutBusy} onClick={() => void logout()}>{logoutBusy ? "나가는 중…" : "취소"}</button></div></header>
      <section className="student-login-card">
        <div className="student-login-heading"><span className="pencil-mark" aria-hidden="true"><School /></span><div><p className="eyebrow">비밀번호 보호</p><h1>새 비밀번호를 먼저 만들어요</h1><p>임시 비밀번호로는 학생 서비스를 이용할 수 없어요.</p></div></div>
        <form onSubmit={changeTemporaryPassword} className="student-login-form">
          <div className="password-tip"><b>기억하기 쉬운 비밀번호도 괜찮아요</b><span>영문 또는 숫자 4~32자로 만들고, 임시 비밀번호 123456과는 다르게 입력해 주세요.</span></div>
          <div className="student-credentials">
            <label><span>새 비밀번호</span><input className="student-password-input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value.slice(0, 32))} maxLength={32} placeholder="예: apple 또는 1234" autoComplete="new-password" autoFocus required /></label>
            <label><span>한 번 더</span><input className="student-password-input" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value.slice(0, 32))} maxLength={32} placeholder="똑같이 입력" autoComplete="new-password" required /></label>
          </div>
          <Notice message={error} tone="error" />
          <button className="button button-student button-large" disabled={busy}>{busy ? "저장하는 중…" : "새 비밀번호 저장하기 →"}</button>
        </form>
      </section>
    </main>
  );
  if (student) return (
    <main className="student-page student-home">
      <header><Logo compact /><div className="header-actions"><ThemeToggle compact /><button className="student-logout" disabled={logoutBusy} onClick={() => void logout()}>{logoutBusy ? "로그아웃 중…" : "로그아웃"}</button></div></header>
      <AnnouncementBanner />
      <Notice message={error} tone="error" />
      <section className="student-welcome" aria-labelledby="student-home-title">
        <span className="student-avatar">{student.student_number}</span>
        <p>{student.school_name} {student.grade}학년 {student.class_number}반</p>
        <h1 id="student-home-title">{student.official_name}님,<br />우리반운영센터에 잘 들어왔어요!</h1>
        <div className="student-id-card"><span>내 공식 정보</span><strong>{student.student_number}번 · {student.official_name}</strong><small>이름과 번호는 선생님만 고칠 수 있어요.</small></div>
        <JobEvaluationPanel studentId={student.id} />
        {student.current_job ? (
          <div className="student-job-card">
            <span><BriefcaseBusiness aria-hidden="true" /></span>
            <div>
              <small>{student.current_job.assignmentType === "monthly"
                ? `${student.current_job.assignmentYear}년 ${student.current_job.assignmentMonth}월 나의 직업`
                : "나의 첫 직업"}</small>
              <h2>{student.current_job.name}</h2>
              <p>{student.current_job.description}</p>
              {student.current_job.first_job_start_date && student.current_job.first_job_end_date && (
                <b>{student.current_job.first_job_start_date} ~ {student.current_job.first_job_end_date}</b>
              )}
            </div>
          </div>
        ) : (
          <div className="future-card"><b>직업 배정을 기다리고 있어요</b><p>선생님이 이번 직업을 최종 확정하면 이 화면에서 바로 확인할 수 있어요.</p></div>
        )}
        <section className="student-service-section" aria-labelledby="student-services-title">
          <div className="student-service-heading">
            <p className="eyebrow">우리 반 바로가기</p>
            <h2 id="student-services-title">우리 반 서비스</h2>
            <p>필요한 활동을 골라 바로 들어가요.</p>
          </div>
          <div className="student-service-grid">
            <a className="student-finance-card student-service-card finance" href="/finance">
              <span aria-hidden="true"><Landmark /></span>
              <div>
                <small>우리 반 금융생활</small>
                <h3>금융센터</h3>
                <p>내 금융 활동을 확인하고, 은행원이라면 우리 반 은행을 운영해요.</p>
              </div>
              <strong>들어가기 <ArrowRight aria-hidden="true" /></strong>
            </a>
            <a className="student-finance-card student-service-card mart" href="/mart">
              <span aria-hidden="true"><ShoppingBasket /></span>
              <div>
                <small>현물 학급화폐로 운영</small>
                <h3>마트센터</h3>
                <p>내 구매 기록을 보고, 마트 직원이라면 상품과 재고·판매를 운영해요.</p>
              </div>
              <strong>들어가기 <ArrowRight aria-hidden="true" /></strong>
            </a>
            <a className="student-finance-card student-service-card life" href="/life-checks">
              <span aria-hidden="true"><ClipboardCheck /></span>
              <div>
                <small>우리 반 생활 기록</small>
                <h3>생활확인</h3>
                <p>내 확인 결과를 보고, 담당 직업이라면 양치·우유·급식을 기록해요.</p>
              </div>
              <strong>들어가기 <ArrowRight aria-hidden="true" /></strong>
            </a>
          </div>
        </section>
      </section>
    </main>
  );

  const classRemembered = schoolCode && grade && classNumber;
  return (
    <main className="student-login-page">
      <header><Logo compact /><div className="header-actions"><ThemeToggle compact /><a href="/teacher">선생님 입구</a></div></header>
      <section className="student-login-card">
        <div className="student-login-heading"><span className="pencil-mark" aria-hidden="true"><School /></span><StudentEntryIntro /></div>
        {sessionError && (
          <div className="session-check-error">
            <Notice message={sessionError} tone="error" />
            <button className="button button-light" type="button" onClick={() => {
              setSessionStatus("checking");
              setSessionError("");
              setSessionRetryKey((value) => value + 1);
            }}>접속 상태 다시 확인</button>
          </div>
        )}
        <form onSubmit={login} className="student-login-form">
          <div className={`remembered-class ${classRemembered ? "visible" : ""}`}>
            <label>학교코드<input inputMode="numeric" value={schoolCode} onChange={(event) => setSchoolCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="01" minLength={2} maxLength={6} required /></label>
            <div className="student-class-row">
              <label>학년<select value={grade} onChange={(event) => setGrade(event.target.value)} required><option value="">선택</option>{[1,2,3,4,5,6].map((item) => <option key={item} value={item}>{item}학년</option>)}</select></label>
              <label>반<input inputMode="numeric" value={classNumber} onChange={(event) => setClassNumber(event.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="반" required /></label>
            </div>
            <small>서울서이초등학교 코드는 01이에요.</small>
            {classRemembered && <small>이 기기에서 우리 반을 기억하고 있어요.</small>}
          </div>
          <div className="student-credentials">
            <label><span>내 번호</span><input className="student-number-input" inputMode="numeric" value={studentNumber} onChange={(event) => setStudentNumber(event.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="예: 12" autoFocus={Boolean(classRemembered)} required /></label>
            <label><span>비밀번호</span><input className="student-password-input" type="password" value={password} onChange={(event) => setPassword(event.target.value.slice(0, 32))} maxLength={32} placeholder="영문 또는 숫자" autoComplete="current-password" required /></label>
          </div>
          <Notice message={error} tone="error" />
          <button className="button button-student button-large" disabled={busy}>{busy ? "들어가는 중…" : "들어가기 →"}</button>
        </form>
        <a className="qr-help" href="/activate"><span>QR</span><div><b>개인 QR 카드가 있나요?</b><small>처음 등록하거나 평소 비밀번호로 빠르게 로그인해요. 잊었다면 선생님께 10분 재설정 허용을 요청하세요.</small></div><i>→</i></a>
      </section>
    </main>
  );
}
