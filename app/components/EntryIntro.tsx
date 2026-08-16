import { BriefcaseBusiness, GraduationCap, UsersRound } from "lucide-react";

export const entryCopy = {
  home: {
    eyebrow: "선생님은 편하게, 학생은 재미있게",
    title: "우리반운영센터",
    description: "학생 관리부터 일정, 직업, 금융, 마트까지 우리 반의 하루를 한곳에서 이어가요.",
  },
  teacher: {
    eyebrow: "선생님으로 들어가기",
    title: "학급 준비부터 하루 운영까지.",
    description: "학생 명단과 일정, 직업과 학급 활동을 한곳에서 편리하게 관리하세요.",
  },
  student: {
    eyebrow: "학생 로그인",
    title: "우리 반으로 들어가기",
    description: "내 직업과 학급 활동을 확인하고 재미있게 참여해요.",
  },
} as const;

export function HomeEntryIntro() {
  return (
    <div className="neutral-entry-intro portal-entry-copy">
      <span className="entry-intro-icon portal-entry-copy__icon" aria-hidden="true"><UsersRound /></span>
      <p className="eyebrow">{entryCopy.home.eyebrow}</p>
      <h1 id="portal-entry-title">{entryCopy.home.title}</h1>
      <p>{entryCopy.home.description}</p>
    </div>
  );
}

export function TeacherEntryIntro() {
  return (
    <section className="auth-promise teacher-entry-intro portal-auth-intro">
      <span className="entry-intro-icon" aria-hidden="true"><GraduationCap /></span>
      <p className="eyebrow">{entryCopy.teacher.eyebrow}</p>
      <h1>{entryCopy.teacher.title}</h1>
      <p>{entryCopy.teacher.description}</p>
      <ul>
        <li>여러 학급을 한 계정에서 관리</li>
        <li>학생 비밀번호는 선생님도 볼 수 없음</li>
        <li>학생 관리·일정·직업·금융을 한곳에서 연결</li>
      </ul>
      <div className="teacher-feature-chip"><BriefcaseBusiness aria-hidden="true" />우리 반 운영에 필요한 다음 행동 안내</div>
    </section>
  );
}

export function StudentEntryIntro() {
  return (
    <div className="student-entry-intro portal-auth-intro">
      <p className="eyebrow">{entryCopy.student.eyebrow}</p>
      <h1>{entryCopy.student.title}</h1>
      <p>{entryCopy.student.description}</p>
    </div>
  );
}
