CREATE TABLE `finance_stock_liquidation_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`class_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`trade_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`gross_amount` integer NOT NULL,
	`fee_amount` integer NOT NULL,
	`wallet_delta` integer NOT NULL,
	`cost_basis_removed` integer NOT NULL,
	`realized_gain` integer NOT NULL,
	`holding_quantity_before` integer NOT NULL,
	`holding_quantity_after` integer NOT NULL,
	`holding_cost_basis_before` integer NOT NULL,
	`holding_cost_basis_after` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`operation_id`,`class_id`) REFERENCES `finance_stock_liquidation_operations`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trade_id`,`class_id`) REFERENCES `finance_stock_trades`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_stock_liquidation_chunks_amount_ck" CHECK("finance_stock_liquidation_chunks"."chunk_index" BETWEEN 0 AND 1
        AND "finance_stock_liquidation_chunks"."quantity" BETWEEN 1 AND 1000000000
        AND "finance_stock_liquidation_chunks"."gross_amount" BETWEEN 1 AND 1000000000
        AND "finance_stock_liquidation_chunks"."fee_amount" BETWEEN 0 AND "finance_stock_liquidation_chunks"."gross_amount"
        AND "finance_stock_liquidation_chunks"."wallet_delta" = "finance_stock_liquidation_chunks"."gross_amount" - "finance_stock_liquidation_chunks"."fee_amount"
        AND "finance_stock_liquidation_chunks"."wallet_delta" > 0
        AND "finance_stock_liquidation_chunks"."cost_basis_removed" BETWEEN 0 AND 1000000000
        AND "finance_stock_liquidation_chunks"."realized_gain" = "finance_stock_liquidation_chunks"."wallet_delta"
          - "finance_stock_liquidation_chunks"."cost_basis_removed"),
	CONSTRAINT "finance_stock_liquidation_chunks_holding_ck" CHECK("finance_stock_liquidation_chunks"."holding_quantity_before" BETWEEN 1 AND 1000000000
        AND "finance_stock_liquidation_chunks"."holding_quantity_after"
          = "finance_stock_liquidation_chunks"."holding_quantity_before" - "finance_stock_liquidation_chunks"."quantity"
        AND "finance_stock_liquidation_chunks"."holding_quantity_after" BETWEEN 0 AND 1000000000
        AND "finance_stock_liquidation_chunks"."holding_cost_basis_before" BETWEEN 1 AND 1000000000
        AND "finance_stock_liquidation_chunks"."holding_cost_basis_after"
          = "finance_stock_liquidation_chunks"."holding_cost_basis_before" - "finance_stock_liquidation_chunks"."cost_basis_removed"
        AND "finance_stock_liquidation_chunks"."holding_cost_basis_after" BETWEEN 0 AND 1000000000
        AND (("finance_stock_liquidation_chunks"."holding_quantity_after" = 0
            AND "finance_stock_liquidation_chunks"."holding_cost_basis_after" = 0)
          OR ("finance_stock_liquidation_chunks"."holding_quantity_after" > 0
            AND "finance_stock_liquidation_chunks"."holding_cost_basis_after" > 0)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_liquidation_chunks_operation_index_uq` ON `finance_stock_liquidation_chunks` (`operation_id`,`chunk_index`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_liquidation_chunks_trade_uq` ON `finance_stock_liquidation_chunks` (`trade_id`);--> statement-breakpoint
CREATE INDEX `finance_stock_liquidation_chunks_class_created_idx` ON `finance_stock_liquidation_chunks` (`class_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `finance_stock_liquidation_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`stock_id` text NOT NULL,
	`student_id` text NOT NULL,
	`teacher_id` text NOT NULL,
	`root_idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`origin` text NOT NULL,
	`intervention_reason` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`snapshot_reference_price` integer NOT NULL,
	`snapshot_spread` integer NOT NULL,
	`snapshot_unit_price` integer NOT NULL,
	`snapshot_fee_bps` integer NOT NULL,
	`snapshot_denomination_step` integer NOT NULL,
	`snapshot_stock_revision` integer NOT NULL,
	`snapshot_market_revision` integer NOT NULL,
	`snapshot_finance_settings_revision` integer NOT NULL,
	`snapshot_holding_revision` integer NOT NULL,
	`snapshot_wallet_revision` integer NOT NULL,
	`snapshot_wallet_balance` integer NOT NULL,
	`snapshot_student_status` text NOT NULL,
	`snapshot_stock_status` text NOT NULL,
	`snapshot_market_was_open` integer NOT NULL,
	`initial_quantity` integer NOT NULL,
	`remaining_quantity` integer NOT NULL,
	`sold_quantity` integer NOT NULL,
	`initial_cost_basis` integer NOT NULL,
	`remaining_cost_basis` integer NOT NULL,
	`expected_gross_amount` integer NOT NULL,
	`expected_fee_amount` integer NOT NULL,
	`expected_wallet_delta` integer NOT NULL,
	`completed_chunk_count` integer DEFAULT 0 NOT NULL,
	`total_gross_amount` integer DEFAULT 0 NOT NULL,
	`total_fee_amount` integer DEFAULT 0 NOT NULL,
	`total_wallet_delta` integer DEFAULT 0 NOT NULL,
	`total_cost_basis_removed` integer DEFAULT 0 NOT NULL,
	`total_realized_gain` integer DEFAULT 0 NOT NULL,
	`next_chunk_index` integer DEFAULT 0 NOT NULL,
	`last_trade_id` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	`cancelled_at` integer,
	`cancellation_reason` text,
	`cancellation_idempotency_key` text,
	`cancellation_payload_hash` text,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stock_id`,`class_id`) REFERENCES `finance_stocks`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_trade_id`,`class_id`) REFERENCES `finance_stock_trades`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_stock_liquidation_operations_text_ck" CHECK(LENGTH(TRIM("finance_stock_liquidation_operations"."root_idempotency_key")) BETWEEN 8 AND 200
        AND LENGTH(TRIM("finance_stock_liquidation_operations"."payload_hash")) BETWEEN 8 AND 500
        AND "finance_stock_liquidation_operations"."origin" IN (
          'finance_center', 'student_exclusion', 'class_archive', 'account_recovery'
        )
        AND LENGTH(TRIM("finance_stock_liquidation_operations"."intervention_reason")) BETWEEN 2 AND 300),
	CONSTRAINT "finance_stock_liquidation_operations_snapshot_ck" CHECK("finance_stock_liquidation_operations"."snapshot_reference_price" BETWEEN 1 AND 1000000000
        AND "finance_stock_liquidation_operations"."snapshot_spread" BETWEEN 0 AND 1000000000
        AND "finance_stock_liquidation_operations"."snapshot_unit_price" = "finance_stock_liquidation_operations"."snapshot_reference_price"
          - "finance_stock_liquidation_operations"."snapshot_spread"
        AND "finance_stock_liquidation_operations"."snapshot_unit_price" BETWEEN 1 AND 1000000000
        AND "finance_stock_liquidation_operations"."snapshot_fee_bps" BETWEEN 0 AND 1000
        AND "finance_stock_liquidation_operations"."snapshot_denomination_step" BETWEEN 1 AND 1000000000
        AND "finance_stock_liquidation_operations"."snapshot_reference_price" % "finance_stock_liquidation_operations"."snapshot_denomination_step" = 0
        AND "finance_stock_liquidation_operations"."snapshot_spread" % "finance_stock_liquidation_operations"."snapshot_denomination_step" = 0
        AND "finance_stock_liquidation_operations"."snapshot_stock_revision" >= 0
        AND "finance_stock_liquidation_operations"."snapshot_market_revision" >= 0
        AND "finance_stock_liquidation_operations"."snapshot_finance_settings_revision" >= 0
        AND "finance_stock_liquidation_operations"."snapshot_holding_revision" > 0
        AND "finance_stock_liquidation_operations"."snapshot_wallet_revision" >= 0
        AND "finance_stock_liquidation_operations"."snapshot_wallet_balance" BETWEEN 0 AND 1000000000
        AND "finance_stock_liquidation_operations"."snapshot_market_was_open" IN (0, 1)),
	CONSTRAINT "finance_stock_liquidation_operations_progress_ck" CHECK("finance_stock_liquidation_operations"."initial_quantity" BETWEEN 1 AND 1000000000
        AND "finance_stock_liquidation_operations"."remaining_quantity" BETWEEN 0 AND "finance_stock_liquidation_operations"."initial_quantity"
        AND "finance_stock_liquidation_operations"."sold_quantity" = "finance_stock_liquidation_operations"."initial_quantity"
          - "finance_stock_liquidation_operations"."remaining_quantity"
        AND "finance_stock_liquidation_operations"."initial_cost_basis" BETWEEN 1 AND 1000000000
        AND "finance_stock_liquidation_operations"."remaining_cost_basis" BETWEEN 0 AND "finance_stock_liquidation_operations"."initial_cost_basis"
        AND (("finance_stock_liquidation_operations"."remaining_quantity" = 0 AND "finance_stock_liquidation_operations"."remaining_cost_basis" = 0)
          OR ("finance_stock_liquidation_operations"."remaining_quantity" > 0 AND "finance_stock_liquidation_operations"."remaining_cost_basis" > 0))
        AND "finance_stock_liquidation_operations"."expected_gross_amount"
          = "finance_stock_liquidation_operations"."snapshot_unit_price" * "finance_stock_liquidation_operations"."initial_quantity"
        AND "finance_stock_liquidation_operations"."expected_gross_amount" BETWEEN 1 AND 1111111111
        AND "finance_stock_liquidation_operations"."expected_fee_amount" BETWEEN 0 AND "finance_stock_liquidation_operations"."expected_gross_amount"
        AND "finance_stock_liquidation_operations"."expected_fee_amount" <= CAST(
          "finance_stock_liquidation_operations"."expected_gross_amount" * "finance_stock_liquidation_operations"."snapshot_fee_bps" / 10000
          AS INTEGER)
        AND "finance_stock_liquidation_operations"."expected_wallet_delta"
          = "finance_stock_liquidation_operations"."expected_gross_amount" - "finance_stock_liquidation_operations"."expected_fee_amount"
        AND "finance_stock_liquidation_operations"."expected_wallet_delta" > 0
        AND "finance_stock_liquidation_operations"."expected_wallet_delta"
          <= 1000000000 - "finance_stock_liquidation_operations"."snapshot_wallet_balance"
        AND "finance_stock_liquidation_operations"."completed_chunk_count" BETWEEN 0 AND 2
        AND "finance_stock_liquidation_operations"."next_chunk_index" = "finance_stock_liquidation_operations"."completed_chunk_count"
        AND "finance_stock_liquidation_operations"."revision" = "finance_stock_liquidation_operations"."completed_chunk_count"
          + CASE "finance_stock_liquidation_operations"."status" WHEN 'cancelled' THEN 1 ELSE 0 END
        AND "finance_stock_liquidation_operations"."total_gross_amount"
          = "finance_stock_liquidation_operations"."snapshot_unit_price" * "finance_stock_liquidation_operations"."sold_quantity"
        AND "finance_stock_liquidation_operations"."total_fee_amount" BETWEEN 0 AND "finance_stock_liquidation_operations"."total_gross_amount"
        AND "finance_stock_liquidation_operations"."total_wallet_delta"
          = "finance_stock_liquidation_operations"."total_gross_amount" - "finance_stock_liquidation_operations"."total_fee_amount"
        AND "finance_stock_liquidation_operations"."total_cost_basis_removed"
          = "finance_stock_liquidation_operations"."initial_cost_basis" - "finance_stock_liquidation_operations"."remaining_cost_basis"
        AND "finance_stock_liquidation_operations"."total_realized_gain"
          = "finance_stock_liquidation_operations"."total_wallet_delta" - "finance_stock_liquidation_operations"."total_cost_basis_removed"),
	CONSTRAINT "finance_stock_liquidation_operations_state_ck" CHECK((("finance_stock_liquidation_operations"."status" = 'running'
          AND "finance_stock_liquidation_operations"."remaining_quantity" > 0
          AND "finance_stock_liquidation_operations"."completed_chunk_count" < 2
          AND "finance_stock_liquidation_operations"."completed_at" IS NULL
          AND "finance_stock_liquidation_operations"."cancelled_at" IS NULL
          AND "finance_stock_liquidation_operations"."cancellation_reason" IS NULL
          AND "finance_stock_liquidation_operations"."cancellation_idempotency_key" IS NULL
          AND "finance_stock_liquidation_operations"."cancellation_payload_hash" IS NULL)
        OR ("finance_stock_liquidation_operations"."status" = 'completed'
          AND "finance_stock_liquidation_operations"."remaining_quantity" = 0
          AND "finance_stock_liquidation_operations"."remaining_cost_basis" = 0
          AND "finance_stock_liquidation_operations"."sold_quantity" = "finance_stock_liquidation_operations"."initial_quantity"
          AND "finance_stock_liquidation_operations"."total_gross_amount" = "finance_stock_liquidation_operations"."expected_gross_amount"
          AND "finance_stock_liquidation_operations"."total_fee_amount" = "finance_stock_liquidation_operations"."expected_fee_amount"
          AND "finance_stock_liquidation_operations"."total_wallet_delta" = "finance_stock_liquidation_operations"."expected_wallet_delta"
          AND "finance_stock_liquidation_operations"."total_cost_basis_removed" = "finance_stock_liquidation_operations"."initial_cost_basis"
          AND "finance_stock_liquidation_operations"."completed_at" IS NOT NULL
          AND "finance_stock_liquidation_operations"."cancelled_at" IS NULL
          AND "finance_stock_liquidation_operations"."cancellation_reason" IS NULL
          AND "finance_stock_liquidation_operations"."cancellation_idempotency_key" IS NULL
          AND "finance_stock_liquidation_operations"."cancellation_payload_hash" IS NULL)
        OR ("finance_stock_liquidation_operations"."status" = 'cancelled'
          AND "finance_stock_liquidation_operations"."remaining_quantity" > 0
          AND "finance_stock_liquidation_operations"."completed_at" IS NULL
          AND "finance_stock_liquidation_operations"."cancelled_at" IS NOT NULL
          AND LENGTH(TRIM(COALESCE("finance_stock_liquidation_operations"."cancellation_reason", '')))
            BETWEEN 2 AND 300
          AND LENGTH(TRIM(COALESCE("finance_stock_liquidation_operations"."cancellation_idempotency_key", '')))
            BETWEEN 8 AND 200
          AND LENGTH(TRIM(COALESCE("finance_stock_liquidation_operations"."cancellation_payload_hash", '')))
            BETWEEN 8 AND 500))
        AND (("finance_stock_liquidation_operations"."completed_chunk_count" = 0 AND "finance_stock_liquidation_operations"."last_trade_id" IS NULL)
          OR ("finance_stock_liquidation_operations"."completed_chunk_count" > 0 AND "finance_stock_liquidation_operations"."last_trade_id" IS NOT NULL))
        AND "finance_stock_liquidation_operations"."updated_at" >= "finance_stock_liquidation_operations"."created_at"
        AND ("finance_stock_liquidation_operations"."completed_at" IS NULL OR "finance_stock_liquidation_operations"."completed_at" = "finance_stock_liquidation_operations"."updated_at")
        AND ("finance_stock_liquidation_operations"."cancelled_at" IS NULL OR "finance_stock_liquidation_operations"."cancelled_at" = "finance_stock_liquidation_operations"."updated_at"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_liquidation_operations_id_class_uq` ON `finance_stock_liquidation_operations` (`id`,`class_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_liquidation_operations_root_uq` ON `finance_stock_liquidation_operations` (`root_idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_liquidation_operations_running_uq` ON `finance_stock_liquidation_operations` (`class_id`,`stock_id`,`student_id`) WHERE "finance_stock_liquidation_operations"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_liquidation_operations_cancellation_uq` ON `finance_stock_liquidation_operations` (`cancellation_idempotency_key`) WHERE "finance_stock_liquidation_operations"."cancellation_idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `finance_stock_liquidation_operations_class_status_idx` ON `finance_stock_liquidation_operations` (`class_id`,`status`,`updated_at`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_operations_insert_guard
    BEFORE INSERT ON finance_stock_liquidation_operations
    BEGIN
      SELECT CASE WHEN NEW.status <> 'running'
        OR NEW.remaining_quantity <> NEW.initial_quantity
        OR NEW.sold_quantity <> 0
        OR NEW.remaining_cost_basis <> NEW.initial_cost_basis
        OR NEW.completed_chunk_count <> 0
        OR NEW.total_gross_amount <> 0 OR NEW.total_fee_amount <> 0
        OR NEW.total_wallet_delta <> 0 OR NEW.total_cost_basis_removed <> 0
        OR NEW.total_realized_gain <> 0 OR NEW.next_chunk_index <> 0
        OR NEW.last_trade_id IS NOT NULL OR NEW.revision <> 0
        OR NEW.updated_at <> NEW.created_at OR NEW.completed_at IS NOT NULL
        OR NEW.cancelled_at IS NOT NULL OR NEW.cancellation_reason IS NOT NULL
        OR NEW.cancellation_idempotency_key IS NOT NULL
        OR NEW.cancellation_payload_hash IS NOT NULL
        THEN RAISE(ABORT,
          'FINANCE_STOCK_LIQUIDATION_OPERATION_INVALID_INITIAL_STATE') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM classes classroom
        JOIN students student ON student.id = NEW.student_id
          AND student.class_id = classroom.id
        JOIN finance_stocks stock ON stock.id = NEW.stock_id
          AND stock.class_id = classroom.id
        JOIN finance_stock_markets market ON market.class_id = classroom.id
        JOIN finance_settings setting ON setting.class_id = classroom.id
        JOIN finance_stock_holdings holding
          ON holding.class_id = classroom.id AND holding.stock_id = stock.id
          AND holding.student_id = student.id
        JOIN finance_accounts wallet ON wallet.id = holding.wallet_account_id
          AND wallet.class_id = classroom.id AND wallet.student_id = student.id
          AND wallet.account_type = 'student_wallet' AND wallet.status = 'active'
        JOIN finance_accounts issuance ON issuance.class_id = classroom.id
          AND issuance.student_id IS NULL
          AND issuance.account_type = 'class_issuance'
          AND issuance.status = 'active'
        WHERE classroom.id = NEW.class_id
          AND classroom.teacher_id = NEW.teacher_id
          AND classroom.status = 'active'
          AND student.status = NEW.snapshot_student_status
          AND student.status IN ('active', 'locked', 'reset_required', 'pending')
          AND stock.status = NEW.snapshot_stock_status
          AND stock.status IN ('active', 'sell_only', 'halted')
          AND market.is_open = NEW.snapshot_market_was_open
          AND stock.current_price = NEW.snapshot_reference_price
          AND market.sell_spread = NEW.snapshot_spread
          AND NEW.snapshot_unit_price = stock.current_price - market.sell_spread
          AND market.sell_fee_bps = NEW.snapshot_fee_bps
          AND stock.revision = NEW.snapshot_stock_revision
          AND market.revision = NEW.snapshot_market_revision
          AND setting.revision = NEW.snapshot_finance_settings_revision
          AND NEW.snapshot_denomination_step = (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          )
          AND holding.revision = NEW.snapshot_holding_revision
          AND holding.quantity = NEW.initial_quantity
          AND holding.cost_basis = NEW.initial_cost_basis
          AND wallet.revision = NEW.snapshot_wallet_revision
          AND wallet.balance = NEW.snapshot_wallet_balance
          AND NEW.snapshot_wallet_balance + NEW.expected_wallet_delta
            <= 1000000000
          AND issuance.balance - NEW.expected_wallet_delta >= -1000000000
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_STALE') END;
    END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS finance_stock_liquidation_operations_update_guard;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_operations_update_guard
    BEFORE UPDATE ON finance_stock_liquidation_operations
    BEGIN
      SELECT CASE WHEN OLD.status IN ('completed', 'cancelled')
        THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_IMMUTABLE') END;
      SELECT CASE WHEN NEW.status NOT IN ('running', 'completed', 'cancelled')
        THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_STALE') END;
      SELECT CASE WHEN NEW.id <> OLD.id OR NEW.class_id <> OLD.class_id
        OR NEW.stock_id <> OLD.stock_id OR NEW.student_id <> OLD.student_id
        OR NEW.teacher_id <> OLD.teacher_id
        OR NEW.root_idempotency_key <> OLD.root_idempotency_key
        OR NEW.payload_hash <> OLD.payload_hash OR NEW.origin <> OLD.origin
        OR NEW.intervention_reason <> OLD.intervention_reason
        THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_IMMUTABLE') END;
      SELECT CASE WHEN NEW.snapshot_reference_price <> OLD.snapshot_reference_price
        OR NEW.snapshot_spread <> OLD.snapshot_spread
        OR NEW.snapshot_unit_price <> OLD.snapshot_unit_price
        OR NEW.snapshot_fee_bps <> OLD.snapshot_fee_bps
        OR NEW.snapshot_denomination_step <> OLD.snapshot_denomination_step
        OR NEW.snapshot_stock_revision <> OLD.snapshot_stock_revision
        OR NEW.snapshot_market_revision <> OLD.snapshot_market_revision
        OR NEW.snapshot_finance_settings_revision
          <> OLD.snapshot_finance_settings_revision
        OR NEW.snapshot_holding_revision <> OLD.snapshot_holding_revision
        OR NEW.snapshot_wallet_revision <> OLD.snapshot_wallet_revision
        OR NEW.snapshot_wallet_balance <> OLD.snapshot_wallet_balance
        OR NEW.snapshot_student_status <> OLD.snapshot_student_status
        OR NEW.snapshot_stock_status <> OLD.snapshot_stock_status
        OR NEW.snapshot_market_was_open <> OLD.snapshot_market_was_open
        THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_IMMUTABLE') END;
      SELECT CASE WHEN NEW.initial_quantity <> OLD.initial_quantity
        OR NEW.initial_cost_basis <> OLD.initial_cost_basis
        OR NEW.expected_gross_amount <> OLD.expected_gross_amount
        OR NEW.expected_fee_amount <> OLD.expected_fee_amount
        OR NEW.expected_wallet_delta <> OLD.expected_wallet_delta
        OR NEW.created_at <> OLD.created_at OR NEW.updated_at < OLD.updated_at
        THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_IMMUTABLE') END;
      SELECT CASE WHEN NEW.status IN ('running', 'completed') AND (
        NEW.revision <> OLD.revision + 1
        OR NEW.cancelled_at IS NOT NULL OR NEW.cancellation_reason IS NOT NULL
        OR NEW.cancellation_idempotency_key IS NOT NULL
        OR NEW.cancellation_payload_hash IS NOT NULL
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_STALE') END;
      SELECT CASE WHEN NEW.status IN ('running', 'completed') AND NOT EXISTS (
        SELECT 1 FROM finance_stock_liquidation_chunks chunk
        WHERE chunk.operation_id = OLD.id AND chunk.class_id = OLD.class_id
          AND chunk.chunk_index = OLD.next_chunk_index
          AND chunk.trade_id = NEW.last_trade_id
          AND chunk.holding_quantity_before = OLD.remaining_quantity
          AND chunk.holding_quantity_after = NEW.remaining_quantity
          AND chunk.holding_cost_basis_before = OLD.remaining_cost_basis
          AND chunk.holding_cost_basis_after = NEW.remaining_cost_basis
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_STALE') END;
      SELECT CASE WHEN NEW.status IN ('running', 'completed') AND NOT EXISTS (
        SELECT 1 FROM finance_stock_liquidation_chunks chunk
        WHERE chunk.operation_id = OLD.id AND chunk.class_id = OLD.class_id
          AND chunk.chunk_index = OLD.next_chunk_index
          AND NEW.sold_quantity = OLD.sold_quantity + chunk.quantity
          AND NEW.completed_chunk_count = OLD.completed_chunk_count + 1
          AND NEW.next_chunk_index = OLD.next_chunk_index + 1
          AND NEW.status = CASE WHEN chunk.holding_quantity_after = 0
            THEN 'completed' ELSE 'running' END
          AND NEW.completed_at IS CASE
            WHEN chunk.holding_quantity_after = 0 THEN chunk.created_at
            ELSE NULL END
          AND NEW.updated_at = chunk.created_at
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_STALE') END;
      SELECT CASE WHEN NEW.status IN ('running', 'completed') AND NOT EXISTS (
        SELECT 1 FROM finance_stock_liquidation_chunks chunk
        WHERE chunk.operation_id = OLD.id AND chunk.class_id = OLD.class_id
          AND chunk.chunk_index = OLD.next_chunk_index
          AND NEW.total_gross_amount = OLD.total_gross_amount + chunk.gross_amount
          AND NEW.total_fee_amount = OLD.total_fee_amount + chunk.fee_amount
          AND NEW.total_wallet_delta = OLD.total_wallet_delta + chunk.wallet_delta
          AND NEW.total_cost_basis_removed
            = OLD.total_cost_basis_removed + chunk.cost_basis_removed
          AND NEW.total_realized_gain
            = OLD.total_realized_gain + chunk.realized_gain
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_STALE') END;
      SELECT CASE WHEN NEW.status = 'cancelled' AND (
        NEW.revision <> OLD.revision + 1
        OR NEW.remaining_quantity <> OLD.remaining_quantity
        OR NEW.sold_quantity <> OLD.sold_quantity
        OR NEW.remaining_cost_basis <> OLD.remaining_cost_basis
        OR NEW.completed_chunk_count <> OLD.completed_chunk_count
        OR NEW.next_chunk_index <> OLD.next_chunk_index
        OR NEW.last_trade_id IS NOT OLD.last_trade_id
        OR NEW.completed_at IS NOT NULL OR NEW.cancelled_at <> NEW.updated_at
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_STALE') END;
      SELECT CASE WHEN NEW.status = 'cancelled' AND (
        NEW.total_gross_amount <> OLD.total_gross_amount
        OR NEW.total_fee_amount <> OLD.total_fee_amount
        OR NEW.total_wallet_delta <> OLD.total_wallet_delta
        OR NEW.total_cost_basis_removed <> OLD.total_cost_basis_removed
        OR NEW.total_realized_gain <> OLD.total_realized_gain
        OR LENGTH(TRIM(COALESCE(NEW.cancellation_reason, '')))
          NOT BETWEEN 2 AND 300
        OR LENGTH(TRIM(COALESCE(NEW.cancellation_idempotency_key, '')))
          NOT BETWEEN 8 AND 200
        OR LENGTH(TRIM(COALESCE(NEW.cancellation_payload_hash, '')))
          NOT BETWEEN 8 AND 500
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_STALE') END;
      SELECT CASE WHEN NEW.status = 'cancelled' AND NOT EXISTS (
        SELECT 1 FROM classes classroom
        WHERE classroom.id = OLD.class_id
          AND classroom.teacher_id = OLD.teacher_id
          AND classroom.status = 'active'
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_STALE') END;
    END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_operations_delete_guard
    BEFORE DELETE ON finance_stock_liquidation_operations
    BEGIN
      SELECT RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_IMMUTABLE');
    END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_target_trade_guard
    BEFORE INSERT ON finance_stock_trades
    WHEN EXISTS (
      SELECT 1 FROM finance_stock_liquidation_operations operation
      WHERE operation.class_id = NEW.class_id
        AND operation.stock_id = NEW.stock_id
        AND operation.student_id = NEW.student_id
        AND operation.status = 'running'
    )
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_liquidation_operations operation
        JOIN finance_transactions transaction_row
          ON transaction_row.class_id = operation.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND transaction_row.status = 'pending'
          AND transaction_row.actor_type = 'teacher'
          AND transaction_row.actor_teacher_id = operation.teacher_id
        WHERE operation.class_id = NEW.class_id
          AND operation.stock_id = NEW.stock_id
          AND operation.student_id = NEW.student_id
          AND operation.status = 'running'
          AND json_valid(transaction_row.metadata_json) = 1
          AND json_extract(transaction_row.metadata_json, '$.operationId')
            = operation.id
          AND json_extract(transaction_row.metadata_json, '$.rootIdempotencyKey')
            = operation.root_idempotency_key
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.chunkIndex'
          ) AS INTEGER) = operation.next_chunk_index
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_IN_PROGRESS') END;
    END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_wallet_guard
    BEFORE INSERT ON finance_ledger_entries
    WHEN EXISTS (
      SELECT 1
      FROM finance_stock_liquidation_operations operation
      JOIN finance_accounts wallet ON wallet.class_id = operation.class_id
        AND wallet.student_id = operation.student_id
        AND wallet.account_type = 'student_wallet'
      WHERE operation.class_id = NEW.class_id
        AND operation.status = 'running' AND wallet.id = NEW.account_id
    )
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_liquidation_operations operation
        JOIN finance_accounts wallet ON wallet.class_id = operation.class_id
          AND wallet.student_id = operation.student_id
          AND wallet.account_type = 'student_wallet'
        JOIN finance_transactions transaction_row
          ON transaction_row.id = NEW.transaction_id
          AND transaction_row.class_id = operation.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.status = 'pending'
          AND transaction_row.actor_type = 'teacher'
          AND transaction_row.actor_teacher_id = operation.teacher_id
        WHERE operation.class_id = NEW.class_id
          AND operation.status = 'running' AND wallet.id = NEW.account_id
          AND json_valid(transaction_row.metadata_json) = 1
          AND json_extract(transaction_row.metadata_json, '$.operationId')
            = operation.id
          AND json_extract(transaction_row.metadata_json, '$.rootIdempotencyKey')
            = operation.root_idempotency_key
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.chunkIndex'
          ) AS INTEGER) = operation.next_chunk_index
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_IN_PROGRESS') END;
    END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_ledger_entries_issuance_floor_guard
    BEFORE INSERT ON finance_ledger_entries
    WHEN NEW.amount < 0 AND NEW.balance_after < -1000000000
      AND EXISTS (
        SELECT 1 FROM finance_accounts account
        WHERE account.id = NEW.account_id
          AND account.class_id = NEW.class_id
          AND account.account_type = 'class_issuance'
      )
    BEGIN
      SELECT RAISE(ABORT, 'FINANCE_ISSUANCE_BALANCE_LIMIT');
    END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS finance_stock_liquidation_chunks_insert_guard;
--> statement-breakpoint
DROP TRIGGER IF EXISTS finance_stock_liquidation_chunks_trade_guard;
--> statement-breakpoint
DROP TRIGGER IF EXISTS finance_stock_liquidation_chunks_transaction_guard;
--> statement-breakpoint
DROP TRIGGER IF EXISTS finance_stock_liquidation_chunks_metadata_guard;
--> statement-breakpoint
DROP TRIGGER IF EXISTS finance_stock_liquidation_chunks_projection_guard;
--> statement-breakpoint
DROP TRIGGER IF EXISTS finance_stock_liquidation_chunks_totals_guard;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_chunks_insert_guard
    BEFORE INSERT ON finance_stock_liquidation_chunks
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_liquidation_operations operation
        JOIN finance_stock_trades trade ON trade.id = NEW.trade_id
          AND trade.class_id = operation.class_id
        WHERE operation.id = NEW.operation_id
          AND operation.class_id = NEW.class_id
          AND operation.status = 'running'
          AND NEW.chunk_index = operation.next_chunk_index
          AND NEW.chunk_index = operation.completed_chunk_count
          AND NEW.quantity = CASE
            WHEN operation.remaining_quantity * operation.snapshot_unit_price
              <= 1000000000 THEN operation.remaining_quantity
            ELSE CAST(1000000000 / operation.snapshot_unit_price AS INTEGER)
          END
          AND NEW.holding_quantity_before = operation.remaining_quantity
          AND NEW.holding_cost_basis_before = operation.remaining_cost_basis
          AND trade.status = 'posted' AND trade.side = 'sell'
          AND trade.stock_id = operation.stock_id
          AND trade.student_id = operation.student_id
          AND trade.quantity = NEW.quantity
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_CHUNK_STALE') END;
    END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_chunks_trade_guard
    BEFORE INSERT ON finance_stock_liquidation_chunks
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_liquidation_operations operation
        JOIN finance_stock_trades trade ON trade.id = NEW.trade_id
          AND trade.class_id = operation.class_id
        WHERE operation.id = NEW.operation_id
          AND operation.class_id = NEW.class_id
          AND operation.status = 'running'
          AND trade.reference_price = operation.snapshot_reference_price
          AND trade.spread_snapshot = operation.snapshot_spread
          AND trade.unit_price = operation.snapshot_unit_price
          AND trade.fee_bps_snapshot = operation.snapshot_fee_bps
          AND trade.gross_amount = NEW.gross_amount
          AND trade.fee_amount = NEW.fee_amount
          AND trade.wallet_delta = NEW.wallet_delta
          AND trade.cost_basis_removed = NEW.cost_basis_removed
          AND trade.realized_gain = NEW.realized_gain
          AND trade.holding_quantity_before = NEW.holding_quantity_before
          AND trade.holding_quantity_after = NEW.holding_quantity_after
          AND trade.holding_cost_basis_before = NEW.holding_cost_basis_before
          AND trade.holding_cost_basis_after = NEW.holding_cost_basis_after
          AND trade.holding_revision_before
            = operation.snapshot_holding_revision + operation.completed_chunk_count
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_CHUNK_STALE') END;
    END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_chunks_transaction_guard
    BEFORE INSERT ON finance_stock_liquidation_chunks
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_liquidation_operations operation
        JOIN finance_stock_trades trade ON trade.id = NEW.trade_id
          AND trade.class_id = operation.class_id
        JOIN finance_transactions transaction_row
          ON transaction_row.id = trade.posted_transaction_id
          AND transaction_row.class_id = operation.class_id
        WHERE operation.id = NEW.operation_id
          AND operation.class_id = NEW.class_id
          AND operation.status = 'running'
          AND transaction_row.status = 'posted'
          AND transaction_row.actor_type = 'teacher'
          AND transaction_row.actor_teacher_id = operation.teacher_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = trade.id
          AND json_valid(transaction_row.metadata_json) = 1
          AND json_extract(transaction_row.metadata_json, '$.operationId')
            = operation.id
          AND json_extract(transaction_row.metadata_json, '$.rootIdempotencyKey')
            = operation.root_idempotency_key
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.chunkIndex'
          ) AS INTEGER) = NEW.chunk_index
          AND json_extract(transaction_row.metadata_json, '$.origin')
            = operation.origin
          AND json_extract(transaction_row.metadata_json, '$.interventionReason')
            = operation.intervention_reason
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_CHUNK_STALE') END;
    END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_chunks_metadata_guard
    BEFORE INSERT ON finance_stock_liquidation_chunks
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_liquidation_operations operation
        JOIN finance_stock_trades trade ON trade.id = NEW.trade_id
          AND trade.class_id = operation.class_id
        JOIN finance_transactions transaction_row
          ON transaction_row.id = trade.posted_transaction_id
          AND transaction_row.class_id = operation.class_id
        WHERE operation.id = NEW.operation_id
          AND operation.class_id = NEW.class_id
          AND operation.status = 'running'
          AND json_valid(transaction_row.metadata_json) = 1
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.referencePrice'
          ) AS INTEGER) = operation.snapshot_reference_price
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.spreadSnapshot'
          ) AS INTEGER) = operation.snapshot_spread
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.unitPrice'
          ) AS INTEGER) = operation.snapshot_unit_price
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.feeBpsSnapshot'
          ) AS INTEGER) = operation.snapshot_fee_bps
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.frozenStockRevision'
          ) AS INTEGER) = operation.snapshot_stock_revision
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.frozenMarketRevision'
          ) AS INTEGER) = operation.snapshot_market_revision
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.frozenFinanceSettingsRevision'
          ) AS INTEGER) = operation.snapshot_finance_settings_revision
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.frozenDenominationStep'
          ) AS INTEGER) = operation.snapshot_denomination_step
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_CHUNK_STALE') END;
    END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_chunks_projection_guard
    BEFORE INSERT ON finance_stock_liquidation_chunks
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_liquidation_operations operation
        JOIN finance_stock_trades trade ON trade.id = NEW.trade_id
          AND trade.class_id = operation.class_id
        JOIN finance_stock_holdings holding
          ON holding.class_id = operation.class_id
          AND holding.stock_id = operation.stock_id
          AND holding.student_id = operation.student_id
        JOIN finance_stocks stock ON stock.id = operation.stock_id
          AND stock.class_id = operation.class_id
        JOIN finance_accounts wallet ON wallet.id = trade.wallet_account_id
          AND wallet.class_id = operation.class_id
          AND wallet.student_id = operation.student_id
          AND wallet.account_type = 'student_wallet' AND wallet.status = 'active'
        WHERE operation.id = NEW.operation_id
          AND operation.class_id = NEW.class_id
          AND operation.status = 'running'
          AND holding.quantity = NEW.holding_quantity_after
          AND holding.cost_basis = NEW.holding_cost_basis_after
          AND holding.revision = trade.holding_revision_after
          AND holding.last_trade_id = trade.id
          AND stock.available_shares = trade.available_shares_after
          AND stock.inventory_revision = trade.inventory_revision_after
          AND stock.last_trade_id = trade.id
          AND wallet.revision = trade.wallet_revision_after
          AND wallet.balance = operation.snapshot_wallet_balance
            + operation.total_wallet_delta + NEW.wallet_delta
          AND NEW.created_at = trade.posted_at
          AND NEW.created_at >= operation.updated_at
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_CHUNK_STALE') END;
    END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_chunks_totals_guard
    BEFORE INSERT ON finance_stock_liquidation_chunks
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_liquidation_operations operation
        WHERE operation.id = NEW.operation_id
          AND operation.class_id = NEW.class_id
          AND operation.status = 'running'
          AND operation.total_gross_amount + NEW.gross_amount
            <= operation.expected_gross_amount
          AND operation.total_fee_amount + NEW.fee_amount
            <= operation.expected_fee_amount
          AND operation.total_wallet_delta + NEW.wallet_delta
            <= operation.expected_wallet_delta
          AND operation.total_cost_basis_removed + NEW.cost_basis_removed
            <= operation.initial_cost_basis
          AND (
            NEW.holding_quantity_after > 0
            OR (
              operation.total_gross_amount + NEW.gross_amount
                = operation.expected_gross_amount
              AND operation.total_fee_amount + NEW.fee_amount
                = operation.expected_fee_amount
              AND operation.total_wallet_delta + NEW.wallet_delta
                = operation.expected_wallet_delta
              AND operation.total_cost_basis_removed + NEW.cost_basis_removed
                = operation.initial_cost_basis
            )
          )
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_CHUNK_STALE') END;
    END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_chunks_progress
    AFTER INSERT ON finance_stock_liquidation_chunks
    BEGIN
      UPDATE finance_stock_liquidation_operations
      SET remaining_quantity = NEW.holding_quantity_after,
          sold_quantity = sold_quantity + NEW.quantity,
          remaining_cost_basis = NEW.holding_cost_basis_after,
          completed_chunk_count = completed_chunk_count + 1,
          total_gross_amount = total_gross_amount + NEW.gross_amount,
          total_fee_amount = total_fee_amount + NEW.fee_amount,
          total_wallet_delta = total_wallet_delta + NEW.wallet_delta,
          total_cost_basis_removed
            = total_cost_basis_removed + NEW.cost_basis_removed,
          total_realized_gain = total_realized_gain + NEW.realized_gain,
          next_chunk_index = next_chunk_index + 1,
          last_trade_id = NEW.trade_id, revision = revision + 1,
          status = CASE WHEN NEW.holding_quantity_after = 0
            THEN 'completed' ELSE 'running' END,
          completed_at = CASE WHEN NEW.holding_quantity_after = 0
            THEN NEW.created_at ELSE NULL END,
          updated_at = NEW.created_at
      WHERE id = NEW.operation_id AND class_id = NEW.class_id
        AND status = 'running' AND next_chunk_index = NEW.chunk_index;
      SELECT CASE WHEN changes() <> 1
        THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_OPERATION_STALE') END;
    END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_chunks_update_guard
    BEFORE UPDATE ON finance_stock_liquidation_chunks
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_CHUNK_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_liquidation_chunks_delete_guard
    BEFORE DELETE ON finance_stock_liquidation_chunks
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_CHUNK_IMMUTABLE'); END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS finance_stock_trades_insert_guard;
--> statement-breakpoint
DROP TRIGGER IF EXISTS finance_stock_trades_initial_guard;
--> statement-breakpoint
DROP TRIGGER IF EXISTS finance_stock_trades_liquidation_live_guard;
--> statement-breakpoint
DROP TRIGGER IF EXISTS finance_stock_trades_liquidation_economics_guard;
--> statement-breakpoint
DROP TRIGGER IF EXISTS finance_stock_trades_liquidation_metadata_guard;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_trades_initial_guard
    BEFORE INSERT ON finance_stock_trades
    BEGIN
      SELECT CASE WHEN NEW.status <> 'pending'
        OR NEW.posted_transaction_id IS NOT NULL
        OR NEW.transaction_payload_hash IS NOT NULL
        OR NEW.posted_at IS NOT NULL
        THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_INVALID_INITIAL_STATE') END;
      SELECT CASE WHEN NEW.side = 'buy' AND EXISTS (
        SELECT 1 FROM finance_stocks stock
        WHERE stock.id = NEW.stock_id AND stock.class_id = NEW.class_id
          AND NEW.holding_quantity_after
            > CAST(1000000000 / stock.current_price AS INTEGER)
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_POSITION_VALUE_LIMIT') END;
      SELECT CASE WHEN COALESCE((
          SELECT holding.quantity FROM finance_stock_holdings holding
          WHERE holding.class_id = NEW.class_id
            AND holding.stock_id = NEW.stock_id
            AND holding.student_id = NEW.student_id
        ), 0) <> NEW.holding_quantity_before
        THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
      SELECT CASE WHEN COALESCE((
          SELECT holding.cost_basis FROM finance_stock_holdings holding
          WHERE holding.class_id = NEW.class_id
            AND holding.stock_id = NEW.stock_id
            AND holding.student_id = NEW.student_id
        ), 0) <> NEW.holding_cost_basis_before
        THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
      SELECT CASE WHEN COALESCE((
          SELECT holding.revision FROM finance_stock_holdings holding
          WHERE holding.class_id = NEW.class_id
            AND holding.stock_id = NEW.stock_id
            AND holding.student_id = NEW.student_id
        ), 0) <> NEW.holding_revision_before
        THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
    END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_trades_insert_guard
    BEFORE INSERT ON finance_stock_trades
    WHEN NOT EXISTS (
      SELECT 1 FROM finance_stock_liquidation_operations operation
      WHERE operation.class_id = NEW.class_id
        AND operation.stock_id = NEW.stock_id
        AND operation.student_id = NEW.student_id
        AND operation.status = 'running'
    )
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stocks stock
        JOIN finance_stock_markets market ON market.class_id = stock.class_id
        JOIN finance_settings setting ON setting.class_id = stock.class_id
        JOIN students student ON student.id = NEW.student_id
          AND student.class_id = stock.class_id
        JOIN finance_accounts wallet ON wallet.id = NEW.wallet_account_id
          AND wallet.class_id = stock.class_id
          AND wallet.student_id = student.id
          AND wallet.account_type = 'student_wallet'
          AND wallet.status = 'active'
        WHERE stock.id = NEW.stock_id AND stock.class_id = NEW.class_id
          AND stock.revision = NEW.stock_revision
          AND stock.inventory_revision = NEW.inventory_revision_before
          AND stock.available_shares = NEW.available_shares_before
          AND setting.revision = NEW.finance_settings_revision
          AND market.revision = NEW.market_revision
          AND wallet.revision = NEW.wallet_revision_before
          AND NEW.reference_price = stock.current_price
          AND NEW.spread_snapshot = CASE NEW.side
            WHEN 'buy' THEN market.buy_spread ELSE market.sell_spread END
          AND NEW.fee_bps_snapshot = CASE NEW.side
            WHEN 'buy' THEN market.buy_fee_bps ELSE market.sell_fee_bps END
          AND NEW.reference_price > market.sell_spread
          AND NEW.reference_price + market.buy_spread <= 1000000000
          AND NEW.reference_price % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
          AND NEW.spread_snapshot % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
          AND NEW.fee_amount = CAST(
            CAST((NEW.gross_amount * NEW.fee_bps_snapshot) / 10000 AS INTEGER)
              / (
                SELECT MIN(CAST(value AS INTEGER))
                FROM json_each(setting.denominations_json)
              ) AS INTEGER
          ) * (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          )
          AND NEW.available_shares_after BETWEEN 0 AND stock.total_shares
          AND NEW.holding_quantity_after <= stock.max_shares_per_student
          AND (
            (
              student.status = 'active'
              AND market.is_open = 1
              AND stock.status IN ('active', 'sell_only')
              AND (NEW.side = 'sell' OR stock.status = 'active')
            )
            OR (
              NEW.side = 'sell'
              AND student.status IN ('active', 'locked', 'reset_required', 'pending')
              AND stock.status IN ('active', 'sell_only', 'halted')
              AND EXISTS (
                SELECT 1
                FROM finance_transactions transaction_row
                JOIN classes classroom ON classroom.id = transaction_row.class_id
                WHERE transaction_row.class_id = NEW.class_id
                  AND transaction_row.status = 'pending'
                  AND transaction_row.transaction_type = 'stock_sell'
                  AND transaction_row.source_type = 'stock_trade'
                  AND transaction_row.source_id = NEW.id
                  AND transaction_row.idempotency_key = 'stock-trade:' || NEW.id || ':ledger'
                  AND transaction_row.actor_type = 'teacher'
                  AND transaction_row.actor_teacher_id = classroom.teacher_id
                  AND transaction_row.actor_student_id IS NULL
                  AND transaction_row.actor_job_period_id IS NULL
                  AND classroom.status = 'active'
              )
            )
          )
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
    END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_trades_liquidation_live_guard
    BEFORE INSERT ON finance_stock_trades
    WHEN EXISTS (
      SELECT 1 FROM finance_stock_liquidation_operations operation
      WHERE operation.class_id = NEW.class_id
        AND operation.stock_id = NEW.stock_id
        AND operation.student_id = NEW.student_id
        AND operation.status = 'running'
    )
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_liquidation_operations operation
        JOIN finance_stocks stock ON stock.id = operation.stock_id
          AND stock.class_id = operation.class_id
        JOIN finance_stock_markets market ON market.class_id = operation.class_id
        JOIN finance_settings setting ON setting.class_id = operation.class_id
        JOIN students student ON student.id = operation.student_id
          AND student.class_id = operation.class_id
        JOIN finance_stock_holdings holding
          ON holding.class_id = operation.class_id
          AND holding.stock_id = operation.stock_id
          AND holding.student_id = operation.student_id
        JOIN finance_accounts wallet ON wallet.id = holding.wallet_account_id
          AND wallet.class_id = operation.class_id
          AND wallet.student_id = operation.student_id
          AND wallet.account_type = 'student_wallet' AND wallet.status = 'active'
        WHERE operation.class_id = NEW.class_id
          AND operation.stock_id = NEW.stock_id
          AND operation.student_id = NEW.student_id
          AND operation.status = 'running' AND NEW.side = 'sell'
          AND stock.inventory_revision = NEW.inventory_revision_before
          AND stock.available_shares = NEW.available_shares_before
          AND wallet.revision = NEW.wallet_revision_before
          AND NEW.stock_revision = stock.revision
          AND NEW.market_revision = market.revision
          AND NEW.finance_settings_revision = setting.revision
          AND student.status IN ('active', 'locked', 'reset_required', 'pending')
          AND stock.status IN ('active', 'sell_only', 'halted')
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
    END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_trades_liquidation_economics_guard
    BEFORE INSERT ON finance_stock_trades
    WHEN EXISTS (
      SELECT 1 FROM finance_stock_liquidation_operations operation
      WHERE operation.class_id = NEW.class_id
        AND operation.stock_id = NEW.stock_id
        AND operation.student_id = NEW.student_id
        AND operation.status = 'running'
    )
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_liquidation_operations operation
        JOIN finance_stocks stock ON stock.id = operation.stock_id
          AND stock.class_id = operation.class_id
        WHERE operation.class_id = NEW.class_id
          AND operation.stock_id = NEW.stock_id
          AND operation.student_id = NEW.student_id
          AND operation.status = 'running'
          AND NEW.reference_price = operation.snapshot_reference_price
          AND NEW.spread_snapshot = operation.snapshot_spread
          AND NEW.unit_price = operation.snapshot_unit_price
          AND NEW.fee_bps_snapshot = operation.snapshot_fee_bps
          AND NEW.fee_amount = CAST(
            CAST((NEW.gross_amount * NEW.fee_bps_snapshot) / 10000 AS INTEGER)
              / operation.snapshot_denomination_step AS INTEGER
          ) * operation.snapshot_denomination_step
          AND NEW.quantity = CASE
            WHEN operation.remaining_quantity * operation.snapshot_unit_price
              <= 1000000000 THEN operation.remaining_quantity
            ELSE CAST(1000000000 / operation.snapshot_unit_price AS INTEGER)
          END
          AND NEW.available_shares_after BETWEEN 0 AND stock.total_shares
          AND NEW.holding_quantity_before = operation.remaining_quantity
          AND NEW.holding_cost_basis_before = operation.remaining_cost_basis
          AND NEW.holding_revision_before
            = operation.snapshot_holding_revision + operation.completed_chunk_count
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
    END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_trades_liquidation_metadata_guard
    BEFORE INSERT ON finance_stock_trades
    WHEN EXISTS (
      SELECT 1 FROM finance_stock_liquidation_operations operation
      WHERE operation.class_id = NEW.class_id
        AND operation.stock_id = NEW.stock_id
        AND operation.student_id = NEW.student_id
        AND operation.status = 'running'
    )
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_liquidation_operations operation
        JOIN finance_transactions transaction_row
          ON transaction_row.class_id = operation.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND transaction_row.status = 'pending'
        WHERE operation.class_id = NEW.class_id
          AND operation.stock_id = NEW.stock_id
          AND operation.student_id = NEW.student_id
          AND operation.status = 'running'
          AND transaction_row.actor_type = 'teacher'
          AND transaction_row.actor_teacher_id = operation.teacher_id
          AND transaction_row.actor_student_id IS NULL
          AND transaction_row.actor_job_period_id IS NULL
          AND json_valid(transaction_row.metadata_json) = 1
          AND json_extract(transaction_row.metadata_json, '$.operationId')
            = operation.id
          AND json_extract(transaction_row.metadata_json, '$.rootIdempotencyKey')
            = operation.root_idempotency_key
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.chunkIndex'
          ) AS INTEGER) = operation.next_chunk_index
          AND json_extract(transaction_row.metadata_json, '$.liquidationPolicy')
            = 'frozen_quote_resumable'
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.frozenStockRevision'
          ) AS INTEGER) = operation.snapshot_stock_revision
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.frozenMarketRevision'
          ) AS INTEGER) = operation.snapshot_market_revision
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.frozenFinanceSettingsRevision'
          ) AS INTEGER) = operation.snapshot_finance_settings_revision
          AND CAST(json_extract(
            transaction_row.metadata_json, '$.frozenDenominationStep'
          ) AS INTEGER) = operation.snapshot_denomination_step
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
    END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS finance_stock_trades_teacher_insert_guard;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_trades_teacher_insert_guard
    BEFORE INSERT ON finance_stock_trades
    WHEN EXISTS (
      SELECT 1 FROM finance_transactions transaction_row
      WHERE transaction_row.class_id = NEW.class_id
        AND transaction_row.source_type = 'stock_trade'
        AND transaction_row.source_id = NEW.id
        AND transaction_row.status = 'pending'
        AND transaction_row.actor_type = 'teacher'
    ) AND NOT EXISTS (
      SELECT 1
      FROM finance_transactions transaction_row
      JOIN finance_stock_liquidation_operations operation
        ON operation.class_id = transaction_row.class_id
        AND operation.id = json_extract(
          transaction_row.metadata_json, '$.operationId'
        )
      WHERE transaction_row.class_id = NEW.class_id
        AND transaction_row.source_type = 'stock_trade'
        AND transaction_row.source_id = NEW.id
        AND transaction_row.status = 'pending'
        AND transaction_row.actor_type = 'teacher'
        AND operation.status = 'running'
        AND operation.stock_id = NEW.stock_id
        AND operation.student_id = NEW.student_id
        AND json_extract(transaction_row.metadata_json, '$.rootIdempotencyKey')
          = operation.root_idempotency_key
        AND CAST(json_extract(
          transaction_row.metadata_json, '$.chunkIndex'
        ) AS INTEGER) = operation.next_chunk_index
    )
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_transactions transaction_row
        WHERE transaction_row.class_id = NEW.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND json_valid(transaction_row.metadata_json) = 1
          AND json_extract(transaction_row.metadata_json, '$.isEmergency') = 1
          AND json_extract(transaction_row.metadata_json, '$.liquidationPolicy')
            = 'current_market_terms_at_liquidation'
          AND json_extract(transaction_row.metadata_json, '$.origin') IN (
            'finance_center', 'student_exclusion', 'class_archive', 'account_recovery'
          )
          AND json_type(transaction_row.metadata_json, '$.operationId') = 'text'
          AND LENGTH(TRIM(CAST(json_extract(
            transaction_row.metadata_json, '$.operationId'
          ) AS TEXT))) BETWEEN 8 AND 160
          AND json_type(transaction_row.metadata_json, '$.interventionReason') = 'text'
          AND LENGTH(TRIM(CAST(json_extract(
            transaction_row.metadata_json, '$.interventionReason'
          ) AS TEXT))) BETWEEN 2 AND 300
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_transactions transaction_row
        WHERE transaction_row.class_id = NEW.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND json_extract(transaction_row.metadata_json, '$.studentId') = NEW.student_id
          AND json_extract(transaction_row.metadata_json, '$.stockId') = NEW.stock_id
          AND json_extract(transaction_row.metadata_json, '$.side') = NEW.side
          AND CAST(json_extract(transaction_row.metadata_json, '$.quantity') AS INTEGER) = NEW.quantity
          AND CAST(json_extract(transaction_row.metadata_json, '$.referencePrice') AS INTEGER) = NEW.reference_price
          AND CAST(json_extract(transaction_row.metadata_json, '$.spreadSnapshot') AS INTEGER) = NEW.spread_snapshot
          AND CAST(json_extract(transaction_row.metadata_json, '$.unitPrice') AS INTEGER) = NEW.unit_price
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_transactions transaction_row
        WHERE transaction_row.class_id = NEW.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND CAST(json_extract(transaction_row.metadata_json, '$.grossAmount') AS INTEGER) = NEW.gross_amount
          AND CAST(json_extract(transaction_row.metadata_json, '$.feeBpsSnapshot') AS INTEGER) = NEW.fee_bps_snapshot
          AND CAST(json_extract(transaction_row.metadata_json, '$.feeAmount') AS INTEGER) = NEW.fee_amount
          AND CAST(json_extract(transaction_row.metadata_json, '$.walletDelta') AS INTEGER) = NEW.wallet_delta
          AND CAST(json_extract(transaction_row.metadata_json, '$.costBasisRemoved') AS INTEGER) = NEW.cost_basis_removed
          AND CAST(json_extract(transaction_row.metadata_json, '$.realizedGain') AS INTEGER) = NEW.realized_gain
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_transactions transaction_row
        WHERE transaction_row.class_id = NEW.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND CAST(json_extract(transaction_row.metadata_json, '$.stockRevision') AS INTEGER) = NEW.stock_revision
          AND CAST(json_extract(transaction_row.metadata_json, '$.inventoryRevisionBefore') AS INTEGER) = NEW.inventory_revision_before
          AND CAST(json_extract(transaction_row.metadata_json, '$.marketRevision') AS INTEGER) = NEW.market_revision
          AND CAST(json_extract(transaction_row.metadata_json, '$.financeSettingsRevision') AS INTEGER) = NEW.finance_settings_revision
          AND CAST(json_extract(transaction_row.metadata_json, '$.walletRevisionBefore') AS INTEGER) = NEW.wallet_revision_before
          AND CAST(json_extract(transaction_row.metadata_json, '$.holdingRevisionBefore') AS INTEGER) = NEW.holding_revision_before
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_transactions transaction_row
        WHERE transaction_row.class_id = NEW.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND CAST(json_extract(transaction_row.metadata_json, '$.availableSharesBefore') AS INTEGER) = NEW.available_shares_before
          AND CAST(json_extract(transaction_row.metadata_json, '$.availableSharesAfter') AS INTEGER) = NEW.available_shares_after
          AND CAST(json_extract(transaction_row.metadata_json, '$.holdingQuantityBefore') AS INTEGER) = NEW.holding_quantity_before
          AND CAST(json_extract(transaction_row.metadata_json, '$.holdingQuantityAfter') AS INTEGER) = NEW.holding_quantity_after
          AND CAST(json_extract(transaction_row.metadata_json, '$.holdingCostBasisBefore') AS INTEGER) = NEW.holding_cost_basis_before
          AND CAST(json_extract(transaction_row.metadata_json, '$.holdingCostBasisAfter') AS INTEGER) = NEW.holding_cost_basis_after
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_transactions transaction_row
        JOIN students student ON student.id = NEW.student_id
          AND student.class_id = NEW.class_id
        JOIN finance_stocks stock ON stock.id = NEW.stock_id
          AND stock.class_id = NEW.class_id
        JOIN finance_stock_markets market ON market.class_id = NEW.class_id
        WHERE transaction_row.class_id = NEW.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND json_extract(transaction_row.metadata_json, '$.studentStatusSnapshot') = student.status
          AND CAST(json_extract(transaction_row.metadata_json, '$.marketWasOpen') AS INTEGER) = market.is_open
          AND json_extract(transaction_row.metadata_json, '$.stockStatusSnapshot') = stock.status
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
    END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS finance_stocks_inventory_update_guard;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stocks_inventory_update_guard
    BEFORE UPDATE ON finance_stocks
    WHEN NEW.last_trade_id IS NOT OLD.last_trade_id
    BEGIN
      SELECT CASE WHEN NEW.id <> OLD.id OR NEW.class_id <> OLD.class_id
        OR NEW.name <> OLD.name OR NEW.symbol <> OLD.symbol
        OR NEW.description <> OLD.description
        OR NEW.initial_price <> OLD.initial_price
        OR NEW.current_price <> OLD.current_price
        OR NEW.previous_price <> OLD.previous_price
        OR NEW.total_shares <> OLD.total_shares
        OR NEW.max_shares_per_student <> OLD.max_shares_per_student
        OR NEW.status <> OLD.status OR NEW.revision <> OLD.revision
        OR NEW.created_by_teacher_id <> OLD.created_by_teacher_id
        OR NEW.updated_by_actor_type <> OLD.updated_by_actor_type
        OR NEW.updated_by_teacher_id IS NOT OLD.updated_by_teacher_id
        OR NEW.created_at <> OLD.created_at
        OR NEW.inventory_revision <> OLD.inventory_revision + 1
        OR NOT EXISTS (
          SELECT 1 FROM finance_stock_trades trade
          WHERE trade.id = NEW.last_trade_id AND trade.status = 'pending'
            AND trade.class_id = NEW.class_id AND trade.stock_id = NEW.id
            AND trade.stock_revision = OLD.revision
            AND trade.inventory_revision_before = OLD.inventory_revision
            AND trade.inventory_revision_after = NEW.inventory_revision
            AND trade.available_shares_before = OLD.available_shares
            AND trade.available_shares_after = NEW.available_shares
            AND NEW.updated_at = trade.created_at
        )
        THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
    END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS finance_stock_trades_finalize_guard;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_trades_finalize_guard
    BEFORE UPDATE OF status, posted_transaction_id,
      transaction_payload_hash, posted_at ON finance_stock_trades
    BEGIN
      SELECT CASE WHEN OLD.status <> 'pending' OR NEW.status <> 'posted'
        OR OLD.posted_transaction_id IS NOT NULL
        OR OLD.transaction_payload_hash IS NOT NULL OR OLD.posted_at IS NOT NULL
        OR NEW.posted_transaction_id IS NULL
        OR NEW.transaction_payload_hash IS NULL OR NEW.posted_at IS NULL
        OR NEW.posted_at < NEW.created_at
        THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_INVALID_TRANSITION') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_transactions transaction_row
        WHERE transaction_row.id = NEW.posted_transaction_id
          AND transaction_row.class_id = NEW.class_id
          AND transaction_row.status = 'posted'
          AND transaction_row.transaction_type = CASE NEW.side
            WHEN 'buy' THEN 'stock_buy' ELSE 'stock_sell' END
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND (
            (
              transaction_row.actor_type = 'system'
              AND COALESCE(json_extract(
                transaction_row.metadata_json, '$.isEmergency'
              ), 0) <> 1
            )
            OR (
              NEW.side = 'sell'
              AND transaction_row.actor_type = 'teacher'
              AND transaction_row.actor_student_id IS NULL
              AND transaction_row.actor_job_period_id IS NULL
              AND json_valid(transaction_row.metadata_json) = 1
              AND json_extract(transaction_row.metadata_json, '$.isEmergency') = 1
              AND (
                json_extract(transaction_row.metadata_json, '$.liquidationPolicy')
                  = 'current_market_terms_at_liquidation'
                OR (
                  json_extract(
                    transaction_row.metadata_json, '$.liquidationPolicy'
                  ) = 'frozen_quote_resumable'
                  AND EXISTS (
                    SELECT 1
                    FROM finance_stock_liquidation_operations operation
                    WHERE operation.class_id = NEW.class_id
                      AND operation.stock_id = NEW.stock_id
                      AND operation.student_id = NEW.student_id
                      AND operation.teacher_id
                        = transaction_row.actor_teacher_id
                      AND operation.status = 'running'
                      AND json_extract(
                        transaction_row.metadata_json, '$.operationId'
                      ) = operation.id
                      AND json_extract(
                        transaction_row.metadata_json, '$.rootIdempotencyKey'
                      ) = operation.root_idempotency_key
                      AND CAST(json_extract(
                        transaction_row.metadata_json, '$.chunkIndex'
                      ) AS INTEGER) = operation.next_chunk_index
                  )
                )
              )
              AND json_type(transaction_row.metadata_json, '$.interventionReason') = 'text'
              AND LENGTH(TRIM(CAST(json_extract(
                transaction_row.metadata_json, '$.interventionReason'
              ) AS TEXT))) BETWEEN 2 AND 300
              AND json_extract(transaction_row.metadata_json, '$.studentId') = NEW.student_id
              AND json_extract(transaction_row.metadata_json, '$.stockId') = NEW.stock_id
              AND EXISTS (
                SELECT 1 FROM classes classroom
                WHERE classroom.id = NEW.class_id
                  AND classroom.teacher_id = transaction_row.actor_teacher_id
                  AND classroom.status = 'active'
              )
            )
          )
          AND transaction_row.payload_hash = NEW.transaction_payload_hash
          AND (SELECT COUNT(*) FROM finance_ledger_entries entry
               WHERE entry.transaction_id = transaction_row.id) = 2
          AND EXISTS (
            SELECT 1 FROM finance_ledger_entries entry
            WHERE entry.transaction_id = transaction_row.id
              AND entry.account_id = NEW.wallet_account_id
              AND entry.amount = NEW.wallet_delta
              AND entry.account_revision_after = NEW.wallet_revision_after
          )
          AND EXISTS (
            SELECT 1
            FROM finance_ledger_entries entry
            JOIN finance_accounts issuance ON issuance.id = entry.account_id
              AND issuance.class_id = entry.class_id
              AND issuance.account_type = 'class_issuance'
            WHERE entry.transaction_id = transaction_row.id
              AND entry.amount = -NEW.wallet_delta
          )
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LEDGER_MISMATCH') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_accounts wallet
        WHERE wallet.id = NEW.wallet_account_id
          AND wallet.class_id = NEW.class_id
          AND wallet.revision = NEW.wallet_revision_after
      ) THEN RAISE(ABORT, 'FINANCE_ACCOUNT_STALE') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_stock_holdings holding
        WHERE holding.class_id = NEW.class_id
          AND holding.stock_id = NEW.stock_id
          AND holding.student_id = NEW.student_id
          AND holding.wallet_account_id = NEW.wallet_account_id
          AND holding.quantity = NEW.holding_quantity_after
          AND holding.cost_basis = NEW.holding_cost_basis_after
          AND holding.revision = NEW.holding_revision_after
          AND holding.last_trade_id = NEW.id
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_PROJECTION_MISMATCH') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_stocks stock
        WHERE stock.id = NEW.stock_id AND stock.class_id = NEW.class_id
          AND stock.available_shares = NEW.available_shares_after
          AND stock.inventory_revision = NEW.inventory_revision_after
          AND stock.last_trade_id = NEW.id
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
    END;
