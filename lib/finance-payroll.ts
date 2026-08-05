import { sha256 } from "./crypto";
import { database, ensureSchema } from "./database";
import { financeContextForRequest, type FinanceContext } from "./finance-access";
import {
  classIssuanceAccountId,
  financeReconciliation,
  postFinanceTransaction,
  studentWalletAccountId,
} from "./finance-ledger";
import { FINANCE_MAX_ABSOLUTE_AMOUNT } from "./finance-ledger-rules";
import {
  DEFAULT_FINANCE_SALARY_SETTINGS,
  FinancePayrollRuleError,
  type FinanceSalaryGrade,
  type FinanceSalarySettingsValues,
  financePayrollPayload,
  financeSalarySettingsJson,
  financeSalarySettingsPayload,
  normalizeFinancePayrollRequest,
  normalizeFinanceSalarySettingsUpdate,
  salaryAmountForGrade,
} from "./finance-payroll-rules";
import {
  financeAmountMatchesDenominations,
} from "./finance-settings-rules";
import { financeSettingsForClass } from "./finance-settings";
import { ApiError } from "./responses";

const PAYROLL_LOCK_TIMEOUT_MS = 2 * 60 * 1_000;

type SalarySettingsRow = {
  class_id: string;
  grade_a_amount: number;
  grade_b_amount: number;
  grade_c_amount: number;
  revision: number;
  updated_by_teacher_id: string | null;
  updated_at: number;
};

type SalarySettingsRevisionRow = {
  id: string;
  class_id: string;
  revision: number;
  idempotency_key: string;
  payload_hash: string;
  settings_json: string;
  created_at: number;
};

type ClosureRow = {
  id: string;
  class_id: string;
  source_period_id: string;
  source_year: number;
  source_month: number;
  status: string;
  closed_at: number;
};

type ClosureResultRow = {
  id: string;
  closure_id: string;
  class_id: string;
  student_id: string;
  student_number: number;
  student_name: string;
  class_job_id: string;
  job_name: string;
  job_grade: string;
  wallet_status: string | null;
};

type PayrollRunRow = {
  id: string;
  class_id: string;
  closure_id: string;
  source_period_id: string;
  source_year: number;
  source_month: number;
  salary_settings_revision: number;
  salary_settings_json: string;
  status: "prepared" | "posting" | "completed";
  recipient_count: number;
  posted_count: number;
  total_amount: number;
  idempotency_key: string;
  payload_hash: string;
  initiated_by_teacher_id: string | null;
  created_at: number;
  posted_at: number | null;
  updated_at: number;
};

type PayrollItemRow = {
  id: string;
  run_id: string;
  class_id: string;
  closure_result_id: string;
  student_id: string;
  student_number: number;
  student_name: string;
  class_job_id: string;
  job_name: string;
  job_grade: string;
  base_amount: number;
  total_amount: number;
  status: "pending" | "posted";
  posted_transaction_id: string | null;
  created_at: number;
  posted_at: number | null;
  updated_at: number;
  effective_status?: string | null;
};

export type FinanceSalarySettingsView = FinanceSalarySettingsValues & {
  revision: number;
  updatedAt: number;
};

export type FinancePayrollItemView = {
  id: string;
  studentId: string;
  studentNumber: number;
  studentName: string;
  classJobId: string;
  jobName: string;
  jobGrade: FinanceSalaryGrade;
  amount: number;
  status: "pending" | "posted" | "reversed";
  transactionId: string | null;
  postedAt: number | null;
};

export type FinancePayrollView = {
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
  items: FinancePayrollItemView[];
};

function ruleError(error: unknown): never {
  if (error instanceof FinancePayrollRuleError) {
    throw new ApiError(400, error.message, error.code);
  }
  throw error;
}

function requireTeacher(context: FinanceContext, write = false) {
  if (context.financeRole !== "teacher" || context.actor.type !== "teacher") {
    throw new ApiError(
      403,
      "직업 월급은 담임교사만 확인하고 지급할 수 있습니다.",
      "FINANCE_PAYROLL_TEACHER_REQUIRED",
    );
  }
  if (write && context.classroom.status !== "active") {
    throw new ApiError(
      409,
      "현재 운영 중인 학급에서만 월급을 지급할 수 있습니다.",
      "FINANCE_PAYROLL_CLASS_NOT_ACTIVE",
    );
  }
  return context.actor.id;
}

function settingsValues(row: SalarySettingsRow): FinanceSalarySettingsValues {
  return {
    gradeAAmount: Number(row.grade_a_amount),
    gradeBAmount: Number(row.grade_b_amount),
    gradeCAmount: Number(row.grade_c_amount),
  };
}

async function assertSalaryAmountsMatchCurrentDenominations(
  classId: string,
  values: FinanceSalarySettingsValues,
) {
  const financeSettings = await financeSettingsForClass(classId);
  const smallestDenomination = Math.min(...financeSettings.denominations);
  if (
    Object.values(values).some((amount) => (
      !financeAmountMatchesDenominations(amount, financeSettings.denominations)
    ))
  ) {
    throw new ApiError(
      409,
      `현재 월급 기준이 가장 작은 권종 ${smallestDenomination.toLocaleString("ko-KR")} 단위와 맞지 않습니다. 월급 기준을 다시 저장한 뒤 지급해 주세요.`,
      "FINANCE_PAYROLL_DENOMINATION_MISMATCH",
    );
  }
}

function settingsView(row: SalarySettingsRow): FinanceSalarySettingsView {
  return {
    ...settingsValues(row),
    revision: Number(row.revision),
    updatedAt: Number(row.updated_at),
  };
}

function parseStoredSettings(value: string): FinanceSalarySettingsValues {
  try {
    const parsed = JSON.parse(value) as Partial<FinanceSalarySettingsValues>;
    const candidate = {
      gradeAAmount: Number(parsed.gradeAAmount),
      gradeBAmount: Number(parsed.gradeBAmount),
      gradeCAmount: Number(parsed.gradeCAmount),
    };
    if (
      Object.values(candidate).every((amount) => (
        Number.isSafeInteger(amount) && amount > 0 && amount <= FINANCE_MAX_ABSOLUTE_AMOUNT
      ))
      && candidate.gradeAAmount >= candidate.gradeBAmount
      && candidate.gradeBAmount >= candidate.gradeCAmount
    ) return candidate;
  } catch {
    // Invalid snapshots are reported as a data-integrity error below.
  }
  throw new ApiError(
    409,
    "저장된 월급 설정을 확인할 수 없습니다.",
    "FINANCE_PAYROLL_SETTINGS_CORRUPTED",
  );
}

async function ensureSalarySettings(classId: string) {
  const now = Date.now();
  await database().prepare(
    `INSERT OR IGNORE INTO finance_salary_settings (
       class_id, grade_a_amount, grade_b_amount, grade_c_amount,
       revision, updated_by_teacher_id, updated_at
     )
     SELECT id, ?, ?, ?, 0, NULL, ?
     FROM classes WHERE id = ?`,
  ).bind(
    DEFAULT_FINANCE_SALARY_SETTINGS.gradeAAmount,
    DEFAULT_FINANCE_SALARY_SETTINGS.gradeBAmount,
    DEFAULT_FINANCE_SALARY_SETTINGS.gradeCAmount,
    now,
    classId,
  ).run();
}

async function salarySettingsRow(classId: string) {
  await ensureSalarySettings(classId);
  const row = await database().prepare(
    `SELECT class_id, grade_a_amount, grade_b_amount, grade_c_amount,
            revision, updated_by_teacher_id, updated_at
     FROM finance_salary_settings
     WHERE class_id = ?
     LIMIT 1`,
  ).bind(classId).first<SalarySettingsRow>();
  if (!row) {
    throw new ApiError(
      404,
      "학급의 월급 설정을 찾을 수 없습니다.",
      "FINANCE_PAYROLL_SETTINGS_NOT_FOUND",
    );
  }
  return row;
}

async function salarySettingsRevisionByKey(classId: string, key: string) {
  return database().prepare(
    `SELECT id, class_id, revision, idempotency_key, payload_hash,
            settings_json, created_at
     FROM finance_salary_setting_revisions
     WHERE class_id = ? AND idempotency_key = ?
     LIMIT 1`,
  ).bind(classId, key).first<SalarySettingsRevisionRow>();
}

function settingsReplay(
  revision: SalarySettingsRevisionRow,
  payloadHash: string,
) {
  if (revision.payload_hash !== payloadHash) {
    throw new ApiError(
      409,
      "같은 저장 요청 번호가 다른 월급 설정에 사용되었습니다.",
      "FINANCE_PAYROLL_IDEMPOTENCY_CONFLICT",
    );
  }
  const values = parseStoredSettings(revision.settings_json);
  return {
    settings: {
      ...values,
      revision: Number(revision.revision),
      updatedAt: Number(revision.created_at),
    } satisfies FinanceSalarySettingsView,
    deduplicated: true,
  };
}

export async function updateFinanceSalarySettings(
  request: Request,
  input: {
    gradeAAmount?: unknown;
    gradeBAmount?: unknown;
    gradeCAmount?: unknown;
    expectedRevision?: unknown;
    idempotencyKey?: unknown;
    changeReason?: unknown;
  },
) {
  let normalized: ReturnType<typeof normalizeFinanceSalarySettingsUpdate>;
  try {
    normalized = normalizeFinanceSalarySettingsUpdate(input);
  } catch (error) {
    ruleError(error);
  }
  await ensureSchema();
  const context = await financeContextForRequest(request);
  const teacherId = requireTeacher(context, true);
  const financeSettings = await financeSettingsForClass(context.classroom.id);
  for (const amount of Object.values(normalized.values)) {
    if (!financeAmountMatchesDenominations(amount, financeSettings.denominations)) {
      throw new ApiError(
        400,
        `월급은 가장 작은 권종 ${Math.min(...financeSettings.denominations).toLocaleString("ko-KR")}의 배수로 입력해 주세요.`,
        "FINANCE_PAYROLL_DENOMINATION_MISMATCH",
      );
    }
  }

  const payloadHash = await sha256(financeSalarySettingsPayload({
    values: normalized.values,
    expectedRevision: normalized.expectedRevision,
    changeReason: normalized.changeReason,
  }));
  const replay = await salarySettingsRevisionByKey(
    context.classroom.id,
    normalized.idempotencyKey,
  );
  if (replay) return settingsReplay(replay, payloadHash);

  const current = await salarySettingsRow(context.classroom.id);
  if (Number(current.revision) !== normalized.expectedRevision) {
    throw new ApiError(
      409,
      "다른 화면에서 월급 설정이 먼저 바뀌었습니다. 최신 설정을 다시 확인해 주세요.",
      "FINANCE_SALARY_SETTINGS_STALE",
    );
  }

  const now = Date.now();
  const nextRevision = normalized.expectedRevision + 1;
  const previousJson = financeSalarySettingsJson(settingsValues(current));
  const nextJson = financeSalarySettingsJson(normalized.values);
  const db = database();
  try {
    await db.batch([
      db.prepare(
        `UPDATE finance_salary_settings
         SET grade_a_amount = ?, grade_b_amount = ?, grade_c_amount = ?,
             revision = revision + 1, updated_by_teacher_id = ?, updated_at = ?
         WHERE class_id = ? AND revision = ?`,
      ).bind(
        normalized.values.gradeAAmount,
        normalized.values.gradeBAmount,
        normalized.values.gradeCAmount,
        teacherId,
        now,
        context.classroom.id,
        normalized.expectedRevision,
      ),
      db.prepare(
        `INSERT INTO finance_salary_setting_revisions (
           id, class_id, revision, idempotency_key, payload_hash,
           previous_settings_json, settings_json, change_reason,
           actor_teacher_id, actor_label, created_at
         )
         SELECT ?, class_id, revision, ?, ?, ?, ?, ?, ?, '담임교사', ?
         FROM finance_salary_settings
         WHERE class_id = ? AND revision = ?`,
      ).bind(
        crypto.randomUUID(),
        normalized.idempotencyKey,
        payloadHash,
        previousJson,
        nextJson,
        normalized.changeReason,
        teacherId,
        now,
        context.classroom.id,
        nextRevision,
      ),
    ]);
  } catch (error) {
    const concurrent = await salarySettingsRevisionByKey(
      context.classroom.id,
      normalized.idempotencyKey,
    );
    if (concurrent) return settingsReplay(concurrent, payloadHash);
    const latest = await salarySettingsRow(context.classroom.id);
    if (Number(latest.revision) !== normalized.expectedRevision) {
      throw new ApiError(
        409,
        "다른 화면에서 월급 설정이 먼저 바뀌었습니다. 최신 설정을 다시 확인해 주세요.",
        "FINANCE_SALARY_SETTINGS_STALE",
      );
    }
    throw error;
  }

  const storedRevision = await salarySettingsRevisionByKey(
    context.classroom.id,
    normalized.idempotencyKey,
  );
  if (!storedRevision) {
    throw new ApiError(
      409,
      "다른 화면에서 월급 설정이 먼저 바뀌었습니다. 최신 설정을 다시 확인해 주세요.",
      "FINANCE_SALARY_SETTINGS_STALE",
    );
  }
  return {
    settings: settingsView(await salarySettingsRow(context.classroom.id)),
    deduplicated: false,
  };
}

async function closureRows(classId: string) {
  return database().prepare(
    `SELECT id, class_id, source_period_id, source_year, source_month,
            status, closed_at
     FROM class_job_month_closures
     WHERE class_id = ? AND status = 'closed'
     ORDER BY source_year DESC, source_month DESC, closed_at DESC, id DESC
     LIMIT 12`,
  ).bind(classId).all<ClosureRow>();
}

async function closureRow(classId: string, closureId: string) {
  return database().prepare(
    `SELECT id, class_id, source_period_id, source_year, source_month,
            status, closed_at
     FROM class_job_month_closures
     WHERE id = ? AND class_id = ? AND status = 'closed'
     LIMIT 1`,
  ).bind(closureId, classId).first<ClosureRow>();
}

async function closureResults(classId: string, closureId: string) {
  return database().prepare(
    `SELECT result.id, result.closure_id, result.class_id, result.student_id,
            result.student_number, result.student_name, result.class_job_id,
            result.job_name, result.job_grade, wallet.status AS wallet_status
     FROM class_job_month_results result
     LEFT JOIN finance_accounts wallet
       ON wallet.class_id = result.class_id
      AND wallet.student_id = result.student_id
      AND wallet.account_type = 'student_wallet'
     WHERE result.class_id = ? AND result.closure_id = ?
     ORDER BY result.student_number, result.student_id`,
  ).bind(classId, closureId).all<ClosureResultRow>();
}

async function payrollRunByIdentity(input: {
  classId: string;
  closureId?: string;
  idempotencyKey?: string;
  runId?: string;
}) {
  if (input.runId) {
    return database().prepare(
      `SELECT id, class_id, closure_id, source_period_id, source_year, source_month,
              salary_settings_revision, salary_settings_json, status,
              recipient_count, posted_count, total_amount, idempotency_key,
              payload_hash, initiated_by_teacher_id, created_at, posted_at, updated_at
       FROM finance_payroll_runs
       WHERE id = ? AND class_id = ?
       LIMIT 1`,
    ).bind(input.runId, input.classId).first<PayrollRunRow>();
  }
  return database().prepare(
    `SELECT id, class_id, closure_id, source_period_id, source_year, source_month,
            salary_settings_revision, salary_settings_json, status,
            recipient_count, posted_count, total_amount, idempotency_key,
            payload_hash, initiated_by_teacher_id, created_at, posted_at, updated_at
     FROM finance_payroll_runs
     WHERE class_id = ?
       AND (closure_id = ? OR idempotency_key = ?)
     ORDER BY CASE WHEN idempotency_key = ? THEN 0 ELSE 1 END
     LIMIT 1`,
  ).bind(
    input.classId,
    input.closureId ?? "",
    input.idempotencyKey ?? "",
    input.idempotencyKey ?? "",
  ).first<PayrollRunRow>();
}

async function payrollItems(classId: string, runId: string) {
  return database().prepare(
    `SELECT item.id, item.run_id, item.class_id, item.closure_result_id,
            item.student_id, item.student_number, item.student_name,
            item.class_job_id, item.job_name, item.job_grade,
            item.base_amount, item.total_amount, item.status,
            item.posted_transaction_id, item.created_at, item.posted_at,
            item.updated_at,
            CASE
              WHEN reversal.id IS NOT NULL THEN 'reversed'
              WHEN transaction_row.id IS NOT NULL THEN 'posted'
              ELSE 'pending'
            END AS effective_status
     FROM finance_payroll_items item
     LEFT JOIN finance_transactions transaction_row
       ON transaction_row.id = item.posted_transaction_id
      AND transaction_row.class_id = item.class_id
      AND transaction_row.status = 'posted'
     LEFT JOIN finance_transactions reversal
       ON reversal.reversal_of_transaction_id = transaction_row.id
      AND reversal.class_id = transaction_row.class_id
      AND reversal.status = 'posted'
     WHERE item.class_id = ? AND item.run_id = ?
     ORDER BY item.student_number, item.student_id`,
  ).bind(classId, runId).all<PayrollItemRow>();
}

function normalizedGrade(value: string): FinanceSalaryGrade {
  if (value === "A" || value === "B" || value === "C") return value;
  throw new ApiError(
    409,
    "월 마감 기록의 직업 등급을 확인할 수 없습니다.",
    "FINANCE_PAYROLL_INVALID_GRADE",
  );
}

function itemView(row: PayrollItemRow): FinancePayrollItemView {
  const effective = row.effective_status === "reversed"
    ? "reversed" as const
    : row.effective_status === "posted" || row.status === "posted"
      ? "posted" as const
      : "pending" as const;
  return {
    id: row.id,
    studentId: row.student_id,
    studentNumber: Number(row.student_number),
    studentName: row.student_name,
    classJobId: row.class_job_id,
    jobName: row.job_name,
    jobGrade: normalizedGrade(row.job_grade),
    amount: Number(row.total_amount),
    status: effective,
    transactionId: row.posted_transaction_id,
    postedAt: row.posted_at === null ? null : Number(row.posted_at),
  };
}

function previewItem(
  row: ClosureResultRow,
  settings: FinanceSalarySettingsValues,
): FinancePayrollItemView {
  const grade = normalizedGrade(row.job_grade);
  return {
    id: row.id,
    studentId: row.student_id,
    studentNumber: Number(row.student_number),
    studentName: row.student_name,
    classJobId: row.class_job_id,
    jobName: row.job_name,
    jobGrade: grade,
    amount: salaryAmountForGrade(grade, settings),
    status: "pending",
    transactionId: null,
    postedAt: null,
  };
}

async function payrollView(
  closure: ClosureRow,
  currentSettings: SalarySettingsRow,
  run?: PayrollRunRow | null,
): Promise<FinancePayrollView> {
  if (!run) {
    const rows = await closureResults(closure.class_id, closure.id);
    const items = rows.results.map((row) => previewItem(row, settingsValues(currentSettings)));
    return {
      id: null,
      closureId: closure.id,
      sourcePeriodId: closure.source_period_id,
      sourceYear: Number(closure.source_year),
      sourceMonth: Number(closure.source_month),
      closedAt: Number(closure.closed_at),
      status: "ready",
      settingsRevision: Number(currentSettings.revision),
      recipientCount: items.length,
      postedCount: 0,
      totalAmount: items.reduce((sum, item) => sum + item.amount, 0),
      postedAt: null,
      items,
    };
  }
  const rows = await payrollItems(run.class_id, run.id);
  const items = rows.results.map(itemView);
  const postedCount = items.filter((item) => item.status !== "pending").length;
  const reversedCount = items.filter((item) => item.status === "reversed").length;
  const postingLockIsFresh = run.status === "posting"
    && Number(run.updated_at) >= Date.now() - PAYROLL_LOCK_TIMEOUT_MS;
  const status = reversedCount > 0
    ? "adjusted" as const
    : postingLockIsFresh
      ? "posting" as const
      : postedCount === items.length && items.length > 0
        ? "completed" as const
        : postedCount > 0
          ? "partial" as const
          : "ready" as const;
  return {
    id: run.id,
    closureId: run.closure_id,
    sourcePeriodId: run.source_period_id,
    sourceYear: Number(run.source_year),
    sourceMonth: Number(run.source_month),
    closedAt: Number(closure.closed_at),
    status,
    settingsRevision: Number(run.salary_settings_revision),
    recipientCount: Number(run.recipient_count),
    postedCount,
    totalAmount: Number(run.total_amount),
    postedAt: run.posted_at === null ? null : Number(run.posted_at),
    items,
  };
}

export async function financePayrollsForRequest(request: Request) {
  await ensureSchema();
  const context = await financeContextForRequest(request);
  requireTeacher(context);
  const settings = await salarySettingsRow(context.classroom.id);
  const closures = await closureRows(context.classroom.id);
  const payrolls = await Promise.all(closures.results.map(async (closure) => {
    const run = await payrollRunByIdentity({
      classId: context.classroom.id,
      closureId: closure.id,
    });
    return payrollView(closure, settings, run);
  }));
  return {
    settings: settingsView(settings),
    payrolls,
    serverTime: Date.now(),
  };
}

async function assertLedgerReady(classId: string) {
  const reconciliation = await financeReconciliation(classId);
  if (
    reconciliation.mismatches.length > 0
    || reconciliation.pendingTransactionCount > 0
  ) {
    throw new ApiError(
      409,
      "금융 원장 확인이 필요해 월급 지급을 잠시 멈췄습니다.",
      "FINANCE_LEDGER_ATTENTION",
    );
  }
}

function runReplay(existing: PayrollRunRow, payloadHash: string) {
  if (existing.payload_hash !== payloadHash) {
    throw new ApiError(
      409,
      "같은 월급 지급 요청이 다른 내용으로 사용되었습니다.",
      "FINANCE_PAYROLL_IDEMPOTENCY_CONFLICT",
    );
  }
  return existing;
}

async function preparePayroll(input: {
  classId: string;
  closureId: string;
  settings: SalarySettingsRow;
  idempotencyKey: string;
  initiatedByTeacherId: string | null;
}) {
  const closure = await closureRow(input.classId, input.closureId);
  if (!closure) {
    throw new ApiError(
      404,
      "지급할 월 마감 기록을 찾을 수 없습니다.",
      "FINANCE_PAYROLL_CLOSURE_NOT_FOUND",
    );
  }
  const resultSet = await closureResults(input.classId, input.closureId);
  if (resultSet.results.length < 1) {
    throw new ApiError(
      409,
      "월급을 계산할 학생별 마감 기록이 없습니다.",
      "FINANCE_PAYROLL_RESULTS_REQUIRED",
    );
  }
  const unavailable = resultSet.results.filter((row) => row.wallet_status !== "active");
  if (unavailable.length > 0) {
    throw new ApiError(
      409,
      `${unavailable.map((row) => `${row.student_number}번 ${row.student_name}`).join(", ")} 학생의 지갑 상태를 먼저 확인해 주세요.`,
      "FINANCE_PAYROLL_WALLET_NOT_ACTIVE",
    );
  }
  const settings = settingsValues(input.settings);
  const items = resultSet.results.map((result) => {
    const grade = normalizedGrade(result.job_grade);
    return {
      id: crypto.randomUUID(),
      result,
      grade,
      amount: salaryAmountForGrade(grade, settings),
    };
  });
  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
  if (
    !Number.isSafeInteger(totalAmount)
    || totalAmount <= 0
    || totalAmount > FINANCE_MAX_ABSOLUTE_AMOUNT
  ) {
    throw new ApiError(
      409,
      "월급 총액을 안전하게 계산할 수 없습니다.",
      "FINANCE_PAYROLL_INVALID_TOTAL",
    );
  }
  const issuance = await database().prepare(
    `SELECT balance, status FROM finance_accounts
     WHERE id = ? AND class_id = ? AND account_type = 'class_issuance'
     LIMIT 1`,
  ).bind(classIssuanceAccountId(input.classId), input.classId).first<{
    balance: number;
    status: string;
  }>();
  if (!issuance || issuance.status !== "active") {
    throw new ApiError(
      409,
      "학급 발행 계정 상태를 먼저 확인해 주세요.",
      "FINANCE_PAYROLL_ACCOUNT_NOT_ACTIVE",
    );
  }
  if (Number(issuance.balance) - totalAmount < -FINANCE_MAX_ABSOLUTE_AMOUNT) {
    throw new ApiError(
      409,
      "학급 발행 한도를 넘어 월급을 지급할 수 없습니다.",
      "FINANCE_ISSUANCE_BALANCE_LIMIT",
    );
  }

  const payrollPayload = financePayrollPayload({
    classId: input.classId,
    closureId: closure.id,
    sourcePeriodId: closure.source_period_id,
    sourceYear: Number(closure.source_year),
    sourceMonth: Number(closure.source_month),
    settingsRevision: Number(input.settings.revision),
    settings,
    items: items.map((item) => ({
      closureResultId: item.result.id,
      studentId: item.result.student_id,
      classJobId: item.result.class_job_id,
      jobGrade: item.grade,
      amount: item.amount,
    })),
  });
  const payloadHash = await sha256(payrollPayload);
  const existing = await payrollRunByIdentity({
    classId: input.classId,
    closureId: input.closureId,
    idempotencyKey: input.idempotencyKey,
  });
  if (existing) return { run: runReplay(existing, payloadHash), closure, deduplicated: true };

  const runId = crypto.randomUUID();
  const now = Date.now();
  const db = database();
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO finance_payroll_runs (
         id, class_id, closure_id, source_period_id, source_year, source_month,
         salary_settings_revision, salary_settings_json, status,
         recipient_count, posted_count, total_amount, idempotency_key,
         payload_hash, initiated_by_teacher_id, created_at, posted_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, 0, ?, ?, ?, ?, ?, NULL, ?)`,
    ).bind(
      runId,
      input.classId,
      closure.id,
      closure.source_period_id,
      Number(closure.source_year),
      Number(closure.source_month),
      Number(input.settings.revision),
      financeSalarySettingsJson(settings),
      items.length,
      totalAmount,
      input.idempotencyKey,
      payloadHash,
      input.initiatedByTeacherId,
      now,
      now,
    ),
    ...items.map((item) => db.prepare(
      `INSERT INTO finance_payroll_items (
         id, run_id, class_id, closure_result_id, student_id, student_number,
         student_name, class_job_id, job_name, job_grade, base_amount,
         total_amount, status, posted_transaction_id, created_at, posted_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL, ?)`,
    ).bind(
      item.id,
      runId,
      input.classId,
      item.result.id,
      item.result.student_id,
      Number(item.result.student_number),
      item.result.student_name,
      item.result.class_job_id,
      item.result.job_name,
      item.grade,
      item.amount,
      item.amount,
      now,
      now,
    )),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    const concurrent = await payrollRunByIdentity({
      classId: input.classId,
      closureId: input.closureId,
      idempotencyKey: input.idempotencyKey,
    });
    if (concurrent) {
      return { run: runReplay(concurrent, payloadHash), closure, deduplicated: true };
    }
    throw error;
  }
  const run = await payrollRunByIdentity({ classId: input.classId, runId });
  if (!run) {
    throw new ApiError(
      500,
      "월급 지급 준비 결과를 확인할 수 없습니다.",
      "FINANCE_PAYROLL_UNAVAILABLE",
    );
  }
  return { run, closure, deduplicated: false };
}

async function refreshRunProgress(classId: string, runId: string, now = Date.now()) {
  const db = database();
  await db.prepare(
    `UPDATE finance_payroll_runs
     SET posted_count = (
           SELECT COUNT(*) FROM finance_payroll_items
           WHERE run_id = ? AND class_id = ? AND status = 'posted'
         ),
         status = CASE WHEN (
           SELECT COUNT(*) FROM finance_payroll_items
           WHERE run_id = ? AND class_id = ? AND status = 'pending'
         ) = 0 THEN 'completed' ELSE 'prepared' END,
         posted_at = CASE WHEN (
           SELECT COUNT(*) FROM finance_payroll_items
           WHERE run_id = ? AND class_id = ? AND status = 'pending'
         ) = 0 THEN COALESCE(posted_at, ?) ELSE posted_at END,
         updated_at = ?
     WHERE id = ? AND class_id = ?`,
  ).bind(
    runId,
    classId,
    runId,
    classId,
    runId,
    classId,
    now,
    now,
    runId,
    classId,
  ).run();
  return payrollRunByIdentity({ classId, runId });
}

function postingConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("finance_payroll_runs_class_posting_uq")
    || message.includes("finance_payroll_runs.class_id");
}

async function postPreparedPayroll(input: {
  run: PayrollRunRow;
  closure: ClosureRow;
}) {
  if (input.run.status === "completed") return input.run;
  const now = Date.now();
  let lock;
  try {
    lock = await database().prepare(
      `UPDATE finance_payroll_runs
       SET status = 'posting', updated_at = ?
       WHERE id = ? AND class_id = ? AND status <> 'completed'
         AND (status = 'prepared' OR updated_at < ?)`,
    ).bind(
      now,
      input.run.id,
      input.run.class_id,
      now - PAYROLL_LOCK_TIMEOUT_MS,
    ).run();
  } catch (error) {
    if (postingConflict(error)) {
      throw new ApiError(
        409,
        "다른 달의 월급을 지급하고 있습니다. 잠시 후 다시 시도해 주세요.",
        "FINANCE_PAYROLL_BUSY",
      );
    }
    throw error;
  }
  if (!Number(lock.meta.changes ?? 0)) {
    const current = await payrollRunByIdentity({
      classId: input.run.class_id,
      runId: input.run.id,
    });
    if (current?.status === "completed") return current;
    throw new ApiError(
      409,
      "같은 월급을 이미 지급하고 있습니다. 잠시 후 새로고침해 주세요.",
      "FINANCE_PAYROLL_BUSY",
    );
  }

  const pending = await database().prepare(
    `SELECT id, run_id, class_id, closure_result_id, student_id,
            student_number, student_name, class_job_id, job_name, job_grade,
            base_amount, total_amount, status, posted_transaction_id,
            created_at, posted_at, updated_at
     FROM finance_payroll_items
     WHERE run_id = ? AND class_id = ? AND status = 'pending'
     ORDER BY student_number, student_id`,
  ).bind(input.run.id, input.run.class_id).all<PayrollItemRow>();

  try {
    for (const item of pending.results) {
      const actor = input.run.initiated_by_teacher_id
        ? {
          type: "teacher" as const,
          teacherId: input.run.initiated_by_teacher_id,
          label: "담임교사",
        }
        : { type: "system" as const, label: "월급 자동 지급" };
      const result = await postFinanceTransaction({
        classId: input.run.class_id,
        idempotencyKey: `salary:item:${item.id}`,
        transactionType: "salary",
        description: `${input.run.source_year}년 ${input.run.source_month}월 ${item.job_name} 직업 월급`,
        actor,
        sourceType: "salary_item",
        sourceId: item.id,
        lines: [
          {
            accountId: studentWalletAccountId(item.student_id),
            amount: Number(item.total_amount),
            memo: `${item.job_grade}등급 ${item.job_name} 월급`,
          },
          {
            accountId: classIssuanceAccountId(input.run.class_id),
            amount: -Number(item.total_amount),
            memo: `${item.student_name} 직업 월급 발행`,
          },
        ],
        metadata: {
          payrollRunId: input.run.id,
          payrollItemId: item.id,
          closureId: input.run.closure_id,
          sourcePeriodId: input.run.source_period_id,
          sourceYear: Number(input.run.source_year),
          sourceMonth: Number(input.run.source_month),
          salarySettingsRevision: Number(input.run.salary_settings_revision),
          studentId: item.student_id,
          studentNumber: Number(item.student_number),
          classJobId: item.class_job_id,
          jobName: item.job_name,
          jobGrade: item.job_grade,
          baseAmount: Number(item.base_amount),
          totalAmount: Number(item.total_amount),
        },
      });
      const postedAt = result.transaction.postedAt;
      await database().prepare(
        `UPDATE finance_payroll_items
         SET status = 'posted', posted_transaction_id = ?, posted_at = ?, updated_at = ?
         WHERE id = ? AND run_id = ? AND class_id = ?
           AND status = 'pending'`,
      ).bind(
        result.transaction.id,
        postedAt,
        postedAt,
        item.id,
        input.run.id,
        input.run.class_id,
      ).run();
    }
  } catch (error) {
    await refreshRunProgress(input.run.class_id, input.run.id).catch(() => undefined);
    throw error;
  }

  const completed = await refreshRunProgress(input.run.class_id, input.run.id);
  if (!completed || completed.status !== "completed") {
    throw new ApiError(
      409,
      "일부 학생의 월급 지급을 마치지 못했습니다. 같은 버튼을 눌러 이어서 지급해 주세요.",
      "FINANCE_PAYROLL_PARTIAL",
    );
  }
  return completed;
}

async function executePayroll(input: {
  classId: string;
  closureId: string;
  expectedSettingsRevision: number | null;
  idempotencyKey: string;
  initiatedByTeacherId: string | null;
}) {
  const existing = await payrollRunByIdentity({
    classId: input.classId,
    closureId: input.closureId,
    idempotencyKey: input.idempotencyKey,
  });
  if (existing) {
    if (existing.closure_id !== input.closureId) {
      throw new ApiError(
        409,
        "같은 월급 지급 요청 번호가 다른 달에 사용되었습니다.",
        "FINANCE_PAYROLL_IDEMPOTENCY_CONFLICT",
      );
    }
    const closure = await closureRow(input.classId, existing.closure_id);
    if (!closure) {
      throw new ApiError(
        409,
        "기존 월급 지급의 월 마감 기록을 확인할 수 없습니다.",
        "FINANCE_PAYROLL_CLOSURE_NOT_FOUND",
      );
    }
    if (existing.status !== "completed") {
      await assertSalaryAmountsMatchCurrentDenominations(
        input.classId,
        parseStoredSettings(existing.salary_settings_json),
      );
      await assertLedgerReady(input.classId);
    }
    const completed = await postPreparedPayroll({ run: existing, closure });
    const currentSettings = await salarySettingsRow(input.classId);
    return {
      payroll: await payrollView(closure, currentSettings, completed),
      deduplicated: true,
    };
  }

  const settings = await salarySettingsRow(input.classId);
  if (
    input.expectedSettingsRevision !== null
    && Number(settings.revision) !== input.expectedSettingsRevision
  ) {
    throw new ApiError(
      409,
      "월급 설정이 바뀌었습니다. 지급 금액을 다시 확인해 주세요.",
      "FINANCE_SALARY_SETTINGS_STALE",
    );
  }
  await assertSalaryAmountsMatchCurrentDenominations(
    input.classId,
    settingsValues(settings),
  );
  await assertLedgerReady(input.classId);
  const prepared = await preparePayroll({
    classId: input.classId,
    closureId: input.closureId,
    settings,
    idempotencyKey: input.idempotencyKey,
    initiatedByTeacherId: input.initiatedByTeacherId,
  });
  const completed = await postPreparedPayroll(prepared);
  return {
    payroll: await payrollView(prepared.closure, settings, completed),
    deduplicated: prepared.deduplicated || prepared.run.status === "completed",
  };
}

export async function payFinancePayrollForRequest(
  request: Request,
  input: {
    closureId?: unknown;
    expectedSettingsRevision?: unknown;
    idempotencyKey?: unknown;
  },
) {
  let normalized: ReturnType<typeof normalizeFinancePayrollRequest>;
  try {
    normalized = normalizeFinancePayrollRequest(input);
  } catch (error) {
    ruleError(error);
  }
  await ensureSchema();
  const context = await financeContextForRequest(request);
  const teacherId = requireTeacher(context, true);
  return executePayroll({
    classId: context.classroom.id,
    closureId: normalized.closureId,
    expectedSettingsRevision: normalized.expectedSettingsRevision,
    idempotencyKey: normalized.idempotencyKey,
    initiatedByTeacherId: teacherId,
  });
}

/**
 * 월 마감 이후 서버 흐름에서 호출할 수 있는 자동 지급 진입점입니다.
 * 전달받은 classId/closureId는 호출자가 이미 소유권 검사를 마친 값이어야 하며,
 * 거래 행위자는 교사가 아닌 시스템으로 원장에 기록됩니다.
 */
export async function autoPayFinancePayrollForClosure(input: {
  classId: string;
  closureId: string;
}) {
  await ensureSchema();
  return executePayroll({
    classId: input.classId,
    closureId: input.closureId,
    expectedSettingsRevision: null,
    idempotencyKey: `salary-auto:${input.closureId}`,
    initiatedByTeacherId: null,
  });
}
