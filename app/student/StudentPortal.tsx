"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, BookOpen, BriefcaseBusiness, ClipboardCheck, GraduationCap, Landmark, School, ShoppingBasket } from "lucide-react";
import { Logo } from "@/app/components/Logo";
import { AnnouncementBanner } from "@/app/components/AnnouncementBanner";
import { StudentEntryIntro } from "@/app/components/EntryIntro";
import { Notice } from "@/app/components/Notice";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { api, postJson } from "@/lib/client-api";
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

const preferenceKey = "job_classroom_student_class_v1";

export function StudentPortal() {
  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [teacherSession, setTeacherSession] = useState(false);
  const [schoolName, setSchoolName] = useState("");
  const [schoolYear, setSchoolYear] = useState("");
  const [grade, setGrade] = useState("");
  const [classNumber, setClassNumber] = useState("");
  const [studentNumber, setStudentNumber] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [sessionRetryKey, setSessionRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const frame = requestAnimationFrame(() => {
    try {
      const remembered = JSON.parse(localStorage.getItem(preferenceKey) || "null");
      if (remembered) {
        setSchoolName(remembered.schoolName || "");
        setSchoolYear(String(remembered.schoolYear || ""));
        setGrade(String(remembered.grade || ""));
        setClassNumber(String(remembered.classNumber || ""));
      }
    } catch {}
    api<{ serverTime: { year: number } }>("/api/time", { signal: controller.signal })
      .then(({ serverTime }) => setSchoolYear((current) => current || String(serverTime.year)))
      .catch((reason) => {
        if ((reason as Error).name !== "AbortError") {
          setSchoolYear((current) => current || String(new Date().getFullYear()));
        }
      });
    });
    api<{ actor: (StudentInfo & { type: "student" }) | { type: "teacher" } | null }>("/api/session", { signal: controller.signal })
      .then(({ actor }) => {
        setSessionError("");
        if (actor?.type === "student") {
          api<{ student: StudentInfo }>("/api/student/me", { signal: controller.signal })
            .then((data) => setStudent(data.student))
            .catch((reason) => {
              if ((reason as Error).name !== "AbortError") setStudent(actor);
            });
        }
        if (actor?.type === "teacher") setTeacherSession(true);
      })
      .catch((reason) => {
        if ((reason as Error).name !== "AbortError") {
          setSessionError("접속 상태를 확인하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      cancelAnimationFrame(frame);
      controller.abort();
    };
  }, [sessionRetryKey]);

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await postJson("/api/student/login", {
        schoolName,
        schoolYear: Number(schoolYear),
        grade: Number(grade),
        classNumber: Number(classNumber),
        studentNumber: Number(studentNumber),
        password,
      });
      localStorage.setItem(preferenceKey, JSON.stringify({
        schoolName,
        schoolYear: Number(schoolYear),
        grade: Number(grade),
        classNumber: Number(classNumber),
      }));
      const data = await api<{ student: StudentInfo }>("/api/student/me");
      setStudent(data.student); setPassword(""); setSessionError("");
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }

  async function logout() {
    await api("/api/session", { method: "DELETE" });
    setStudent(null); setTeacherSession(false); setStudentNumber(""); setPassword("");
  }

  if (loading) return <div className="student-loading"><span><BookOpen aria-hidden="true" /></span><p>우리 반을 찾고 있어요</p></div>;
  if (teacherSession) return (
    <main className="student-page"><header><Logo compact /><ThemeToggle compact /></header><section className="student-message-card"><span className="message-icon"><GraduationCap aria-hidden="true" /></span><h1>선생님으로 로그인되어 있어요</h1><p>교사 화면으로 돌아가거나 로그아웃한 뒤 학생으로 들어와 주세요.</p><a className="button button-primary button-large" href="/teacher">교사 화면으로</a><button className="button button-light" onClick={logout}>로그아웃</button></section></main>
  );
  if (student) return (
    <main className="student-page student-home">
      <header><Logo compact /><div className="header-actions"><ThemeToggle compact /><button className="student-logout" onClick={logout}>로그아웃</button></div></header>
      <AnnouncementBanner />
      <section className="student-welcome">
        <span className="student-avatar">{student.student_number}</span>
        <p>{student.school_name} {student.grade}학년 {student.class_number}반</p>
        <h1>{student.official_name}님,<br />직업교실에 잘 들어왔어요!</h1>
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
        <a className="student-finance-card" href="/finance">
          <span aria-hidden="true"><Landmark /></span>
          <div>
            <small>우리 반 금융생활</small>
            <h2>금융센터</h2>
            <p>내 금융생활과 우리 반 은행 기능을 차례로 준비하고 있어요.</p>
          </div>
          <strong>들어가기 <ArrowRight aria-hidden="true" /></strong>
        </a>
        <a className="student-finance-card" href="/mart">
          <span aria-hidden="true"><ShoppingBasket /></span>
          <div>
            <small>현물 학급화폐로 운영</small>
            <h2>마트센터</h2>
            <p>내 구매 기록을 보고, 마트 직원이라면 상품과 재고·판매를 운영해요.</p>
          </div>
          <strong>들어가기 <ArrowRight aria-hidden="true" /></strong>
        </a>
        <a className="student-finance-card" href="/life-checks">
          <span aria-hidden="true"><ClipboardCheck /></span>
          <div>
            <small>우리 반 생활 기록</small>
            <h2>생활확인</h2>
            <p>내 확인 결과를 보고, 담당 직업이라면 양치·우유·급식을 기록해요.</p>
          </div>
          <strong>들어가기 <ArrowRight aria-hidden="true" /></strong>
        </a>
      </section>
    </main>
  );

  const classRemembered = schoolName && schoolYear && grade && classNumber;
  return (
    <main className="student-login-page">
      <header><Logo compact /><div className="header-actions"><ThemeToggle compact /><a href="/teacher">선생님 입구</a></div></header>
      <section className="student-login-card">
        <div className="student-login-heading"><span className="pencil-mark" aria-hidden="true"><School /></span><StudentEntryIntro /></div>
        {sessionError && (
          <div className="session-check-error">
            <Notice message={sessionError} tone="error" />
            <button className="button button-light" type="button" onClick={() => {
              setLoading(true);
              setSessionError("");
              setSessionRetryKey((value) => value + 1);
            }}>접속 상태 다시 확인</button>
          </div>
        )}
        <form onSubmit={login} className="student-login-form">
          <div className={`remembered-class ${classRemembered ? "visible" : ""}`}>
            <label>학교<input value={schoolName} onChange={(event) => setSchoolName(event.target.value)} placeholder="학교 이름" required /></label>
            <div className="student-class-row">
              <label>학년도<input inputMode="numeric" value={schoolYear} onChange={(event) => setSchoolYear(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="2026" min="2020" max="2100" required /></label>
              <label>학년<select value={grade} onChange={(event) => setGrade(event.target.value)} required><option value="">선택</option>{[1,2,3,4,5,6].map((item) => <option key={item} value={item}>{item}학년</option>)}</select></label>
              <label>반<input inputMode="numeric" value={classNumber} onChange={(event) => setClassNumber(event.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="반" required /></label>
            </div>
            {classRemembered && <small>이 기기에서 우리 반을 기억하고 있어요.</small>}
          </div>
          <div className="student-credentials">
            <label><span>내 번호</span><input className="student-number-input" inputMode="numeric" value={studentNumber} onChange={(event) => setStudentNumber(event.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="예: 12" autoFocus={Boolean(classRemembered)} required /></label>
            <label><span>비밀번호</span><input className="student-password-input" type="password" inputMode="numeric" value={password} onChange={(event) => setPassword(event.target.value.replace(/\D/g, "").slice(0, 12))} placeholder="● ● ● ●" autoComplete="current-password" required /></label>
          </div>
          <Notice message={error} tone="error" />
          <button className="button button-student button-large" disabled={busy}>{busy ? "들어가는 중…" : "들어가기 →"}</button>
        </form>
        <a className="qr-help" href="/activate"><span>QR</span><div><b>개인 QR 카드가 있나요?</b><small>처음 등록하거나 평소 비밀번호로 빠르게 로그인해요. 잊었다면 선생님께 10분 재설정 허용을 요청하세요.</small></div><i>→</i></a>
      </section>
    </main>
  );
}
