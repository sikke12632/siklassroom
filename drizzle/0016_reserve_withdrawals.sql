CREATE INDEX IF NOT EXISTS `finance_cash_requests_wallet_pending_idx`
ON `finance_cash_requests` (`class_id`,`wallet_account_id`,`request_type`,`created_at`);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_transactions_pending_withdrawal_guard`
BEFORE UPDATE OF status ON finance_transactions
WHEN OLD.status = 'pending' AND NEW.status = 'posted'
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM finance_ledger_entries entry
      JOIN finance_accounts account
        ON account.id = entry.account_id
       AND account.class_id = entry.class_id
      WHERE entry.transaction_id = NEW.id
        AND entry.amount < 0
        AND entry.balance_after >= 0
        AND account.account_type = 'student_wallet'
        AND entry.balance_after < COALESCE((
          SELECT SUM(request_row.amount)
          FROM finance_cash_requests request_row
          WHERE request_row.class_id = entry.class_id
            AND request_row.wallet_account_id = entry.account_id
            AND request_row.request_type = 'withdrawal'
            AND NOT EXISTS (
              SELECT 1
              FROM finance_request_resolutions resolution
              WHERE resolution.request_id = request_row.id
                AND resolution.class_id = request_row.class_id
            )
        ), 0)
    )
    THEN RAISE(ABORT, 'FINANCE_INSUFFICIENT_AVAILABLE_BALANCE')
  END;
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_ledger_entries_pending_withdrawal_guard`
BEFORE INSERT ON finance_ledger_entries
WHEN NEW.amount < 0
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM finance_accounts account
      WHERE account.id = NEW.account_id
        AND account.class_id = NEW.class_id
        AND account.account_type = 'student_wallet'
        AND NEW.balance_after >= 0
        AND NEW.balance_after < COALESCE((
          SELECT SUM(request_row.amount)
          FROM finance_cash_requests request_row
          WHERE request_row.class_id = NEW.class_id
            AND request_row.wallet_account_id = NEW.account_id
            AND request_row.request_type = 'withdrawal'
            AND NOT EXISTS (
              SELECT 1
              FROM finance_request_resolutions resolution
              WHERE resolution.request_id = request_row.id
                AND resolution.class_id = request_row.class_id
            )
        ), 0)
    )
    THEN RAISE(ABORT, 'FINANCE_INSUFFICIENT_AVAILABLE_BALANCE')
  END;
END;
