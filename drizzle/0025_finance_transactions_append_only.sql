DROP TRIGGER `finance_transactions_posted_delete_guard`;--> statement-breakpoint
CREATE TRIGGER `finance_transactions_posted_delete_guard`
BEFORE DELETE ON `finance_transactions`
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_TRANSACTION_IMMUTABLE');
END;
