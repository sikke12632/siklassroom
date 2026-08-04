import { database } from "./database";
import {
  type FinanceContext,
  currentBankersForClass,
  financeContextForRequest,
} from "./finance-access";
import { financeReconciliation } from "./finance-ledger";
import {
  type FinanceSettingsView,
  financeSettingsForClass,
} from "./finance-settings";

type WalletRow = {
  id: string;
  student_id: string;
  student_number: number;
  official_name: string;
  balance: number;
  status: string;
  revision: number;
  updated_at: number;
};

type SummaryRow = {
  wallet_count: number;
  total_balance: number;
  last_entry_at: number | null;
};

type TransactionViewRow = {
  id: string;
  transaction_type: string;
  source_type: string | null;
  description: string;
  actor_type: string;
  actor_label: string;
  posted_at: number;
  reversal_of_transaction_id: string | null;
  is_reversed: number;
  amount: number;
  balance_after: number;
  student_id: string;
  student_number: number;
  official_name: string;
  account_status: string;
};

type RequestViewRow = {
  id: string;
  requester_student_id: string;
  request_type: string;
  amount: number;
  memo: string | null;
  student_number_snapshot: number;
  student_name_snapshot: string;
  revision: number;
  created_at: number;
  decision: string | null;
  actor_label: string | null;
  reason_code: string | null;
  reason_note: string | null;
  intervention_reason: string | null;
  posted_transaction_id: string | null;
  resolved_at: number | null;
  wallet_status: string;
  is_corrected: number;
};

type RequestSummaryRow = {
  pending_count: number;
  pending_withdrawal_amount: number;
};

export type FinanceWalletView = {
  id: string;
  studentId: string;
  studentNumber: number;
  studentName: string;
  balance: number;
  status: "active" | "frozen" | "closed";
  revision: number;
  updatedAt: number;
};

export type FinanceTransactionView = {
  id: string;
  transactionType: string;
  description: string;
  actorType: "teacher" | "banker" | "system";
  actorLabel: string;
  postedAt: number;
  reversalOfTransactionId: string | null;
  isReversed: boolean;
  amount: number;
  balanceAfter: number;
  studentId: string;
  studentNumber: number;
  studentName: string;
  canReverse: boolean;
  reversalBlockedReason: string | null;
};

export type FinanceRequestView = {
  id: string;
  requestType: "deposit" | "withdrawal";
  amount: number;
  memo: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  student: {
    id: string;
    number: number;
    name: string;
  };
  requestedAt: number;
  resolvedAt: number | null;
  processorLabel: string | null;
  reasonCode: string | null;
  reasonNote: string | null;
  interventionReason: string | null;
  revision: number;
  canCancel: boolean;
  canDecide: boolean;
  decisionBlockedReason: string | null;
  canApprove: boolean;
  canReject: boolean;
  approveBlockedReason: string | null;
  rejectBlockedReason: string | null;
  transactionId: string | null;
  isCorrected: boolean;
};

export type FinanceOverview = {
  context: FinanceContext;
  finance: {
    phase: "settings_audit";
    mode: "operations";
    currencyLabel: string;
    scope: "class" | "self";
    settings: FinanceSettingsView;
    bankers: Array<{
      studentId: string;
      studentNumber: number;
      studentName: string;
      jobName: string;
      assignmentYear: number;
      assignmentMonth: number;
    }>;
    summary: {
      walletCount: number;
      totalBalance: number;
      lastEntryAt: number | null;
      ledgerIntegrity: "ok" | "attention" | "not_checked";
    };
    wallets: FinanceWalletView[];
    requestSummary: {
      pendingCount: number;
      pendingWithdrawalAmount: number;
      availableBalance: number | null;
    };
    requests: FinanceRequestView[];
    transactions: FinanceTransactionView[];
  };
};

function serializeWallet(row: WalletRow): FinanceWalletView {
  const status = row.status === "active"
    ? "active"
    : row.status === "frozen"
      ? "frozen"
      : "closed";
  return {
    id: row.id,
    studentId: row.student_id,
    studentNumber: Number(row.student_number),
    studentName: row.official_name,
    balance: Number(row.balance),
    status,
    revision: Number(row.revision),
    updatedAt: Number(row.updated_at),
  };
}

function serializeTransaction(
  row: TransactionViewRow,
  context: FinanceContext,
  ledgerAttention: boolean,
): FinanceTransactionView {
  const classIsActive = context.classroom.status === "active";
  const canReverse = context.financeRole === "teacher"
    && classIsActive
    && !ledgerAttention
    && row.account_status === "active"
    && row.transaction_type !== "reversal"
    && row.source_type !== "deposit_contract"
    && row.source_type !== "deposit_settlement"
    && row.source_type !== "stock_trade"
    && !Boolean(row.is_reversed);
  const reversalBlockedReason = canReverse
    ? null
    : context.financeRole !== "teacher"
      ? "선생님만 거래를 정정할 수 있습니다."
      : !classIsActive
        ? "보관된 학급에서는 기록만 확인할 수 있습니다."
        : ledgerAttention
          ? "잔액과 원장을 먼저 점검해 주세요."
          : row.account_status !== "active"
            ? "현재 사용 중인 학생 지갑 거래만 정정할 수 있습니다."
            : row.transaction_type === "reversal"
              ? "정정 거래는 다시 정정할 수 없습니다."
              : row.source_type === "deposit_contract"
                  || row.source_type === "deposit_settlement"
                ? "예금 거래는 계약과 함께 자동 관리됩니다."
              : row.source_type === "stock_trade"
                ? "주식 거래는 보유 수량과 함께 자동 관리됩니다."
              : Boolean(row.is_reversed)
                ? "이미 정정된 거래입니다."
                : null;
  return {
    id: row.id,
    transactionType: row.transaction_type,
    description: row.description,
    actorType: row.actor_type as "teacher" | "banker" | "system",
    actorLabel: row.actor_label,
    postedAt: Number(row.posted_at),
    reversalOfTransactionId: row.reversal_of_transaction_id,
    isReversed: Boolean(row.is_reversed),
    amount: Number(row.amount),
    balanceAfter: Number(row.balance_after),
    studentId: row.student_id,
    studentNumber: Number(row.student_number),
    studentName: row.official_name,
    canReverse,
    reversalBlockedReason,
  };
}

function serializeRequest(
  row: RequestViewRow,
  context: FinanceContext,
  settings: FinanceSettingsView,
): FinanceRequestView {
  const status = row.decision === "approved"
    ? "approved"
    : row.decision === "rejected"
      ? "rejected"
      : row.decision === "cancelled"
        ? "cancelled"
        : "pending";
  const pending = status === "pending";
  const classIsActive = context.classroom.status === "active";
  const selfRequest = context.actor.id === row.requester_student_id;
  const bankerPolicyAllows = context.financeRole !== "banker"
    || (
      settings.bankOpen
      && settings.bankerProcessingEnabled
      && Number(row.amount) <= settings.maxRequestAmount
      && (
        (row.request_type === "deposit" && settings.depositEnabled)
        || (row.request_type === "withdrawal" && settings.withdrawalEnabled)
      )
    );
  const roleCanDecide = context.financeRole === "teacher"
    || (context.financeRole === "banker" && !selfRequest);
  const canApprove = pending
    && classIsActive
    && row.wallet_status === "active"
    && bankerPolicyAllows
    && roleCanDecide;
  const canReject = pending
    && classIsActive
    && roleCanDecide
    && (
      context.financeRole === "teacher"
      || (row.wallet_status === "active" && bankerPolicyAllows)
    );
  const approveBlockedReason = canApprove
    ? null
    : !pending
      ? "이미 처리된 신청입니다."
      : !classIsActive
        ? "보관된 학급에서는 기록만 확인할 수 있습니다."
        : context.financeRole === "banker" && selfRequest
          ? "내 신청은 다른 은행원이나 선생님이 처리해야 합니다."
        : row.wallet_status !== "active"
          ? "현재 사용할 수 없는 학생 지갑이라 승인할 수 없습니다. 거절하면 대기 신청을 정리할 수 있습니다."
          : context.financeRole === "banker" && !bankerPolicyAllows
            ? "현재 학급의 은행 운영 설정에 따라 처리가 잠시 멈춰 있습니다."
            : "이 신청을 처리할 권한이 없습니다.";
  const rejectBlockedReason = canReject
    ? null
    : !pending
      ? "이미 처리된 신청입니다."
      : !classIsActive
        ? "보관된 학급에서는 기록만 확인할 수 있습니다."
        : context.financeRole === "banker" && selfRequest
          ? "내 신청은 다른 은행원이나 선생님이 처리해야 합니다."
          : context.financeRole === "banker" && row.wallet_status !== "active"
            ? "현재 사용할 수 없는 학생 지갑입니다. 선생님이 신청을 정리해야 합니다."
            : context.financeRole === "banker" && !bankerPolicyAllows
              ? "현재 학급의 은행 운영 설정에 따라 처리가 잠시 멈춰 있습니다."
              : "이 신청을 처리할 권한이 없습니다.";
  const canDecide = canApprove || canReject;
  const decisionBlockedReason = canDecide
    ? null
    : rejectBlockedReason ?? approveBlockedReason;
  return {
    id: row.id,
    requestType: row.request_type === "withdrawal" ? "withdrawal" : "deposit",
    amount: Number(row.amount),
    memo: row.memo,
    status,
    student: {
      id: row.requester_student_id,
      number: Number(row.student_number_snapshot),
      name: row.student_name_snapshot,
    },
    requestedAt: Number(row.created_at),
    resolvedAt: row.resolved_at === null ? null : Number(row.resolved_at),
    processorLabel: row.actor_label,
    reasonCode: row.reason_code,
    reasonNote: row.reason_note,
    interventionReason: context.financeRole === "teacher"
      ? row.intervention_reason
      : null,
    revision: Number(row.revision),
    canCancel: pending && classIsActive && selfRequest && row.wallet_status === "active",
    canDecide,
    decisionBlockedReason,
    canApprove,
    canReject,
    approveBlockedReason,
    rejectBlockedReason,
    transactionId: row.posted_transaction_id,
    isCorrected: Boolean(row.is_corrected),
  };
}

async function classWallets(classId: string, includeInactive: boolean) {
  return database().prepare(
    `SELECT account.id, account.student_id, student.student_number,
            student.official_name, account.balance, account.status,
            account.revision, account.updated_at
     FROM finance_accounts account
     JOIN students student
       ON student.id = account.student_id
      AND student.class_id = account.class_id
     WHERE account.class_id = ?
       AND account.account_type = 'student_wallet'
       AND (
         ? = 1
         OR (account.status = 'active' AND student.status <> 'excluded')
       )
     ORDER BY student.student_number, student.id`,
  ).bind(classId, includeInactive ? 1 : 0).all<WalletRow>();
}

async function studentWallet(classId: string, studentId: string) {
  return database().prepare(
    `SELECT account.id, account.student_id, student.student_number,
            student.official_name, account.balance, account.status,
            account.revision, account.updated_at
     FROM finance_accounts account
     JOIN students student
       ON student.id = account.student_id
      AND student.class_id = account.class_id
     WHERE account.class_id = ?
       AND account.student_id = ?
       AND account.account_type = 'student_wallet'
       AND student.status = 'active'
     LIMIT 1`,
  ).bind(classId, studentId).first<WalletRow>();
}

async function classSummary(classId: string, includeInactive: boolean) {
  return database().prepare(
    `SELECT
       COUNT(account.id) AS wallet_count,
       COALESCE(SUM(account.balance), 0) AS total_balance,
       (
         SELECT MAX(transaction_row.posted_at)
         FROM finance_transactions transaction_row
         WHERE transaction_row.class_id = ?
           AND transaction_row.status = 'posted'
       ) AS last_entry_at
     FROM finance_accounts account
     LEFT JOIN students student ON student.id = account.student_id
     WHERE account.class_id = ?
       AND account.account_type = 'student_wallet'
       AND (
         ? = 1
         OR (account.status = 'active' AND student.status <> 'excluded')
       )`,
  ).bind(classId, classId, includeInactive ? 1 : 0).first<SummaryRow>();
}

async function studentSummary(classId: string, studentId: string) {
  return database().prepare(
    `SELECT
       COUNT(account.id) AS wallet_count,
       COALESCE(SUM(account.balance), 0) AS total_balance,
       (
         SELECT MAX(transaction_row.posted_at)
         FROM finance_transactions transaction_row
         JOIN finance_ledger_entries entry
           ON entry.transaction_id = transaction_row.id
          AND entry.class_id = transaction_row.class_id
         WHERE transaction_row.class_id = ?
           AND transaction_row.status = 'posted'
           AND entry.account_id = 'finance:student:' || ? || ':wallet'
       ) AS last_entry_at
     FROM finance_accounts account
     WHERE account.class_id = ?
       AND account.student_id = ?
       AND account.account_type = 'student_wallet'`,
  ).bind(classId, studentId, classId, studentId).first<SummaryRow>();
}

async function classTransactions(
  classId: string,
  limit: number,
  includeDepositTransactions: boolean,
) {
  return database().prepare(
    `SELECT transaction_row.id, transaction_row.transaction_type,
            transaction_row.source_type,
            transaction_row.description, transaction_row.actor_type,
            transaction_row.actor_label, transaction_row.posted_at,
            transaction_row.reversal_of_transaction_id,
            EXISTS (
              SELECT 1 FROM finance_transactions reversal
              WHERE reversal.reversal_of_transaction_id = transaction_row.id
                AND reversal.status = 'posted'
            ) AS is_reversed,
            entry.amount, entry.balance_after, student.id AS student_id,
            student.student_number, student.official_name,
            account.status AS account_status
     FROM finance_transactions transaction_row
     JOIN finance_ledger_entries entry
       ON entry.transaction_id = transaction_row.id
      AND entry.class_id = transaction_row.class_id
     JOIN finance_accounts account
       ON account.id = entry.account_id
      AND account.class_id = entry.class_id
      AND account.account_type = 'student_wallet'
     JOIN students student
       ON student.id = account.student_id
      AND student.class_id = account.class_id
     WHERE transaction_row.class_id = ?
       AND transaction_row.status = 'posted'
       AND (? = 1 OR COALESCE(transaction_row.source_type, '')
         NOT IN ('deposit_contract', 'deposit_settlement', 'stock_trade'))
     ORDER BY transaction_row.posted_at DESC, transaction_row.id DESC, entry.id
     LIMIT ?`,
  ).bind(classId, includeDepositTransactions ? 1 : 0, limit).all<TransactionViewRow>();
}

async function studentTransactions(
  classId: string,
  studentId: string,
  limit: number,
) {
  return database().prepare(
    `SELECT transaction_row.id, transaction_row.transaction_type,
            transaction_row.source_type,
            transaction_row.description, transaction_row.actor_type,
            transaction_row.actor_label, transaction_row.posted_at,
            transaction_row.reversal_of_transaction_id,
            EXISTS (
              SELECT 1 FROM finance_transactions reversal
              WHERE reversal.reversal_of_transaction_id = transaction_row.id
                AND reversal.status = 'posted'
            ) AS is_reversed,
            entry.amount, entry.balance_after, student.id AS student_id,
            student.student_number, student.official_name,
            account.status AS account_status
     FROM finance_transactions transaction_row
     JOIN finance_ledger_entries entry
       ON entry.transaction_id = transaction_row.id
      AND entry.class_id = transaction_row.class_id
     JOIN finance_accounts account
       ON account.id = entry.account_id
      AND account.class_id = entry.class_id
      AND account.account_type = 'student_wallet'
     JOIN students student
       ON student.id = account.student_id
      AND student.class_id = account.class_id
     WHERE transaction_row.class_id = ?
       AND transaction_row.status = 'posted'
       AND account.student_id = ?
     ORDER BY transaction_row.posted_at DESC, transaction_row.id DESC
     LIMIT ?`,
  ).bind(classId, studentId, limit).all<TransactionViewRow>();
}

async function financeRequests(
  context: FinanceContext,
  limit: number,
) {
  const ownOnly = context.financeRole === "student";
  return database().prepare(
    `SELECT request_row.id, request_row.requester_student_id,
            request_row.request_type, request_row.amount, request_row.memo,
            request_row.student_number_snapshot,
            request_row.student_name_snapshot, request_row.revision,
            request_row.created_at, resolution.decision,
            resolution.actor_label, resolution.reason_code,
            resolution.reason_note, resolution.intervention_reason,
            resolution.posted_transaction_id, resolution.resolved_at,
            account.status AS wallet_status,
            CASE
              WHEN resolution.posted_transaction_id IS NULL THEN 0
              ELSE EXISTS (
                SELECT 1
                FROM finance_transactions reversal
                WHERE reversal.reversal_of_transaction_id =
                      resolution.posted_transaction_id
                  AND reversal.status = 'posted'
              )
            END AS is_corrected
     FROM finance_cash_requests request_row
     JOIN finance_accounts account
       ON account.id = request_row.wallet_account_id
      AND account.class_id = request_row.class_id
     LEFT JOIN finance_request_resolutions resolution
       ON resolution.request_id = request_row.id
      AND resolution.class_id = request_row.class_id
     WHERE request_row.class_id = ?
       AND (? = 0 OR request_row.requester_student_id = ?)
     ORDER BY
       CASE WHEN resolution.id IS NULL THEN 0 ELSE 1 END,
       request_row.created_at DESC,
       request_row.id DESC
     LIMIT ?`,
  ).bind(
    context.classroom.id,
    ownOnly ? 1 : 0,
    context.actor.id,
    limit,
  ).all<RequestViewRow>();
}

async function financeRequestSummary(context: FinanceContext) {
  const ownOnly = context.financeRole === "student";
  return database().prepare(
    `SELECT
       COUNT(*) AS pending_count,
       COALESCE(SUM(
         CASE WHEN request_row.request_type = 'withdrawal'
              THEN request_row.amount ELSE 0 END
       ), 0) AS pending_withdrawal_amount
     FROM finance_cash_requests request_row
     LEFT JOIN finance_request_resolutions resolution
       ON resolution.request_id = request_row.id
      AND resolution.class_id = request_row.class_id
     WHERE request_row.class_id = ?
       AND resolution.id IS NULL
       AND (? = 0 OR request_row.requester_student_id = ?)`,
  ).bind(
    context.classroom.id,
    ownOnly ? 1 : 0,
    context.actor.id,
  ).first<RequestSummaryRow>();
}

export async function financeOverviewForRequest(
  request: Request,
): Promise<FinanceOverview> {
  const context = await financeContextForRequest(request);
  const classScope = context.financeRole === "teacher"
    || context.financeRole === "banker";

  const [
    walletResult,
    transactionResult,
    summary,
    reconciliation,
    requestResult,
    requestSummary,
    settings,
    bankers,
  ] = await Promise.all([
    context.financeRole === "teacher"
      ? classWallets(context.classroom.id, true)
      : context.financeRole === "banker"
        ? classWallets(context.classroom.id, false)
        : studentWallet(context.classroom.id, context.actor.id),
    classScope
      ? classTransactions(
          context.classroom.id,
          context.financeRole === "teacher" ? 150 : 30,
          context.financeRole === "teacher",
        )
      : studentTransactions(context.classroom.id, context.actor.id, 15),
    context.financeRole === "teacher"
      ? classSummary(context.classroom.id, true)
      : context.financeRole === "banker"
        ? classSummary(context.classroom.id, false)
        : studentSummary(context.classroom.id, context.actor.id),
    context.financeRole === "teacher"
      ? financeReconciliation(context.classroom.id)
      : Promise.resolve(null),
    financeRequests(context, context.financeRole === "teacher" ? 150 : 50),
    financeRequestSummary(context),
    financeSettingsForClass(context.classroom.id),
    currentBankersForClass(context.classroom.id),
  ]);

  const wallets = walletResult && "results" in walletResult
    ? walletResult.results.map(serializeWallet)
    : walletResult ? [serializeWallet(walletResult)] : [];
  const ledgerAttention = reconciliation !== null
    && (
      reconciliation.mismatches.length > 0
      || reconciliation.pendingTransactionCount > 0
    );
  const ownWallet = wallets.find((wallet) => wallet.studentId === context.actor.id)
    ?? null;
  const pendingWithdrawalAmount = context.financeRole === "student"
    ? Number(requestSummary?.pending_withdrawal_amount ?? 0)
    : 0;
  return {
    context,
    finance: {
      phase: "settings_audit",
      mode: "operations",
      currencyLabel: settings.currencyUnit,
      scope: classScope ? "class" : "self",
      settings,
      bankers,
      summary: {
        walletCount: Number(summary?.wallet_count ?? 0),
        totalBalance: Number(summary?.total_balance ?? 0),
        lastEntryAt: summary?.last_entry_at === null || summary?.last_entry_at === undefined
          ? null
          : Number(summary.last_entry_at),
        ledgerIntegrity: reconciliation === null
          ? "not_checked"
          : reconciliation.mismatches.length === 0
              && reconciliation.pendingTransactionCount === 0
            ? "ok"
            : "attention",
      },
      wallets,
      requestSummary: {
        pendingCount: Number(requestSummary?.pending_count ?? 0),
        pendingWithdrawalAmount,
        availableBalance: context.financeRole === "student"
          ? Math.max(0, (ownWallet?.balance ?? 0) - pendingWithdrawalAmount)
          : null,
      },
      requests: requestResult.results.map(
        (row) => serializeRequest(row, context, settings),
      ),
      transactions: transactionResult.results.map(
        (row) => serializeTransaction(row, context, ledgerAttention),
      ),
    },
  };
}
