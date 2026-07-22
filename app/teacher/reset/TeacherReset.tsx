"use client";

import { FormEvent, useState } from "react";
import { Logo } from "@/app/components/Logo";
import { Notice } from "@/app/components/Notice";
import { postJson } from "@/lib/client-api";

export function TeacherReset({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!token) return setError("재설정 주소가 올바르지 않아요. 다시 요청해 주세요.");
    if (password.length < 8) return setError("8자 이상으로 만들어 주세요.");
    if (password !== confirmPassword) return setError("두 비밀번호가 달라요.");
    setBusy(true);
    try { await postJson("/api/teacher/password/reset", { token, password }); setDone(true); }
    catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }
  return <main className="centered-page"><section className="centered-card"><Logo />{done ? <><span className="success-circle">✓</span><h1>새 비밀번호를 저장했어요</h1><p>다른 기기의 로그인은 안전하게 종료했습니다.</p><a className="button button-primary button-large" href="/teacher">새 비밀번호로 로그인</a></> : <><p className="eyebrow">교사 계정</p><h1>새 비밀번호 만들기</h1><p>이 링크는 한 번만 사용할 수 있습니다.</p><form onSubmit={submit} className="form-stack"><label>새 비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required /></label><label>새 비밀번호 확인<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required /></label><Notice message={error} tone="error" /><button className="button button-primary button-large" disabled={busy}>{busy ? "저장 중…" : "비밀번호 바꾸기"}</button></form></>}</section></main>;
}
