"use client";

import {
  ArrowLeft,
  BarChart3,
  CircleAlert,
  ClipboardList,
  LoaderCircle,
  PackageOpen,
  RefreshCw,
  ShoppingCart,
  Store,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/app/components/Logo";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { loadMartDashboard, martErrorMessage, type MartDashboard } from "./mart-api";
import { MartInventoryPanel, MartProductsPanel } from "./MartManagement";
import { MartRecordsPanel, MartStatisticsPanel } from "./MartRecords";
import { MartSaleWorkspace } from "./MartSaleWorkspace";
import {
  allowedMartSections,
  martNavigationKey,
  resolveMartSection,
  type MartSection,
} from "./mart-navigation";
import styles from "./MartPortal.module.css";

type PortalError = {
  kind: "login" | "class" | "forbidden" | "network";
  message: string;
};

const SECTION_LABELS: Record<MartSection, string> = {
  sale: "판매",
  products: "상품",
  inventory: "재고",
  records: "기록",
  statistics: "통계",
};

const SECTION_ICONS: Record<MartSection, React.ReactNode> = {
  sale: <ShoppingCart aria-hidden="true" />,
  products: <PackageOpen aria-hidden="true" />,
  inventory: <Store aria-hidden="true" />,
  records: <ClipboardList aria-hidden="true" />,
  statistics: <BarChart3 aria-hidden="true" />,
};

function portalError(error: unknown): PortalError {
  const status = typeof error === "object" && error && "status" in error
    ? Number((error as { status: number }).status)
    : 0;
  if (status === 401) {
    return { kind: "login", message: "직업교실에 로그인한 뒤 마트센터를 이용해 주세요." };
  }
  if (status === 400) {
    return { kind: "class", message: "운영할 학급을 먼저 선택해 주세요." };
  }
  if (status === 403 || status === 404) {
    return { kind: "forbidden", message: "이 마트센터를 열 권한이 없거나 학급을 찾지 못했습니다." };
  }
  return { kind: "network", message: martErrorMessage(error) };
}

export function MartPortal() {
  const [dashboard, setDashboard] = useState<MartDashboard | null>(null);
  const [error, setError] = useState<PortalError | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retryRevision, setRetryRevision] = useState(0);
  const requestRevision = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  const load = useCallback(async (quiet: boolean) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const requestId = ++requestRevision.current;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const requestedClassId = new URLSearchParams(window.location.search).get("classId");
      const nextDashboard = await loadMartDashboard(requestedClassId, controller.signal);
      if (controller.signal.aborted || requestId !== requestRevision.current) return;
      setDashboard(nextDashboard);
    } catch (reason) {
      if (
        controller.signal.aborted
        || requestId !== requestRevision.current
        || (reason as { name?: string })?.name === "AbortError"
      ) return;
      if (!quiet) setDashboard(null);
      setError(portalError(reason));
    } finally {
      if (!controller.signal.aborted && requestId === requestRevision.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load(false));
    return () => {
      cancelAnimationFrame(frame);
      requestRevision.current += 1;
      activeRequest.current?.abort();
    };
  }, [load, retryRevision]);

  if (loading && !dashboard) {
    return (
      <main className={styles.statePage} aria-busy="true">
        <LoaderCircle className={styles.spin} aria-hidden="true" />
        <p role="status">우리 반 마트 문을 열고 있어요</p>
      </main>
    );
  }

  if (!dashboard) {
    const backHref = error?.kind === "login" ? "/" : "/teacher";
    return (
      <main className={styles.statePage}>
        <section className={styles.stateCard} aria-labelledby="mart-error-title">
          <Store aria-hidden="true" />
          <p className={styles.eyebrow}>마트센터</p>
          <h1 id="mart-error-title">
            {error?.kind === "login" ? "로그인이 필요해요" : "마트센터를 열지 못했어요"}
          </h1>
          <p role="alert">{error?.message}</p>
          <div className={styles.buttonRow}>
            <a className={`${styles.button} ${styles.primary}`} href={backHref}>
              돌아가기
            </a>
            <button
              className={styles.button}
              type="button"
              onClick={() => setRetryRevision((value) => value + 1)}
            >
              <RefreshCw aria-hidden="true" /> 다시 확인
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <MartHome
      key={martNavigationKey(dashboard.context)}
      dashboard={dashboard}
      error={error}
      refreshing={refreshing}
      onRefresh={() => load(true)}
    />
  );
}

function MartHome({
  dashboard,
  error,
  refreshing,
  onRefresh,
}: {
  dashboard: MartDashboard;
  error: PortalError | null;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
}) {
  const { context } = dashboard;
  const operator = context.role !== "student" && context.permissions.canOperate;
  const sections = allowedMartSections(context);
  const [requestedSection, setSection] = useState<MartSection>(sections[0] ?? "records");
  const section = resolveMartSection(requestedSection, sections);
  const roleLabel = context.role === "teacher"
    ? "선생님"
    : context.role === "market_clerk"
      ? "이번 달 마트 직원"
      : "학생";
  const backHref = context.actor.type === "teacher"
    ? `/teacher?classId=${encodeURIComponent(context.classroom.id)}`
    : "/student";

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Logo compact />
        <div className={styles.topbarActions}>
          <ThemeToggle compact />
          <a className={styles.button} href={backHref}>
            <ArrowLeft aria-hidden="true" /> {context.actor.type === "teacher" ? "교사 화면" : "학생 화면"}
          </a>
        </div>
      </header>

      <div className={styles.content}>
        <section className={styles.hero} aria-labelledby="mart-title">
          <div className={styles.heroIcon} aria-hidden="true"><Store /></div>
          <div>
            <p className={styles.eyebrow}>선생님은 편하게 · 학생은 재미있게</p>
            <h1 id="mart-title">{context.classroom.name || `${context.classroom.grade}학년 ${context.classroom.classNumber}반`} 마트센터</h1>
            <p>
              {operator
                ? "현물 학급화폐로 판매하고, 상품과 재고 기록을 한곳에서 관리해요."
                : "내가 현물 학급화폐로 산 물건과 취소 기록을 확인해요."}
            </p>
          </div>
          <div className={styles.heroMeta}>
            <span>{roleLabel}</span>
            {context.activeJob && <span>{context.activeJob.name}</span>}
            <button
              className={styles.button}
              type="button"
              onClick={() => void onRefresh()}
              disabled={refreshing}
            >
              <RefreshCw className={refreshing ? styles.spin : undefined} aria-hidden="true" />
              {refreshing ? "확인 중" : "새로고침"}
            </button>
          </div>
        </section>

        {error && (
          <div className={`${styles.notice} ${styles.danger}`} role="alert">
            <CircleAlert aria-hidden="true" />
            <div><b>최신 정보를 불러오지 못했어요.</b><p>{error.message}</p></div>
          </div>
        )}

        {context.classroom.status !== "active" && (
          <div className={`${styles.notice} ${styles.warning}`} role="alert">
            <CircleAlert aria-hidden="true" />
            <div><b>보관된 학급입니다.</b><p>기록은 볼 수 있지만 새 판매와 변경은 할 수 없어요.</p></div>
          </div>
        )}

        {operator && (
          <div className={styles.cashNotice}>
            <b>현물화폐 판매</b>
            <span>이 화면은 실제로 받은 {context.currency.name}만 기록하며 디지털 금융 자산은 사용하지 않습니다.</span>
          </div>
        )}

        <nav className={styles.tabs} aria-label="마트센터 메뉴">
          {sections.map((item) => (
            <button
              key={item}
              type="button"
              className={section === item ? styles.activeTab : undefined}
              aria-current={section === item ? "page" : undefined}
              onClick={() => setSection(item)}
            >
              {SECTION_ICONS[item]}
              {SECTION_LABELS[item]}
            </button>
          ))}
        </nav>

        <div className={styles.workspace}>
          {section === "sale" && operator && (
            <MartSaleWorkspace dashboard={dashboard} onChanged={onRefresh} />
          )}
          {section === "products" && context.permissions.canManageProducts && (
            <MartProductsPanel dashboard={dashboard} onChanged={onRefresh} />
          )}
          {section === "inventory" && context.permissions.canAdjustInventory && (
            <MartInventoryPanel dashboard={dashboard} onChanged={onRefresh} />
          )}
          {section === "records" && (
            <MartRecordsPanel
              key={`${context.classroom.id}:${context.revision}`}
              dashboard={dashboard}
              onChanged={onRefresh}
            />
          )}
          {section === "statistics" && context.permissions.canViewStatistics && (
            <MartStatisticsPanel dashboard={dashboard} />
          )}
        </div>
      </div>
    </main>
  );
}
