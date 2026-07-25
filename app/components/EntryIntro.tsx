import { BriefcaseBusiness, GraduationCap, UsersRound } from "lucide-react";

export const entryCopy = {
  home: {
    eyebrow: "우리 반의 공용 입구",
    title: "우리 반 운영센터",
    description: "선생님과 학생이 함께 사용하는 우리 반 공간이에요.",
  },
  teacher: {
    eyebrow: "선생님으로 들어가기",
    title: "학급 준비부터 우리 반 직업까지.",
    description: "학생 명단과 계정을 안전하게 준비하고, 우리 반에 꼭 맞는 직업을 추천받거나 직접 구성하세요.",
  },
  student: {
    eyebrow: "학생 로그인",
    title: "학생으로 들어가기",
    description: "우리 반 활동을 확인하고 참여해요.",
  },
} as const;

export function HomeEntryIntro() {
  return (
    <div className="neutral-entry-intro">
      <span className="entry-intro-icon" aria-hidden="true"><UsersRound /></span>
      <p className="eyebrow">{entryCopy.home.eyebrow}</p>
      <h1>{entryCopy.home.title}</h1>
      <p>{entryCopy.home.description}</p>
    </div>
  );
}

export function TeacherEntryIntro() {
  return (
    <section className="auth-promise teacher-entry-intro">
      <span className="entry-intro-icon" aria-hidden="true"><GraduationCap /></span>
      <p className="eyebrow">{entryCopy.teacher.eyebrow}</p>
      <h1>{entryCopy.teacher.title}</h1>
      <p>{entryCopy.teacher.description}</p>
      <ul>
        <li>여러 학급을 한 계정에서 관리</li>
        <li>학생 비밀번호는 선생님도 볼 수 없음</li>
        <li>학생 수에 맞춰 우리 반 직업 구성</li>
      </ul>
      <div className="teacher-feature-chip"><BriefcaseBusiness aria-hidden="true" />추천받기와 직접 만들기 지원</div>
    </section>
  );
}

export function StudentEntryIntro() {
  return (
    <div className="student-entry-intro">
      <p className="eyebrow">{entryCopy.student.eyebrow}</p>
      <h1>{entryCopy.student.title}</h1>
      <p>{entryCopy.student.description}</p>
    </div>
  );
}
