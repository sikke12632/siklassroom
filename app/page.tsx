import Link from "next/link";
import { ArrowRight, GraduationCap, UsersRound } from "lucide-react";
import { Logo } from "./components/Logo";
import { HomeEntryIntro } from "./components/EntryIntro";
import { ThemeToggle } from "./components/ThemeToggle";

export default function Home() {
  return (
    <main className="landing-page">
      <header className="landing-nav"><Logo /><ThemeToggle compact /></header>
      <section className="neutral-entry">
        <HomeEntryIntro />
        <div className="entrance-grid">
          <Link href="/teacher" className="entrance-card teacher-card">
            <span className="entrance-icon" aria-hidden="true"><GraduationCap /></span>
            <div><small>선생님</small><h2>선생님으로 들어가기</h2></div>
            <strong>들어가기 <ArrowRight aria-hidden="true" /></strong>
          </Link>
          <Link href="/student" className="entrance-card student-card">
            <span className="entrance-icon" aria-hidden="true"><UsersRound /></span>
            <div><small>학생</small><h2>학생으로 들어가기</h2></div>
            <strong>들어가기 <ArrowRight aria-hidden="true" /></strong>
          </Link>
        </div>
      </section>
    </main>
  );
}
