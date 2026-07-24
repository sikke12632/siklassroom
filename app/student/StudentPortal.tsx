"use client";

import { FormEvent, useEffect, useState } from "react";
import { BookOpen, GraduationCap, School } from "lucide-react";
import { Logo } from "@/app/components/Logo";
import { Notice } from "@/app/components/Notice";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { api, postJson } from "@/lib/client-api";

type StudentInfo = {
  id: string; official_name: string; student_number: number; class_id: string;
  school_name: string; school_year: number; grade: number; class_number: number; display_name: string | null;
};

const preferenceKey = "job_classroom_student_class_v1";

export function StudentPortal() {
  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [teacherSession, setTeacherSession] = useState(false);
  const [schoolName, setSchoolName] = useState("");
  const [grade, setGrade] = useState("");
  const [classNumber, setClassNumber] = useState("");
  const [studentNumber, setStudentNumber] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
    try {
      const remembered = JSON.parse(localStorage.getItem(preferenceKey) || "null");
      if (remembered) { setSchoolName(remembered.schoolName || ""); setGrade(String(remembered.grade || "")); setClassNumber(String(remembered.classNumber || "")); }
    } catch {}
    });
    api<{ actor: (StudentInfo & { type: "student" }) | { type: "teacher" } | null }>("/api/session")
      .then(({ actor }) => {
        if (actor?.type === "student") setStudent(actor);
        if (actor?.type === "teacher") setTeacherSession(true);
      })
      .finally(() => setLoading(false));
    return () => cancelAnimationFrame(frame);
  }, []);

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await postJson("/api/student/login", { schoolName, grade: Number(grade), classNumber: Number(classNumber), studentNumber: Number(studentNumber), password });
      localStorage.setItem(preferenceKey, JSON.stringify({ schoolName, grade: Number(grade), classNumber: Number(classNumber) }));
      const data = await api<{ student: StudentInfo }>("/api/student/me");
      setStudent(data.student); setPassword("");
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
      <section className="student-welcome">
        <span className="student-avatar">{student.student_number}</span>
        <p>{student.school_name} {student.grade}학년 {student.class_number}반</p>
        <h1>{student.official_name}님,<br />직업교실에 잘 들어왔어요!</h1>
        <div className="student-id-card"><span>내 공식 정보</span><strong>{student.student_number}번 · {student.official_name}</strong><small>이름과 번호는 선생님만 고칠 수 있어요.</small></div>
        <div className="future-card"><b>우리 반 기능을 준비하고 있어요</b><p>다음 단계에서 직업과 학급 운영 기능이 이 계정에 연결됩니다.</p></div>
      </section>
    </main>
  );

  const classRemembered = schoolName && grade && classNumber;
  return (
    <main className="student-login-page">
      <header><Logo compact /><div className="header-actions"><ThemeToggle compact /><a href="/teacher">선생님 입구</a></div></header>
      <section className="student-login-card">
        <div className="student-login-heading"><span className="pencil-mark" aria-hidden="true"><School /></span><p className="eyebrow">학생 로그인</p><h1>우리 반에 들어가요</h1><p>내 번호와 내가 만든 비밀번호를 입력해 주세요.</p></div>
        <form onSubmit={login} className="student-login-form">
          <div className={`remembered-class ${classRemembered ? "visible" : ""}`}>
            <label>학교<input value={schoolName} onChange={(event) => setSchoolName(event.target.value)} placeholder="학교 이름" required /></label>
            <div className="student-class-row">
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
        <a className="qr-help" href="/activate"><span>QR</span><div><b>처음 들어오나요?</b><small>선생님께 받은 QR로 비밀번호를 먼저 만들어요.</small></div><i>→</i></a>
      </section>
    </main>
  );
}
