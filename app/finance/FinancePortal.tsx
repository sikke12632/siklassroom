"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Landmark,
  RefreshCw,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { Logo } from "@/app/components/Logo";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import {
  FinanceWalletOverview,
  type FinanceOverviewData,
} from "./FinanceWalletOverview";
import { FinanceAuditPanel } from "./FinanceAuditPanel";
import { FinanceDepositsPanel } from "./FinanceDepositsPanel";
import { FinanceOperations } from "./FinanceOperations";
import { FinanceSettingsPanel } from "./FinanceSettingsPanel";

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

type FinanceOverviewPayload = {
  context: FinanceContext;
  finance: FinanceOverviewData;
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
  const [overview, setOverview] = useState<FinanceOverviewPayload | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const loadContext = useCallback(async (signal: AbortSignal, quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);

    const classId = new URLSearchParams(window.location.search).get("classId");
    const query = classId ? `?classId=${encodeURIComponent(classId)}` : "";

    try {
      const response = await fetch(`/api/finance/overview${query}`, {
        headers: { Accept: "application/json" },
        signal,
      });
      const data = await response.json().catch(() => ({})) as FinanceOverviewPayload & { error?: string };
      if (!response.ok) {
        setOverview(null);
        setError(classifyError(response.status, data.error));
        return;
      }
      setOverview(data);
    } catch (reason) {
      if ((reason as Error).name !== "AbortError") {
        setOverview(null);
        setError(classifyError(0));
      }
    } finally {
      if (!signal.aborted) {
        if (quiet) setRefreshing(false);
        else setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const frame = requestAnimationFrame(() => {
      loadContext(controller.signal, false);
    });
    return () => {
      cancelAnimationFrame(frame);
      controller.abort();
    };
  }, [loadContext, retryKey]);

  const refreshOverview = useCallback(async () => {
    const controller = new AbortController();
    await loadContext(controller.signal, true);
  }, [loadContext]);

  if (loading) {
    return (
      <main className="finance-state-page" aria-busy="true">
        <div className="finance-loading-mark" aria-hidden="true"><Landmark /></div>
        <p role="status">우리 반 금융센터를 확인하고 있어요</p>
      </main>
    );
  }

  if (error || !overview) {
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

  return (
    <FinanceHome
      context={overview.context}
      finance={overview.finance}
      refreshing={refreshing}
      onRefresh={refreshOverview}
    />
  );
}

function FinanceHome({
  context,
  finance,
  refreshing,
  onRefresh,
}: {
  context: FinanceContext;
  finance: FinanceOverviewData;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
}) {
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
          <TeacherFinanceHome
            context={context}
            finance={finance}
            classIsActive={classIsActive}
            backHref={backHref}
            refreshing={refreshing}
            onRefresh={onRefresh}
          />
        ) : isBanker ? (
          <BankerFinanceHome
            context={context}
            finance={finance}
            activeJob={context.activeJob}
            backHref={backHref}
            refreshing={refreshing}
            onRefresh={onRefresh}
          />
        ) : (
          <StudentFinanceHome
            context={context}
            finance={finance}
            backHref={backHref}
            refreshing={refreshing}
            onRefresh={onRefresh}
          />
        )}
      </div>
    </main>
  );
}

function TeacherFinanceHome({
  context,
  finance,
  classIsActive,
  backHref,
  refreshing,
  onRefresh,
}: {
  context: FinanceContext;
  finance: FinanceOverviewData;
  classIsActive: boolean;
  backHref: string;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
}) {
  return (
    <>
      <section className="finance-lead-card teacher-finance-lead">
        <div className="finance-lead-icon" aria-hidden="true"><UsersRound /></div>
        <div>
          <p className="eyebrow">{classIsActive ? "학생이 주인공인 금융센터" : "보관된 학급 금융 기록"}</p>
          <h2>{classIsActive ? "은행원 친구들이 금융센터를 운영하고 있어요" : "운영 기능은 잠기고 기록만 보게 됩니다"}</h2>
          <p>{classIsActive
            ? "선생님은 전체 기록을 살펴보고, 아이들이 어려워할 때만 대신 처리하거나 잘못된 거래를 정정할 수 있어요."
            : "보관된 학급에서는 새 금융 업무를 처리하거나 정정할 수 없고, 기존 기록만 안전하게 확인하게 됩니다."}</p>
        </div>
      </section>

      <nav className="finance-teacher-section-nav" aria-label="금융센터 교사 메뉴">
        <a href="#finance-operations">은행 업무</a>
        <a href="#finance-deposits">예금상품</a>
        <a href="#finance-settings">화폐·은행 설정</a>
        <a href="#finance-audit">전체 금융 기록</a>
      </nav>

      <div id="finance-operations">
        <FinanceOperations
          role="teacher"
          actorId={context.actor.id}
          classId={context.classroom.id}
          classIsActive={classIsActive}
          canOverride={context.permissions.canOverride}
          finance={finance}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      </div>

      <FinanceDepositsPanel
        classId={context.classroom.id}
        financeRole={context.financeRole}
        actorType={context.actor.type}
        classIsActive={classIsActive}
        currencyLabel={finance.currencyLabel}
        denominations={finance.settings.denominations}
        onRefresh={onRefresh}
      />

      <div id="finance-settings">
        <FinanceSettingsPanel
          role="teacher"
          classId={context.classroom.id}
          classIsActive={classIsActive}
          settings={finance.settings}
          bankers={finance.bankers}
          onRefresh={onRefresh}
        />
      </div>

      <FinanceWalletOverview
        role="teacher"
        actorId={context.actor.id}
        finance={finance}
        classIsActive={classIsActive}
        hideLedger
      />
      <div id="finance-audit">
        <FinanceAuditPanel
          classId={context.classroom.id}
          currencyUnit={finance.currencyLabel}
        />
      </div>
      <ReturnLink backHref={backHref} />
    </>
  );
}

function BankerFinanceHome({
  context,
  finance,
  activeJob,
  backHref,
  refreshing,
  onRefresh,
}: {
  context: FinanceContext;
  finance: FinanceOverviewData;
  activeJob: FinanceContext["activeJob"];
  backHref: string;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
}) {
  return (
    <>
      <section className="finance-lead-card banker-finance-lead">
        <div className="finance-lead-icon" aria-hidden="true"><BriefcaseBusiness /></div>
        <div>
          <p className="eyebrow">나의 금융센터 역할</p>
          <h2>{activeJob?.name || "은행원"}으로 연결되었어요</h2>
          <p>친구들의 신청을 살피고, 실물 화폐와 금액을 확인한 뒤 직접 처리해요.</p>
          {activeJob && (
            <small>{activeJob.assignmentYear}년 {activeJob.assignmentMonth}월 직업 배정에서 자동으로 확인했어요.</small>
          )}
        </div>
      </section>

      <FinanceOperations
        role="banker"
        actorId={context.actor.id}
        classId={context.classroom.id}
        classIsActive={context.classroom.status === "active"}
        canOverride={false}
        finance={finance}
        refreshing={refreshing}
        onRefresh={onRefresh}
      />

      <FinanceDepositsPanel
        classId={context.classroom.id}
        financeRole={context.financeRole}
        actorType={context.actor.type}
        classIsActive={context.classroom.status === "active"}
        currencyLabel={finance.currencyLabel}
        denominations={finance.settings.denominations}
        onRefresh={onRefresh}
      />

      <FinanceSettingsPanel
        role="banker"
        classId={context.classroom.id}
        classIsActive={context.classroom.status === "active"}
        settings={finance.settings}
        bankers={finance.bankers}
        onRefresh={onRefresh}
      />

      <FinanceWalletOverview
        role="banker"
        actorId={context.actor.id}
        finance={finance}
        classIsActive={context.classroom.status === "active"}
      />
      <ReturnLink backHref={backHref} />
    </>
  );
}

function StudentFinanceHome({
  context,
  finance,
  backHref,
  refreshing,
  onRefresh,
}: {
  context: FinanceContext;
  finance: FinanceOverviewData;
  backHref: string;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
}) {
  return (
    <>
      <section className="finance-lead-card student-finance-lead">
        <div className="finance-lead-icon" aria-hidden="true"><WalletCards /></div>
        <div>
          <p className="eyebrow">나의 금융생활</p>
          <h2>내 지갑과 은행 업무를 한곳에서 확인해요</h2>
          <p>실물 화폐를 맡기거나 찾아갈 때 은행원 친구에게 바로 신청할 수 있어요.</p>
        </div>
      </section>

      <FinanceOperations
        role="student"
        actorId={context.actor.id}
        classId={context.classroom.id}
        classIsActive={context.classroom.status === "active"}
        canOverride={false}
        finance={finance}
        refreshing={refreshing}
        onRefresh={onRefresh}
      />

      <FinanceDepositsPanel
        classId={context.classroom.id}
        financeRole={context.financeRole}
        actorType={context.actor.type}
        classIsActive={context.classroom.status === "active"}
        currencyLabel={finance.currencyLabel}
        denominations={finance.settings.denominations}
        onRefresh={onRefresh}
      />

      <FinanceSettingsPanel
        role="student"
        classId={context.classroom.id}
        classIsActive={context.classroom.status === "active"}
        settings={finance.settings}
        bankers={finance.bankers}
        onRefresh={onRefresh}
      />

      <FinanceWalletOverview
        role="student"
        actorId={context.actor.id}
        finance={finance}
        classIsActive={context.classroom.status === "active"}
        hideBalanceSummary
      />
      <ReturnLink backHref={backHref} />
    </>
  );
}

function ReturnLink({ backHref }: { backHref: string }) {
  return (
    <div className="finance-return-row">
      <a className="finance-next-link" href={backHref}>
        원래 화면으로 돌아가기 <ArrowRight aria-hidden="true" />
      </a>
    </div>
  );
}
