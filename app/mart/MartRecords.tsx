"use client";

import {
  BarChart3,
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  Download,
  PackageSearch,
  ReceiptText,
  RotateCcw,
  ShieldAlert,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  MartApiError,
  cancelMartSale,
  loadMartAuditPage,
  loadMartSalesPage,
  martActionKey,
  martErrorMessage,
  martSalesCsvUrl,
  mergeMartAuditPages,
  mergeMartSalesPages,
  visibleMartSales,
  type MartDashboard,
  type MartSale,
} from "./mart-api";
import styles from "./MartPortal.module.css";

type Notice = { tone: "success" | "warning" | "danger"; message: string };

function amountText(amount: number, unit: string) {
  return `${amount.toLocaleString("ko-KR")} ${unit}`;
}

function dateTimeText(epochMs: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(epochMs));
}

const AUDIT_LABELS: Record<string, string> = {
  product_create: "상품 생성",
  product_update: "상품 수정",
  inventory_inbound: "입고",
  inventory_outbound: "수동 출고",
  inventory_correction: "재고 비상 정정",
  sale_create: "판매 확정",
  sale_cancel: "판매 취소",
};

export function MartRecordsPanel({
  dashboard,
  onChanged,
}: {
  dashboard: MartDashboard;
  onChanged: () => Promise<void>;
}) {
  const { context } = dashboard;
  const [status, setStatus] = useState<"all" | "completed" | "cancelled">("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [appliedDates, setAppliedDates] = useState({ from: "", to: "" });
  const [history, setHistory] = useState(() => visibleMartSales(context, dashboard.sales));
  const [nextCursor, setNextCursor] = useState(dashboard.salesNextCursor);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [auditEvents, setAuditEvents] = useState(dashboard.audit);
  const [auditNextCursor, setAuditNextCursor] = useState(dashboard.auditNextCursor);
  const [auditBusy, setAuditBusy] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const cancelAttempt = useRef<{ signature: string; key: string } | null>(null);
  const historyRequest = useRef(0);
  const sales = visibleMartSales(context, history);
  const canCancel = context.role !== "student" && context.permissions.canCancelSales;
  const csvHref = martSalesCsvUrl(context.classroom.id, {
    status,
    from: appliedDates.from,
    to: appliedDates.to,
  });

  const replaceHistory = async (nextStatus: typeof status, from: string, to: string) => {
    if (from && to && from > to) {
      setNotice({ tone: "warning", message: "시작 날짜는 종료 날짜보다 늦을 수 없습니다." });
      return;
    }
    const requestId = ++historyRequest.current;
    setHistoryBusy(true);
    setNotice(null);
    try {
      const page = await loadMartSalesPage({
        classId: context.classroom.id,
        status: nextStatus,
        from,
        to,
      });
      if (requestId !== historyRequest.current) return;
      setStatus(nextStatus);
      setAppliedDates({ from, to });
      setHistory(visibleMartSales(context, page.sales));
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (requestId !== historyRequest.current) return;
      setNotice({ tone: "danger", message: martErrorMessage(error) });
    } finally {
      if (requestId === historyRequest.current) setHistoryBusy(false);
    }
  };

  const loadMore = async () => {
    if (!nextCursor || historyBusy) return;
    const requestId = ++historyRequest.current;
    setHistoryBusy(true);
    setNotice(null);
    try {
      const page = await loadMartSalesPage({
        classId: context.classroom.id,
        cursor: nextCursor,
        status,
        from: appliedDates.from,
        to: appliedDates.to,
      });
      if (requestId !== historyRequest.current) return;
      setHistory((current) => mergeMartSalesPages(current, visibleMartSales(context, page.sales)));
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (requestId !== historyRequest.current) return;
      setNotice({ tone: "danger", message: martErrorMessage(error) });
    } finally {
      if (requestId === historyRequest.current) setHistoryBusy(false);
    }
  };

  const loadMoreAudit = async () => {
    if (!auditNextCursor || auditBusy) return;
    setAuditBusy(true);
    setNotice(null);
    try {
      const page = await loadMartAuditPage({
        classId: context.classroom.id,
        cursor: auditNextCursor,
      });
      setAuditEvents((current) => mergeMartAuditPages(current, page.events));
      setAuditNextCursor(page.nextCursor);
    } catch (error) {
      setNotice({ tone: "danger", message: martErrorMessage(error) });
    } finally {
      setAuditBusy(false);
    }
  };

  const submitCancellation = async (
    event: FormEvent<HTMLFormElement>,
    sale: MartSale,
  ) => {
    event.preventDefault();
    if (reason.trim().length < 2) {
      setNotice({ tone: "warning", message: "판매를 취소하는 이유를 두 글자 이상 적어 주세요." });
      return;
    }
    const signature = JSON.stringify([sale.id, sale.revision, reason.trim()]);
    if (!cancelAttempt.current || cancelAttempt.current.signature !== signature) {
      cancelAttempt.current = { signature, key: martActionKey("sale-cancel") };
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await cancelMartSale({
        classId: context.classroom.id,
        saleId: sale.id,
        reason: reason.trim(),
        expectedRevision: sale.revision,
        idempotencyKey: cancelAttempt.current.key,
      });
      setCancelId(null);
      setReason("");
      cancelAttempt.current = null;
      setNotice({
        tone: result.deduplicated ? "warning" : "success",
        message: result.deduplicated
          ? "같은 취소 요청이 이미 반영되어 한 번만 처리했습니다."
          : "판매를 취소하고 사유와 재고 복구 기록을 남겼습니다.",
      });
      setHistory((current) => current.map((row) => (
        row.id === result.sale.id ? result.sale : row
      )));
      await onChanged();
    } catch (error) {
      const code = error instanceof MartApiError ? error.code : "";
      setNotice({ tone: code.includes("STALE") || code.includes("DUPLICATE") ? "warning" : "danger", message: martErrorMessage(error) });
      if (code.includes("STALE") || code.includes("DUPLICATE")) await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="mart-records-title">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>{context.role === "student" ? "나만 볼 수 있어요" : "판매 장부"}</p>
          <h2 id="mart-records-title">{context.role === "student" ? "내 구매 기록" : "판매·취소 기록"}</h2>
          <p>{context.role === "student" ? "다른 친구의 기록은 보이지 않고 내 구매 내역만 보여요." : "완료와 취소 기록을 지우지 않고 시간순으로 확인해요."}</p>
        </div>
        <div className={styles.headingActions}>
          {context.role === "teacher" && (
            <a className={styles.button} href={csvHref} download>
              <Download aria-hidden="true" /> 전체 기록 CSV
            </a>
          )}
          <span className={styles.stepBadge}>{sales.length.toLocaleString("ko-KR")}건 불러옴</span>
        </div>
      </div>

      {notice && (
        <div className={`${styles.notice} ${styles[notice.tone]}`} role={notice.tone === "danger" ? "alert" : "status"}>
          {notice.tone === "success" ? <CheckCircle2 aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
          <p>{notice.message}</p>
        </div>
      )}

      <div className={styles.recordToolbar}>
        <div className={styles.segmentedButtons} aria-label="판매 기록 상태 필터">
          {(["all", "completed", "cancelled"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={status === item ? styles.selectedSegment : undefined}
              onClick={() => void replaceHistory(item, appliedDates.from, appliedDates.to)}
              disabled={historyBusy}
            >
              {item === "all" ? "전체" : item === "completed" ? "판매 완료" : "취소"}
            </button>
          ))}
        </div>
        <form
          className={styles.historyFilters}
          onSubmit={(event) => {
            event.preventDefault();
            void replaceHistory(status, fromDate, toDate);
          }}
        >
          <label>시작일<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} disabled={historyBusy} /></label>
          <label>종료일<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} disabled={historyBusy} /></label>
          <button className={styles.button} type="submit" disabled={historyBusy}>{historyBusy ? "조회 중" : "기간 조회"}</button>
          {(appliedDates.from || appliedDates.to) && (
            <button
              className={styles.button}
              type="button"
              onClick={() => {
                setFromDate("");
                setToDate("");
                void replaceHistory(status, "", "");
              }}
              disabled={historyBusy}
            >
              기간 지우기
            </button>
          )}
        </form>
      </div>

      {sales.length === 0 ? (
        <div className={`${styles.card} ${styles.emptyState}`}>
          <ClipboardList aria-hidden="true" />
          <b>{status === "all" ? "아직 기록이 없습니다." : "이 상태의 기록이 없습니다."}</b>
          <p>{context.role === "student" ? "첫 구매 뒤 이곳에서 확인할 수 있어요." : "판매를 확정하면 영수증 기록이 여기에 쌓여요."}</p>
        </div>
      ) : (
        <div className={styles.recordList}>
          {sales.map((sale) => (
            <article className={styles.recordCard} key={sale.id}>
              <header>
                <div>
                  <span className={sale.status === "completed" ? styles.completeBadge : styles.cancelBadge}>
                    {sale.status === "completed" ? "판매 완료" : "판매 취소"}
                  </span>
                  {sale.intervention?.kind === "teacher_emergency_correction" && (
                    <span className={styles.emergencyBadge}><ShieldAlert aria-hidden="true" /> 교사 비상 정정</span>
                  )}
                  <h3>{sale.receiptNumber || "판매 기록"}</h3>
                  <p>{dateTimeText(sale.soldAt)} · {context.role === "student" ? `판매 ${sale.seller.name}` : `${sale.buyer.number}번 ${sale.buyer.name}`}</p>
                </div>
                <strong>{amountText(sale.totalAmount, context.currency.unit)}</strong>
              </header>
              <ul className={styles.saleItems}>
                {sale.items.map((item, index) => (
                  <li key={`${sale.id}-${item.productId}-${index}`}>
                    <span>{item.productName} × {item.quantity}</span>
                    <b>{amountText(item.lineTotal, context.currency.unit)}</b>
                  </li>
                ))}
              </ul>
              <footer>
                {sale.cancellation && (
                  <div className={styles.reasonBox}><RotateCcw aria-hidden="true" /><p><b>취소 사유</b><br />{sale.cancellation.reason} · {sale.cancellation.actorName}</p></div>
                )}
                {sale.intervention && (
                  <div className={styles.reasonBox}><ShieldAlert aria-hidden="true" /><p><b>정정 기록</b><br />{sale.intervention.reason} · {sale.intervention.actorName}</p></div>
                )}
                {canCancel && sale.status === "completed" && cancelId !== sale.id && (
                  <button className={`${styles.button} ${styles.dangerButton}`} type="button" onClick={() => { setCancelId(sale.id); setReason(""); cancelAttempt.current = null; }} disabled={busy || context.classroom.status !== "active"}><RotateCcw aria-hidden="true" /> 판매 취소</button>
                )}
                {canCancel && sale.status === "completed" && cancelId === sale.id && (
                  <form className={styles.cancelForm} onSubmit={(event) => void submitCancellation(event, sale)}>
                    <label>취소 사유<textarea rows={2} maxLength={160} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="예: 상품을 잘못 선택함" disabled={busy} required /></label>
                    <div className={styles.buttonRow}>
                      <button className={`${styles.button} ${styles.dangerButton}`} type="submit" disabled={busy}>{busy ? "취소 기록 중" : "사유와 함께 취소 확정"}</button>
                      <button className={styles.button} type="button" onClick={() => { setCancelId(null); setReason(""); cancelAttempt.current = null; }} disabled={busy}>닫기</button>
                    </div>
                  </form>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}

      {nextCursor && sales.length > 0 && (
        <div className={styles.loadMoreRow}>
          <button className={styles.button} type="button" onClick={() => void loadMore()} disabled={historyBusy}>
            {historyBusy ? "기록을 불러오는 중" : "이전 판매 기록 더 보기"}
          </button>
          <p>현재 목록 뒤의 기록을 이어서 불러옵니다.</p>
        </div>
      )}

      {context.role !== "student" && (
        <section className={`${styles.card} ${styles.auditSection}`} aria-labelledby="mart-audit-title">
          <div className={styles.formHeading}>
            <div><ClipboardList aria-hidden="true" /><div><h3 id="mart-audit-title">최근 운영 변경 기록</h3><p>상품·입고·출고·정정·판매·취소를 처리자와 사유까지 확인해요.</p></div></div>
          </div>
          {auditEvents.length === 0 ? (
            <div className={styles.emptyState}><ClipboardList aria-hidden="true" /><b>아직 운영 변경 기록이 없습니다.</b></div>
          ) : (
            <ol className={styles.auditList}>
              {auditEvents.map((event) => {
                const productId = event.productName ? null : event.movementProductId;
                const productName = event.productName
                  || dashboard.products.find((product) => product.id === productId)?.name
                  || event.buyerName
                  || "마트 기록";
                const emergency = event.operation === "inventory_correction" && event.actor.type === "teacher";
                return (
                  <li key={event.id}>
                    <div className={styles.auditIcon} aria-hidden="true">
                      {emergency ? <ShieldAlert /> : <ClipboardList />}
                    </div>
                    <div>
                      <div className={styles.auditTitleRow}>
                        <b>{AUDIT_LABELS[event.operation] || event.operation}</b>
                        {emergency && <span className={styles.emergencyBadge}>교사 비상 정정</span>}
                      </div>
                      <span>{productName}{event.inventoryDelta ? ` · 재고 ${event.inventoryDelta > 0 ? "+" : ""}${event.inventoryDelta}개` : ""}{event.saleTotal !== null ? ` · ${amountText(event.saleTotal, context.currency.unit)}` : ""}</span>
                      {event.interventionReason && <p>사유: {event.interventionReason}</p>}
                    </div>
                    <div className={styles.auditMeta}><b>{event.actor.label}</b><time dateTime={new Date(event.createdAt).toISOString()}>{dateTimeText(event.createdAt)}</time></div>
                  </li>
                );
              })}
            </ol>
          )}
          {auditNextCursor && auditEvents.length > 0 && (
            <div className={styles.loadMoreRow}>
              <button className={styles.button} type="button" onClick={() => void loadMoreAudit()} disabled={auditBusy}>
                {auditBusy ? "변경 기록을 불러오는 중" : "이전 변경 기록 더 보기"}
              </button>
              <p>같은 시각의 기록도 빠뜨리지 않고 이어서 불러옵니다.</p>
            </div>
          )}
        </section>
      )}
    </section>
  );
}

export function MartStatisticsPanel({ dashboard }: { dashboard: MartDashboard }) {
  const { context, statistics, products, inventory } = dashboard;
  const inventoryByProduct = useMemo(
    () => new Map(inventory.map((row) => [row.productId, row])),
    [inventory],
  );
  const lowStock = products.filter((product) => (
    product.isActive
    && (inventoryByProduct.get(product.id)?.onHand ?? 0) <= product.lowStockThreshold
  ));

  if (!statistics) {
    return (
      <section aria-labelledby="mart-statistics-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>오늘의 운영</p><h2 id="mart-statistics-title">매출과 상품 통계</h2></div></div>
        <div className={`${styles.card} ${styles.emptyState}`}><BarChart3 aria-hidden="true" /><b>통계를 불러오지 못했습니다.</b><p>새로고침해 다시 확인해 주세요.</p></div>
      </section>
    );
  }

  return (
    <section aria-labelledby="mart-statistics-title">
      <div className={styles.sectionHeading}>
        <div><p className={styles.eyebrow}>오늘의 운영</p><h2 id="mart-statistics-title">매출과 상품 통계</h2><p>{statistics.date} 현물화폐 판매를 기준으로 계산합니다.</p></div>
        <div className={styles.headingActions}>
          {context.role === "teacher" && (
            <a className={styles.button} href={martSalesCsvUrl(context.classroom.id)} download>
              <Download aria-hidden="true" /> 전체 판매 CSV
            </a>
          )}
          <span className={styles.stepBadge}>낮은 재고 {lowStock.length}개</span>
        </div>
      </div>

      <div className={styles.statGrid}>
        <article><ReceiptText aria-hidden="true" /><span>오늘 매출</span><strong>{amountText(statistics.salesAmount, context.currency.unit)}</strong></article>
        <article><ShoppingBag aria-hidden="true" /><span>판매 완료</span><strong>{statistics.completedSaleCount.toLocaleString("ko-KR")}건</strong></article>
        <article><TrendingUp aria-hidden="true" /><span>판매 상품</span><strong>{statistics.itemsSold.toLocaleString("ko-KR")}개</strong></article>
        <article><RotateCcw aria-hidden="true" /><span>취소 기록</span><strong>{statistics.cancelledSaleCount.toLocaleString("ko-KR")}건</strong></article>
      </div>

      <div className={styles.managementLayout}>
        <section className={styles.card} aria-labelledby="mart-product-stats-title">
          <div className={styles.formHeading}><div><BarChart3 aria-hidden="true" /><div><h3 id="mart-product-stats-title">상품별 판매</h3><p>많이 팔린 상품부터 보여요.</p></div></div></div>
          {statistics.products.length === 0 ? (
            <div className={styles.emptyState}><PackageSearch aria-hidden="true" /><b>오늘 판매된 상품이 없습니다.</b></div>
          ) : (
            <ol className={styles.rankingList}>
              {statistics.products.map((product, index) => (
                <li key={product.productId}><span className={styles.numberBadge}>{index + 1}</span><div><b>{product.productName}</b><span>{product.quantity.toLocaleString("ko-KR")}개 판매</span></div><strong>{amountText(product.salesAmount, context.currency.unit)}</strong></li>
              ))}
            </ol>
          )}
        </section>

        <section className={styles.card} aria-labelledby="mart-low-stock-title">
          <div className={styles.formHeading}><div><CircleAlert aria-hidden="true" /><div><h3 id="mart-low-stock-title">낮은 재고</h3><p>다음 입고가 필요한 상품이에요.</p></div></div></div>
          {lowStock.length === 0 ? (
            <div className={styles.emptyState}><CheckCircle2 aria-hidden="true" /><b>모든 상품 재고가 충분합니다.</b></div>
          ) : (
            <ul className={styles.stockList}>
              {lowStock.map((product) => <li key={product.id}><div><b>{product.name}</b><span>알림 기준 {product.lowStockThreshold}개</span></div><strong className={styles.lowText}>{inventoryByProduct.get(product.id)?.onHand ?? 0}개 · 낮음</strong></li>)}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
