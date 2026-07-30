import { database } from "./database";
import {
  type FinanceContext,
  financeContextForRequest,
} from "./finance-access";
import { financeReconciliation } from "./finance-ledger";

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
};

export type FinanceOverview = {
  context: FinanceContext;
  finance: {
    phase: "wallet_ledger";
    mode: "read_only";
    currencyLabel: "학급화폐";
    scope: "class" | "self";
    summary: {
      walletCount: number;
      totalBalance: number;
      lastEntryAt: number | null;
      ledgerIntegrity: "ok" | "attention" | "not_checked";
    };
    wallets: FinanceWalletView[];
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

function serializeTransaction(row: TransactionViewRow): FinanceTransactionView {
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

async function classTransactions(classId: string, limit: number) {
  return database().prepare(
    `SELECT transaction_row.id, transaction_row.transaction_type,
            transaction_row.description, transaction_row.actor_type,
            transaction_row.actor_label, transaction_row.posted_at,
            transaction_row.reversal_of_transaction_id,
            EXISTS (
              SELECT 1 FROM finance_transactions reversal
              WHERE reversal.reversal_of_transaction_id = transaction_row.id
                AND reversal.status = 'posted'
            ) AS is_reversed,
            entry.amount, entry.balance_after, student.id AS student_id,
            student.student_number, student.official_name
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
     ORDER BY transaction_row.posted_at DESC, transaction_row.id DESC, entry.id
     LIMIT ?`,
  ).bind(classId, limit).all<TransactionViewRow>();
}

async function studentTransactions(
  classId: string,
  studentId: string,
  limit: number,
) {
  return database().prepare(
    `SELECT transaction_row.id, transaction_row.transaction_type,
            transaction_row.description, transaction_row.actor_type,
            transaction_row.actor_label, transaction_row.posted_at,
            transaction_row.reversal_of_transaction_id,
            EXISTS (
              SELECT 1 FROM finance_transactions reversal
              WHERE reversal.reversal_of_transaction_id = transaction_row.id
                AND reversal.status = 'posted'
            ) AS is_reversed,
            entry.amount, entry.balance_after, student.id AS student_id,
            student.student_number, student.official_name
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

export async function financeOverviewForRequest(
  request: Request,
): Promise<FinanceOverview> {
  const context = await financeContextForRequest(request);
  const classScope = context.financeRole === "teacher"
    || context.financeRole === "banker";

  const [walletResult, transactionResult, summary, reconciliation] = await Promise.all([
    context.financeRole === "teacher"
      ? classWallets(context.classroom.id, true)
      : context.financeRole === "banker"
        ? classWallets(context.classroom.id, false)
        : studentWallet(context.classroom.id, context.actor.id),
    classScope
      ? classTransactions(context.classroom.id, 30)
      : studentTransactions(context.classroom.id, context.actor.id, 15),
    context.financeRole === "teacher"
      ? classSummary(context.classroom.id, true)
      : context.financeRole === "banker"
        ? classSummary(context.classroom.id, false)
        : studentSummary(context.classroom.id, context.actor.id),
    context.financeRole === "teacher"
      ? financeReconciliation(context.classroom.id)
      : Promise.resolve(null),
  ]);

  const wallets = walletResult && "results" in walletResult
    ? walletResult.results.map(serializeWallet)
    : walletResult ? [serializeWallet(walletResult)] : [];
  return {
    context,
    finance: {
      phase: "wallet_ledger",
      mode: "read_only",
      currencyLabel: "학급화폐",
      scope: classScope ? "class" : "self",
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
      transactions: transactionResult.results.map(serializeTransaction),
    },
  };
}
