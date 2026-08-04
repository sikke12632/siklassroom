CREATE TABLE `finance_stock_tick_retries` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`stock_id` text NOT NULL,
	`stock_revision` integer NOT NULL,
	`market_revision` integer NOT NULL,
	`scheduled_tick_at` integer NOT NULL,
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error_code` text NOT NULL,
	`last_failed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `finance_stock_markets`(`class_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stock_id`,`class_id`) REFERENCES `finance_stocks`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_stock_tick_retries_revision_ck" CHECK("finance_stock_tick_retries"."stock_revision" >= 0 AND "finance_stock_tick_retries"."market_revision" >= 0),
	CONSTRAINT "finance_stock_tick_retries_attempt_ck" CHECK("finance_stock_tick_retries"."attempt_count" BETWEEN 1 AND 1000000),
	CONSTRAINT "finance_stock_tick_retries_timing_ck" CHECK("finance_stock_tick_retries"."scheduled_tick_at" >= 0
        AND "finance_stock_tick_retries"."last_failed_at" >= "finance_stock_tick_retries"."scheduled_tick_at"
        AND "finance_stock_tick_retries"."next_attempt_at" >= "finance_stock_tick_retries"."last_failed_at"
        AND "finance_stock_tick_retries"."created_at" >= 0
        AND "finance_stock_tick_retries"."updated_at" >= "finance_stock_tick_retries"."created_at"),
	CONSTRAINT "finance_stock_tick_retries_error_ck" CHECK(LENGTH(TRIM("finance_stock_tick_retries"."last_error_code")) BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_tick_retries_occurrence_uq` ON `finance_stock_tick_retries` (`class_id`,`stock_id`,`stock_revision`,`market_revision`,`scheduled_tick_at`);--> statement-breakpoint
CREATE INDEX `finance_stock_tick_retries_next_attempt_idx` ON `finance_stock_tick_retries` (`next_attempt_at`,`class_id`);--> statement-breakpoint
CREATE INDEX `finance_stock_tick_retries_class_idx` ON `finance_stock_tick_retries` (`class_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `finance_stock_markets_due_idx` ON `finance_stock_markets` (`is_open`,`next_tick_at`,`class_id`);--> statement-breakpoint
CREATE TRIGGER `finance_stock_tick_retries_market_cleanup`
AFTER UPDATE OF `is_open`, `next_tick_at`, `revision` ON `finance_stock_markets`
BEGIN
	DELETE FROM `finance_stock_tick_retries` WHERE `class_id` = NEW.`class_id`;
END;--> statement-breakpoint
CREATE TRIGGER `finance_stock_tick_retries_stock_cleanup`
AFTER UPDATE OF `revision`, `status` ON `finance_stocks`
BEGIN
	DELETE FROM `finance_stock_tick_retries`
	WHERE `class_id` = NEW.`class_id` AND `stock_id` = NEW.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `finance_stock_tick_retries_class_cleanup`
AFTER UPDATE OF `status` ON `classes`
WHEN NEW.`status` <> 'active'
BEGIN
	DELETE FROM `finance_stock_tick_retries` WHERE `class_id` = NEW.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `finance_stock_tick_retries_insert_cleanup`
AFTER INSERT ON `finance_stock_tick_retries`
WHEN NOT EXISTS (
	SELECT 1
	FROM `finance_stock_markets` market
	JOIN `finance_stocks` stock ON stock.`class_id` = market.`class_id`
	JOIN `classes` classroom ON classroom.`id` = market.`class_id`
	WHERE market.`class_id` = NEW.`class_id` AND stock.`id` = NEW.`stock_id`
		AND market.`is_open` = 1 AND classroom.`status` = 'active'
		AND stock.`status` IN ('active', 'sell_only')
		AND stock.`revision` = NEW.`stock_revision`
		AND market.`revision` = NEW.`market_revision`
		AND market.`next_tick_at` = NEW.`scheduled_tick_at`
		AND market.`next_tick_at` <= NEW.`last_failed_at`
)
BEGIN
	DELETE FROM `finance_stock_tick_retries` WHERE `id` = NEW.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `finance_stock_tick_retries_update_cleanup`
AFTER UPDATE ON `finance_stock_tick_retries`
WHEN NOT EXISTS (
	SELECT 1
	FROM `finance_stock_markets` market
	JOIN `finance_stocks` stock ON stock.`class_id` = market.`class_id`
	JOIN `classes` classroom ON classroom.`id` = market.`class_id`
	WHERE market.`class_id` = NEW.`class_id` AND stock.`id` = NEW.`stock_id`
		AND market.`is_open` = 1 AND classroom.`status` = 'active'
		AND stock.`status` IN ('active', 'sell_only')
		AND stock.`revision` = NEW.`stock_revision`
		AND market.`revision` = NEW.`market_revision`
		AND market.`next_tick_at` = NEW.`scheduled_tick_at`
		AND market.`next_tick_at` <= NEW.`last_failed_at`
)
BEGIN
	DELETE FROM `finance_stock_tick_retries` WHERE `id` = NEW.`id`;
END;
