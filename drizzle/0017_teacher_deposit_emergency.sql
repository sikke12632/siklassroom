DROP TRIGGER IF EXISTS `finance_deposit_settlements_insert_guard`;
--> statement-breakpoint
CREATE TRIGGER `finance_deposit_settlements_insert_guard`
BEFORE INSERT ON `finance_deposit_settlements`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM finance_deposit_contracts contract
    WHERE contract.id = NEW.contract_id AND contract.class_id = NEW.class_id
      AND contract.student_id = NEW.student_id
      AND NOT EXISTS (
        SELECT 1 FROM finance_deposit_settlements prior
        WHERE prior.contract_id = contract.id
      )
      AND ((NEW.settlement_type = 'maturity'
            AND NEW.settled_at >= contract.matures_at
            AND NEW.principal = contract.principal
            AND NEW.interest = contract.maturity_interest
            AND NEW.payout = contract.maturity_payout)
        OR (NEW.settlement_type = 'early_termination'
            AND NEW.settled_at < contract.matures_at
            AND NEW.principal = contract.principal
            AND NEW.interest = contract.early_interest
            AND NEW.payout = contract.early_payout))
  ) THEN RAISE(ABORT, 'FINANCE_DEPOSIT_SETTLEMENT_STALE') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM finance_transactions transaction_row
    JOIN finance_deposit_contracts contract
      ON contract.id = NEW.contract_id AND contract.class_id = NEW.class_id
    WHERE transaction_row.id = NEW.posted_transaction_id
      AND transaction_row.class_id = NEW.class_id
      AND transaction_row.status = 'posted'
      AND transaction_row.transaction_type = CASE NEW.settlement_type
        WHEN 'maturity' THEN 'deposit_maturity'
        ELSE 'deposit_early_termination' END
      AND transaction_row.source_type = 'deposit_settlement'
      AND transaction_row.source_id = NEW.contract_id
      AND (
        transaction_row.actor_type = 'system'
        OR (
          transaction_row.actor_type = 'teacher'
          AND transaction_row.actor_teacher_id IS NOT NULL
          AND transaction_row.actor_student_id IS NULL
          AND transaction_row.actor_job_period_id IS NULL
          AND EXISTS (
            SELECT 1 FROM classes classroom
            WHERE classroom.id = NEW.class_id
              AND classroom.teacher_id = transaction_row.actor_teacher_id
              AND classroom.status = 'active'
          )
          AND json_valid(transaction_row.metadata_json) = 1
          AND json_extract(transaction_row.metadata_json, '$.isEmergency') = 1
          AND json_extract(transaction_row.metadata_json, '$.contractId') = NEW.contract_id
          AND json_extract(transaction_row.metadata_json, '$.studentId') = NEW.student_id
          AND json_extract(transaction_row.metadata_json, '$.settlementType') = NEW.settlement_type
          AND CAST(json_extract(transaction_row.metadata_json, '$.principal') AS INTEGER) = NEW.principal
          AND CAST(json_extract(transaction_row.metadata_json, '$.interest') AS INTEGER) = NEW.interest
          AND CAST(json_extract(transaction_row.metadata_json, '$.payout') AS INTEGER) = NEW.payout
          AND CAST(json_extract(transaction_row.metadata_json, '$.expectedSettlementRevision') AS INTEGER) = 0
          AND json_extract(transaction_row.metadata_json, '$.settlementPolicy') = 'contract_terms_at_settlement'
          AND json_extract(transaction_row.metadata_json, '$.origin') IN (
            'finance_center', 'student_exclusion', 'class_archive'
          )
          AND json_type(transaction_row.metadata_json, '$.interventionReason') = 'text'
          AND LENGTH(TRIM(CAST(json_extract(
            transaction_row.metadata_json, '$.interventionReason'
          ) AS TEXT))) BETWEEN 2 AND 300
        )
      )
      AND transaction_row.payload_hash = NEW.transaction_payload_hash
      AND (SELECT COUNT(*) FROM finance_ledger_entries entry
           WHERE entry.transaction_id = transaction_row.id) = 2
      AND EXISTS (
        SELECT 1 FROM finance_ledger_entries entry
        WHERE entry.transaction_id = transaction_row.id
          AND entry.account_id = contract.wallet_account_id
          AND entry.amount = NEW.payout
      )
      AND EXISTS (
        SELECT 1 FROM finance_ledger_entries entry
        JOIN finance_accounts issuance ON issuance.id = entry.account_id
          AND issuance.class_id = entry.class_id
          AND issuance.account_type = 'class_issuance'
        WHERE entry.transaction_id = transaction_row.id
          AND entry.amount = -NEW.payout
      )
  ) THEN RAISE(ABORT, 'FINANCE_DEPOSIT_LEDGER_MISMATCH') END;
END;
