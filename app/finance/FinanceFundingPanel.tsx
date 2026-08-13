"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  Flag,
  HandCoins,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import {
  financeFundingDeadlineAtEndOfSeoulDay,
  financeFundingDeadlineInputRange,
} from "@/lib/finance-funding-rules";

type FinanceFundingStatus =
  | "active"
  | "paused"
  | "funded"
  | "refunding"
  | "succeeded"
  | "failed"
  | "cancelled";

type FundingCampaign = {
  id: string;
  title: string;
  description: string;
  targetAmount: number;
  pledgedAmount: number;
  refundedAmount: number;
  remainingAmount: number;
  progress: number;
  status: FinanceFundingStatus;
  terminalReason: string | null;
  deadlineAt: number;
  revision: number;
  creator: { id: string; number: number; name: string };
  participantCount: number;
  contributionCount: number;
  myContributionAmount: number;
  isCreator: boolean;
  canContribute: boolean;
  canEdit: boolean;
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
  canEmergencyCancel: boolean;
  processing: boolean;
};

type FundingPayload = {
  context: {
    actorType: "teacher" | "student";
    actorId: string;
    financeRole: "teacher" | "banker" | "student";
    classId: string;
    classIsActive: boolean;
  };
  currencyUnit: string;
  denominationStep: number;
  canCreate: boolean;
  campaigns: FundingCampaign[];
};

type Notice = { tone: "success" | "warning" | "danger"; message: string };
type ActionAttempt = { fingerprint: string; key: string };

const STATUS_LABELS: Record<FinanceFundingStatus, string> = {
  active: "모금 중",
  paused: "잠시 멈춤",
  funded: "지급 준비 중",
  refunding: "환불 중",
  succeeded: "목표 달성",
  failed: "마감·환불 완료",
  cancelled: "취소·환불 완료",
};

function actionKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

export function stableActionKey(
  attempts: Record<string, ActionAttempt>,
  slot: string,
  prefix: string,
  payload: unknown,
) {
  const fingerprint = JSON.stringify(payload);
  if (attempts[slot]?.fingerprint !== fingerprint) {
    attempts[slot] = { fingerprint, key: actionKey(prefix) };
  }
  return attempts[slot].key;
}

function requestCode(error: unknown) {
  return (error as { code?: string } | null)?.code;
}

function amountText(amount: number, unit: string) {
  return `${amount.toLocaleString("ko-KR")} ${unit}`;
}

function seoulDateInput(epochMs: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epochMs));
}

function deadlineText(epochMs: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(epochMs));
}

async function responseJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & {
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    const error = new Error(data.error || "펀딩 요청을 처리하지 못했습니다.");
    Object.assign(error, { code: data.code || "REQUEST_FAILED" });
    throw error;
  }
  return data;
}

export function FinanceFundingPanel({
  classId,
  classIsActive,
  refreshRevision,
  onRefresh,
}: {
  classId: string;
  financeRole: "teacher" | "banker" | "student";
  actorType: "teacher" | "student";
  classIsActive: boolean;
  currencyUnit: string;
  refreshRevision: number;
  onRefresh: () => Promise<void>;
}) {
  const [initialNow] = useState(() => Date.now());
  const [deadlineRange] = useState(() => (
    financeFundingDeadlineInputRange(initialNow)
  ));
  const [data, setData] = useState<FundingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [deadline, setDeadline] = useState(deadlineRange.defaultDate);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [emergencyReasons, setEmergencyReasons] = useState<Record<string, string>>({});
  const attempts = useRef<Record<string, ActionAttempt>>({});
  const requestSequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  const query = `?classId=${encodeURIComponent(classId)}`;
  const load = useCallback(async (quiet = false) => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/finance/funding${query}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const nextData = await responseJson<FundingPayload>(response);
      if (requestId !== requestSequence.current) return;
      setData(nextData);
      if (!quiet) setNotice(null);
    } catch (error) {
      if (
        controller.signal.aborted
        || requestId !== requestSequence.current
        || (error as { name?: string })?.name === "AbortError"
      ) return;
      setNotice({
        tone: "danger",
        message: error instanceof Error ? error.message : "펀딩 목록을 불러오지 못했습니다.",
      });
    } finally {
      if (requestId === requestSequence.current) {
        if (activeRequest.current === controller) activeRequest.current = null;
        setLoading(false);
      }
    }
  }, [query]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load(false));
    return () => {
      cancelAnimationFrame(frame);
      requestSequence.current += 1;
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [load, refreshRevision]);

  const refreshAll = async () => {
    await Promise.all([load(true), onRefresh()]);
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setTargetAmount("");
    setDeadline(deadlineRange.defaultDate);
    setEditingId(null);
  };

  const editingCampaign = editingId
    ? data?.campaigns.find((campaign) => campaign.id === editingId) ?? null
    : null;
  const editingDeadlineDate = editingCampaign
    ? seoulDateInput(editingCampaign.deadlineAt)
    : null;
  const formDeadlineMin = editingDeadlineDate && editingDeadlineDate < deadlineRange.minDate
    ? editingDeadlineDate
    : deadlineRange.minDate;
  const formDeadlineMax = editingDeadlineDate && editingDeadlineDate > deadlineRange.maxDate
    ? editingDeadlineDate
    : deadlineRange.maxDate;

  const submitCampaign = async (event: FormEvent) => {
    event.preventDefault();
    if (!data || busy) return;
    const keyId = editingId ? `edit:${editingId}` : "create";
    const campaign = editingCampaign;
    const deadlineAt = campaign && editingDeadlineDate === deadline
      ? campaign.deadlineAt
      : financeFundingDeadlineAtEndOfSeoulDay(deadline);
    const payload = {
      ...(editingId ? { action: "edit", expectedRevision: campaign?.revision } : {}),
      title,
      description,
      targetAmount: Number(targetAmount),
      deadlineAt,
    };
    const idempotencyKey = stableActionKey(
      attempts.current,
      keyId,
      `funding-${editingId ? "edit" : "create"}`,
      payload,
    );
    setBusy(keyId);
    setNotice(null);
    try {
      const response = await fetch(
        editingId
          ? `/api/finance/funding/campaigns/${encodeURIComponent(editingId)}${query}`
          : `/api/finance/funding${query}`,
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            idempotencyKey,
          }),
        },
      );
      await responseJson(response);
      delete attempts.current[keyId];
      resetForm();
      setNotice({ tone: "success", message: editingId ? "펀딩 내용을 고쳤습니다." : "새 펀딩을 시작했습니다." });
      await refreshAll();
    } catch (error) {
      if (requestCode(error) === "FINANCE_FUNDING_IDEMPOTENCY_CONFLICT") {
        delete attempts.current[keyId];
        await refreshAll().catch(() => undefined);
        setNotice({ tone: "warning", message: "최신 펀딩 상태를 다시 불러왔어요. 입력한 내용은 그대로 두었으니 확인한 뒤 다시 저장해 주세요." });
      } else {
        setNotice({ tone: "danger", message: error instanceof Error ? error.message : "펀딩을 저장하지 못했습니다." });
      }
    } finally {
      setBusy(null);
    }
  };

  const campaignAction = async (
    campaign: FundingCampaign,
    action: "pause" | "resume" | "cancel",
    reason?: string,
  ) => {
    if (busy) return;
    if (action === "cancel" && !window.confirm("이 펀딩을 취소하고 참여 금액을 모두 환불할까요?")) return;
    const keyId = `${action}:${campaign.id}`;
    const payload = {
      action,
      expectedRevision: campaign.revision,
      interventionReason: reason,
    };
    const idempotencyKey = stableActionKey(attempts.current, keyId, `funding-${action}`, payload);
    setBusy(keyId);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/finance/funding/campaigns/${encodeURIComponent(campaign.id)}${query}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            idempotencyKey,
          }),
        },
      );
      await responseJson(response);
      delete attempts.current[keyId];
      setNotice({
        tone: "success",
        message: action === "pause" ? "펀딩을 잠시 멈췄습니다."
          : action === "resume" ? "펀딩을 다시 시작했습니다."
            : "취소를 접수했습니다. 참여금은 자동 환불됩니다.",
      });
      await refreshAll();
    } catch (error) {
      if (requestCode(error) === "FINANCE_FUNDING_IDEMPOTENCY_CONFLICT") {
        delete attempts.current[keyId];
        await refreshAll().catch(() => undefined);
        setNotice({ tone: "warning", message: "펀딩 상태가 달라져 최신 내용을 불러왔어요. 확인한 뒤 다시 시도해 주세요." });
      } else {
        setNotice({ tone: "danger", message: error instanceof Error ? error.message : "펀딩 상태를 바꾸지 못했습니다." });
      }
    } finally {
      setBusy(null);
    }
  };

  const contribute = async (campaign: FundingCampaign) => {
    if (busy) return;
    const keyId = `contribute:${campaign.id}`;
    const payload = {
      amount: Number(amounts[campaign.id]),
      expectedCampaignRevision: campaign.revision,
    };
    const idempotencyKey = stableActionKey(attempts.current, keyId, "funding-contribute", payload);
    setBusy(keyId);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/finance/funding/campaigns/${encodeURIComponent(campaign.id)}/contributions${query}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            idempotencyKey,
          }),
        },
      );
      const result = await responseJson<{ settlementPending?: boolean }>(response);
      delete attempts.current[keyId];
      setAmounts((current) => ({ ...current, [campaign.id]: "" }));
      setNotice({
        tone: result.settlementPending ? "warning" : "success",
        message: result.settlementPending
          ? "목표를 달성했습니다! 지급 처리를 마무리하고 있습니다."
          : "펀딩 참여가 반영되었습니다.",
      });
      await refreshAll();
    } catch (error) {
      if (requestCode(error) === "FINANCE_FUNDING_IDEMPOTENCY_CONFLICT") {
        delete attempts.current[keyId];
        await refreshAll().catch(() => undefined);
        setNotice({ tone: "warning", message: "모금 현황이 바뀌어 최신 상태를 불러왔어요. 참여 금액은 그대로 두었으니 확인한 뒤 다시 눌러 주세요." });
      } else {
        setNotice({ tone: "danger", message: error instanceof Error ? error.message : "펀딩 참여를 반영하지 못했습니다." });
      }
    } finally {
      setBusy(null);
    }
  };

  const editCampaign = (campaign: FundingCampaign) => {
    setEditingId(campaign.id);
    setTitle(campaign.title);
    setDescription(campaign.description);
    setTargetAmount(String(campaign.targetAmount));
    setDeadline(seoulDateInput(campaign.deadlineAt));
    document.getElementById("finance-funding-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <section id="finance-funding" className="finance-operations-card" aria-labelledby="finance-funding-title">
      <div className="finance-operation-heading">
        <div>
          <p className="eyebrow">함께 만드는 우리 반 프로젝트</p>
          <h2 id="finance-funding-title">펀딩</h2>
          <p>학생이 아이디어를 열고 친구들이 참여해 목표를 채워요. 실패하거나 취소되면 전액 자동 환불됩니다.</p>
        </div>
        <button className="button button-light" type="button" disabled={Boolean(busy)} onClick={() => void load(false)}>
          <RefreshCw aria-hidden="true" /> 새로고침
        </button>
      </div>

      {notice && (
        <div className={`finance-action-notice ${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"}>
          {notice.tone === "danger" ? <CircleAlert aria-hidden="true" /> : <HandCoins aria-hidden="true" />}
          <span>{notice.message}</span>
        </div>
      )}

      {loading ? (
        <div className="finance-empty-state" aria-busy="true"><RefreshCw aria-hidden="true" /><p>펀딩을 확인하고 있어요.</p></div>
      ) : !data ? (
        <div className="finance-empty-state"><CircleAlert aria-hidden="true" /><p>펀딩을 불러오지 못했습니다.</p></div>
      ) : (
        <>
          {data.context.actorType === "student" && (data.canCreate || editingId) && classIsActive && (
            <form id="finance-funding-form" className="finance-request-form" onSubmit={submitCampaign}>
              <div className="finance-operation-heading">
                <div>
                  <p className="eyebrow">{editingId ? "내 펀딩 고치기" : "내 아이디어 시작하기"}</p>
                  <h3>{editingId ? "참여가 시작되기 전까지 내용을 고칠 수 있어요" : "새 펀딩 만들기"}</h3>
                </div>
                <Plus aria-hidden="true" />
              </div>
              <div className="finance-settings-field-grid">
                <label>
                  <span>제목</span>
                  <input value={title} maxLength={50} required onChange={(event) => setTitle(event.target.value)} />
                </label>
                <label>
                  <span>목표 금액</span>
                  <input type="number" min={data.denominationStep} step={data.denominationStep} value={targetAmount} required onChange={(event) => setTargetAmount(event.target.value)} />
                </label>
                <label>
                  <span>마감일</span>
                  <input type="date" value={deadline} min={formDeadlineMin} max={formDeadlineMax} required onChange={(event) => setDeadline(event.target.value)} />
                </label>
              </div>
              <label>
                <span>어디에 쓸 펀딩인지 설명해 주세요</span>
                <textarea value={description} maxLength={300} rows={3} onChange={(event) => setDescription(event.target.value)} />
              </label>
              <div className="finance-settings-save-row">
                <button className="button button-primary" disabled={Boolean(busy)}>
                  <Flag aria-hidden="true" /> {editingId ? "수정 저장" : "펀딩 시작"}
                </button>
                {editingId && <button className="button button-light" type="button" onClick={resetForm}>수정 취소</button>}
                <small>한 학생은 진행 중인 펀딩을 한 개만 운영할 수 있어요.</small>
              </div>
            </form>
          )}

          {data.context.actorType === "student" && !data.canCreate && !editingId && (
            <div className="finance-action-notice warning">
              <Flag aria-hidden="true" />
              <span>진행 중인 내 펀딩을 마무리하면 새 아이디어를 시작할 수 있어요.</span>
            </div>
          )}

          {data.campaigns.length === 0 ? (
            <div className="finance-empty-state"><HandCoins aria-hidden="true" /><p>아직 열린 펀딩이 없습니다. 첫 아이디어를 시작해 보세요.</p></div>
          ) : (
            <div className="finance-settings-section">
              {data.campaigns.map((campaign) => (
                <article key={campaign.id} className="finance-balance-card">
                  <div className="finance-operation-heading">
                    <div>
                      <p className="eyebrow">{campaign.creator.number}번 {campaign.creator.name}의 아이디어</p>
                      <h3>{campaign.title}</h3>
                    </div>
                    <span className={`finance-role-badge role-${campaign.status}`}>{STATUS_LABELS[campaign.status]}</span>
                  </div>
                  {campaign.description && <p>{campaign.description}</p>}
                  <progress max={100} value={campaign.progress} aria-label={`${campaign.title} 달성률 ${campaign.progress}%`} style={{ width: "100%", minHeight: 18 }} />
                  <div className="finance-balance-grid">
                    <div><small>모인 금액</small><strong>{amountText(campaign.pledgedAmount, data.currencyUnit)}</strong></div>
                    <div><small>목표</small><strong>{amountText(campaign.targetAmount, data.currencyUnit)}</strong></div>
                    <div><small>참여</small><strong>{campaign.participantCount}명 · {campaign.contributionCount}회</strong></div>
                    <div><small>마감</small><strong>{deadlineText(campaign.deadlineAt)}</strong></div>
                  </div>
                  {data.context.actorType === "student" && campaign.myContributionAmount > 0 && (
                    <div className="finance-action-notice success"><HandCoins aria-hidden="true" /><span>내가 참여한 금액: {amountText(campaign.myContributionAmount, data.currencyUnit)}</span></div>
                  )}
                  {campaign.processing && (
                    <div className="finance-action-notice warning" role="status">
                      <RotateCcw aria-hidden="true" />
                      <span>{campaign.status === "funded" ? "목표 달성금을 자동 지급하고 있어요." : `참여금을 자동 환불하고 있어요. ${amountText(campaign.refundedAmount, data.currencyUnit)} 환불 완료`}</span>
                    </div>
                  )}
                  {campaign.canContribute && (
                    <div className="finance-quick-amounts">
                      <label className="finance-amount-field">
                        <span>참여 금액</span>
                        <input type="number" min={data.denominationStep} max={campaign.remainingAmount} step={data.denominationStep} value={amounts[campaign.id] ?? ""} onChange={(event) => setAmounts((current) => ({ ...current, [campaign.id]: event.target.value }))} />
                      </label>
                      <button className="button button-primary" type="button" disabled={Boolean(busy) || !Number(amounts[campaign.id])} onClick={() => void contribute(campaign)}>
                        <HandCoins aria-hidden="true" /> 참여하기
                      </button>
                      <small>남은 목표: {amountText(campaign.remainingAmount, data.currencyUnit)} · 참여 후에는 개별 취소할 수 없어요.</small>
                    </div>
                  )}
                  {(campaign.canEdit || campaign.canPause || campaign.canResume || campaign.canCancel) && (
                    <div className="finance-settings-save-row">
                      {campaign.canEdit && <button className="button button-light" type="button" disabled={Boolean(busy)} onClick={() => editCampaign(campaign)}>내용 수정</button>}
                      {campaign.canPause && <button className="button button-light" type="button" disabled={Boolean(busy)} onClick={() => void campaignAction(campaign, "pause")}><Pause aria-hidden="true" /> 잠시 멈춤</button>}
                      {campaign.canResume && <button className="button button-light" type="button" disabled={Boolean(busy)} onClick={() => void campaignAction(campaign, "resume")}><Play aria-hidden="true" /> 다시 시작</button>}
                      {campaign.canCancel && <button className="button finance-danger-button" type="button" disabled={Boolean(busy)} onClick={() => void campaignAction(campaign, "cancel")}>취소·전액 환불</button>}
                    </div>
                  )}
                  {campaign.canEmergencyCancel && (
                    <div className="finance-inline-confirm">
                      <ShieldAlert aria-hidden="true" />
                      <label>
                        <span>선생님 비상 취소 사유</span>
                        <input maxLength={300} value={emergencyReasons[campaign.id] ?? ""} onChange={(event) => setEmergencyReasons((current) => ({ ...current, [campaign.id]: event.target.value }))} />
                      </label>
                      <button className="button finance-danger-button" type="button" disabled={Boolean(busy) || (emergencyReasons[campaign.id]?.trim().length ?? 0) < 2} onClick={() => void campaignAction(campaign, "cancel", emergencyReasons[campaign.id])}>
                        비상 취소·환불
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
