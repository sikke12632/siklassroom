"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  ClipboardList,
  Clock3,
  Landmark,
  RefreshCw,
  ShieldCheck,
  UserRoundCog,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { Logo } from "@/app/components/Logo";
import { ThemeToggle } from "@/app/components/ThemeToggle";

type FinanceRole = "teacher" | "banker" | "student";

type FinanceContext = {
  actor: {
    type: "teacher" | "student";
    id: string;
    name: string;
  };
  classroom: {
    id: string;
    displayName: string | null;
    schoolName: string;
    schoolYear: number;
    grade: number;
    classNumber: number;
    status: "active" | "archived";
  };
  financeRole: FinanceRole;
  permissions: {
    canOperateBank: boolean;
    canViewAudit: boolean;
    canOverride: boolean;
  };
  activeJob: null | {
    id: string;
    name: string;
    templateId: string | null;
    assignmentYear: number;
    assignmentMonth: number;
    periodId: string;
  };
  phase: "foundation";
};

type LoadError = {
  kind: "login" | "class" | "forbidden" | "network";
  message: string;
};

function classifyError(status: number, message?: string): LoadError {
  if (status === 401) {
    return {
      kind: "login",
      message: "금융센터는 직업교실에 로그인한 뒤 이용할 수 있어요.",
    };
  }
  if (status === 400) {
    return {
      kind: "class",
      message: message || "선생님은 운영할 학급을 먼저 선택해 주세요.",
    };
  }
  if (status === 403 || status === 404) {
    return {
      kind: "forbidden",
      message: message || "이 금융센터를 열 수 없어요. 학급과 로그인 상태를 확인해 주세요.",
    };
  }
  return {
    kind: "network",
    message: message || "금융센터 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  };
}

export function FinancePortal() {
  const [context, setContext] = useState<FinanceContext | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);

  const loadContext = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError(null);

    const classId = new URLSearchParams(window.location.search).get("classId");
    const query = classId ? `?classId=${encodeURIComponent(classId)}` : "";

    try {
      const response = await fetch(`/api/finance/context${query}`, {
        headers: { Accept: "application/json" },
        signal,
      });
      const data = await response.json().catch(() => ({})) as FinanceContext & { error?: string };
      if (!response.ok) {
        setContext(null);
        setError(classifyError(response.status, data.error));
        return;
      }
      setContext(data);
    } catch (reason) {
      if ((reason as Error).name !== "AbortError") {
        setContext(null);
        setError(classifyError(0));
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const frame = requestAnimationFrame(() => {
      loadContext(controller.signal);
    });
    return () => {
      cancelAnimationFrame(frame);
      controller.abort();
    };
  }, [loadContext, retryKey]);

  if (loading) {
    return (
      <main className="finance-state-page" aria-busy="true">
        <div className="finance-loading-mark" aria-hidden="true"><Landmark /></div>
        <p role="status">우리 반 금융센터를 확인하고 있어요</p>
      </main>
    );
  }

  if (error || !context) {
    return (
      <main className="finance-state-page">
        <section className="finance-state-card">
          <div className="finance-state-icon" aria-hidden="true"><Landmark /></div>
          <p className="eyebrow">금융센터</p>
          <div className="finance-state-message" role="alert">
            <h1>{error?.kind === "login" ? "로그인이 필요해요" : error?.kind === "class" ? "학급을 선택해 주세요" : "금융센터를 열지 못했어요"}</h1>
            <p>{error?.message}</p>
          </div>
          <div className="finance-state-actions">
            {error?.kind === "login" ? (
              <>
                <a className="button button-primary button-large" href="/teacher">선생님으로 들어가기</a>
                <a className="button button-light button-large" href="/student">학생으로 들어가기</a>
              </>
            ) : (
              <>
                <a className="button button-primary button-large" href={error?.kind === "class" ? "/teacher" : "/"}>
                  {error?.kind === "class" ? "교사 화면으로" : "첫 화면으로"}
                </a>
                {error?.kind !== "class" && (
                  <>
                    <a className="button button-light button-large" href="/student">학생 화면으로</a>
                    <a className="button button-light button-large" href="/teacher">교사 화면으로</a>
                  </>
                )}
                <button className="button button-light button-large" onClick={() => setRetryKey((value) => value + 1)}>
                  <RefreshCw aria-hidden="true" />다시 확인
                </button>
              </>
            )}
          </div>
        </section>
      </main>
    );
  }

  return <FinanceHome context={context} />;
}

function FinanceHome({ context }: { context: FinanceContext }) {
  const isTeacher = context.financeRole === "teacher";
  const isBanker = context.financeRole === "banker";
  const backHref = isTeacher
    ? `/teacher?classId=${encodeURIComponent(context.classroom.id)}`
    : "/student";
  const classLabel = `${context.classroom.grade}학년 ${context.classroom.classNumber}반`;
  const className = context.classroom.displayName
    || classLabel;
  const roleLabel = isTeacher ? "선생님" : isBanker ? "은행원 학생" : "학생";
  const classIsActive = context.classroom.status === "active";

  return (
    <main className={`finance-page finance-role-${context.financeRole}`}>
      <header className="finance-topbar">
        <Logo compact />
        <div className="finance-topbar-actions">
          <ThemeToggle compact />
          <a className="button button-light" href={backHref}>
            <ArrowLeft aria-hidden="true" />{isTeacher ? "교사 화면" : "학생 화면"}
          </a>
        </div>
      </header>

      <div className="finance-content">
        <section className="finance-hero" aria-labelledby="finance-title">
          <div className="finance-hero-icon" aria-hidden="true"><Landmark /></div>
          <div className="finance-hero-copy">
            <div className="finance-kicker-row">
              <p className="eyebrow">직업교실 · 금융센터</p>
              <span className={`finance-role-badge role-${context.financeRole}`}>{roleLabel}</span>
              {!classIsActive && <span className="finance-role-badge role-archived">보관된 학급</span>}
            </div>
            <h1 id="finance-title">{className} 금융센터</h1>
            <p>{context.classroom.schoolName} · {context.classroom.schoolYear}학년도 · {classLabel}</p>
          </div>
          <div className="finance-user-summary">
            <small>현재 접속</small>
            <strong>{context.actor.name}</strong>
            <span>{!classIsActive ? "기록 조회 전용으로 연결됨" : `${roleLabel} 권한으로 연결됨`}</span>
          </div>
        </section>

        {isTeacher ? (
          <TeacherFinanceHome classIsActive={classIsActive} backHref={backHref} />
        ) : isBanker ? (
          <BankerFinanceHome activeJob={context.activeJob} backHref={backHref} />
        ) : (
          <StudentFinanceHome backHref={backHref} />
        )}
      </div>
    </main>
  );
}

function TeacherFinanceHome({
  classIsActive,
  backHref,
}: {
  classIsActive: boolean;
  backHref: string;
}) {
  return (
    <>
      <section className="finance-lead-card teacher-finance-lead">
        <div className="finance-lead-icon" aria-hidden="true"><UsersRound /></div>
        <div>
          <p className="eyebrow">{classIsActive ? "학생이 주인공인 금융센터" : "보관된 학급 금융 기록"}</p>
          <h2>{classIsActive ? "은행원 친구들이 운영할 공간을 준비했어요" : "운영 기능은 잠기고 기록만 보게 됩니다"}</h2>
          <p>{classIsActive
            ? "다음 단계부터 아이들이 은행 업무를 맡고, 선생님은 어려움이나 문제가 생겼을 때 기록을 살펴보고 도울 수 있게 됩니다."
            : "보관된 학급에서는 새 금융 업무를 처리하거나 정정할 수 없고, 기존 기록만 안전하게 확인하게 됩니다."}</p>
        </div>
      </section>

      <section className="finance-principle-grid" aria-label="금융센터 운영 원칙">
        <article>
          <span aria-hidden="true"><Landmark /></span>
          <h3>은행원 학생</h3>
          <p>입출금 신청과 일상적인 은행 업무를 책임지고 직접 운영하게 됩니다.</p>
        </article>
        <article>
          <span aria-hidden="true"><UserRoundCog /></span>
          <h3>선생님</h3>
          <p>운영 기록을 확인하고, 도움이 필요할 때 대신 처리하거나 바로잡게 됩니다.</p>
        </article>
        <article>
          <span aria-hidden="true"><ShieldCheck /></span>
          <h3>시스템</h3>
          <p>중복 처리와 잔액 오류를 막고, 모든 처리 내용을 빠짐없이 남기게 됩니다.</p>
        </article>
      </section>

      <FoundationModules role="teacher" backHref={backHref} />
    </>
  );
}

function BankerFinanceHome({
  activeJob,
  backHref,
}: {
  activeJob: FinanceContext["activeJob"];
  backHref: string;
}) {
  return (
    <>
      <section className="finance-lead-card banker-finance-lead">
        <div className="finance-lead-icon" aria-hidden="true"><BriefcaseBusiness /></div>
        <div>
          <p className="eyebrow">나의 금융센터 역할</p>
          <h2>{activeJob?.name || "은행원"}으로 연결되었어요</h2>
          <p>다음 단계부터 친구들의 금융 요청을 살피고 은행 업무를 책임 있게 운영하게 됩니다.</p>
          {activeJob && (
            <small>{activeJob.assignmentYear}년 {activeJob.assignmentMonth}월 직업 배정에서 자동으로 확인했어요.</small>
          )}
        </div>
      </section>

      <section className="finance-principle-grid" aria-label="은행원이 맡을 일">
        <article>
          <span aria-hidden="true"><ClipboardList /></span>
          <h3>신청 확인</h3>
          <p>친구들이 보낸 입금·출금 신청을 차례로 확인하게 됩니다.</p>
        </article>
        <article>
          <span aria-hidden="true"><WalletCards /></span>
          <h3>은행 업무</h3>
          <p>신청 내용을 확인한 뒤 승인하거나 이유와 함께 돌려보내게 됩니다.</p>
        </article>
        <article>
          <span aria-hidden="true"><ShieldCheck /></span>
          <h3>책임 있는 기록</h3>
          <p>누가 언제 무엇을 처리했는지 기록에 남아 함께 확인할 수 있게 됩니다.</p>
        </article>
      </section>

      <FoundationModules role="banker" backHref={backHref} />
    </>
  );
}

function StudentFinanceHome({ backHref }: { backHref: string }) {
  return (
    <>
      <section className="finance-lead-card student-finance-lead">
        <div className="finance-lead-icon" aria-hidden="true"><WalletCards /></div>
        <div>
          <p className="eyebrow">나의 금융생활</p>
          <h2>금융센터에 안전하게 연결되었어요</h2>
          <p>앞으로 내 학급화폐와 거래 기록을 보고, 필요한 은행 업무를 신청할 수 있게 됩니다.</p>
        </div>
      </section>

      <section className="finance-principle-grid" aria-label="학생 금융센터에서 준비하는 기능">
        <article>
          <span aria-hidden="true"><WalletCards /></span>
          <h3>내 지갑</h3>
          <p>사용할 수 있는 금액과 보관 중인 금액을 헷갈리지 않게 보여 줄게요.</p>
        </article>
        <article>
          <span aria-hidden="true"><ClipboardList /></span>
          <h3>은행 신청</h3>
          <p>입금·출금을 신청하고 은행원이 확인한 결과를 볼 수 있어요.</p>
        </article>
        <article>
          <span aria-hidden="true"><Clock3 /></span>
          <h3>거래 기록</h3>
          <p>언제 어떤 이유로 금액이 바뀌었는지 쉽게 확인할 수 있어요.</p>
        </article>
      </section>

      <FoundationModules role="student" backHref={backHref} />
    </>
  );
}

function FoundationModules({ role, backHref }: { role: FinanceRole; backHref: string }) {
  const message = role === "teacher"
    ? "다음 파트부터 운영 기록 확인과 도움·정정 기능을 차례로 연결합니다."
    : role === "banker"
      ? "다음 파트부터 실제 신청 확인과 은행 업무 기능을 차례로 연결합니다."
      : "다음 파트부터 실제 지갑과 은행 신청 기능을 차례로 연결합니다.";

  return (
    <section className="finance-foundation-card">
      <div>
        <span className="finance-ready-mark" aria-hidden="true"><ShieldCheck /></span>
        <div>
          <p className="eyebrow">1단계 연결 완료</p>
          <h2>로그인과 학급·직업 권한을 연결했어요</h2>
          <p>{message}</p>
        </div>
      </div>
      <span className="finance-coming-badge"><Clock3 aria-hidden="true" />다음 파트 준비 중</span>
      <p className="finance-honest-note">아직 실제 잔액이나 거래를 만들지는 않았어요. 안전한 거래 장부가 준비된 뒤 기능을 열겠습니다.</p>
      <a className="finance-next-link" href={backHref}>
        원래 화면으로 돌아가기 <ArrowRight aria-hidden="true" />
      </a>
    </section>
  );
}
