import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, GraduationCap, QrCode, ShieldCheck, UserRoundCheck, UsersRound } from "lucide-react";
import { Logo } from "./components/Logo";
import { ThemeToggle } from "./components/ThemeToggle";

export default function Home() {
  return (
    <main className="landing-page">
      <header className="landing-nav"><Logo /><ThemeToggle compact /></header>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">우리 반 운영의 시작</p>
          <h1>학급 준비부터<br /><em>우리 반 직업까지.</em></h1>
          <p className="hero-description">학생 명단과 계정을 안전하게 준비하고, 우리 반에 꼭 맞는 직업을 추천받거나 직접 구성하세요.</p>
          <div className="flow-line" aria-label="교사 준비 순서">
            <span><b>1</b> 학급 만들기</span><ArrowRight aria-hidden="true" />
            <span><b>2</b> 학생 등록</span><ArrowRight aria-hidden="true" />
            <span><b>3</b> 직업 준비</span>
          </div>
        </div>
        <div className="entrance-grid">
          <Link href="/teacher" className="entrance-card teacher-card">
            <span className="entrance-icon" aria-hidden="true"><GraduationCap /></span>
            <div><small>선생님 입구</small><h2>학급을 운영할게요</h2><p>학급 만들기 · 학생 관리 · 우리 반 직업</p></div>
            <strong>교사로 시작하기 <ArrowRight aria-hidden="true" /></strong>
          </Link>
          <Link href="/student" className="entrance-card student-card">
            <span className="entrance-icon" aria-hidden="true"><UsersRound /></span>
            <div><small>학생 입구</small><h2>우리 반에 들어갈래요</h2><p>번호와 내가 정한 비밀번호로 로그인</p></div>
            <strong>학생 로그인 <ArrowRight aria-hidden="true" /></strong>
          </Link>
          <Link href="/activate" className="first-qr-link"><QrCode aria-hidden="true" /><span>처음 받은 QR이 있나요?</span><b>비밀번호 만들기 <ArrowRight aria-hidden="true" /></b></Link>
        </div>
      </section>
      <section className="promise-strip">
        <div><ShieldCheck aria-hidden="true" /><span><b>안전한 계정</b><small>비밀번호는 선생님도 볼 수 없어요.</small></span></div>
        <div><UserRoundCheck aria-hidden="true" /><span><b>이어지는 학생 기록</b><small>이름·번호를 고쳐도 기록은 유지됩니다.</small></span></div>
        <div><BriefcaseBusiness aria-hidden="true" /><span><b>우리 반 직업</b><small>학생 수에 맞춰 추천하고 편집합니다.</small></span></div>
      </section>
    </main>
  );
}
