"use client";

import {
  BarChart3,
  CircleAlert,
  Coins,
  HandCoins,
  Landmark,
  LoaderCircle,
  PiggyBank,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FinanceAssetDistributionBucket,
  FinanceAssetSummary,
  FinanceStatisticsRole,
  FinanceStudentAsset,
} from "@/lib/finance-statistics-rules";

type FinanceStatisticsPayload = {
  context: {
    financeRole: FinanceStatisticsRole;
    actorType: "teacher" | "student";
    classId: string;
  };
  serverTime: number;
  currencyUnit: string;
  dataQuality: "ok" | "attention";
  moneySupply: {
    metricType: "recorded_money_supply";
    current: number;
    walletBalance: number;
    depositPrincipal: number;
    fundingLocked: number;
    previousMonthValue: string;
    previousMonthEnd: number | null;
    change: number | null;
    changeBps: number | null;
    actualPriceInflationMeasured: false;
  };
  assets: FinanceAssetSummary;
  distribution: FinanceAssetDistributionBucket[] | null;
  ownAsset?: FinanceStudentAsset;
  students?: FinanceStudentAsset[];
};

export type FinanceStatisticsPanelProps = {
  classId: string;
  financeRole: FinanceStatisticsRole;
  currencyUnit?: string;
  refreshRevision?: number;
};

const DISTRIBUTION_LABELS: Record<FinanceAssetDistributionBucket["key"], string> = {
  zero: "기록된 자산 없음",
  below_half: "평균의 절반 미만",
  around_average: "평균 범위",
  above_average: "평균의 1.5배 초과",
};

function moneyText(amount: number, unit: string, signed = false) {
  const sign = signed && amount > 0 ? "+" : "";
  return `${sign}${amount.toLocaleString("ko-KR")} ${unit}`;
}

function rateText(changeBps: number | null) {
  if (changeBps === null) return "비교 비율 없음";
  const percentage = changeBps / 100;
  const sign = percentage > 0 ? "+" : "";
  return `${sign}${percentage.toLocaleString("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}%`;
}

function loadErrorMessage(status: number, serverMessage?: string) {
  if (status === 401) return "로그인이 만료됐어요. 다시 로그인한 뒤 확인해 주세요.";
  if (status === 403 || status === 404) {
    return "이 학급의 경제 현황을 볼 수 없어요. 학급과 권한을 확인해 주세요.";
  }
  return serverMessage || "경제 현황을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.";
}

function AssetCard({
  icon,
  label,
  amount,
  note,
  unit,
}: {
  icon: React.ReactNode;
  label: string;
  amount: number;
  note: string;
  unit: string;
}) {
  return (
    <article className="finance-balance-card finance-statistics-asset-card">
      <span aria-hidden="true">{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{moneyText(amount, unit)}</strong>
        <p>{note}</p>
      </div>
    </article>
  );
}

export function FinanceStatisticsPanel({
  classId,
  financeRole,
  currencyUnit = "학급화폐",
  refreshRevision = 0,
}: FinanceStatisticsPanelProps) {
  const [statistics, setStatistics] = useState<FinanceStatisticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const activeController = useRef<AbortController | null>(null);

  const loadStatistics = useCallback(async (quiet = false) => {
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    const sequence = ++requestSequence.current;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const parameters = new URLSearchParams({ classId });
      const response = await fetch(`/api/finance/statistics?${parameters.toString()}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({})) as Partial<FinanceStatisticsPayload> & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(loadErrorMessage(response.status, data.error));
      }
      if (
        !data.moneySupply
        || !data.assets
        || !data.context
        || data.context.classId !== classId
        || data.context.financeRole !== financeRole
      ) {
        throw new Error("경제 현황 응답을 확인하지 못했어요. 새로고침해 주세요.");
      }
      if (controller.signal.aborted || requestSequence.current !== sequence) return;
      setStatistics(data as FinanceStatisticsPayload);
    } catch (reason) {
      if ((reason as Error).name !== "AbortError" && requestSequence.current === sequence) {
        setError(reason instanceof Error
          ? reason.message
          : "경제 현황을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      if (!controller.signal.aborted && requestSequence.current === sequence) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [classId, financeRole]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void loadStatistics(false);
    });
    return () => {
      cancelAnimationFrame(frame);
      activeController.current?.abort();
    };
  }, [loadStatistics, refreshRevision]);

  const unit = statistics?.currencyUnit.trim() || currencyUnit.trim() || "학급화폐";

  return (
    <section
      id="finance-statistics"
      className="finance-statistics-panel finance-operations-card"
      aria-labelledby="finance-statistics-title"
      aria-busy={loading || refreshing}
    >
      <div className="finance-operation-heading finance-statistics-heading">
        <div>
          <p className="eyebrow">우리 반 경제 현황</p>
          <h2 id="finance-statistics-title">통화량과 자산 흐름을 살펴봐요</h2>
          <p>지갑·예금·주식 기록을 연결해 지금의 학급 경제 상태를 보여 줍니다.</p>
        </div>
        <button
          className="button button-light finance-refresh-button"
          type="button"
          onClick={() => void loadStatistics(true)}
          disabled={loading || refreshing}
        >
          <RefreshCw className={refreshing ? "spin" : ""} aria-hidden="true" />
          새로고침
        </button>
      </div>

      {error && (
        <div className="finance-audit-state finance-audit-error" role="alert">
          <CircleAlert aria-hidden="true" />
          <div>
            <b>경제 현황을 불러오지 못했어요</b>
            <p>{error}</p>
          </div>
          <button
            className="button button-light"
            type="button"
            onClick={() => void loadStatistics(false)}
            disabled={loading || refreshing}
          >
            다시 시도
          </button>
        </div>
      )}

      {loading && !statistics ? (
        <div className="finance-audit-state" role="status" aria-live="polite">
          <LoaderCircle className="spin" aria-hidden="true" />
          <p>경제 기록을 계산하고 있어요.</p>
        </div>
      ) : statistics ? (
        <StatisticsContent statistics={statistics} unit={unit} />
      ) : null}
    </section>
  );
}

function StatisticsContent({
  statistics,
  unit,
}: {
  statistics: FinanceStatisticsPayload;
  unit: string;
}) {
  const { moneySupply, assets } = statistics;
  const changeDirection = (moneySupply.change ?? 0) >= 0 ? "increase" : "decrease";

  return (
    <>
      {statistics.dataQuality === "attention" && (
        <div className="finance-ledger-notice danger" role="alert">
          <CircleAlert aria-hidden="true" />
          <p>
            <b>원장 확인이 먼저 필요해요.</b>{" "}
            현재 합계는 볼 수 있지만 전월 대비 증감은 안전을 위해 숨겼습니다.
          </p>
        </div>
      )}

      <div className="finance-balance-grid finance-statistics-summary-grid">
        <article className="finance-balance-card primary">
          <span aria-hidden="true"><Coins /></span>
          <div>
            <small>시스템 기록 통화량</small>
            <strong>{moneyText(moneySupply.current, unit)}</strong>
            <p>학생 지갑, 정산 전 예금 원금, 미정산 펀딩 참여금을 합한 금액</p>
          </div>
        </article>
        <article className="finance-balance-card">
          <span aria-hidden="true">
            {changeDirection === "increase" ? <TrendingUp /> : <TrendingDown />}
          </span>
          <div>
            <small>{moneySupply.previousMonthValue} 말 대비</small>
            <strong>
              {moneySupply.change === null
                ? "비교 자료 없음"
                : rateText(moneySupply.changeBps)}
            </strong>
            <p>
              {moneySupply.change === null
                ? "지난달 말 기록이 없거나 원장 확인이 필요해요."
                : `${moneyText(moneySupply.change, unit, true)} 변했어요.`}
            </p>
          </div>
        </article>
        <article className="finance-balance-card">
          <span aria-hidden="true"><Landmark /></span>
          <div>
            <small>추적 가능한 학생 총자산</small>
            <strong>{moneyText(assets.trackedTotal, unit)}</strong>
            <p>활성 학생의 지갑·예금 평가액·주식 현재가 합계</p>
          </div>
        </article>
        <article className="finance-balance-card">
          <span aria-hidden="true"><UsersRound /></span>
          <div>
            <small>학생 1명당 평균 자산</small>
            <strong>{assets.average === null ? "자료 없음" : moneyText(assets.average, unit)}</strong>
            <p>활성 학생 {assets.activeStudentCount.toLocaleString("ko-KR")}명 기준</p>
          </div>
        </article>
      </div>

      <section className="finance-statistics-breakdown" aria-labelledby="finance-statistics-breakdown-title">
        <div className="finance-subsection-heading">
          <div>
            <p className="eyebrow">자산 구성</p>
            <h3 id="finance-statistics-breakdown-title">어디에 얼마나 들어 있을까요?</h3>
          </div>
        </div>
        <div className="finance-balance-grid">
          <AssetCard
            icon={<WalletCards />}
            label="학생 지갑"
            amount={assets.walletTotal}
            note="현재 시스템 지갑에 남아 있는 금액"
            unit={unit}
          />
          <AssetCard
            icon={<PiggyBank />}
            label="예금 평가액"
            amount={assets.depositValueTotal}
            note="지금 해지하거나 만기 수령할 수 있는 금액"
            unit={unit}
          />
          <AssetCard
            icon={<BarChart3 />}
            label="주식 평가액"
            amount={assets.stockMarketValueTotal}
            note="현재 주가로 계산한 보유 주식 가치"
            unit={unit}
          />
          <AssetCard
            icon={<HandCoins />}
            label="펀딩 참여금"
            amount={assets.fundingLockedTotal}
            note="성공 지급이나 환불 전까지 안전하게 잠긴 참여금"
            unit={unit}
          />
        </div>
      </section>

      {statistics.ownAsset && (
        <OwnAsset asset={statistics.ownAsset} unit={unit} />
      )}
      {statistics.distribution && (
        <AssetDistribution
          distribution={statistics.distribution}
          studentCount={assets.activeStudentCount}
        />
      )}
      {statistics.students && (
        <TeacherStudentAssets students={statistics.students} unit={unit} />
      )}

      <div className="finance-ledger-notice finance-statistics-disclaimer">
        <ShieldCheck aria-hidden="true" />
        <p>
          <b>이 수치는 실제 물가상승률이 아닙니다.</b>{" "}
          통화량 변화는 인플레이션을 살펴보는 참고 자료이며, 손에 들고 있는 지폐와 교실 물건 가격은 포함하지 않습니다.
        </p>
      </div>
    </>
  );
}

function OwnAsset({ asset, unit }: { asset: FinanceStudentAsset; unit: string }) {
  return (
    <section className="finance-statistics-own" aria-labelledby="finance-statistics-own-title">
      <div className="finance-subsection-heading">
        <div>
          <p className="eyebrow">나의 자산</p>
          <h3 id="finance-statistics-own-title">내 기록만 자세히 볼 수 있어요</h3>
        </div>
        <strong>{moneyText(asset.total, unit)}</strong>
      </div>
      <dl className="finance-statistics-own-list">
        <div><dt>지갑</dt><dd>{moneyText(asset.wallet, unit)}</dd></div>
        <div><dt>예금</dt><dd>{moneyText(asset.deposits, unit)}</dd></div>
        <div><dt>주식</dt><dd>{moneyText(asset.stocks, unit)}</dd></div>
        <div><dt>펀딩 참여금</dt><dd>{moneyText(asset.funding, unit)}</dd></div>
      </dl>
    </section>
  );
}

function AssetDistribution({
  distribution,
  studentCount,
}: {
  distribution: FinanceAssetDistributionBucket[];
  studentCount: number;
}) {
  const maximumCount = Math.max(1, ...distribution.map((bucket) => bucket.count));
  return (
    <section className="finance-statistics-distribution" aria-labelledby="finance-statistics-distribution-title">
      <div className="finance-subsection-heading">
        <div>
          <p className="eyebrow">익명 자산 분포</p>
          <h3 id="finance-statistics-distribution-title">이름 없이 구간별 인원만 보여 줘요</h3>
        </div>
        <span>{studentCount.toLocaleString("ko-KR")}명</span>
      </div>
      <ul>
        {distribution.map((bucket) => (
          <li key={bucket.key}>
            <div>
              <span>{DISTRIBUTION_LABELS[bucket.key]}</span>
              <b>{bucket.count.toLocaleString("ko-KR")}명</b>
            </div>
            <progress
              max={maximumCount}
              value={bucket.count}
              aria-label={`${DISTRIBUTION_LABELS[bucket.key]} ${bucket.count}명`}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function TeacherStudentAssets({
  students,
  unit,
}: {
  students: FinanceStudentAsset[];
  unit: string;
}) {
  return (
    <section className="finance-statistics-students" aria-labelledby="finance-statistics-students-title">
      <div className="finance-subsection-heading">
        <div>
          <p className="eyebrow">교사 전용 상세</p>
          <h3 id="finance-statistics-students-title">학생별 자산 구성</h3>
        </div>
        <span>{students.length.toLocaleString("ko-KR")}명</span>
      </div>
      {students.length === 0 ? (
        <div className="finance-empty-state compact">
          <UsersRound aria-hidden="true" />
          <b>확인할 활성 학생이 없어요.</b>
        </div>
      ) : (
        <div className="finance-statistics-table-wrap">
          <table>
            <caption className="visually-hidden">학생별 지갑, 예금, 주식, 펀딩 참여금 및 총자산</caption>
            <thead>
              <tr>
                <th scope="col">학생</th>
                <th scope="col">지갑</th>
                <th scope="col">예금</th>
                <th scope="col">주식</th>
                <th scope="col">펀딩 참여금</th>
                <th scope="col">총자산</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.studentId}>
                  <th scope="row">{student.studentNumber}번 {student.studentName}</th>
                  <td>{moneyText(student.wallet, unit)}</td>
                  <td>{moneyText(student.deposits, unit)}</td>
                  <td>{moneyText(student.stocks, unit)}</td>
                  <td>{moneyText(student.funding, unit)}</td>
                  <td><b>{moneyText(student.total, unit)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
