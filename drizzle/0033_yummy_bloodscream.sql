CREATE TABLE `finance_stock_tick_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`retry_id` text NOT NULL,
	`stock_id` text NOT NULL,
	`stock_revision` integer NOT NULL,
	`market_revision` integer NOT NULL,
	`scheduled_tick_at` integer NOT NULL,
	`stock_price_snapshot` integer NOT NULL,
	`attempt_count` integer NOT NULL,
	`error_code` text NOT NULL,
	`failed_at` integer NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`capture_status` text NOT NULL,
	FOREIGN KEY (`stock_id`,`class_id`) REFERENCES `finance_stocks`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_stock_tick_attempts_id_ck" CHECK("finance_stock_tick_attempts"."id" = 'finance:stock-tick-attempt:'
        || "finance_stock_tick_attempts"."retry_id" || ':' || "finance_stock_tick_attempts"."attempt_count"),
	CONSTRAINT "finance_stock_tick_attempts_state_ck" CHECK("finance_stock_tick_attempts"."stock_revision" >= 0 AND "finance_stock_tick_attempts"."market_revision" >= 0
        AND "finance_stock_tick_attempts"."scheduled_tick_at" >= 0
        AND "finance_stock_tick_attempts"."stock_price_snapshot" BETWEEN 1 AND 1000000000
        AND "finance_stock_tick_attempts"."attempt_count" BETWEEN 1 AND 1000000
        AND LENGTH(TRIM("finance_stock_tick_attempts"."error_code")) BETWEEN 1 AND 100
        AND "finance_stock_tick_attempts"."failed_at" >= "finance_stock_tick_attempts"."scheduled_tick_at"
        AND "finance_stock_tick_attempts"."next_attempt_at" >= "finance_stock_tick_attempts"."failed_at"
        AND "finance_stock_tick_attempts"."capture_status" IN ('exact', 'legacy_latest'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_tick_attempts_retry_attempt_uq` ON `finance_stock_tick_attempts` (`retry_id`,`attempt_count`);--> statement-breakpoint
CREATE INDEX `finance_stock_tick_attempts_class_failed_idx` ON `finance_stock_tick_attempts` (`class_id`,`failed_at`,`id`);
--> statement-breakpoint
CREATE TRIGGER `finance_stock_tick_attempts_insert_guard`
BEFORE INSERT ON `finance_stock_tick_attempts`
BEGIN
	SELECT CASE WHEN NEW.`id` != 'finance:stock-tick-attempt:'
			|| NEW.`retry_id` || ':' || NEW.`attempt_count`
		THEN RAISE(ABORT, 'FINANCE_STOCK_TICK_ATTEMPT_INVALID') END;
	SELECT CASE WHEN NOT EXISTS (
		SELECT 1
		FROM `finance_stock_tick_retries` retry
		JOIN `finance_stocks` stock
			ON stock.`id` = retry.`stock_id` AND stock.`class_id` = retry.`class_id`
		WHERE retry.`id` = NEW.`retry_id`
			AND retry.`class_id` = NEW.`class_id`
			AND retry.`stock_id` = NEW.`stock_id`
			AND retry.`stock_revision` = NEW.`stock_revision`
			AND retry.`market_revision` = NEW.`market_revision`
			AND retry.`scheduled_tick_at` = NEW.`scheduled_tick_at`
			AND stock.`current_price` = NEW.`stock_price_snapshot`
			AND retry.`attempt_count` = NEW.`attempt_count`
			AND retry.`last_error_code` = NEW.`error_code`
			AND retry.`last_failed_at` = NEW.`failed_at`
			AND retry.`next_attempt_at` = NEW.`next_attempt_at`
	) THEN RAISE(ABORT, 'FINANCE_STOCK_TICK_ATTEMPT_INVALID') END;
END;
--> statement-breakpoint
CREATE TRIGGER `finance_stock_tick_attempts_update_guard`
BEFORE UPDATE ON `finance_stock_tick_attempts`
BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_TICK_ATTEMPT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `finance_stock_tick_attempts_delete_guard`
BEFORE DELETE ON `finance_stock_tick_attempts`
BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_TICK_ATTEMPT_IMMUTABLE'); END;
--> statement-breakpoint
INSERT OR IGNORE INTO `finance_stock_tick_attempts` (
	`id`, `class_id`, `retry_id`, `stock_id`, `stock_revision`,
	`market_revision`, `scheduled_tick_at`, `stock_price_snapshot`,
	`attempt_count`, `error_code`, `failed_at`, `next_attempt_at`, `capture_status`
)
SELECT 'finance:stock-tick-attempt:' || retry.`id`
		 || ':' || retry.`attempt_count`,
	 retry.`class_id`, retry.`id`, retry.`stock_id`, retry.`stock_revision`,
	 retry.`market_revision`, retry.`scheduled_tick_at`, stock.`current_price`,
	 retry.`attempt_count`, retry.`last_error_code`, retry.`last_failed_at`,
	 retry.`next_attempt_at`, 'legacy_latest'
FROM `finance_stock_tick_retries` retry
JOIN `finance_stocks` stock
	ON stock.`id` = retry.`stock_id` AND stock.`class_id` = retry.`class_id`;
--> statement-breakpoint
CREATE TRIGGER `finance_stock_tick_capture_first_attempt`
AFTER INSERT ON `finance_stock_tick_retries`
WHEN EXISTS (
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
	INSERT INTO `finance_stock_tick_attempts` (
		`id`, `class_id`, `retry_id`, `stock_id`, `stock_revision`,
		`market_revision`, `scheduled_tick_at`, `stock_price_snapshot`,
		`attempt_count`, `error_code`, `failed_at`, `next_attempt_at`, `capture_status`
	)
	SELECT 'finance:stock-tick-attempt:' || NEW.`id` || ':' || NEW.`attempt_count`,
		NEW.`class_id`, NEW.`id`, NEW.`stock_id`, NEW.`stock_revision`,
		NEW.`market_revision`, NEW.`scheduled_tick_at`, stock.`current_price`,
		NEW.`attempt_count`, NEW.`last_error_code`, NEW.`last_failed_at`,
		NEW.`next_attempt_at`, 'exact'
	FROM `finance_stocks` stock
	WHERE stock.`id` = NEW.`stock_id` AND stock.`class_id` = NEW.`class_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `finance_stock_tick_capture_later_attempt`
AFTER UPDATE OF `attempt_count` ON `finance_stock_tick_retries`
WHEN NEW.`attempt_count` <> OLD.`attempt_count` AND EXISTS (
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
	INSERT INTO `finance_stock_tick_attempts` (
		`id`, `class_id`, `retry_id`, `stock_id`, `stock_revision`,
		`market_revision`, `scheduled_tick_at`, `stock_price_snapshot`,
		`attempt_count`, `error_code`, `failed_at`, `next_attempt_at`, `capture_status`
	)
	SELECT 'finance:stock-tick-attempt:' || NEW.`id` || ':' || NEW.`attempt_count`,
		NEW.`class_id`, NEW.`id`, NEW.`stock_id`, NEW.`stock_revision`,
		NEW.`market_revision`, NEW.`scheduled_tick_at`, stock.`current_price`,
		NEW.`attempt_count`, NEW.`last_error_code`, NEW.`last_failed_at`,
		NEW.`next_attempt_at`, 'exact'
	FROM `finance_stocks` stock
	WHERE stock.`id` = NEW.`stock_id` AND stock.`class_id` = NEW.`class_id`;
END;
