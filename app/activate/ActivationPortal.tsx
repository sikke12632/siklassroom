"use client";

import { FormEvent, useEffect, useState } from "react";
import { Logo } from "@/app/components/Logo";
import { Notice } from "@/app/components/Notice";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { api, postJson } from "@/lib/client-api";

type ActivationInfo = {
  student: { official_name: string; student_number: number; school_name: string; school_year: number; grade: number; class_number: number; display_name: string | null };
  purpose: "activate" | "reset";
};

export function ActivationPortal({ token }: { token: string }) {
  const [info, setInfo] = useState<ActivationInfo | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(token ? "" : "QR로 들어오거나 선생님께 받은 주소를 열어 주세요.");

  useEffect(() => {
    if (!token) return;
    api<ActivationInfo>(`/api/registration/verify?token=${encodeURIComponent(token)}`)
      .then(setInfo).catch((reason) => setError(reason.message)).finally(() => setLoading(false));
  }, [token]);

  async function complete(event: FormEvent) {
    event.preventDefault(); setError("");
    if (password !== confirmPassword) return setError("두 비밀번호가 달라요. 똑같이 입력해 주세요.");
    if (!/^\d{4,12}$/.test(password)) return setError("숫자 4~12자리로 만들어 주세요.");
    setBusy(true);
    try {
      await postJson("/api/registration/complete", { token, password });
      window.location.href = "/student";
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }

  return (
    <main className="activation-page">
      <header><Logo compact /><ThemeToggle compact /></header>
      <section className="activation-card">
        {loading ? <div className="student-loading inline"><span>QR</span><p>내 카드를 확인하고 있어요</p></div> : error && !info ? <div className="expired-qr"><span>!</span><h1>이 QR은 사용할 수 없어요</h1><Notice message={error} tone="error" /><p>이미 사용했거나 새 QR이 발급되었을 수 있어요. 선생님께 새 카드를 받아 주세요.</p><a className="button button-light" href="/student">학생 로그인으로</a></div> : info && <>
          <div className="activation-progress"><span className="active">1. 내 정보 확인</span><i /><span className="active">2. 비밀번호 만들기</span><i /><span>3. 완료</span></div>
          <div className="identity-check"><span className="check-mark">✓</span><small>{info.purpose === "reset" ? "비밀번호를 다시 만들 학생" : "이 QR의 주인"}</small><h1>{info.student.student_number}번 {info.student.official_name}</h1><p>{info.student.school_name} · {info.student.grade}학년 {info.student.class_number}반</p></div>
          <form onSubmit={complete} className="activation-form">
            <div><p className="eyebrow">내 비밀번호</p><h2>기억하기 쉬운 숫자를 정해요</h2><p>친구에게 알려주지 않을 숫자 4~12자리를 두 번 입력해 주세요.</p></div>
            <label>새 비밀번호<input type="password" inputMode="numeric" value={password} onChange={(event) => setPassword(event.target.value.replace(/\D/g, "").slice(0, 12))} placeholder="숫자 4자리 이상" autoFocus required /></label>
            <label>한 번 더<input type="password" inputMode="numeric" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value.replace(/\D/g, "").slice(0, 12))} placeholder="똑같이 입력" required /></label>
            <Notice message={error} tone="error" />
            <div className="password-tip"><b>기억하는 요령</b><span>내가 기억할 수 있지만 다른 친구는 모르는 숫자가 좋아요.</span></div>
            <button className="button button-student button-large" disabled={busy}>{busy ? "안전하게 저장 중…" : info.purpose === "reset" ? "새 비밀번호로 바꾸기 →" : "등록하고 바로 들어가기 →"}</button>
          </form>
        </>}
      </section>
    </main>
  );
}
