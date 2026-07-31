"use client";

import {
  BadgeCheck,
  CircleAlert,
  Coins,
  Landmark,
  LoaderCircle,
  RefreshCw,
  Save,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type FinanceSettingsPanelRole = "teacher" | "banker" | "student";

export type FinanceSettingsPanelData = {
  currencyName: string;
  currencyUnit: string;
  denominations: number[];
  bankOpen: boolean;
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  bankerProcessingEnabled: boolean;
  maxRequestAmount: number;
  revision: number;
  updatedAt: number;
};

export type FinanceSettingsBanker = {
  studentId: string;
  studentNumber: number;
  studentName: string;
  jobName: string;
  assignmentYear: number;
  assignmentMonth: number;
};

export type FinanceSettingsPanelProps = {
  role: FinanceSettingsPanelRole;
  classId: string;
  classIsActive: boolean;
  settings: FinanceSettingsPanelData;
  bankers: FinanceSettingsBanker[];
  onRefresh: () => Promise<void>;
};

type DraftSettings = {
  currencyName: string;
  currencyUnit: string;
  denominationsText: string;
  bankOpen: boolean;
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  bankerProcessingEnabled: boolean;
  maxRequestAmountText: string;
};

type Notice = {
  tone: "success" | "error" | "info";
  message: string;
} | null;

type ValidationResult = {
  values: {
    currencyName: string;
    currencyUnit: string;
    denominations: number[];
    bankOpen: boolean;
    depositEnabled: boolean;
    withdrawalEnabled: boolean;
    bankerProcessingEnabled: boolean;
    maxRequestAmount: number;
  } | null;
  message: string | null;
};

const MAX_AMOUNT = 1_000_000_000;

function draftFromSettings(settings: FinanceSettingsPanelData): DraftSettings {
  return {
    currencyName: settings.currencyName,
    currencyUnit: settings.currencyUnit,
    denominationsText: [...settings.denominations]
      .sort((left, right) => left - right)
      .join(", "),
    bankOpen: settings.bankOpen,
    depositEnabled: settings.depositEnabled,
    withdrawalEnabled: settings.withdrawalEnabled,
    bankerProcessingEnabled: settings.bankerProcessingEnabled,
    maxRequestAmountText: String(settings.maxRequestAmount),
  };
}

function validateDraft(draft: DraftSettings): ValidationResult {
  const currencyName = draft.currencyName.trim();
  const currencyUnit = draft.currencyUnit.trim();
  if (!currencyName || currencyName.length > 30 || /[\r\n]/.test(currencyName)) {
    return {
      values: null,
      message: "화폐 이름은 30자 이내 한 줄로 입력해 주세요.",
    };
  }
  if (!currencyUnit || currencyUnit.length > 10 || /[\r\n]/.test(currencyUnit)) {
    return {
      values: null,
      message: "화폐 단위는 10자 이내 한 줄로 입력해 주세요.",
    };
  }

  const denominationParts = draft.denominationsText
    .split(",")
    .map((value) => value.trim());
  if (
    denominationParts.length < 1
    || denominationParts.length > 8
    || denominationParts.some((value) => !/^\d+$/.test(value))
  ) {
    return {
      values: null,
      message: "권종은 쉼표로 나누어 1개 이상 8개 이하의 정수로 입력해 주세요.",
    };
  }
  const denominations = denominationParts.map(Number);
  if (
    denominations.some((value) => (
      !Number.isSafeInteger(value)
      || value <= 0
      || value > MAX_AMOUNT
    ))
  ) {
    return {
      values: null,
      message: "각 권종은 0보다 크고 10억 이하인 정수로 입력해 주세요.",
    };
  }
  if (new Set(denominations).size !== denominations.length) {
    return {
      values: null,
      message: "같은 권종은 한 번만 입력해 주세요.",
    };
  }
  const sortedDenominations = [...denominations]
    .sort((left, right) => left - right);
  if (
    sortedDenominations.some(
      (value) => value % sortedDenominations[0] !== 0,
    )
  ) {
    return {
      values: null,
      message: "모든 권종은 가장 작은 권종의 배수로 입력해 주세요.",
    };
  }

  const maxRequestAmount = Number(draft.maxRequestAmountText);
  if (
    !/^\d+$/.test(draft.maxRequestAmountText.trim())
    || !Number.isSafeInteger(maxRequestAmount)
    || maxRequestAmount <= 0
    || maxRequestAmount > MAX_AMOUNT
  ) {
    return {
      values: null,
      message: "최대 신청액은 0보다 크고 10억 이하인 정수로 입력해 주세요.",
    };
  }
  if (maxRequestAmount < sortedDenominations[0]) {
    return {
      values: null,
      message: "최대 신청액은 가장 작은 권종보다 크거나 같아야 합니다.",
    };
  }

  return {
    values: {
      currencyName,
      currencyUnit,
      denominations: sortedDenominations,
      bankOpen: draft.bankOpen,
      depositEnabled: draft.depositEnabled,
      withdrawalEnabled: draft.withdrawalEnabled,
      bankerProcessingEnabled: draft.bankerProcessingEnabled,
      maxRequestAmount,
    },
    message: null,
  };
}

function newIdempotencyKey() {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `finance-settings:${suffix}`;
}

function settingsFingerprint(input: Record<string, unknown>) {
  return JSON.stringify(input);
}

function dateTimeText(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "아직 저장 기록이 없어요";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function amountText(value: number, unit: string) {
  return `${value.toLocaleString("ko-KR")} ${unit}`;
}

function StatusNotice({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <div
      className={`finance-action-notice ${notice.tone}`}
      role={notice.tone === "error" ? "alert" : "status"}
      aria-live={notice.tone === "error" ? "assertive" : "polite"}
    >
      {notice.tone === "success"
        ? <BadgeCheck aria-hidden="true" />
        : notice.tone === "error"
          ? <CircleAlert aria-hidden="true" />
          : <RefreshCw aria-hidden="true" />}
      <p>{notice.message}</p>
    </div>
  );
}

function BankerRoster({
  bankers,
  classId,
  showAssignmentLink,
}: {
  bankers: FinanceSettingsBanker[];
  classId: string;
  showAssignmentLink: boolean;
}) {
  return (
    <section className="finance-settings-section finance-banker-settings" aria-labelledby="finance-bankers-title">
      <div className="finance-settings-section-heading">
        <UsersRound aria-hidden="true" />
        <div>
          <h3 id="finance-bankers-title">현재 은행원</h3>
          <p>확정된 직업 배정에서 은행원인 학생에게 업무 권한이 자동으로 연결됩니다.</p>
        </div>
      </div>

      {bankers.length > 0 ? (
        <ol className="finance-banker-list">
          {bankers.map((banker) => (
            <li key={banker.studentId}>
              <span>{banker.studentNumber}번</span>
              <strong>{banker.studentName}</strong>
              <small>
                {banker.assignmentYear}년 {banker.assignmentMonth}월 · {banker.jobName}
              </small>
            </li>
          ))}
        </ol>
      ) : (
        <div className="finance-empty-state compact">
          <UsersRound aria-hidden="true" />
          <b>현재 연결된 은행원이 없어요.</b>
          <p>직업 배정을 확정하면 은행원 학생에게 자동으로 권한이 생깁니다.</p>
        </div>
      )}

      {showAssignmentLink && (
        <a
          className="button button-light"
          href={`/teacher/classes/${encodeURIComponent(classId)}/job-assignments`}
        >
          직업 배정에서 확인
        </a>
      )}
    </section>
  );
}

function ReadOnlySettings({
  role,
  classId,
  settings,
  bankers,
}: Pick<
  FinanceSettingsPanelProps,
  "role" | "classId" | "settings" | "bankers"
>) {
  return (
    <div className="finance-settings-readonly">
      <div className="finance-settings-summary-grid">
        <section className="finance-settings-summary-card">
          <Coins aria-hidden="true" />
          <p>우리 반 화폐</p>
          <strong>{settings.currencyName}</strong>
          <small>금액 단위: {settings.currencyUnit}</small>
        </section>
        <section className="finance-settings-summary-card">
          <Landmark aria-hidden="true" />
          <p>은행 운영 상태</p>
          <strong>{settings.bankOpen ? "은행 열림" : "은행 잠시 멈춤"}</strong>
          <small>
            {settings.bankOpen
              ? "현재 허용된 금융 업무를 이용할 수 있어요."
              : "선생님이 다시 열 때까지 기다려 주세요."}
          </small>
        </section>
      </div>

      <section className="finance-settings-section" aria-labelledby="finance-denominations-read-title">
        <h3 id="finance-denominations-read-title">사용하는 권종</h3>
        <ul className="finance-denomination-list">
          {settings.denominations.map((value) => (
            <li key={value}>{amountText(value, settings.currencyUnit)}</li>
          ))}
        </ul>
      </section>

      <section className="finance-settings-section" aria-labelledby="finance-service-read-title">
        <h3 id="finance-service-read-title">현재 이용 가능한 업무</h3>
        <dl className="finance-settings-status-list">
          <div>
            <dt>입금 신청</dt>
            <dd>{settings.bankOpen && settings.depositEnabled ? "가능" : "잠시 멈춤"}</dd>
          </div>
          <div>
            <dt>출금 신청</dt>
            <dd>{settings.bankOpen && settings.withdrawalEnabled ? "가능" : "잠시 멈춤"}</dd>
          </div>
          <div>
            <dt>은행원 처리</dt>
            <dd>
              {settings.bankOpen && settings.bankerProcessingEnabled
                ? "가능"
                : "잠시 멈춤"}
            </dd>
          </div>
          <div>
            <dt>한 번에 신청할 수 있는 최대 금액</dt>
            <dd>{amountText(settings.maxRequestAmount, settings.currencyUnit)}</dd>
          </div>
        </dl>
      </section>

      <BankerRoster
        bankers={bankers}
        classId={classId}
        showAssignmentLink={role === "teacher"}
      />
    </div>
  );
}

export function FinanceSettingsPanel({
  role,
  classId,
  classIsActive,
  settings,
  bankers,
  onRefresh,
}: FinanceSettingsPanelProps) {
  const [draft, setDraft] = useState<DraftSettings>(() => draftFromSettings(settings));
  const [changeReason, setChangeReason] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const loadedRevision = useRef(settings.revision);
  const preserveDraftOnRefresh = useRef(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    if (loadedRevision.current === settings.revision) return;
    loadedRevision.current = settings.revision;
    if (preserveDraftOnRefresh.current) {
      preserveDraftOnRefresh.current = false;
      setStale(false);
      attempt.current = null;
      return;
    }
    setDraft(draftFromSettings(settings));
    setChangeReason("");
    setStale(false);
    attempt.current = null;
  }, [settings]);

  const validation = useMemo(() => validateDraft(draft), [draft]);
  const originalValues = useMemo(
    () => validateDraft(draftFromSettings(settings)).values,
    [settings],
  );
  const changed = validation.values !== null
    && originalValues !== null
    && JSON.stringify(validation.values) !== JSON.stringify(originalValues);
  const reasonValid = changeReason.trim().length >= 2
    && changeReason.trim().length <= 300
    && !/[\r\n]/.test(changeReason.trim());
  const currencyNameInvalid = (
    !draft.currencyName.trim()
    || draft.currencyName.trim().length > 30
    || /[\r\n]/.test(draft.currencyName)
  );
  const currencyUnitInvalid = (
    !draft.currencyUnit.trim()
    || draft.currencyUnit.trim().length > 10
    || /[\r\n]/.test(draft.currencyUnit)
  );
  const maxRequestAmount = Number(draft.maxRequestAmountText);
  const maxRequestAmountInvalid = (
    !/^\d+$/.test(draft.maxRequestAmountText.trim())
    || !Number.isSafeInteger(maxRequestAmount)
    || maxRequestAmount <= 0
    || maxRequestAmount > MAX_AMOUNT
    || Boolean(validation.message?.includes("최대 신청액"))
  );
  const denominationInvalid = Boolean(validation.message?.includes("권종"));
  const formErrorMessage = validation.message
    || (changeReason.length > 0 && !reasonValid
      ? "변경 이유를 2자 이상 300자 이내 한 줄로 입력해 주세요."
      : null);
  const canSave = role === "teacher"
    && classIsActive
    && !busy
    && !refreshing
    && !stale
    && changed
    && validation.values !== null
    && reasonValid;

  function changeDraft(
    updater: (current: DraftSettings) => DraftSettings,
  ) {
    attempt.current = null;
    setDraft(updater);
    setNotice(null);
  }

  async function refreshLatest() {
    setRefreshing(true);
    setNotice({
      tone: "info",
      message: "최신 금융 설정을 불러오고 있어요.",
    });
    try {
      await onRefresh();
      setNotice({
        tone: "success",
        message: "최신 설정을 불러왔어요. 내용을 확인한 뒤 다시 저장해 주세요.",
      });
    } catch {
      setNotice({
        tone: "error",
        message: "최신 설정을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.",
      });
    } finally {
      setRefreshing(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validation.values) {
      setNotice({
        tone: "error",
        message: validation.message || "입력 내용을 다시 확인해 주세요.",
      });
      return;
    }
    if (!reasonValid) {
      setNotice({
        tone: "error",
        message: "변경 이유를 2자 이상 300자 이내 한 줄로 입력해 주세요.",
      });
      return;
    }
    if (!canSave) return;

    const bodyWithoutKey = {
      ...validation.values,
      expectedRevision: settings.revision,
      changeReason: changeReason.trim(),
    };
    const fingerprint = settingsFingerprint(bodyWithoutKey);
    if (!attempt.current || attempt.current.fingerprint !== fingerprint) {
      attempt.current = {
        fingerprint,
        key: newIdempotencyKey(),
      };
    }

    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/finance/settings?classId=${encodeURIComponent(classId)}`,
        {
          method: "PUT",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...bodyWithoutKey,
            idempotencyKey: attempt.current.key,
          }),
        },
      );
      const data = await response.json().catch(() => ({})) as {
        error?: string;
        code?: string;
      };
      if (!response.ok) {
        if (
          response.status === 409
          && data.code === "FINANCE_SETTINGS_STALE"
        ) {
          preserveDraftOnRefresh.current = true;
          setStale(true);
          setNotice({
            tone: "error",
            message: "다른 화면에서 설정이 먼저 바뀌었어요. 입력한 내용은 그대로 두었으니 최신 설정을 불러온 뒤 다시 확인해 주세요.",
          });
          return;
        }
        if (
          response.status === 409
          && data.code === "FINANCE_SETTINGS_IDEMPOTENCY_CONFLICT"
        ) {
          attempt.current = null;
          setNotice({
            tone: "error",
            message: "저장 요청 번호가 겹쳤어요. 입력 내용은 그대로 두었으니 다시 저장해 주세요.",
          });
          return;
        }
        setNotice({
          tone: "error",
          message: data.error || (
            response.status === 403
              ? "이 금융 설정을 바꿀 권한이 없어요."
              : "금융 설정을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요."
          ),
        });
        return;
      }

      attempt.current = null;
      setChangeReason("");
      setNotice({
        tone: "success",
        message: "금융 설정을 안전하게 저장했어요.",
      });
      await onRefresh().catch(() => {
        setNotice({
          tone: "info",
          message: "설정은 저장했지만 최신 화면을 바로 불러오지 못했어요. 새로고침해서 확인해 주세요.",
        });
      });
    } catch {
      setNotice({
        tone: "error",
        message: "인터넷 연결을 확인하지 못했어요. 같은 설정으로 다시 저장하면 중복 변경 없이 결과를 확인합니다.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (role !== "teacher") {
    return (
      <section
        className={`finance-operations-card finance-settings-card role-${role}`}
        aria-labelledby="finance-settings-title"
      >
        <div className="finance-operation-heading">
          <div>
            <p className="eyebrow">금융센터 설정</p>
            <h2 id="finance-settings-title">우리 반 화폐와 은행 운영</h2>
            <p>현재 사용하는 화폐와 이용 가능한 은행 업무를 확인할 수 있어요.</p>
          </div>
          <ShieldCheck aria-hidden="true" />
        </div>
        <ReadOnlySettings
          role={role}
          classId={classId}
          settings={settings}
          bankers={bankers}
        />
      </section>
    );
  }

  return (
    <section
      className="finance-operations-card finance-settings-card role-teacher"
      aria-labelledby="finance-settings-title"
      aria-busy={busy || refreshing}
    >
      <div className="finance-operation-heading">
        <div>
          <p className="eyebrow">금융센터 설정</p>
          <h2 id="finance-settings-title">우리 반 화폐와 은행 운영을 정해요</h2>
          <p>저장한 변경 내용과 이유는 금융 기록에 남습니다.</p>
        </div>
        <ShieldCheck aria-hidden="true" />
      </div>

      <StatusNotice notice={notice} />

      {!classIsActive && (
        <div className="finance-action-notice info" role="status">
          <CircleAlert aria-hidden="true" />
          <p>보관된 학급에서는 설정을 볼 수만 있고 바꿀 수 없습니다.</p>
        </div>
      )}

      {stale && (
        <div className="finance-settings-stale-actions">
          <button
            className="button button-light"
            type="button"
            onClick={() => void refreshLatest()}
            disabled={refreshing || busy}
          >
            {refreshing
              ? <LoaderCircle className="spin" aria-hidden="true" />
              : <RefreshCw aria-hidden="true" />}
            최신 설정 불러오기
          </button>
        </div>
      )}

      <form className="finance-settings-form" onSubmit={submit} noValidate>
        <fieldset disabled={!classIsActive || busy || refreshing}>
          <legend>화폐 기본 정보</legend>
          <div className="finance-settings-field-grid">
            <label>
              <span>화폐 이름</span>
              <input
                value={draft.currencyName}
                maxLength={30}
                onChange={(event) => changeDraft((current) => ({
                  ...current,
                  currencyName: event.target.value,
                }))}
                aria-invalid={currencyNameInvalid}
                aria-describedby="finance-currency-name-help finance-settings-form-error"
                required
              />
              <small id="finance-currency-name-help">예: 우리 반 화폐, 별빛 머니</small>
            </label>
            <label>
              <span>금액 단위</span>
              <input
                value={draft.currencyUnit}
                maxLength={10}
                onChange={(event) => changeDraft((current) => ({
                  ...current,
                  currencyUnit: event.target.value,
                }))}
                aria-invalid={currencyUnitInvalid}
                aria-describedby="finance-currency-unit-help finance-settings-form-error"
                required
              />
              <small id="finance-currency-unit-help">예: 학급화폐, 별, 냥</small>
            </label>
          </div>

          <label>
            <span>사용할 권종</span>
            <input
              value={draft.denominationsText}
              inputMode="numeric"
              onChange={(event) => changeDraft((current) => ({
                ...current,
                denominationsText: event.target.value,
              }))}
              aria-describedby="finance-denominations-help finance-settings-form-error"
              aria-invalid={denominationInvalid}
              required
            />
            <small id="finance-denominations-help">
              쉼표로 나누어 1개 이상 8개 이하로 입력해 주세요. 예: 100, 500, 1000
            </small>
          </label>

          <label>
            <span>한 번에 신청할 수 있는 최대 금액</span>
            <input
              type="number"
              min={1}
              max={MAX_AMOUNT}
              step={1}
              value={draft.maxRequestAmountText}
              onChange={(event) => changeDraft((current) => ({
                ...current,
                maxRequestAmountText: event.target.value,
              }))}
              aria-invalid={maxRequestAmountInvalid}
              aria-describedby="finance-max-request-help finance-settings-form-error"
              required
            />
            <small id="finance-max-request-help">
              학생 한 명이 한 번의 입금 또는 출금 신청에 적을 수 있는 최대 금액입니다.
            </small>
          </label>
        </fieldset>

        <fieldset disabled={!classIsActive || busy || refreshing}>
          <legend>은행 운영</legend>
          <div className="finance-settings-toggle-list">
            <label>
              <input
                type="checkbox"
                checked={draft.bankOpen}
                onChange={(event) => changeDraft((current) => ({
                  ...current,
                  bankOpen: event.target.checked,
                }))}
              />
              <span>
                <b>은행 열기</b>
                <small>끄면 새 신청과 은행원 처리를 잠시 멈춥니다.</small>
              </span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.depositEnabled}
                onChange={(event) => changeDraft((current) => ({
                  ...current,
                  depositEnabled: event.target.checked,
                }))}
              />
              <span>
                <b>입금 신청 허용</b>
                <small>학생이 실물 화폐를 맡기는 신청을 할 수 있습니다.</small>
              </span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.withdrawalEnabled}
                onChange={(event) => changeDraft((current) => ({
                  ...current,
                  withdrawalEnabled: event.target.checked,
                }))}
              />
              <span>
                <b>출금 신청 허용</b>
                <small>학생이 지갑 잔액을 실물 화폐로 찾는 신청을 할 수 있습니다.</small>
              </span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.bankerProcessingEnabled}
                onChange={(event) => changeDraft((current) => ({
                  ...current,
                  bankerProcessingEnabled: event.target.checked,
                }))}
              />
              <span>
                <b>은행원 처리 허용</b>
                <small>현재 은행원 학생이 친구들의 신청을 승인하거나 거절할 수 있습니다.</small>
              </span>
            </label>
          </div>
        </fieldset>

        <label>
          <span>변경 이유</span>
          <input
            value={changeReason}
            maxLength={300}
            onChange={(event) => {
              attempt.current = null;
              setChangeReason(event.target.value);
              setNotice(null);
            }}
            placeholder="예: 새 학기 화폐 단위와 권종을 정함"
            aria-invalid={!reasonValid}
            aria-describedby="finance-change-reason-help finance-settings-form-error"
            required
            disabled={!classIsActive || busy || refreshing}
          />
          <small id="finance-change-reason-help">
            나중에 선생님이 변경 기록을 이해할 수 있도록 2자 이상 적어 주세요.
          </small>
        </label>

        <p
          id="finance-settings-form-error"
          className={formErrorMessage ? "finance-field-error" : "visually-hidden"}
          role={formErrorMessage ? "alert" : undefined}
        >
          {formErrorMessage || ""}
        </p>

        <div className="finance-settings-save-row">
          <span>
            설정 {settings.revision}판 · 마지막 저장 {dateTimeText(settings.updatedAt)}
          </span>
          <button
            className="button button-primary"
            type="submit"
            disabled={!canSave}
          >
            {busy
              ? <LoaderCircle className="spin" aria-hidden="true" />
              : <Save aria-hidden="true" />}
            {busy ? "저장 중" : "설정 저장"}
          </button>
        </div>
      </form>

      <BankerRoster
        bankers={bankers}
        classId={classId}
        showAssignmentLink
      />
    </section>
  );
}
