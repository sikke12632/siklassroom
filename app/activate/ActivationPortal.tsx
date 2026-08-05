"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/app/components/Logo";
import { Notice } from "@/app/components/Notice";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { postJson } from "@/lib/client-api";
import { isSafeNewStudentPassword, isValidExistingStudentPassword } from "@/lib/student-password";

type ActivationInfo = {
  student: {
    official_name: string;
    student_number: number;
    grade: number;
    class_number: number;
  };
  mode: "activate" | "login" | "reset";
  resetExpiresAt: number | null;
};

function tokenFromLocation() {
  const current = new URL(window.location.href);
  const fragment = new URLSearchParams(current.hash.replace(/^#/, ""));
  return fragment.get("token") ?? current.searchParams.get("token") ?? "";
}

export function ActivationPortal() {
  const router = useRouter();
  const [info, setInfo] = useState<ActivationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const token = tokenFromLocation();
      window.history.replaceState(null, "", window.location.pathname);
      if (!token) {
        setError("QR로 들어오거나 선생님께 받은 카드를 다시 스캔해 주세요.");
        setLoading(false);
        return;
      }
      postJson<ActivationInfo>("/api/registration/verify", { token })
        .then(setInfo)
        .catch((reason) => setError(reason.message))
        .finally(() => setLoading(false));
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  async function complete(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (info?.mode !== "login" && password !== confirmPassword) {
      setError("두 비밀번호가 달라요. 똑같이 입력해 주세요.");
      return;
    }
    if (info?.mode === "login" ? !isValidExistingStudentPassword(password) : !isSafeNewStudentPassword(password)) {
      setError(info?.mode === "login"
        ? "숫자 4~12자리로 입력해 주세요."
        : "같은 숫자나 연속 숫자를 피해서 숫자 6~12자리로 만들어 주세요.");
      return;
    }
    setBusy(true);
    try {
      await postJson("/api/registration/complete", { password });
      router.replace("/student");
      router.refresh();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isLogin = info?.mode === "login";
  const heading = isLogin
    ? "내 비밀번호로 들어가요"
    : info?.mode === "reset"
      ? "새 비밀번호를 만들어요"
      : "처음 쓸 비밀번호를 만들어요";

  return (
    <main className="activation-page">
      <header><Logo compact /><ThemeToggle compact /></header>
      <section className="activation-card">
        {loading ? (
          <div className="student-loading inline"><span>QR</span><p>내 카드를 확인하고 있어요</p></div>
        ) : error && !info ? (
          <div className="expired-qr">
            <span>!</span><h1>이 QR을 사용할 수 없어요</h1>
            <Notice message={error} tone="error" />
            <p>QR이 바뀌었거나 선생님의 확인이 필요한 상태일 수 있어요. 안내 문구를 선생님께 보여 주세요.</p>
            <a className="button button-light" href="/student">학생 로그인으로</a>
          </div>
        ) : info && (
          <>
            <div className="activation-progress">
              <span className="active">1. 내 정보 확인</span><i />
              <span className="active">2. {isLogin ? "비밀번호 입력" : "비밀번호 만들기"}</span><i />
              <span>3. 완료</span>
            </div>
            <div className="identity-check">
              <span className="check-mark">✓</span>
              <small>{isLogin ? "이 QR의 주인" : info.mode === "reset" ? "재설정이 허용된 학생" : "처음 등록할 학생"}</small>
              <h1>{info.student.student_number}번 {info.student.official_name}</h1>
              <p>{info.student.grade}학년 {info.student.class_number}반</p>
            </div>
            <form onSubmit={complete} className="activation-form">
              <div>
                <p className="eyebrow">{isLogin ? "QR 로그인" : "학생 비밀번호"}</p>
                <h2>{heading}</h2>
                <p>{isLogin
                  ? "QR은 학생을 찾는 카드예요. 평소 쓰던 비밀번호를 입력하면 안전하게 들어갈 수 있어요."
                  : "친구에게 알려주지 않을 숫자 6~12자리를 정해 주세요."}</p>
              </div>
              <label>{isLogin ? "현재 비밀번호" : "새 비밀번호"}
                <input
                  type="password"
                  inputMode="numeric"
                  value={password}
                  onChange={(event) => setPassword(event.target.value.replace(/\D/g, "").slice(0, 12))}
                  placeholder={isLogin ? "숫자 4자리 이상" : "숫자 6자리 이상"}
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  autoFocus
                  required
                />
              </label>
              {!isLogin && (
                <label>한 번 더
                  <input
                    type="password"
                    inputMode="numeric"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value.replace(/\D/g, "").slice(0, 12))}
                    placeholder="똑같이 입력"
                    autoComplete="new-password"
                    required
                  />
                </label>
              )}
              <Notice message={error} tone="error" />
              {info.mode === "reset" && info.resetExpiresAt && (
                <div className="password-tip"><b>10분 안에 완료해 주세요</b><span>시간이 지나면 선생님께 다시 허용을 요청하면 돼요.</span></div>
              )}
              <button className="button button-student button-large" disabled={busy}>
                {busy ? "안전하게 확인 중…" : isLogin ? "내 계정으로 들어가기 →" : "저장하고 바로 들어가기 →"}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
