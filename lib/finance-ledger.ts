import { sha256 } from "./crypto";
import { database, ensureSchema } from "./database";
import { BANKER_JOB_TEMPLATE_ID } from "./finance-access-rules";
import { currentStudentJob } from "./finance-access";
import {
  FinanceRuleError,
  type FinancePostingActor,
  type FinanceTransactionInput,
  financeTransactionPayload,
  normalizeFinanceTransaction,
} from "./finance-ledger-rules";
import { ApiError } from "./responses";

type TransactionRow = {
  id: string;
  class_id: string;
  status: string;
  transaction_type: string;
  description: string;
  idempotency_key: string;
  payload_hash: string;
  source_type: string | null;
  source_id: string | null;
  reversal_of_transaction_id: string | null;
  actor_type: string;
  actor_teacher_id: string | null;
  actor_student_id: string | null;
  actor_job_period_id: string | null;
  actor_label: string;
  metadata_json: string | null;
  created_at: number;
  posted_at: number | null;
};

type LedgerEntryRow = {
  id: string;
  account_id: string;
  amount: number;
  balance_after: number;
  account_revision_after: number;
  memo: string | null;
  created_at: number;
};

type AccountRow = {
  id: string;
  class_id: string;
  status: string;
};

export type PostedFinanceTransaction = {
  id: string;
  classId: string;
  status: "posted";
  transactionType: string;
  description: string;
  sourceType: string | null;
  sourceId: string | null;
  reversalOfTransactionId: string | null;
  actor: {
    type: "teacher" | "banker" | "system";
    teacherId: string | null;
    studentId: string | null;
    bankerPeriodId: string | null;
    label: string;
  };
  metadata: unknown;
  createdAt: number;
  postedAt: number;
  entries: Array<{
    id: string;
    accountId: string;
    amount: number;
    balanceAfter: number;
    accountRevisionAfter: number;
    memo: string | null;
    createdAt: number;
  }>;
};

export function studentWalletAccountId(studentId: string) {
  return `finance:student:${studentId}:wallet`;
}

export function classIssuanceAccountId(classId: string) {
  return `finance:class:${classId}:issuance`;
}

function ruleError(error: unknown): never {
  if (error instanceof FinanceRuleError) {
    throw new ApiError(400, error.message, error.code);
  }
  throw error;
}

function parseMetadata(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export async function financeTransactionById(
  transactionId: string,
): Promise<PostedFinanceTransaction | null> {
  const db = database();
  const [transaction, entries] = await Promise.all([
    db.prepare(
      `SELECT id, class_id, status, transaction_type, description,
              idempotency_key, payload_hash, source_type, source_id,
              reversal_of_transaction_id, actor_type, actor_teacher_id,
              actor_student_id, actor_job_period_id, actor_label,
              metadata_json, created_at, posted_at
       FROM finance_transactions
       WHERE id = ? AND status = 'posted'
       LIMIT 1`,
    ).bind(transactionId).first<TransactionRow>(),
    db.prepare(
      `SELECT id, account_id, amount, balance_after, account_revision_after,
              memo, created_at
       FROM finance_ledger_entries
       WHERE transaction_id = ?
       ORDER BY id`,
    ).bind(transactionId).all<LedgerEntryRow>(),
  ]);
  if (!transaction || transaction.posted_at === null) return null;
  return {
    id: transaction.id,
    classId: transaction.class_id,
    status: "posted",
    transactionType: transaction.transaction_type,
    description: transaction.description,
    sourceType: transaction.source_type,
    sourceId: transaction.source_id,
    reversalOfTransactionId: transaction.reversal_of_transaction_id,
    actor: {
      type: transaction.actor_type as "teacher" | "banker" | "system",
      teacherId: transaction.actor_teacher_id,
      studentId: transaction.actor_student_id,
      bankerPeriodId: transaction.actor_job_period_id,
      label: transaction.actor_label,
    },
    metadata: parseMetadata(transaction.metadata_json),
    createdAt: Number(transaction.created_at),
    postedAt: Number(transaction.posted_at),
    entries: entries.results.map((entry) => ({
      id: entry.id,
      accountId: entry.account_id,
      amount: Number(entry.amount),
      balanceAfter: Number(entry.balance_after),
      accountRevisionAfter: Number(entry.account_revision_after),
      memo: entry.memo,
      createdAt: Number(entry.created_at),
    })),
  };
}

async function matchingTransaction(input: {
  classId: string;
  idempotencyKey: string;
  sourceType: string | null;
  sourceId: string | null;
}) {
  if (input.sourceType && input.sourceId) {
    return database().prepare(
      `SELECT id, status, payload_hash
       FROM finance_transactions
       WHERE class_id = ?
         AND (
           idempotency_key = ?
           OR (source_type = ? AND source_id = ?)
         )
       ORDER BY CASE WHEN idempotency_key = ? THEN 0 ELSE 1 END
       LIMIT 1`,
    ).bind(
      input.classId,
      input.idempotencyKey,
      input.sourceType,
      input.sourceId,
      input.idempotencyKey,
    ).first<{ id: string; status: string; payload_hash: string }>();
  }
  return database().prepare(
    `SELECT id, status, payload_hash
     FROM finance_transactions
     WHERE class_id = ? AND idempotency_key = ?
     LIMIT 1`,
  ).bind(
    input.classId,
    input.idempotencyKey,
  ).first<{ id: string; status: string; payload_hash: string }>();
}

async function existingResult(
  input: {
    classId: string;
    idempotencyKey: string;
    sourceType: string | null;
    sourceId: string | null;
  },
  payloadHash: string,
) {
  const existing = await matchingTransaction(input);
  if (!existing) return null;
  if (existing.payload_hash !== payloadHash) {
    throw new ApiError(
      409,
      "같은 요청 번호가 다른 거래 내용에 사용되었습니다.",
      "FINANCE_IDEMPOTENCY_CONFLICT",
    );
  }
  if (existing.status !== "posted") {
    throw new ApiError(
      409,
      "같은 금융 거래를 처리하고 있습니다. 잠시 뒤 다시 확인해 주세요.",
      "FINANCE_TRANSACTION_PENDING",
    );
  }
  const transaction = await financeTransactionById(existing.id);
  if (!transaction) {
    throw new ApiError(
      409,
      "기존 금융 거래를 확인하지 못했습니다.",
      "FINANCE_TRANSACTION_UNAVAILABLE",
    );
  }
  return {
    transaction,
    deduplicated: true,
  };
}

async function verifyPostingActor(
  classId: string,
  actor: ReturnType<typeof normalizeFinanceTransaction>["actor"],
) {
  if (actor.type === "system") return;
  if (actor.type === "teacher") {
    const classroom = await database().prepare(
      `SELECT id
       FROM classes
       WHERE id = ? AND teacher_id = ? AND status = 'active'
       LIMIT 1`,
    ).bind(classId, actor.teacherId).first();
    if (!classroom) {
      throw new ApiError(
        403,
        "이 학급의 금융 거래를 처리할 수 없습니다.",
        "FINANCE_CLASS_ACCESS_DENIED",
      );
    }
    return;
  }

  if (!actor.studentId || !actor.bankerPeriodId) {
    throw new ApiError(
      403,
      "은행원 처리자 정보를 확인할 수 없습니다.",
      "FINANCE_BANKER_ACCESS_DENIED",
    );
  }
  const activeJob = await currentStudentJob(classId, actor.studentId);
  if (
    !activeJob
    || activeJob.templateId !== BANKER_JOB_TEMPLATE_ID
    || activeJob.periodId !== actor.bankerPeriodId
  ) {
    throw new ApiError(
      403,
      "현재 은행원 직업을 맡은 학생만 이 거래를 처리할 수 있습니다.",
      "FINANCE_BANKER_ACCESS_DENIED",
    );
  }
  throw new ApiError(
    403,
    "은행원 거래 처리는 입출금 신청·승인 단계를 연 뒤 사용할 수 있습니다.",
    "FINANCE_BANKER_WRITES_NOT_ENABLED",
  );
}

async function verifyAccounts(classId: string, accountIds: string[]) {
  const placeholders = accountIds.map(() => "?").join(", ");
  const rows = await database().prepare(
    `SELECT id, class_id, status
     FROM finance_accounts
     WHERE class_id = ? AND id IN (${placeholders})`,
  ).bind(classId, ...accountIds).all<AccountRow>();
  if (rows.results.length !== accountIds.length) {
    throw new ApiError(
      409,
      "거래에 사용할 지갑 정보를 찾지 못했습니다.",
      "FINANCE_ACCOUNT_NOT_FOUND",
    );
  }
  if (rows.results.some((account) => account.status !== "active")) {
    throw new ApiError(
      409,
      "현재 사용할 수 없는 지갑이 포함되어 있습니다.",
      "FINANCE_ACCOUNT_NOT_ACTIVE",
    );
  }
}

function mapDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const mappings: Array<[string, number, string, string]> = [
    [
      "FINANCE_INSUFFICIENT_FUNDS",
      409,
      "잔액이 부족하여 거래를 처리하지 않았습니다.",
      "FINANCE_INSUFFICIENT_FUNDS",
    ],
    [
      "FINANCE_ACCOUNT_NOT_ACTIVE",
      409,
      "현재 사용할 수 없는 지갑입니다.",
      "FINANCE_ACCOUNT_NOT_ACTIVE",
    ],
    [
      "FINANCE_ACCOUNT_STALE",
      409,
      "다른 거래가 먼저 반영되었습니다. 최신 잔액으로 다시 시도해 주세요.",
      "FINANCE_ACCOUNT_STALE",
    ],
    [
      "FINANCE_REVERSAL_MISMATCH",
      409,
      "원래 거래와 정확히 반대되는 정정 거래가 아닙니다.",
      "FINANCE_REVERSAL_MISMATCH",
    ],
    [
      "FINANCE_TRANSACTION_UNBALANCED",
      409,
      "금융 원장의 증감 합계가 맞지 않아 거래를 취소했습니다.",
      "FINANCE_TRANSACTION_UNBALANCED",
    ],
    [
      "FINANCE_TRANSACTION_NEEDS_TWO_ENTRIES",
      409,
      "거래의 양쪽 기록이 모두 준비되지 않아 거래를 취소했습니다.",
      "FINANCE_TRANSACTION_NEEDS_TWO_ENTRIES",
    ],
    [
      "FINANCE_ACCOUNT_LEDGER_MISMATCH",
      409,
      "잔액과 거래 기록이 일치하지 않아 거래를 중단했습니다.",
      "FINANCE_ACCOUNT_LEDGER_MISMATCH",
    ],
    [
      "FINANCE_CLASS_NOT_ACTIVE",
      409,
      "현재 운영 중인 학급에서만 새 거래를 만들 수 있습니다.",
      "FINANCE_CLASS_NOT_ACTIVE",
    ],
    [
      "FINANCE_CLASS_ACCESS_DENIED",
      403,
      "이 학급의 금융 거래를 처리할 권한이 없습니다.",
      "FINANCE_CLASS_ACCESS_DENIED",
    ],
    [
      "FINANCE_BANKER_ACCESS_DENIED",
      403,
      "현재 은행원 직업을 맡은 학생만 은행 업무를 처리할 수 있습니다.",
      "FINANCE_BANKER_ACCESS_DENIED",
    ],
    [
      "FINANCE_BANKER_WRITES_NOT_ENABLED",
      403,
      "은행원 거래 처리는 입출금 신청·승인 단계를 연 뒤 사용할 수 있습니다.",
      "FINANCE_BANKER_WRITES_NOT_ENABLED",
    ],
  ];
  for (const [needle, status, userMessage, code] of mappings) {
    if (message.includes(needle)) throw new ApiError(status, userMessage, code);
  }
  throw error;
}

export async function postFinanceTransaction(input: FinanceTransactionInput) {
  let normalized: ReturnType<typeof normalizeFinanceTransaction>;
  try {
    normalized = normalizeFinanceTransaction(input);
  } catch (error) {
    ruleError(error);
  }

  await ensureSchema();
  const payloadHash = await sha256(financeTransactionPayload(normalized));
  await verifyPostingActor(normalized.classId, normalized.actor);
  const duplicate = await existingResult(normalized, payloadHash);
  if (duplicate) return duplicate;

  await verifyAccounts(
    normalized.classId,
    normalized.lines.map((line) => line.accountId),
  );

  const transactionId = crypto.randomUUID();
  const now = Date.now();
  const db = database();
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO finance_transactions (
         id, class_id, status, transaction_type, description,
         idempotency_key, payload_hash, source_type, source_id,
         reversal_of_transaction_id, actor_type, actor_teacher_id,
         actor_student_id, actor_job_period_id, actor_label, metadata_json,
         created_at, posted_at
       ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(
      transactionId,
      normalized.classId,
      normalized.transactionType,
      normalized.description,
      normalized.idempotencyKey,
      payloadHash,
      normalized.sourceType,
      normalized.sourceId,
      normalized.reversalOfTransactionId,
      normalized.actor.type,
      normalized.actor.teacherId,
      normalized.actor.studentId,
      normalized.actor.bankerPeriodId,
      normalized.actor.label,
      normalized.metadataJson,
      now,
    ),
  ];

  for (const line of normalized.lines) {
    statements.push(
      db.prepare(
        `INSERT INTO finance_ledger_entries (
           id, transaction_id, class_id, account_id, amount, balance_after,
           account_revision_after, memo, created_at
         )
         SELECT ?, ?, ?, account.id, ?, account.balance + ?,
                account.revision + 1, ?, ?
         FROM finance_accounts account
         WHERE account.id = ? AND account.class_id = ?`,
      ).bind(
        crypto.randomUUID(),
        transactionId,
        normalized.classId,
        line.amount,
        line.amount,
        line.memo,
        now,
        line.accountId,
        normalized.classId,
      ),
    );
  }

  statements.push(
    db.prepare(
      `UPDATE finance_transactions
       SET status = 'posted', posted_at = ?
       WHERE id = ? AND status = 'pending'`,
    ).bind(now, transactionId),
  );

  try {
    await db.batch(statements);
  } catch (error) {
    const concurrentDuplicate = await existingResult(normalized, payloadHash);
    if (concurrentDuplicate) return concurrentDuplicate;
    mapDatabaseError(error);
  }

  const transaction = await financeTransactionById(transactionId);
  if (!transaction) {
    throw new ApiError(
      500,
      "거래 저장 후 원장을 다시 확인하지 못했습니다.",
      "FINANCE_TRANSACTION_UNAVAILABLE",
    );
  }
  return {
    transaction,
    deduplicated: false,
  };
}

export async function reverseFinanceTransaction(input: {
  classId: string;
  originalTransactionId: string;
  idempotencyKey: string;
  description: string;
  actor: FinancePostingActor;
}) {
  await ensureSchema();
  const original = await financeTransactionById(input.originalTransactionId);
  if (!original || original.classId !== input.classId) {
    throw new ApiError(
      404,
      "정정할 원래 거래를 찾을 수 없습니다.",
      "FINANCE_TRANSACTION_NOT_FOUND",
    );
  }
  if (original.transactionType === "reversal") {
    throw new ApiError(
      409,
      "정정 거래를 다시 정정할 수 없습니다.",
      "FINANCE_REVERSAL_OF_REVERSAL",
    );
  }
  if (
    original.sourceType === "deposit_contract"
    || original.sourceType === "deposit_settlement"
  ) {
    throw new ApiError(
      409,
      "예금 거래는 계약 기록과 함께 움직여서 일반 거래 정정으로 바꿀 수 없습니다.",
      "FINANCE_DEPOSIT_REVERSAL_REQUIRES_CONTRACT",
    );
  }
  if (original.sourceType === "stock_trade") {
    throw new ApiError(
      409,
      "주식 거래는 보유 수량과 함께 움직여서 일반 거래 정정으로 바꿀 수 없습니다.",
      "FINANCE_STOCK_REVERSAL_REQUIRES_TRADE",
    );
  }

  return postFinanceTransaction({
    classId: input.classId,
    idempotencyKey: input.idempotencyKey,
    transactionType: "reversal",
    description: input.description,
    actor: input.actor,
    sourceType: "reversal",
    sourceId: original.id,
    reversalOfTransactionId: original.id,
    lines: original.entries.map((entry) => ({
      accountId: entry.accountId,
      amount: -entry.amount,
      memo: `정정: ${original.description}`,
    })),
    metadata: {
      originalTransactionId: original.id,
    },
  });
}

export async function financeReconciliation(classId: string) {
  await ensureSchema();
  const db = database();
  const [rows, pending] = await Promise.all([
    db.prepare(
    `SELECT account.id, account.account_type, account.student_id,
            account.balance AS stored_balance,
            account.revision AS stored_revision,
            COALESCE(ledger.ledger_balance, 0) AS ledger_balance,
            COALESCE(ledger.ledger_revision, 0) AS ledger_revision
     FROM finance_accounts account
     LEFT JOIN (
       SELECT entry.account_id,
              SUM(entry.amount) AS ledger_balance,
              COUNT(*) AS ledger_revision
       FROM finance_ledger_entries entry
       JOIN finance_transactions transaction_row
         ON transaction_row.id = entry.transaction_id
        AND transaction_row.class_id = entry.class_id
        AND transaction_row.status = 'posted'
       GROUP BY entry.account_id
     ) ledger ON ledger.account_id = account.id
     WHERE account.class_id = ?
       AND (
         account.balance <> COALESCE(ledger.ledger_balance, 0)
         OR account.revision <> COALESCE(ledger.ledger_revision, 0)
       )
     ORDER BY account.id`,
    ).bind(classId).all<{
      id: string;
      account_type: string;
      student_id: string | null;
      stored_balance: number;
      stored_revision: number;
      ledger_balance: number;
      ledger_revision: number;
    }>(),
    db.prepare(
      `SELECT COUNT(*) AS count
       FROM finance_transactions
       WHERE class_id = ? AND status = 'pending'`,
    ).bind(classId).first<{ count: number }>(),
  ]);
  return {
    mismatches: rows.results.map((row) => ({
      accountId: row.id,
      accountType: row.account_type,
      studentId: row.student_id,
      storedBalance: Number(row.stored_balance),
      storedRevision: Number(row.stored_revision),
      ledgerBalance: Number(row.ledger_balance),
      ledgerRevision: Number(row.ledger_revision),
    })),
    pendingTransactionCount: Number(pending?.count ?? 0),
  };
}
