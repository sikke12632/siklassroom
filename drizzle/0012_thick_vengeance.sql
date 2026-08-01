CREATE TABLE `finance_deposit_contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`product_id` text NOT NULL,
	`product_revision` integer NOT NULL,
	`student_id` text NOT NULL,
	`wallet_account_id` text NOT NULL,
	`principal` integer NOT NULL,
	`product_name_snapshot` text NOT NULL,
	`term_weeks_snapshot` integer NOT NULL,
	`maturity_interest_bps_snapshot` integer NOT NULL,
	`early_interest_bps_snapshot` integer NOT NULL,
	`maturity_interest` integer NOT NULL,
	`early_interest` integer NOT NULL,
	`maturity_payout` integer NOT NULL,
	`early_payout` integer NOT NULL,
	`opened_at` integer NOT NULL,
	`matures_at` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`posted_transaction_id` text NOT NULL,
	`transaction_payload_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`,`class_id`) REFERENCES `finance_deposit_products`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`wallet_account_id`,`class_id`) REFERENCES `finance_accounts`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`posted_transaction_id`,`class_id`) REFERENCES `finance_transactions`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_deposit_contracts_amount_ck" CHECK("finance_deposit_contracts"."principal" BETWEEN 1 AND 1000000000
      AND "finance_deposit_contracts"."maturity_interest" BETWEEN 0 AND 1000000000
      AND "finance_deposit_contracts"."early_interest" BETWEEN 0 AND "finance_deposit_contracts"."maturity_interest"
      AND "finance_deposit_contracts"."maturity_payout" = "finance_deposit_contracts"."principal" + "finance_deposit_contracts"."maturity_interest"
      AND "finance_deposit_contracts"."early_payout" = "finance_deposit_contracts"."principal" + "finance_deposit_contracts"."early_interest"
      AND "finance_deposit_contracts"."maturity_payout" <= 1000000000),
	CONSTRAINT "finance_deposit_contracts_terms_ck" CHECK("finance_deposit_contracts"."product_revision" >= 0
      AND "finance_deposit_contracts"."term_weeks_snapshot" BETWEEN 1 AND 52
      AND "finance_deposit_contracts"."maturity_interest_bps_snapshot" BETWEEN 0 AND 10000
      AND "finance_deposit_contracts"."early_interest_bps_snapshot" BETWEEN 0 AND 10000
      AND "finance_deposit_contracts"."matures_at" > "finance_deposit_contracts"."opened_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_deposit_contracts_id_class_uq` ON `finance_deposit_contracts` (`id`,`class_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_deposit_contracts_class_student_idempotency_uq` ON `finance_deposit_contracts` (`class_id`,`student_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_deposit_contracts_posted_transaction_uq` ON `finance_deposit_contracts` (`posted_transaction_id`);--> statement-breakpoint
CREATE INDEX `finance_deposit_contracts_student_created_idx` ON `finance_deposit_contracts` (`student_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `finance_deposit_contracts_class_maturity_idx` ON `finance_deposit_contracts` (`class_id`,`matures_at`);--> statement-breakpoint
CREATE TABLE `finance_deposit_product_events` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`product_id` text NOT NULL,
	`revision` integer NOT NULL,
	`action` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`product_snapshot_json` text NOT NULL,
	`actor_teacher_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`,`class_id`) REFERENCES `finance_deposit_products`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_deposit_product_events_action_ck" CHECK("finance_deposit_product_events"."action" IN ('issued', 'opened', 'paused')),
	CONSTRAINT "finance_deposit_product_events_revision_ck" CHECK("finance_deposit_product_events"."revision" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_deposit_product_events_product_revision_uq` ON `finance_deposit_product_events` (`product_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_deposit_product_events_class_idempotency_uq` ON `finance_deposit_product_events` (`class_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `finance_deposit_product_events_class_created_idx` ON `finance_deposit_product_events` (`class_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `finance_deposit_products` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`term_weeks` integer NOT NULL,
	`maturity_interest_bps` integer NOT NULL,
	`early_interest_bps` integer DEFAULT 0 NOT NULL,
	`min_amount` integer NOT NULL,
	`max_amount` integer NOT NULL,
	`is_open` integer DEFAULT true NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_by_teacher_id` text NOT NULL,
	`updated_by_teacher_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_deposit_products_text_ck" CHECK(LENGTH(TRIM("finance_deposit_products"."name")) BETWEEN 1 AND 40
      AND LENGTH("finance_deposit_products"."description") <= 200),
	CONSTRAINT "finance_deposit_products_term_ck" CHECK("finance_deposit_products"."term_weeks" BETWEEN 1 AND 52),
	CONSTRAINT "finance_deposit_products_rate_ck" CHECK("finance_deposit_products"."maturity_interest_bps" BETWEEN 0 AND 10000
      AND "finance_deposit_products"."early_interest_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "finance_deposit_products_amount_ck" CHECK("finance_deposit_products"."min_amount" BETWEEN 1 AND 1000000000
      AND "finance_deposit_products"."max_amount" BETWEEN "finance_deposit_products"."min_amount" AND 1000000000),
	CONSTRAINT "finance_deposit_products_open_ck" CHECK("finance_deposit_products"."is_open" IN (0, 1)),
	CONSTRAINT "finance_deposit_products_revision_ck" CHECK("finance_deposit_products"."revision" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_deposit_products_id_class_uq` ON `finance_deposit_products` (`id`,`class_id`);--> statement-breakpoint
CREATE INDEX `finance_deposit_products_class_open_idx` ON `finance_deposit_products` (`class_id`,`is_open`,`created_at`);--> statement-breakpoint
CREATE TABLE `finance_deposit_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`student_id` text NOT NULL,
	`settlement_type` text NOT NULL,
	`principal` integer NOT NULL,
	`interest` integer NOT NULL,
	`payout` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`posted_transaction_id` text NOT NULL,
	`transaction_payload_hash` text NOT NULL,
	`settled_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contract_id`,`class_id`) REFERENCES `finance_deposit_contracts`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`posted_transaction_id`,`class_id`) REFERENCES `finance_transactions`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_deposit_settlements_type_ck" CHECK("finance_deposit_settlements"."settlement_type" IN ('early_termination', 'maturity')),
	CONSTRAINT "finance_deposit_settlements_amount_ck" CHECK("finance_deposit_settlements"."principal" BETWEEN 1 AND 1000000000
      AND "finance_deposit_settlements"."interest" BETWEEN 0 AND 1000000000
      AND "finance_deposit_settlements"."payout" = "finance_deposit_settlements"."principal" + "finance_deposit_settlements"."interest"
      AND "finance_deposit_settlements"."payout" <= 1000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_deposit_settlements_contract_uq` ON `finance_deposit_settlements` (`contract_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_deposit_settlements_class_student_idempotency_uq` ON `finance_deposit_settlements` (`class_id`,`student_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_deposit_settlements_posted_transaction_uq` ON `finance_deposit_settlements` (`posted_transaction_id`);--> statement-breakpoint
CREATE INDEX `finance_deposit_settlements_class_created_idx` ON `finance_deposit_settlements` (`class_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `finance_deposit_products_insert_guard`
BEFORE INSERT ON `finance_deposit_products`
BEGIN
  SELECT CASE WHEN NEW.revision <> 0 OR NEW.is_open <> 1
    THEN RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_INVALID_INITIAL_STATE') END;
  SELECT CASE WHEN NEW.created_by_teacher_id <> NEW.updated_by_teacher_id
    OR NOT EXISTS (
      SELECT 1 FROM classes classroom
      WHERE classroom.id = NEW.class_id
        AND classroom.teacher_id = NEW.created_by_teacher_id
        AND classroom.status = 'active'
    )
    THEN RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_ACCESS_DENIED') END;
END;
--> statement-breakpoint
CREATE TRIGGER `finance_deposit_products_update_guard`
BEFORE UPDATE ON `finance_deposit_products`
BEGIN
  SELECT CASE WHEN NEW.id <> OLD.id OR NEW.class_id <> OLD.class_id
    OR NEW.name <> OLD.name OR NEW.description <> OLD.description
    OR NEW.term_weeks <> OLD.term_weeks
    OR NEW.maturity_interest_bps <> OLD.maturity_interest_bps
    OR NEW.early_interest_bps <> OLD.early_interest_bps
    OR NEW.min_amount <> OLD.min_amount OR NEW.max_amount <> OLD.max_amount
    OR NEW.created_by_teacher_id <> OLD.created_by_teacher_id
    OR NEW.created_at <> OLD.created_at
    THEN RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_TERMS_IMMUTABLE') END;
  SELECT CASE WHEN NEW.revision <> OLD.revision + 1
    THEN RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_STALE') END;
  SELECT CASE WHEN NEW.is_open = OLD.is_open
    THEN RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_STATE_UNCHANGED') END;
  SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM classes classroom
      WHERE classroom.id = NEW.class_id
        AND classroom.teacher_id = NEW.updated_by_teacher_id
        AND classroom.status = 'active'
    )
    THEN RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_ACCESS_DENIED') END;
END;
--> statement-breakpoint
CREATE TRIGGER `finance_deposit_products_delete_guard`
BEFORE DELETE ON `finance_deposit_products`
BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `finance_deposit_product_events_insert_guard`
BEFORE INSERT ON `finance_deposit_product_events`
BEGIN
  SELECT CASE WHEN json_valid(NEW.product_snapshot_json) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM finance_deposit_products product
      JOIN classes classroom ON classroom.id = product.class_id
      WHERE product.id = NEW.product_id AND product.class_id = NEW.class_id
        AND product.revision = NEW.revision
        AND product.updated_by_teacher_id = NEW.actor_teacher_id
        AND classroom.teacher_id = NEW.actor_teacher_id
        AND ((NEW.action = 'issued' AND NEW.revision = 0)
          OR (NEW.action = 'opened' AND NEW.revision > 0 AND product.is_open = 1)
          OR (NEW.action = 'paused' AND NEW.revision > 0 AND product.is_open = 0))
    )
    THEN RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_EVENT_INVALID') END;
END;
--> statement-breakpoint
CREATE TRIGGER `finance_deposit_product_events_update_guard`
BEFORE UPDATE ON `finance_deposit_product_events`
BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_EVENT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `finance_deposit_product_events_delete_guard`
BEFORE DELETE ON `finance_deposit_product_events`
BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_EVENT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `finance_deposit_contracts_insert_guard`
BEFORE INSERT ON `finance_deposit_contracts`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM finance_deposit_products product
    JOIN students student ON student.id = NEW.student_id
      AND student.class_id = product.class_id AND student.status = 'active'
    JOIN finance_accounts wallet ON wallet.id = NEW.wallet_account_id
      AND wallet.class_id = product.class_id
      AND wallet.student_id = student.id
      AND wallet.account_type = 'student_wallet' AND wallet.status = 'active'
    WHERE product.id = NEW.product_id AND product.class_id = NEW.class_id
      AND product.is_open = 1 AND product.revision = NEW.product_revision
      AND product.name = NEW.product_name_snapshot
      AND product.term_weeks = NEW.term_weeks_snapshot
      AND product.maturity_interest_bps = NEW.maturity_interest_bps_snapshot
      AND product.early_interest_bps = NEW.early_interest_bps_snapshot
      AND NEW.principal BETWEEN product.min_amount AND product.max_amount
  ) THEN RAISE(ABORT, 'FINANCE_DEPOSIT_SUBSCRIPTION_STALE') END;
  SELECT CASE WHEN NEW.matures_at <> NEW.opened_at
      + (NEW.term_weeks_snapshot * 604800000)
    OR NEW.maturity_interest <> CAST(
      (NEW.principal * NEW.maturity_interest_bps_snapshot) / 10000 AS INTEGER)
    OR NEW.early_interest <> CAST(
      (NEW.maturity_interest * NEW.early_interest_bps_snapshot) / 10000 AS INTEGER)
    THEN RAISE(ABORT, 'FINANCE_DEPOSIT_CALCULATION_MISMATCH') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM finance_deposit_contracts prior
    WHERE prior.class_id = NEW.class_id AND prior.student_id = NEW.student_id
      AND prior.product_id = NEW.product_id
      AND NOT EXISTS (
        SELECT 1 FROM finance_deposit_settlements settlement
        WHERE settlement.contract_id = prior.id
      )
  ) THEN RAISE(ABORT, 'FINANCE_DEPOSIT_ACTIVE_EXISTS') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM finance_transactions transaction_row
    WHERE transaction_row.id = NEW.posted_transaction_id
      AND transaction_row.class_id = NEW.class_id
      AND transaction_row.status = 'posted'
      AND transaction_row.transaction_type = 'deposit_open'
      AND transaction_row.source_type = 'deposit_contract'
      AND transaction_row.source_id = NEW.id
      AND transaction_row.actor_type = 'system'
      AND transaction_row.payload_hash = NEW.transaction_payload_hash
      AND (SELECT COUNT(*) FROM finance_ledger_entries entry
           WHERE entry.transaction_id = transaction_row.id) = 2
      AND EXISTS (
        SELECT 1 FROM finance_ledger_entries entry
        WHERE entry.transaction_id = transaction_row.id
          AND entry.account_id = NEW.wallet_account_id
          AND entry.amount = -NEW.principal
      )
      AND EXISTS (
        SELECT 1 FROM finance_ledger_entries entry
        JOIN finance_accounts issuance ON issuance.id = entry.account_id
          AND issuance.class_id = entry.class_id
          AND issuance.account_type = 'class_issuance'
        WHERE entry.transaction_id = transaction_row.id
          AND entry.amount = NEW.principal
      )
  ) THEN RAISE(ABORT, 'FINANCE_DEPOSIT_LEDGER_MISMATCH') END;
END;
--> statement-breakpoint
CREATE TRIGGER `finance_deposit_contracts_update_guard`
BEFORE UPDATE ON `finance_deposit_contracts`
BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_CONTRACT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `finance_deposit_contracts_delete_guard`
BEFORE DELETE ON `finance_deposit_contracts`
BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_CONTRACT_IMMUTABLE'); END;
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
      AND transaction_row.actor_type = 'system'
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
--> statement-breakpoint
CREATE TRIGGER `finance_deposit_settlements_update_guard`
BEFORE UPDATE ON `finance_deposit_settlements`
BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_SETTLEMENT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `finance_deposit_settlements_delete_guard`
BEFORE DELETE ON `finance_deposit_settlements`
BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_SETTLEMENT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `finance_deposit_transactions_reversal_guard`
BEFORE INSERT ON `finance_transactions`
WHEN NEW.transaction_type = 'reversal' AND EXISTS (
  SELECT 1 FROM finance_transactions original
  WHERE original.id = NEW.reversal_of_transaction_id
    AND original.source_type IN ('deposit_contract', 'deposit_settlement')
)
BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_REVERSAL_REQUIRES_CONTRACT'); END;
--> statement-breakpoint
CREATE TRIGGER `finance_deposit_classes_archive_guard`
BEFORE UPDATE OF status ON `classes`
WHEN NEW.status = 'archived' AND OLD.status <> 'archived'
  AND EXISTS (
    SELECT 1 FROM finance_deposit_contracts contract
    WHERE contract.class_id = NEW.id
      AND NOT EXISTS (
        SELECT 1 FROM finance_deposit_settlements settlement
        WHERE settlement.contract_id = contract.id
      )
  )
BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_ACTIVE_CLASS'); END;
--> statement-breakpoint
CREATE TRIGGER `finance_deposit_students_exclude_guard`
BEFORE UPDATE OF status ON `students`
WHEN NEW.status = 'excluded' AND OLD.status <> 'excluded'
  AND EXISTS (
    SELECT 1 FROM finance_deposit_contracts contract
    WHERE contract.student_id = NEW.id AND contract.class_id = NEW.class_id
      AND NOT EXISTS (
        SELECT 1 FROM finance_deposit_settlements settlement
        WHERE settlement.contract_id = contract.id
      )
  )
BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_ACTIVE_STUDENT'); END;
