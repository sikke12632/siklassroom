"use client";

import {
  BadgeCheck,
  Banknote,
  CalendarCheck,
  CircleAlert,
  LoaderCircle,
  RefreshCw,
  Save,
  UsersRound,
} from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, ClientApiError, postJson, putJson } from "@/lib/client-api";

type SalarySettings = {
  gradeAAmount: number;
  gradeBAmount: number;
  gradeCAmount: number;
  revision: number;
  updatedAt: number;
};

type PayrollItem = {
  id: string;
  studentId: string;
  studentNumber: number;
  studentName: string;
  classJobId: string;
  jobName: string;
  jobGrade: "A" | "B" | "C";
  amount: number;
  status: "pending" | "posted" | "reversed";
  transactionId: string | null;
  postedAt: number | null;
};

type Payroll = {
  id: string | null;
  closureId: string;
  sourcePeriodId: string;
  sourceYear: number;
  sourceMonth: number;
  closedAt: number;
  status: "ready" | "posting" | "partial" | "completed" | "adjusted";
  settingsRevision: number;
  recipientCount: number;
  postedCount: number;
  totalAmount: number;
  postedAt: number | null;
  items: PayrollItem[];
};

type PayrollResponse = {
  settings: SalarySettings;
  payrolls: Payroll[];
  serverTime: number;
};

type Notice = {
  tone: "success" | "error" | "info";
  message: string;
} | null;

export type FinancePayrollPanelProps = {
  classId: string;
  classIsActive?: boolean;
  currencyLabel?: string;
  denominations?: number[];
  refreshRevision?: number;
  onRefresh?: () => Promise<void>;
};

const styles: Record<string, CSSProperties> = {
  shell: {
    marginTop: 24,
    padding: 22,
    border: "1px solid var(--color-border)",
    borderTop: "4px solid var(--color-primary)",
    borderRadius: "var(--radius-xl)",
    background: "var(--color-surface)",
    boxShadow: "var(--shadow-sm)",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
    flexWrap: "wrap",
  },
  titleRow: { display: "flex", alignItems: "flex-start", gap: 12 },
  icon: {
    width: 42,
    height: 42,
    padding: 9,
    flex: "0 0 auto",
    borderRadius: "var(--radius-md)",
    color: "var(--color-primary)",
    background: "var(--color-primary-soft)",
  },
  title: { margin: "2px 0 3px", fontSize: "var(--text-xl)" },
  muted: { margin: 0, color: "var(--color-text-muted)", fontSize: "var(--text-sm)" },
  settings: {
    display: "grid",
    gap: 14,
    marginTop: 20,
    padding: 17,
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-lg)",
    background: "var(--color-surface-raised)",
  },
  fields: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 170px), 1fr))",
    gap: 12,
  },
  label: { display: "grid", gap: 6, fontWeight: 750, fontSize: "var(--text-sm)" },
  moneyInput: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    border: "1px solid var(--color-border-strong)",
    borderRadius: "var(--radius-md)",
    background: "var(--color-surface)",
  },
  input: { minWidth: 0, border: 0, boxShadow: "none" },
  suffix: { paddingRight: 12, color: "var(--color-text-muted)" },
  actions: { display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" },
  cards: { display: "grid", gap: 13, marginTop: 20 },
  card: {
    display: "grid",
    gap: 14,
    padding: 17,
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-lg)",
    background: "var(--color-surface-raised)",
  },
  cardHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 145px), 1fr))",
    gap: 8,
  },
  stat: {
    padding: 11,
    borderRadius: "var(--radius-md)",
    background: "var(--color-surface-subtle)",
  },
  tableWrap: { overflowX: "auto", borderRadius: "var(--radius-md)" },
  table: { width: "100%", minWidth: 560, borderCollapse: "collapse" },
  cell: { padding: "9px 10px", borderBottom: "1px solid var(--color-border)", textAlign: "left" },
  badge: {
    display: "inline-flex",
    padding: "4px 9px",
    borderRadius: "var(--radius-pill)",
    fontSize: "var(--text-xs)",
    fontWeight: 850,
  },
  empty: {
    display: "grid",
    justifyItems: "center",
    gap: 8,
    marginTop: 20,
    padding: 28,
    color: "var(--color-text-muted)",
    textAlign: "center",
    border: "1px dashed var(--color-border-strong)",
    borderRadius: "var(--radius-lg)",
  },
};

function actionKey(
  store: Map<string, { fingerprint: string; key: string }>,
  slot: string,
  fingerprint: string,
) {
  const current = store.get(slot);
  if (current?.fingerprint === fingerprint) return current.key;
  const key = `payroll:${slot}:${crypto.randomUUID()}`;
  store.set(slot, { fingerprint, key });
  return key;
}

function amountText(amount: number, unit: string) {
  return `${amount.toLocaleString("ko-KR")}${unit}`;
}

function dateTimeText(epoch: number | null) {
  if (!epoch) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(epoch));
}

function payrollStatusText(status: Payroll["status"]) {
  return ({
    ready: "지급 준비",
    posting: "지급 중",
    partial: "이어서 지급 필요",
    completed: "지급 완료",
    adjusted: "정정 기록 있음",
  } satisfies Record<Payroll["status"], string>)[status];
}

function itemStatusText(status: PayrollItem["status"]) {
  return status === "posted" ? "지급 완료" : status === "reversed" ? "정정됨" : "지급 전";
}

function errorMessage(reason: unknown) {
  if (reason instanceof ClientApiError) return reason.message;
  return "월급 정보를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export function FinancePayrollPanel({
  classId,
  classIsActive = true,
  currencyLabel = "원",
  denominations = [100],
  refreshRevision = 0,
  onRefresh,
}: FinancePayrollPanelProps) {
  const [data, setData] = useState<PayrollResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmClosureId, setConfirmClosureId] = useState<string | null>(null);
  const [reason, setReason] = useState("학급 직업 월급 기준 변경");
  const [draft, setDraft] = useState({ gradeA: "1300", gradeB: "1000", gradeC: "700" });
  const keys = useRef(new Map<string, { fingerprint: string; key: string }>());
  const requestSequence = useRef(0);

  const load = useCallback(async (quiet = false) => {
    const sequence = ++requestSequence.current;
    if (!quiet) setLoading(true);
    try {
      const next = await api<PayrollResponse>(
        `/api/finance/payrolls?classId=${encodeURIComponent(classId)}`,
      );
      if (sequence !== requestSequence.current) return;
      setData(next);
      setDraft({
        gradeA: String(next.settings.gradeAAmount),
        gradeB: String(next.settings.gradeBAmount),
        gradeC: String(next.settings.gradeCAmount),
      });
      setNotice(null);
    } catch (error) {
      if (sequence === requestSequence.current) {
        setNotice({ tone: "error", message: errorMessage(error) });
      }
    } finally {
      if (sequence === requestSequence.current && !quiet) setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void load(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [load, refreshRevision]);

  const amounts = useMemo(() => ({
    gradeAAmount: Number(draft.gradeA),
    gradeBAmount: Number(draft.gradeB),
    gradeCAmount: Number(draft.gradeC),
  }), [draft]);
  const step = Math.max(1, Math.min(...denominations.filter((value) => value > 0)) || 1);
  const validSettings = Object.values(amounts).every((amount) => (
    Number.isSafeInteger(amount) && amount > 0 && amount <= 1_000_000_000 && amount % step === 0
  ))
    && amounts.gradeAAmount >= amounts.gradeBAmount
    && amounts.gradeBAmount >= amounts.gradeCAmount;
  const settingsChanged = Boolean(data) && (
    amounts.gradeAAmount !== data?.settings.gradeAAmount
    || amounts.gradeBAmount !== data?.settings.gradeBAmount
    || amounts.gradeCAmount !== data?.settings.gradeCAmount
  );

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!data || !validSettings || reason.trim().length < 2 || busy) return;
    const fingerprint = JSON.stringify({ ...amounts, revision: data.settings.revision, reason: reason.trim() });
    const key = actionKey(keys.current, "settings", fingerprint);
    setBusy("settings");
    setNotice(null);
    try {
      await putJson(
        `/api/finance/payrolls/settings?classId=${encodeURIComponent(classId)}`,
        {
          ...amounts,
          expectedRevision: data.settings.revision,
          idempotencyKey: key,
          changeReason: reason.trim(),
        },
      );
      keys.current.delete("settings");
      setNotice({ tone: "success", message: "직업 등급별 기본급을 저장했습니다." });
      await load(true);
      await onRefresh?.();
    } catch (error) {
      setNotice({ tone: "error", message: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function pay(payroll: Payroll) {
    if (!data || busy || settingsChanged || !validSettings || !classIsActive) return;
    const slot = `pay:${payroll.closureId}`;
    const fingerprint = JSON.stringify({
      closureId: payroll.closureId,
      settingsRevision: data.settings.revision,
    });
    const key = actionKey(keys.current, slot, fingerprint);
    setBusy(slot);
    setNotice(null);
    try {
      await postJson(
        `/api/finance/payrolls?classId=${encodeURIComponent(classId)}`,
        {
          closureId: payroll.closureId,
          expectedSettingsRevision: data.settings.revision,
          idempotencyKey: key,
        },
      );
      keys.current.delete(slot);
      setConfirmClosureId(null);
      setNotice({
        tone: "success",
        message: `${payroll.sourceYear}년 ${payroll.sourceMonth}월 직업 월급을 모두 지급했습니다.`,
      });
      await load(true);
      await onRefresh?.();
    } catch (error) {
      setNotice({ tone: "error", message: errorMessage(error) });
      await load(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id="finance-payroll" style={styles.shell} aria-labelledby="finance-payroll-title">
      <header style={styles.header}>
        <div style={styles.titleRow}>
          <Banknote style={styles.icon} aria-hidden="true" />
          <div>
            <p className="eyebrow">직업센터 · 금융센터 자동 연결</p>
            <h3 id="finance-payroll-title" style={styles.title}>직업 월급</h3>
            <p style={styles.muted}>월 마감 등급을 읽어 학생별 금액을 계산하고 한 번에 지급합니다.</p>
          </div>
        </div>
        <button
          className="button button-light"
          type="button"
          onClick={() => void load(true)}
          disabled={Boolean(busy) || loading}
        >
          <RefreshCw className={loading ? "spin" : undefined} aria-hidden="true" />새로고침
        </button>
      </header>

      {notice && (
        <div className={`finance-action-notice ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.tone === "success" ? <BadgeCheck aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
          <p>{notice.message}</p>
        </div>
      )}

      {loading && !data ? (
        <div style={styles.empty} aria-busy="true">
          <LoaderCircle className="spin" aria-hidden="true" />
          <b>월 마감 기록과 월급 설정을 확인하고 있어요.</b>
        </div>
      ) : data ? (
        <>
          <form style={styles.settings} onSubmit={saveSettings}>
            <div>
              <b>직업 등급별 기본급</b>
              <p style={styles.muted}>월급을 지급한 뒤 설정을 바꿔도 지난 지급액은 그대로 보존됩니다.</p>
            </div>
            <div style={styles.fields}>
              {([
                ["A등급", "gradeA"],
                ["B등급", "gradeB"],
                ["C등급", "gradeC"],
              ] as const).map(([label, key]) => (
                <label key={key} style={styles.label}>
                  {label} 기본급
                  <span style={styles.moneyInput}>
                    <input
                      style={styles.input}
                      type="number"
                      inputMode="numeric"
                      min={step}
                      max={1_000_000_000}
                      step={step}
                      value={draft[key]}
                      onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                      disabled={Boolean(busy) || !classIsActive}
                    />
                    <span style={styles.suffix}>{currencyLabel}</span>
                  </span>
                </label>
              ))}
            </div>
            <label style={styles.label}>
              변경 이유
              <input
                value={reason}
                maxLength={300}
                onChange={(event) => setReason(event.target.value)}
                disabled={Boolean(busy) || !classIsActive}
              />
            </label>
            <div style={styles.actions}>
              <button
                className="button button-primary"
                type="submit"
                disabled={!settingsChanged || !validSettings || reason.trim().length < 2 || Boolean(busy) || !classIsActive}
              >
                {busy === "settings" ? <LoaderCircle className="spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
                기본급 저장
              </button>
              {!validSettings && <small style={styles.muted}>금액은 {step.toLocaleString("ko-KR")}{currencyLabel} 단위의 양수로 입력해 주세요.</small>}
              {settingsChanged && validSettings && <small style={styles.muted}>저장한 뒤 월급을 지급할 수 있습니다.</small>}
            </div>
          </form>

          {data.payrolls.length === 0 ? (
            <div style={styles.empty}>
              <CalendarCheck aria-hidden="true" />
              <b>아직 월급을 계산할 월 마감 기록이 없습니다.</b>
              <p style={styles.muted}>직업 평가와 월 마감을 마치면 이곳에 자동으로 나타납니다.</p>
            </div>
          ) : (
            <div style={styles.cards}>
              {data.payrolls.map((payroll) => {
                const slot = `pay:${payroll.closureId}`;
                const paying = busy === slot;
                const payable = payroll.status === "ready" || payroll.status === "partial";
                const confirmed = confirmClosureId === payroll.closureId;
                return (
                  <article key={payroll.closureId} style={styles.card}>
                    <div style={styles.cardHeader}>
                      <div>
                        <p className="eyebrow">{payroll.sourceYear}년 {payroll.sourceMonth}월 마감</p>
                        <h4 style={{ margin: "2px 0" }}>{payroll.sourceMonth}월 직업 월급</h4>
                        <small style={styles.muted}>마감 {dateTimeText(payroll.closedAt)}</small>
                      </div>
                      <span
                        style={{
                          ...styles.badge,
                          color: payroll.status === "completed" ? "var(--color-success)" : "var(--color-primary)",
                          background: payroll.status === "completed" ? "var(--color-success-soft)" : "var(--color-primary-soft)",
                        }}
                      >
                        {payrollStatusText(payroll.status)}
                      </span>
                    </div>

                    <div style={styles.stats}>
                      <div style={styles.stat}><small style={styles.muted}>지급 대상</small><strong>{payroll.recipientCount}명</strong></div>
                      <div style={styles.stat}><small style={styles.muted}>지급 완료</small><strong>{payroll.postedCount}명</strong></div>
                      <div style={styles.stat}><small style={styles.muted}>총 월급</small><strong>{amountText(payroll.totalAmount, currencyLabel)}</strong></div>
                      <div style={styles.stat}><small style={styles.muted}>지급 시각</small><strong>{dateTimeText(payroll.postedAt)}</strong></div>
                    </div>

                    <details>
                      <summary>학생별 월급 {payroll.items.length}명 보기</summary>
                      <div style={styles.tableWrap}>
                        <table style={styles.table}>
                          <thead>
                            <tr>
                              <th style={styles.cell}>학생</th>
                              <th style={styles.cell}>직업</th>
                              <th style={styles.cell}>등급</th>
                              <th style={styles.cell}>월급</th>
                              <th style={styles.cell}>상태</th>
                            </tr>
                          </thead>
                          <tbody>
                            {payroll.items.map((item) => (
                              <tr key={item.id}>
                                <td style={styles.cell}>{item.studentNumber}번 {item.studentName}</td>
                                <td style={styles.cell}>{item.jobName}</td>
                                <td style={styles.cell}>{item.jobGrade}</td>
                                <td style={styles.cell}>{amountText(item.amount, currencyLabel)}</td>
                                <td style={styles.cell}>{itemStatusText(item.status)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>

                    {payable && (
                      confirmed ? (
                        <div className="finance-decision-confirm approve">
                          <div>
                            <b>{payroll.recipientCount}명에게 총 {amountText(payroll.totalAmount, currencyLabel)}을 지급할까요?</b>
                            <p>학생별 금융 원장에 즉시 기록되며, 중복 클릭해도 같은 월급은 한 번만 지급됩니다.</p>
                          </div>
                          <div className="finance-confirm-actions">
                            <button className="button button-light" type="button" onClick={() => setConfirmClosureId(null)} disabled={paying}>다시 확인</button>
                            <button className="button button-primary" type="button" onClick={() => void pay(payroll)} disabled={paying || settingsChanged || !validSettings || !classIsActive}>
                              {paying ? <LoaderCircle className="spin" aria-hidden="true" /> : <UsersRound aria-hidden="true" />}
                              전체 월급 지급
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className="button button-primary button-large"
                          type="button"
                          onClick={() => setConfirmClosureId(payroll.closureId)}
                          disabled={Boolean(busy) || settingsChanged || !validSettings || !classIsActive}
                        >
                          <Banknote aria-hidden="true" />
                          {payroll.status === "partial" ? "남은 월급 이어서 지급" : "금액 확인하고 전체 지급"}
                        </button>
                      )
                    )}
                  </article>
                );
              })}
            </div>
          )}

          {!classIsActive && (
            <div className="finance-action-notice info">
              <CircleAlert aria-hidden="true" />
              <p>보관된 학급에서는 월급 기록만 볼 수 있고 새 지급이나 설정 변경은 할 수 없습니다.</p>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
