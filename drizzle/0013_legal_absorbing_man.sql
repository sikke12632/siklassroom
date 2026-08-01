CREATE TABLE `finance_stock_events` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`stock_id` text NOT NULL,
	`revision` integer NOT NULL,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`previous_snapshot_json` text,
	`stock_snapshot_json` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_teacher_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stock_id`,`class_id`) REFERENCES `finance_stocks`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_stock_events_action_ck" CHECK("finance_stock_events"."action" IN (
      'issued', 'price_changed', 'status_changed', 'automatic_tick', 'news_tick'
    )),
	CONSTRAINT "finance_stock_events_actor_ck" CHECK(("finance_stock_events"."actor_type" = 'teacher' AND "finance_stock_events"."actor_teacher_id" IS NOT NULL)
      OR ("finance_stock_events"."actor_type" = 'system' AND "finance_stock_events"."actor_teacher_id" IS NULL)),
	CONSTRAINT "finance_stock_events_revision_ck" CHECK("finance_stock_events"."revision" >= 0),
	CONSTRAINT "finance_stock_events_reason_ck" CHECK(LENGTH(TRIM("finance_stock_events"."reason")) BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_events_stock_revision_uq` ON `finance_stock_events` (`stock_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_events_class_idempotency_uq` ON `finance_stock_events` (`class_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `finance_stock_events_class_created_idx` ON `finance_stock_events` (`class_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `finance_stock_holdings` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`stock_id` text NOT NULL,
	`student_id` text NOT NULL,
	`wallet_account_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`cost_basis` integer NOT NULL,
	`revision` integer NOT NULL,
	`last_trade_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stock_id`,`class_id`) REFERENCES `finance_stocks`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`wallet_account_id`,`class_id`) REFERENCES `finance_accounts`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_stock_holdings_projection_ck" CHECK("finance_stock_holdings"."quantity" BETWEEN 0 AND 1000000000
      AND "finance_stock_holdings"."cost_basis" BETWEEN 0 AND 1000000000
      AND (("finance_stock_holdings"."quantity" = 0 AND "finance_stock_holdings"."cost_basis" = 0)
        OR ("finance_stock_holdings"."quantity" > 0 AND "finance_stock_holdings"."cost_basis" > 0))
      AND "finance_stock_holdings"."revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_holdings_stock_student_uq` ON `finance_stock_holdings` (`stock_id`,`student_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_holdings_id_class_uq` ON `finance_stock_holdings` (`id`,`class_id`);--> statement-breakpoint
CREATE INDEX `finance_stock_holdings_class_student_idx` ON `finance_stock_holdings` (`class_id`,`student_id`);--> statement-breakpoint
CREATE TABLE `finance_stock_market_events` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`revision` integer NOT NULL,
	`action` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`previous_snapshot_json` text,
	`market_snapshot_json` text NOT NULL,
	`actor_teacher_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `finance_stock_markets`(`class_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_stock_market_events_action_ck" CHECK("finance_stock_market_events"."action" IN ('configured', 'opened', 'closed', 'updated')),
	CONSTRAINT "finance_stock_market_events_revision_ck" CHECK("finance_stock_market_events"."revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_market_events_class_revision_uq` ON `finance_stock_market_events` (`class_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_market_events_class_idempotency_uq` ON `finance_stock_market_events` (`class_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `finance_stock_market_events_class_created_idx` ON `finance_stock_market_events` (`class_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `finance_stock_markets` (
	`class_id` text PRIMARY KEY NOT NULL,
	`is_open` integer DEFAULT false NOT NULL,
	`buy_fee_bps` integer DEFAULT 0 NOT NULL,
	`sell_fee_bps` integer DEFAULT 0 NOT NULL,
	`buy_spread` integer DEFAULT 0 NOT NULL,
	`sell_spread` integer DEFAULT 0 NOT NULL,
	`market_mood` text DEFAULT 'mixed' NOT NULL,
	`tick_interval_minutes` integer DEFAULT 15 NOT NULL,
	`next_tick_at` integer,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_by_teacher_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_stock_markets_open_ck" CHECK("finance_stock_markets"."is_open" IN (0, 1)),
	CONSTRAINT "finance_stock_markets_fee_ck" CHECK("finance_stock_markets"."buy_fee_bps" BETWEEN 0 AND 1000
      AND "finance_stock_markets"."sell_fee_bps" BETWEEN 0 AND 1000),
	CONSTRAINT "finance_stock_markets_spread_ck" CHECK("finance_stock_markets"."buy_spread" BETWEEN 0 AND 1000000000
      AND "finance_stock_markets"."sell_spread" BETWEEN 0 AND 1000000000),
	CONSTRAINT "finance_stock_markets_mood_ck" CHECK("finance_stock_markets"."market_mood" IN ('surge', 'bull', 'mixed', 'bear', 'crash')),
	CONSTRAINT "finance_stock_markets_tick_ck" CHECK("finance_stock_markets"."tick_interval_minutes" BETWEEN 1 AND 1440
      AND ("finance_stock_markets"."next_tick_at" IS NULL OR "finance_stock_markets"."next_tick_at" >= 0)
      AND ("finance_stock_markets"."is_open" = 0 OR "finance_stock_markets"."next_tick_at" IS NOT NULL)),
	CONSTRAINT "finance_stock_markets_revision_ck" CHECK("finance_stock_markets"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE `finance_stock_news` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`impact_bps` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`cancellation_idempotency_key` text,
	`cancellation_payload_hash` text,
	`created_by_teacher_id` text NOT NULL,
	`updated_by_actor_type` text DEFAULT 'teacher' NOT NULL,
	`updated_by_teacher_id` text,
	`cancellation_reason` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`cancelled_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_stock_news_text_ck" CHECK(LENGTH(TRIM("finance_stock_news"."title")) BETWEEN 1 AND 80
      AND LENGTH(TRIM("finance_stock_news"."content")) BETWEEN 1 AND 500),
	CONSTRAINT "finance_stock_news_impact_ck" CHECK("finance_stock_news"."impact_bps" BETWEEN -10000 AND 10000),
	CONSTRAINT "finance_stock_news_status_ck" CHECK("finance_stock_news"."status" IN ('active', 'cancelled', 'expired')),
	CONSTRAINT "finance_stock_news_state_ck" CHECK("finance_stock_news"."revision" >= 0 AND "finance_stock_news"."expires_at" > "finance_stock_news"."created_at"
      AND (
        ("finance_stock_news"."status" = 'active' AND "finance_stock_news"."cancelled_at" IS NULL
          AND "finance_stock_news"."cancellation_reason" IS NULL
          AND "finance_stock_news"."cancellation_idempotency_key" IS NULL
          AND "finance_stock_news"."cancellation_payload_hash" IS NULL)
        OR ("finance_stock_news"."status" = 'cancelled' AND "finance_stock_news"."cancelled_at" IS NOT NULL
          AND LENGTH(TRIM(COALESCE("finance_stock_news"."cancellation_reason", ''))) > 0
          AND "finance_stock_news"."cancellation_idempotency_key" IS NOT NULL
          AND "finance_stock_news"."cancellation_payload_hash" IS NOT NULL)
        OR ("finance_stock_news"."status" = 'expired' AND "finance_stock_news"."cancelled_at" IS NULL
          AND "finance_stock_news"."cancellation_reason" IS NULL
          AND "finance_stock_news"."cancellation_idempotency_key" IS NULL
          AND "finance_stock_news"."cancellation_payload_hash" IS NULL)
      )),
	CONSTRAINT "finance_stock_news_actor_ck" CHECK(("finance_stock_news"."updated_by_actor_type" = 'teacher'
        AND "finance_stock_news"."updated_by_teacher_id" IS NOT NULL)
      OR ("finance_stock_news"."updated_by_actor_type" = 'system'
        AND "finance_stock_news"."updated_by_teacher_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_news_class_idempotency_uq` ON `finance_stock_news` (`class_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_news_class_cancellation_idempotency_uq` ON `finance_stock_news` (`class_id`,`cancellation_idempotency_key`) WHERE "finance_stock_news"."cancellation_idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `finance_stock_news_class_status_idx` ON `finance_stock_news` (`class_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `finance_stock_trades` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`stock_id` text NOT NULL,
	`stock_revision` integer NOT NULL,
	`inventory_revision_before` integer NOT NULL,
	`inventory_revision_after` integer NOT NULL,
	`market_revision` integer NOT NULL,
	`finance_settings_revision` integer NOT NULL,
	`student_id` text NOT NULL,
	`wallet_account_id` text NOT NULL,
	`wallet_revision_before` integer NOT NULL,
	`wallet_revision_after` integer NOT NULL,
	`side` text NOT NULL,
	`quantity` integer NOT NULL,
	`reference_price` integer NOT NULL,
	`spread_snapshot` integer NOT NULL,
	`unit_price` integer NOT NULL,
	`gross_amount` integer NOT NULL,
	`fee_bps_snapshot` integer NOT NULL,
	`fee_amount` integer NOT NULL,
	`wallet_delta` integer NOT NULL,
	`available_shares_before` integer NOT NULL,
	`available_shares_after` integer NOT NULL,
	`holding_quantity_before` integer NOT NULL,
	`holding_quantity_after` integer NOT NULL,
	`holding_cost_basis_before` integer NOT NULL,
	`holding_cost_basis_after` integer NOT NULL,
	`holding_revision_before` integer NOT NULL,
	`holding_revision_after` integer NOT NULL,
	`cost_basis_removed` integer NOT NULL,
	`realized_gain` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`posted_transaction_id` text,
	`transaction_payload_hash` text,
	`created_at` integer NOT NULL,
	`posted_at` integer,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stock_id`,`class_id`) REFERENCES `finance_stocks`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`wallet_account_id`,`class_id`) REFERENCES `finance_accounts`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`posted_transaction_id`,`class_id`) REFERENCES `finance_transactions`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_stock_trades_side_ck" CHECK("finance_stock_trades"."side" IN ('buy', 'sell')),
	CONSTRAINT "finance_stock_trades_revision_ck" CHECK("finance_stock_trades"."stock_revision" >= 0
      AND "finance_stock_trades"."market_revision" >= 0
      AND "finance_stock_trades"."finance_settings_revision" >= 0
      AND "finance_stock_trades"."inventory_revision_after" = "finance_stock_trades"."inventory_revision_before" + 1
      AND "finance_stock_trades"."holding_revision_after" = "finance_stock_trades"."holding_revision_before" + 1
      AND "finance_stock_trades"."wallet_revision_after" = "finance_stock_trades"."wallet_revision_before" + 1),
	CONSTRAINT "finance_stock_trades_amount_ck" CHECK("finance_stock_trades"."quantity" BETWEEN 1 AND 1000000000
      AND "finance_stock_trades"."reference_price" BETWEEN 1 AND 1000000000
      AND "finance_stock_trades"."spread_snapshot" BETWEEN 0 AND 1000000000
      AND "finance_stock_trades"."unit_price" BETWEEN 1 AND 1000000000
      AND "finance_stock_trades"."unit_price" = CASE "finance_stock_trades"."side"
        WHEN 'buy' THEN "finance_stock_trades"."reference_price" + "finance_stock_trades"."spread_snapshot"
        ELSE "finance_stock_trades"."reference_price" - "finance_stock_trades"."spread_snapshot" END
      AND "finance_stock_trades"."gross_amount" = "finance_stock_trades"."unit_price" * "finance_stock_trades"."quantity"
      AND "finance_stock_trades"."gross_amount" BETWEEN 1 AND 1000000000
      AND "finance_stock_trades"."fee_bps_snapshot" BETWEEN 0 AND 1000
      AND "finance_stock_trades"."fee_amount" BETWEEN 0 AND "finance_stock_trades"."gross_amount"
      AND "finance_stock_trades"."wallet_delta" = CASE "finance_stock_trades"."side"
        WHEN 'buy' THEN -("finance_stock_trades"."gross_amount" + "finance_stock_trades"."fee_amount")
        ELSE "finance_stock_trades"."gross_amount" - "finance_stock_trades"."fee_amount" END
      AND "finance_stock_trades"."wallet_delta" <> 0
      AND ABS("finance_stock_trades"."wallet_delta") <= 1000000000),
	CONSTRAINT "finance_stock_trades_inventory_ck" CHECK("finance_stock_trades"."available_shares_before" BETWEEN 0 AND 1000000000
      AND "finance_stock_trades"."available_shares_after" BETWEEN 0 AND 1000000000
      AND "finance_stock_trades"."available_shares_after" = CASE "finance_stock_trades"."side"
        WHEN 'buy' THEN "finance_stock_trades"."available_shares_before" - "finance_stock_trades"."quantity"
        ELSE "finance_stock_trades"."available_shares_before" + "finance_stock_trades"."quantity" END),
	CONSTRAINT "finance_stock_trades_holding_ck" CHECK("finance_stock_trades"."holding_quantity_before" BETWEEN 0 AND 1000000000
      AND "finance_stock_trades"."holding_quantity_after" BETWEEN 0 AND 1000000000
      AND "finance_stock_trades"."holding_cost_basis_before" BETWEEN 0 AND 1000000000
      AND "finance_stock_trades"."holding_cost_basis_after" BETWEEN 0 AND 1000000000
      AND "finance_stock_trades"."cost_basis_removed" BETWEEN 0 AND 1000000000
      AND "finance_stock_trades"."holding_quantity_after" = CASE "finance_stock_trades"."side"
        WHEN 'buy' THEN "finance_stock_trades"."holding_quantity_before" + "finance_stock_trades"."quantity"
        ELSE "finance_stock_trades"."holding_quantity_before" - "finance_stock_trades"."quantity" END
      AND (
        ("finance_stock_trades"."side" = 'buy'
          AND "finance_stock_trades"."cost_basis_removed" = 0
          AND "finance_stock_trades"."realized_gain" = 0
          AND "finance_stock_trades"."holding_cost_basis_after" = "finance_stock_trades"."holding_cost_basis_before"
            + "finance_stock_trades"."gross_amount" + "finance_stock_trades"."fee_amount")
        OR ("finance_stock_trades"."side" = 'sell'
          AND "finance_stock_trades"."holding_quantity_before" > 0
          AND "finance_stock_trades"."quantity" <= "finance_stock_trades"."holding_quantity_before"
          AND "finance_stock_trades"."cost_basis_removed" = CAST(
            ("finance_stock_trades"."holding_cost_basis_before" * "finance_stock_trades"."quantity")
              / "finance_stock_trades"."holding_quantity_before" AS INTEGER)
          AND "finance_stock_trades"."holding_cost_basis_after" = "finance_stock_trades"."holding_cost_basis_before"
            - "finance_stock_trades"."cost_basis_removed"
          AND "finance_stock_trades"."realized_gain" = "finance_stock_trades"."wallet_delta"
            - "finance_stock_trades"."cost_basis_removed")
      )
      AND (("finance_stock_trades"."holding_quantity_after" = 0 AND "finance_stock_trades"."holding_cost_basis_after" = 0)
        OR ("finance_stock_trades"."holding_quantity_after" > 0 AND "finance_stock_trades"."holding_cost_basis_after" > 0))),
	CONSTRAINT "finance_stock_trades_status_ck" CHECK(("finance_stock_trades"."status" = 'pending'
        AND "finance_stock_trades"."posted_transaction_id" IS NULL
        AND "finance_stock_trades"."transaction_payload_hash" IS NULL
        AND "finance_stock_trades"."posted_at" IS NULL)
      OR ("finance_stock_trades"."status" = 'posted'
        AND "finance_stock_trades"."posted_transaction_id" IS NOT NULL
        AND "finance_stock_trades"."transaction_payload_hash" IS NOT NULL
        AND "finance_stock_trades"."posted_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_trades_id_class_uq` ON `finance_stock_trades` (`id`,`class_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_trades_class_student_idempotency_uq` ON `finance_stock_trades` (`class_id`,`student_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_trades_posted_transaction_uq` ON `finance_stock_trades` (`posted_transaction_id`) WHERE "finance_stock_trades"."posted_transaction_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `finance_stock_trades_student_created_idx` ON `finance_stock_trades` (`student_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `finance_stock_trades_class_created_idx` ON `finance_stock_trades` (`class_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `finance_stocks` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`initial_price` integer NOT NULL,
	`current_price` integer NOT NULL,
	`previous_price` integer NOT NULL,
	`total_shares` integer NOT NULL,
	`available_shares` integer NOT NULL,
	`max_shares_per_student` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`inventory_revision` integer DEFAULT 0 NOT NULL,
	`last_trade_id` text,
	`created_by_teacher_id` text NOT NULL,
	`updated_by_actor_type` text DEFAULT 'teacher' NOT NULL,
	`updated_by_teacher_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_stocks_text_ck" CHECK(LENGTH(TRIM("finance_stocks"."name")) BETWEEN 1 AND 40
      AND LENGTH(TRIM("finance_stocks"."symbol")) BETWEEN 1 AND 12
      AND LENGTH("finance_stocks"."description") <= 300),
	CONSTRAINT "finance_stocks_price_ck" CHECK("finance_stocks"."initial_price" BETWEEN 1 AND 1000000000
      AND "finance_stocks"."current_price" BETWEEN 1 AND 1000000000
      AND "finance_stocks"."previous_price" BETWEEN 1 AND 1000000000),
	CONSTRAINT "finance_stocks_supply_ck" CHECK("finance_stocks"."total_shares" BETWEEN 1 AND 1000000000
      AND "finance_stocks"."available_shares" BETWEEN 0 AND "finance_stocks"."total_shares"
      AND "finance_stocks"."max_shares_per_student" BETWEEN 1 AND "finance_stocks"."total_shares"),
	CONSTRAINT "finance_stocks_status_ck" CHECK("finance_stocks"."status" IN ('active', 'sell_only', 'halted', 'archived')),
	CONSTRAINT "finance_stocks_revision_ck" CHECK("finance_stocks"."revision" >= 0 AND "finance_stocks"."inventory_revision" >= 0),
	CONSTRAINT "finance_stocks_actor_ck" CHECK(("finance_stocks"."updated_by_actor_type" = 'teacher'
        AND "finance_stocks"."updated_by_teacher_id" IS NOT NULL)
      OR ("finance_stocks"."updated_by_actor_type" = 'system'
        AND "finance_stocks"."updated_by_teacher_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stocks_class_uq` ON `finance_stocks` (`class_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stocks_id_class_uq` ON `finance_stocks` (`id`,`class_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stocks_class_symbol_uq` ON `finance_stocks` (`class_id`,`symbol`);--> statement-breakpoint
CREATE INDEX `finance_stocks_class_status_idx` ON `finance_stocks` (`class_id`,`status`);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_markets_insert_guard
    BEFORE INSERT ON finance_stock_markets
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM classes classroom WHERE classroom.id = NEW.class_id
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_MARKET_ACCESS_DENIED') END;
      SELECT CASE WHEN NEW.updated_by_teacher_id IS NULL AND (
        NEW.is_open <> 0 OR NEW.buy_fee_bps <> 0 OR NEW.sell_fee_bps <> 0
        OR NEW.buy_spread <> 0 OR NEW.sell_spread <> 0
        OR NEW.market_mood <> 'mixed' OR NEW.tick_interval_minutes <> 15
        OR NEW.next_tick_at IS NOT NULL OR NEW.revision <> 0
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_MARKET_INVALID_INITIAL_STATE') END;
      SELECT CASE WHEN NEW.updated_by_teacher_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM classes classroom
        WHERE classroom.id = NEW.class_id
          AND classroom.teacher_id = NEW.updated_by_teacher_id
          AND classroom.status = 'active'
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_MARKET_ACCESS_DENIED') END;
    END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_markets_update_guard
    BEFORE UPDATE ON finance_stock_markets
    BEGIN
      SELECT CASE WHEN NEW.class_id <> OLD.class_id
        OR NEW.created_at <> OLD.created_at
        OR NEW.updated_at < OLD.updated_at
        THEN RAISE(ABORT, 'FINANCE_STOCK_MARKET_IMMUTABLE') END;
      SELECT CASE WHEN NOT (
        (
          NEW.updated_by_teacher_id IS NOT NULL
          AND NEW.revision = OLD.revision + 1
          AND (
            NEW.is_open <> OLD.is_open
            OR NEW.buy_fee_bps <> OLD.buy_fee_bps
            OR NEW.sell_fee_bps <> OLD.sell_fee_bps
            OR NEW.buy_spread <> OLD.buy_spread
            OR NEW.sell_spread <> OLD.sell_spread
            OR NEW.market_mood <> OLD.market_mood
            OR NEW.tick_interval_minutes <> OLD.tick_interval_minutes
            OR NEW.next_tick_at IS NOT OLD.next_tick_at
          )
          AND EXISTS (
            SELECT 1 FROM classes classroom
            WHERE classroom.id = NEW.class_id
              AND classroom.teacher_id = NEW.updated_by_teacher_id
              AND classroom.status = 'active'
          )
        )
        OR (
          NEW.updated_by_teacher_id IS OLD.updated_by_teacher_id
          AND NEW.revision = OLD.revision
          AND NEW.is_open = OLD.is_open
          AND NEW.buy_fee_bps = OLD.buy_fee_bps
          AND NEW.sell_fee_bps = OLD.sell_fee_bps
          AND NEW.buy_spread = OLD.buy_spread
          AND NEW.sell_spread = OLD.sell_spread
          AND NEW.market_mood = OLD.market_mood
          AND NEW.tick_interval_minutes = OLD.tick_interval_minutes
          AND NEW.next_tick_at IS NOT OLD.next_tick_at
          AND NEW.next_tick_at IS NOT NULL
          AND (OLD.next_tick_at IS NULL OR NEW.next_tick_at > OLD.next_tick_at)
        )
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_MARKET_STALE') END;
      SELECT CASE WHEN NEW.is_open = 1 AND NOT EXISTS (
        SELECT 1
        FROM finance_stocks stock
        JOIN finance_settings setting ON setting.class_id = stock.class_id
        WHERE stock.class_id = NEW.class_id
          AND stock.status <> 'archived'
          AND stock.current_price > NEW.sell_spread
          AND stock.current_price + NEW.buy_spread <= 1000000000
          AND stock.current_price % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
          AND NEW.buy_spread % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
          AND NEW.sell_spread % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_DENOMINATION_MISMATCH') END;
    END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_markets_delete_guard
    BEFORE DELETE ON finance_stock_markets
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_MARKET_IMMUTABLE'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_market_events_insert_guard
    BEFORE INSERT ON finance_stock_market_events
    BEGIN
      SELECT CASE WHEN json_valid(NEW.market_snapshot_json) <> 1
        OR (NEW.previous_snapshot_json IS NOT NULL
          AND json_valid(NEW.previous_snapshot_json) <> 1)
        OR NOT EXISTS (
          SELECT 1
          FROM finance_stock_markets market
          JOIN classes classroom ON classroom.id = market.class_id
          WHERE market.class_id = NEW.class_id
            AND market.revision = NEW.revision
            AND market.updated_by_teacher_id = NEW.actor_teacher_id
            AND classroom.teacher_id = NEW.actor_teacher_id
            AND classroom.status = 'active'
            AND (
              (NEW.action = 'opened' AND market.is_open = 1)
              OR (NEW.action = 'closed' AND market.is_open = 0)
              OR NEW.action IN ('configured', 'updated')
            )
        )
        THEN RAISE(ABORT, 'FINANCE_STOCK_MARKET_EVENT_INVALID') END;
    END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_market_events_update_guard
    BEFORE UPDATE ON finance_stock_market_events
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_MARKET_EVENT_IMMUTABLE'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_market_events_delete_guard
    BEFORE DELETE ON finance_stock_market_events
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_MARKET_EVENT_IMMUTABLE'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_settings_stock_denomination_guard
    BEFORE UPDATE OF denominations_json ON finance_settings
    WHEN NEW.denominations_json <> OLD.denominations_json
      AND json_valid(NEW.denominations_json) = 1
      AND EXISTS (
        SELECT 1
        FROM finance_stock_markets market
        JOIN finance_stocks stock ON stock.class_id = market.class_id
        WHERE market.class_id = NEW.class_id
          AND market.is_open = 1
          AND stock.status <> 'archived'
          AND (
            stock.current_price % (
              SELECT MIN(CAST(value AS INTEGER))
              FROM json_each(NEW.denominations_json)
            ) <> 0
            OR market.buy_spread % (
              SELECT MIN(CAST(value AS INTEGER))
              FROM json_each(NEW.denominations_json)
            ) <> 0
            OR market.sell_spread % (
              SELECT MIN(CAST(value AS INTEGER))
              FROM json_each(NEW.denominations_json)
            ) <> 0
          )
      )
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_DENOMINATION_MISMATCH'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stocks_insert_guard
    BEFORE INSERT ON finance_stocks
    BEGIN
      SELECT CASE WHEN NEW.revision <> 0 OR NEW.inventory_revision <> 0
        OR NEW.initial_price <> NEW.current_price
        OR NEW.previous_price <> NEW.current_price
        OR NEW.available_shares <> NEW.total_shares
        OR NEW.last_trade_id IS NOT NULL
        OR NEW.status <> 'active'
        OR NEW.updated_by_actor_type <> 'teacher'
        OR NEW.updated_by_teacher_id <> NEW.created_by_teacher_id
        THEN RAISE(ABORT, 'FINANCE_STOCK_INVALID_INITIAL_STATE') END;
      SELECT CASE WHEN NEW.symbol <> UPPER(NEW.symbol)
        OR NEW.symbol GLOB '*[^A-Z0-9_-]*'
        THEN RAISE(ABORT, 'FINANCE_STOCK_INVALID_SYMBOL') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM classes classroom
        JOIN finance_stock_markets market ON market.class_id = classroom.id
        JOIN finance_settings setting ON setting.class_id = classroom.id
        WHERE classroom.id = NEW.class_id
          AND classroom.teacher_id = NEW.created_by_teacher_id
          AND classroom.status = 'active'
          AND NEW.current_price > market.sell_spread
          AND NEW.current_price + market.buy_spread <= 1000000000
          AND NEW.current_price % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
          AND market.buy_spread % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
          AND market.sell_spread % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_ACCESS_OR_DENOMINATION_DENIED') END;
    END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stocks_management_update_guard
    BEFORE UPDATE ON finance_stocks
    WHEN NEW.last_trade_id IS OLD.last_trade_id
    BEGIN
      SELECT CASE WHEN NEW.id <> OLD.id OR NEW.class_id <> OLD.class_id
        OR NEW.name <> OLD.name OR NEW.symbol <> OLD.symbol
        OR NEW.description <> OLD.description
        OR NEW.initial_price <> OLD.initial_price
        OR NEW.total_shares <> OLD.total_shares
        OR NEW.max_shares_per_student <> OLD.max_shares_per_student
        OR NEW.available_shares <> OLD.available_shares
        OR NEW.inventory_revision <> OLD.inventory_revision
        OR NEW.created_by_teacher_id <> OLD.created_by_teacher_id
        OR NEW.created_at <> OLD.created_at OR NEW.updated_at < OLD.updated_at
        OR NEW.revision <> OLD.revision + 1
        OR (NEW.current_price = OLD.current_price AND NEW.status = OLD.status)
        OR NEW.previous_price <> CASE
          WHEN NEW.current_price <> OLD.current_price THEN OLD.current_price
          ELSE OLD.previous_price END
        THEN RAISE(ABORT, 'FINANCE_STOCK_STALE') END;
      SELECT CASE WHEN NEW.updated_by_actor_type = 'teacher' AND NOT EXISTS (
        SELECT 1 FROM classes classroom
        WHERE classroom.id = NEW.class_id
          AND classroom.teacher_id = NEW.updated_by_teacher_id
          AND classroom.status = 'active'
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_ACCESS_DENIED') END;
      SELECT CASE WHEN NEW.updated_by_actor_type = 'system' AND (
        NEW.updated_by_teacher_id IS NOT NULL
        OR NEW.current_price = OLD.current_price
        OR NEW.status <> OLD.status
        OR OLD.status NOT IN ('active', 'sell_only')
        OR NOT EXISTS (
          SELECT 1 FROM finance_stock_markets market
          WHERE market.class_id = NEW.class_id AND market.is_open = 1
        )
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_SYSTEM_UPDATE_DENIED') END;
      SELECT CASE WHEN OLD.status = 'archived' AND NEW.status <> 'archived'
        THEN RAISE(ABORT, 'FINANCE_STOCK_IMMUTABLE') END;
      SELECT CASE WHEN NEW.status = 'archived'
        AND NEW.available_shares <> NEW.total_shares
        THEN RAISE(ABORT, 'FINANCE_STOCK_ACTIVE_HOLDINGS') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_markets market
        JOIN finance_settings setting ON setting.class_id = market.class_id
        WHERE market.class_id = NEW.class_id
          AND NEW.current_price > market.sell_spread
          AND NEW.current_price + market.buy_spread <= 1000000000
          AND NEW.current_price % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
          AND market.buy_spread % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
          AND market.sell_spread % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_DENOMINATION_MISMATCH') END;
    END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_events_insert_guard
    BEFORE INSERT ON finance_stock_events
    BEGIN
      SELECT CASE WHEN json_valid(NEW.stock_snapshot_json) <> 1
        OR (NEW.previous_snapshot_json IS NOT NULL
          AND json_valid(NEW.previous_snapshot_json) <> 1)
        OR NOT EXISTS (
          SELECT 1
          FROM finance_stocks stock
          JOIN classes classroom ON classroom.id = stock.class_id
          WHERE stock.id = NEW.stock_id AND stock.class_id = NEW.class_id
            AND stock.revision = NEW.revision
            AND (
              (NEW.action = 'issued' AND NEW.revision = 0
                AND NEW.actor_type = 'teacher'
                AND NEW.actor_teacher_id = stock.created_by_teacher_id
                AND NEW.previous_snapshot_json IS NULL)
              OR (NEW.action <> 'issued' AND NEW.revision > 0
                AND NEW.actor_type = stock.updated_by_actor_type
                AND NEW.actor_teacher_id IS stock.updated_by_teacher_id)
            )
            AND (
              NEW.actor_type = 'system'
              OR (classroom.teacher_id = NEW.actor_teacher_id
                AND classroom.status = 'active')
            )
            AND (
              NEW.action NOT IN ('price_changed', 'automatic_tick', 'news_tick')
              OR EXISTS (
                SELECT 1 FROM finance_stock_markets market
                WHERE market.class_id = NEW.class_id
                  AND market.revision = CAST(
                    json_extract(NEW.stock_snapshot_json, '$.marketRevision')
                    AS INTEGER
                  )
              )
            )
        )
        THEN RAISE(ABORT, 'FINANCE_STOCK_EVENT_INVALID') END;
    END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_events_update_guard
    BEFORE UPDATE ON finance_stock_events
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_EVENT_IMMUTABLE'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_events_delete_guard
    BEFORE DELETE ON finance_stock_events
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_EVENT_IMMUTABLE'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_news_insert_guard
    BEFORE INSERT ON finance_stock_news
    BEGIN
      SELECT CASE WHEN NEW.status <> 'active' OR NEW.revision <> 0
        OR NEW.updated_by_actor_type <> 'teacher'
        OR NEW.updated_by_teacher_id <> NEW.created_by_teacher_id
        OR NEW.cancelled_at IS NOT NULL OR NEW.cancellation_reason IS NOT NULL
        OR NEW.cancellation_idempotency_key IS NOT NULL
        OR NEW.cancellation_payload_hash IS NOT NULL
        OR NOT EXISTS (
          SELECT 1 FROM classes classroom
          WHERE classroom.id = NEW.class_id
            AND classroom.teacher_id = NEW.created_by_teacher_id
            AND classroom.status = 'active'
        )
        THEN RAISE(ABORT, 'FINANCE_STOCK_NEWS_ACCESS_DENIED') END;
    END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_news_update_guard
    BEFORE UPDATE ON finance_stock_news
    BEGIN
      SELECT CASE WHEN NEW.id <> OLD.id OR NEW.class_id <> OLD.class_id
        OR NEW.title <> OLD.title OR NEW.content <> OLD.content
        OR NEW.impact_bps <> OLD.impact_bps
        OR NEW.idempotency_key <> OLD.idempotency_key
        OR NEW.payload_hash <> OLD.payload_hash
        OR NEW.created_by_teacher_id <> OLD.created_by_teacher_id
        OR NEW.created_at <> OLD.created_at OR NEW.expires_at <> OLD.expires_at
        OR NEW.revision <> OLD.revision + 1 OR OLD.status <> 'active'
        OR NEW.updated_at < OLD.updated_at
        THEN RAISE(ABORT, 'FINANCE_STOCK_NEWS_IMMUTABLE') END;
      SELECT CASE WHEN NEW.status = 'cancelled' AND NOT (
        NEW.updated_by_actor_type = 'teacher'
        AND NEW.updated_by_teacher_id IS NOT NULL
        AND NEW.cancelled_at IS NOT NULL
        AND NEW.cancelled_at = NEW.updated_at
        AND NEW.cancellation_idempotency_key IS NOT NULL
        AND NEW.cancellation_payload_hash IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM classes classroom
          WHERE classroom.id = NEW.class_id
            AND classroom.teacher_id = NEW.updated_by_teacher_id
            AND classroom.status = 'active'
        )
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_NEWS_ACCESS_DENIED') END;
      SELECT CASE WHEN NEW.status = 'expired' AND NOT (
        NEW.updated_by_actor_type = 'system'
        AND NEW.updated_by_teacher_id IS NULL
        AND NEW.cancelled_at IS NULL
        AND NEW.cancellation_reason IS NULL
        AND NEW.cancellation_idempotency_key IS NULL
        AND NEW.cancellation_payload_hash IS NULL
        AND NEW.updated_at >= NEW.expires_at
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_NEWS_INVALID_EXPIRY') END;
      SELECT CASE WHEN NEW.status NOT IN ('cancelled', 'expired')
        THEN RAISE(ABORT, 'FINANCE_STOCK_NEWS_INVALID_TRANSITION') END;
    END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_news_delete_guard
    BEFORE DELETE ON finance_stock_news
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_NEWS_IMMUTABLE'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_trades_insert_guard
    BEFORE INSERT ON finance_stock_trades
    BEGIN
      SELECT CASE WHEN NEW.status <> 'pending'
        OR NEW.posted_transaction_id IS NOT NULL
        OR NEW.transaction_payload_hash IS NOT NULL
        OR NEW.posted_at IS NOT NULL
        THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_INVALID_INITIAL_STATE') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stocks stock
        JOIN finance_stock_markets market ON market.class_id = stock.class_id
        JOIN finance_settings setting ON setting.class_id = stock.class_id
        JOIN students student ON student.id = NEW.student_id
          AND student.class_id = stock.class_id AND student.status = 'active'
        JOIN finance_accounts wallet ON wallet.id = NEW.wallet_account_id
          AND wallet.class_id = stock.class_id
          AND wallet.student_id = student.id
          AND wallet.account_type = 'student_wallet'
          AND wallet.status = 'active'
        WHERE stock.id = NEW.stock_id AND stock.class_id = NEW.class_id
          AND market.is_open = 1
          AND stock.status IN ('active', 'sell_only')
          AND (NEW.side = 'sell' OR stock.status = 'active')
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
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
      SELECT CASE WHEN COALESCE((
          SELECT holding.quantity FROM finance_stock_holdings holding
          WHERE holding.class_id = NEW.class_id
            AND holding.stock_id = NEW.stock_id
            AND holding.student_id = NEW.student_id
        ), 0) <> NEW.holding_quantity_before
        OR COALESCE((
          SELECT holding.cost_basis FROM finance_stock_holdings holding
          WHERE holding.class_id = NEW.class_id
            AND holding.stock_id = NEW.stock_id
            AND holding.student_id = NEW.student_id
        ), 0) <> NEW.holding_cost_basis_before
        OR COALESCE((
          SELECT holding.revision FROM finance_stock_holdings holding
          WHERE holding.class_id = NEW.class_id
            AND holding.stock_id = NEW.stock_id
            AND holding.student_id = NEW.student_id
        ), 0) <> NEW.holding_revision_before
        THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
    END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_holdings_insert_guard
    BEFORE INSERT ON finance_stock_holdings
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_trades trade
        JOIN students student ON student.id = trade.student_id
          AND student.class_id = trade.class_id AND student.status = 'active'
        JOIN finance_accounts wallet ON wallet.id = trade.wallet_account_id
          AND wallet.class_id = trade.class_id
          AND wallet.student_id = trade.student_id
          AND wallet.account_type = 'student_wallet'
        WHERE trade.id = NEW.last_trade_id AND trade.status = 'pending'
          AND trade.side = 'buy'
          AND trade.class_id = NEW.class_id AND trade.stock_id = NEW.stock_id
          AND trade.student_id = NEW.student_id
          AND trade.wallet_account_id = NEW.wallet_account_id
          AND trade.holding_quantity_before = 0
          AND trade.holding_cost_basis_before = 0
          AND trade.holding_revision_before = 0
          AND trade.holding_quantity_after = NEW.quantity
          AND trade.holding_cost_basis_after = NEW.cost_basis
          AND trade.holding_revision_after = NEW.revision
          AND NEW.created_at = trade.created_at
          AND NEW.updated_at = trade.created_at
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_PROJECTION_MISMATCH') END;
    END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_holdings_update_guard
    BEFORE UPDATE ON finance_stock_holdings
    BEGIN
      SELECT CASE WHEN NEW.id <> OLD.id OR NEW.class_id <> OLD.class_id
        OR NEW.stock_id <> OLD.stock_id OR NEW.student_id <> OLD.student_id
        OR NEW.wallet_account_id <> OLD.wallet_account_id
        OR NEW.created_at <> OLD.created_at
        OR NEW.revision <> OLD.revision + 1
        OR NEW.last_trade_id = OLD.last_trade_id
        OR NOT EXISTS (
          SELECT 1 FROM finance_stock_trades trade
          WHERE trade.id = NEW.last_trade_id AND trade.status = 'pending'
            AND trade.class_id = NEW.class_id AND trade.stock_id = NEW.stock_id
            AND trade.student_id = NEW.student_id
            AND trade.wallet_account_id = NEW.wallet_account_id
            AND trade.holding_quantity_before = OLD.quantity
            AND trade.holding_quantity_after = NEW.quantity
            AND trade.holding_cost_basis_before = OLD.cost_basis
            AND trade.holding_cost_basis_after = NEW.cost_basis
            AND trade.holding_revision_before = OLD.revision
            AND trade.holding_revision_after = NEW.revision
            AND NEW.updated_at = trade.created_at
        )
        THEN RAISE(ABORT, 'FINANCE_STOCK_PROJECTION_MISMATCH') END;
    END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_holdings_delete_guard
    BEFORE DELETE ON finance_stock_holdings
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_HOLDING_IMMUTABLE'); END;--> statement-breakpoint
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
    END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stocks_delete_guard
    BEFORE DELETE ON finance_stocks
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_IMMUTABLE'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_trades_identity_update_guard
    BEFORE UPDATE OF
      id, class_id, stock_id, stock_revision,
      inventory_revision_before, inventory_revision_after,
      market_revision, finance_settings_revision, student_id,
      wallet_account_id, wallet_revision_before, wallet_revision_after,
      side, quantity, reference_price, spread_snapshot, unit_price,
      gross_amount, fee_bps_snapshot, fee_amount, wallet_delta,
      available_shares_before, available_shares_after,
      holding_quantity_before, holding_quantity_after,
      holding_cost_basis_before, holding_cost_basis_after,
      holding_revision_before, holding_revision_after,
      cost_basis_removed, realized_gain, idempotency_key,
      payload_hash, created_at
    ON finance_stock_trades
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_TRADE_IMMUTABLE'); END;--> statement-breakpoint
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
            transaction_row.actor_type = 'system'
            OR (
              NEW.side = 'sell'
              AND transaction_row.actor_type = 'teacher'
              AND LENGTH(TRIM(COALESCE(
                json_extract(transaction_row.metadata_json, '$.interventionReason'),
                ''
              ))) BETWEEN 1 AND 300
              AND json_extract(transaction_row.metadata_json, '$.studentId') = NEW.student_id
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
    END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_trades_delete_guard
    BEFORE DELETE ON finance_stock_trades
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_TRADE_IMMUTABLE'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_transactions_reversal_guard
    BEFORE INSERT ON finance_transactions
    WHEN NEW.transaction_type = 'reversal' AND EXISTS (
      SELECT 1 FROM finance_transactions original
      WHERE original.id = NEW.reversal_of_transaction_id
        AND original.source_type = 'stock_trade'
    )
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_REVERSAL_REQUIRES_TRADE'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_classes_archive_guard
    BEFORE UPDATE OF status ON classes
    WHEN NEW.status = 'archived' AND OLD.status <> 'archived'
      AND EXISTS (
        SELECT 1 FROM finance_stock_holdings holding
        WHERE holding.class_id = NEW.id AND holding.quantity > 0
      )
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_ACTIVE_CLASS'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_students_exclude_guard
    BEFORE UPDATE OF status ON students
    WHEN NEW.status = 'excluded' AND OLD.status <> 'excluded'
      AND EXISTS (
        SELECT 1 FROM finance_stock_holdings holding
        WHERE holding.class_id = NEW.class_id
          AND holding.student_id = NEW.id AND holding.quantity > 0
      )
    BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_ACTIVE_STUDENT'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_classes_create_stock_market
    AFTER INSERT ON classes
    BEGIN
      INSERT OR IGNORE INTO finance_stock_markets (
        class_id, is_open, buy_fee_bps, sell_fee_bps,
        buy_spread, sell_spread, market_mood,
        tick_interval_minutes, next_tick_at, revision,
        updated_by_teacher_id, created_at, updated_at
      ) VALUES (
        NEW.id, 0, 0, 0, 0, 0, 'mixed', 15, NULL, 0,
        NULL, NEW.created_at, NEW.updated_at
      );
    END;--> statement-breakpoint
