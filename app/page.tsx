import Link from "next/link";
import { Logo } from "./components/Logo";

export default function Home() {
  return (
    <main className="landing-page">
      <header className="landing-nav"><Logo /><span className="trust-chip">학급 계정 기반 1차 버전</span></header>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">우리 반 운영의 시작</p>
          <h1>학생 계정 준비,<br /><em>세 단계면 끝.</em></h1>
          <p className="hero-description">선생님이 학급과 명단을 만들면, 학생은 QR로 자기 비밀번호를 정합니다. 임시 비밀번호 명단을 만들 필요가 없어요.</p>
          <div className="flow-line" aria-label="교사 준비 순서">
            <span><b>1</b> 학급 만들기</span><i aria-hidden="true">→</i>
            <span><b>2</b> 명단 입력</span><i aria-hidden="true">→</i>
            <span><b>3</b> QR 인쇄</span>
          </div>
        </div>
        <div className="entrance-grid">
          <Link href="/teacher" className="entrance-card teacher-card">
            <span className="entrance-icon" aria-hidden="true">교</span>
            <div><small>선생님 입구</small><h2>학급을 준비할게요</h2><p>가입 · 학급 만들기 · 학생 계정 관리</p></div>
            <strong>교사로 시작하기 <span>→</span></strong>
          </Link>
          <Link href="/student" className="entrance-card student-card">
            <span className="entrance-icon" aria-hidden="true">학</span>
            <div><small>학생 입구</small><h2>우리 반에 들어갈래요</h2><p>번호와 내가 정한 비밀번호로 로그인</p></div>
            <strong>학생 로그인 <span>→</span></strong>
          </Link>
          <Link href="/activate" className="first-qr-link">처음 받은 QR로 들어왔나요? <b>비밀번호 만들기 →</b></Link>
        </div>
      </section>
      <section className="promise-strip">
        <div><b>비밀번호는 선생님도 볼 수 없어요</b><span>안전하게 암호화해 저장합니다.</span></div>
        <div><b>이름이 바뀌어도 기록은 그대로</b><span>학생마다 변하지 않는 고유 ID를 씁니다.</span></div>
        <div><b>공용 기기도 안심</b><span>학생 로그인은 짧게 유지되고 바로 로그아웃할 수 있어요.</span></div>
      </section>
    </main>
  );
}
