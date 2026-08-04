CREATE TABLE `finance_deposit_maturity_retries` (
	`contract_id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error_code` text NOT NULL,
	`last_failed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contract_id`,`class_id`) REFERENCES `finance_deposit_contracts`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_deposit_maturity_retries_attempt_ck" CHECK("finance_deposit_maturity_retries"."attempt_count" BETWEEN 1 AND 1000000),
	CONSTRAINT "finance_deposit_maturity_retries_timing_ck" CHECK("finance_deposit_maturity_retries"."next_attempt_at" >= "finance_deposit_maturity_retries"."last_failed_at"
        AND "finance_deposit_maturity_retries"."last_failed_at" >= 0
        AND "finance_deposit_maturity_retries"."created_at" >= 0
        AND "finance_deposit_maturity_retries"."updated_at" >= "finance_deposit_maturity_retries"."created_at"),
	CONSTRAINT "finance_deposit_maturity_retries_error_ck" CHECK(LENGTH(TRIM("finance_deposit_maturity_retries"."last_error_code")) BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE INDEX `finance_deposit_maturity_retries_next_attempt_idx` ON `finance_deposit_maturity_retries` (`next_attempt_at`,`contract_id`);--> statement-breakpoint
CREATE INDEX `finance_deposit_maturity_retries_class_idx` ON `finance_deposit_maturity_retries` (`class_id`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `finance_deposit_contracts_maturity_idx` ON `finance_deposit_contracts` (`matures_at`,`id`);--> statement-breakpoint
CREATE TRIGGER `finance_deposit_maturity_retries_settlement_cleanup`
AFTER INSERT ON `finance_deposit_settlements`
BEGIN
	DELETE FROM `finance_deposit_maturity_retries`
	WHERE `contract_id` = NEW.`contract_id` AND `class_id` = NEW.`class_id`;
END;--> statement-breakpoint
CREATE TRIGGER `finance_deposit_maturity_retries_insert_cleanup`
AFTER INSERT ON `finance_deposit_maturity_retries`
WHEN EXISTS (
	SELECT 1 FROM `finance_deposit_settlements` settlement
	WHERE settlement.`contract_id` = NEW.`contract_id`
		AND settlement.`class_id` = NEW.`class_id`
)
BEGIN
	DELETE FROM `finance_deposit_maturity_retries`
	WHERE `contract_id` = NEW.`contract_id` AND `class_id` = NEW.`class_id`;
END;--> statement-breakpoint
CREATE TRIGGER `finance_deposit_maturity_retries_update_cleanup`
AFTER UPDATE ON `finance_deposit_maturity_retries`
WHEN EXISTS (
	SELECT 1 FROM `finance_deposit_settlements` settlement
	WHERE settlement.`contract_id` = NEW.`contract_id`
		AND settlement.`class_id` = NEW.`class_id`
)
BEGIN
	DELETE FROM `finance_deposit_maturity_retries`
	WHERE `contract_id` = NEW.`contract_id` AND `class_id` = NEW.`class_id`;
END;
