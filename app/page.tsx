import Link from "next/link";
import { ArrowRight, GraduationCap, UsersRound } from "lucide-react";
import { Logo } from "./components/Logo";
import { HomeEntryIntro } from "./components/EntryIntro";
import { SchoolIllustration } from "./components/SchoolIllustration";
import { ThemeToggle } from "./components/ThemeToggle";

export default function Home() {
  return (
    <main className="landing-page portal-landing">
      <header className="landing-nav portal-landing__nav"><Logo /><ThemeToggle compact /></header>
      <section className="neutral-entry portal-entry" aria-labelledby="portal-entry-title">
        <div className="portal-entry__hero">
          <HomeEntryIntro />
          <SchoolIllustration className="portal-entry__school" />
        </div>
        <nav className="entrance-grid portal-role-grid" aria-label="로그인 유형 선택">
          <Link href="/teacher" className="entrance-card teacher-card portal-role-card portal-role-card--teacher">
            <span className="entrance-icon portal-role-card__icon" aria-hidden="true"><GraduationCap /></span>
            <div className="portal-role-card__copy"><small>선생님</small><h2>선생님으로 들어가기</h2></div>
            <strong className="portal-role-card__action">들어가기 <ArrowRight aria-hidden="true" /></strong>
          </Link>
          <Link href="/student" className="entrance-card student-card portal-role-card portal-role-card--student">
            <span className="entrance-icon portal-role-card__icon" aria-hidden="true"><UsersRound /></span>
            <div className="portal-role-card__copy"><small>학생</small><h2>학생으로 들어가기</h2></div>
            <strong className="portal-role-card__action">들어가기 <ArrowRight aria-hidden="true" /></strong>
          </Link>
        </nav>
      </section>
    </main>
  );
}
