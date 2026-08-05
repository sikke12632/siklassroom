CREATE TABLE `finance_deposit_maturity_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`attempt_count` integer NOT NULL,
	`error_code` text NOT NULL,
	`failed_at` integer NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`capture_status` text NOT NULL,
	FOREIGN KEY (`contract_id`,`class_id`) REFERENCES `finance_deposit_contracts`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_deposit_maturity_attempts_id_ck" CHECK("finance_deposit_maturity_attempts"."id" = 'finance:deposit-maturity-attempt:'
        || "finance_deposit_maturity_attempts"."contract_id" || ':' || "finance_deposit_maturity_attempts"."attempt_count"),
	CONSTRAINT "finance_deposit_maturity_attempts_state_ck" CHECK("finance_deposit_maturity_attempts"."attempt_count" BETWEEN 1 AND 1000000
        AND LENGTH(TRIM("finance_deposit_maturity_attempts"."error_code")) BETWEEN 1 AND 100
        AND "finance_deposit_maturity_attempts"."failed_at" >= 0
        AND "finance_deposit_maturity_attempts"."next_attempt_at" >= "finance_deposit_maturity_attempts"."failed_at"
        AND "finance_deposit_maturity_attempts"."capture_status" IN ('exact', 'legacy_latest'))
);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_deposit_maturity_attempts_contract_attempt_uq` ON `finance_deposit_maturity_attempts` (`contract_id`,`attempt_count`);--> statement-breakpoint
CREATE INDEX `finance_deposit_maturity_attempts_class_failed_idx` ON `finance_deposit_maturity_attempts` (`class_id`,`failed_at`,`id`);--> statement-breakpoint
CREATE TRIGGER `finance_deposit_maturity_attempts_insert_guard`
BEFORE INSERT ON `finance_deposit_maturity_attempts`
BEGIN
	SELECT CASE WHEN NEW.`id` != 'finance:deposit-maturity-attempt:'
			|| NEW.`contract_id` || ':' || NEW.`attempt_count`
		THEN RAISE(ABORT, 'FINANCE_DEPOSIT_MATURITY_ATTEMPT_INVALID') END;
	SELECT CASE WHEN NOT EXISTS (
		SELECT 1 FROM `finance_deposit_maturity_retries` retry
		WHERE retry.`contract_id` = NEW.`contract_id`
			AND retry.`class_id` = NEW.`class_id`
			AND retry.`attempt_count` = NEW.`attempt_count`
			AND retry.`last_error_code` = NEW.`error_code`
			AND retry.`last_failed_at` = NEW.`failed_at`
			AND retry.`next_attempt_at` = NEW.`next_attempt_at`
	) THEN RAISE(ABORT, 'FINANCE_DEPOSIT_MATURITY_ATTEMPT_INVALID') END;
END;--> statement-breakpoint
CREATE TRIGGER `finance_deposit_maturity_attempts_update_guard`
BEFORE UPDATE ON `finance_deposit_maturity_attempts`
BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_MATURITY_ATTEMPT_IMMUTABLE'); END;--> statement-breakpoint
CREATE TRIGGER `finance_deposit_maturity_attempts_delete_guard`
BEFORE DELETE ON `finance_deposit_maturity_attempts`
BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_MATURITY_ATTEMPT_IMMUTABLE'); END;--> statement-breakpoint
INSERT OR IGNORE INTO `finance_deposit_maturity_attempts` (
	`id`, `class_id`, `contract_id`, `attempt_count`, `error_code`,
	`failed_at`, `next_attempt_at`, `capture_status`
)
SELECT 'finance:deposit-maturity-attempt:' || retry.`contract_id`
		 || ':' || retry.`attempt_count`,
	 retry.`class_id`, retry.`contract_id`, retry.`attempt_count`,
	 retry.`last_error_code`, retry.`last_failed_at`, retry.`next_attempt_at`,
	 'legacy_latest'
FROM `finance_deposit_maturity_retries` retry;--> statement-breakpoint
CREATE TRIGGER `finance_deposit_maturity_capture_first_attempt`
AFTER INSERT ON `finance_deposit_maturity_retries`
WHEN NOT EXISTS (
	SELECT 1 FROM `finance_deposit_settlements` settlement
	WHERE settlement.`contract_id` = NEW.`contract_id`
		AND settlement.`class_id` = NEW.`class_id`
)
BEGIN
	INSERT INTO `finance_deposit_maturity_attempts` (
		`id`, `class_id`, `contract_id`, `attempt_count`, `error_code`,
		`failed_at`, `next_attempt_at`, `capture_status`
	) VALUES (
		'finance:deposit-maturity-attempt:' || NEW.`contract_id`
			|| ':' || NEW.`attempt_count`,
		NEW.`class_id`, NEW.`contract_id`, NEW.`attempt_count`,
		NEW.`last_error_code`, NEW.`last_failed_at`, NEW.`next_attempt_at`, 'exact'
	);
END;--> statement-breakpoint
CREATE TRIGGER `finance_deposit_maturity_capture_later_attempt`
AFTER UPDATE OF `attempt_count` ON `finance_deposit_maturity_retries`
WHEN NEW.`attempt_count` <> OLD.`attempt_count` AND NOT EXISTS (
	SELECT 1 FROM `finance_deposit_settlements` settlement
	WHERE settlement.`contract_id` = NEW.`contract_id`
		AND settlement.`class_id` = NEW.`class_id`
)
BEGIN
	INSERT INTO `finance_deposit_maturity_attempts` (
		`id`, `class_id`, `contract_id`, `attempt_count`, `error_code`,
		`failed_at`, `next_attempt_at`, `capture_status`
	) VALUES (
		'finance:deposit-maturity-attempt:' || NEW.`contract_id`
			|| ':' || NEW.`attempt_count`,
		NEW.`class_id`, NEW.`contract_id`, NEW.`attempt_count`,
		NEW.`last_error_code`, NEW.`last_failed_at`, NEW.`next_attempt_at`, 'exact'
	);
END;
