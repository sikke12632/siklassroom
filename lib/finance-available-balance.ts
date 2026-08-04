type PendingWithdrawalRow = {
  pending_withdrawal_amount: number | null;
};

export type FinanceWalletAvailability = {
  balance: number;
  pendingWithdrawalAmount: number;
  availableBalance: number;
};

export function calculateFinanceWalletAvailability(
  balance: number,
  pendingWithdrawalAmount: number,
): FinanceWalletAvailability {
  const normalizedBalance = Number.isFinite(balance) ? Math.trunc(balance) : 0;
  const normalizedPending = Number.isFinite(pendingWithdrawalAmount)
    ? Math.max(0, Math.trunc(pendingWithdrawalAmount))
    : 0;
  return {
    balance: normalizedBalance,
    pendingWithdrawalAmount: normalizedPending,
    availableBalance: Math.max(0, normalizedBalance - normalizedPending),
  };
}

export async function financeWalletAvailability(
  db: D1Database,
  input: {
    classId: string;
    walletAccountId: string;
    balance: number;
  },
): Promise<FinanceWalletAvailability> {
  const row = await db.prepare(
    `SELECT COALESCE(SUM(request_row.amount), 0) AS pending_withdrawal_amount
     FROM finance_cash_requests request_row
     WHERE request_row.class_id = ?
       AND request_row.wallet_account_id = ?
       AND request_row.request_type = 'withdrawal'
       AND NOT EXISTS (
         SELECT 1
         FROM finance_request_resolutions resolution
         WHERE resolution.request_id = request_row.id
           AND resolution.class_id = request_row.class_id
       )`,
  ).bind(input.classId, input.walletAccountId).first<PendingWithdrawalRow>();

  return calculateFinanceWalletAvailability(
    input.balance,
    Number(row?.pending_withdrawal_amount ?? 0),
  );
}
