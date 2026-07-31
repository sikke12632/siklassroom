CREATE TABLE `finance_setting_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`revision` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`previous_settings_json` text NOT NULL,
	`settings_json` text NOT NULL,
	`change_reason` text NOT NULL,
	`actor_teacher_id` text NOT NULL,
	`actor_label` text DEFAULT '교사' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_setting_revisions_revision_ck" CHECK("finance_setting_revisions"."revision" > 0),
	CONSTRAINT "finance_setting_revisions_reason_ck" CHECK(LENGTH(TRIM("finance_setting_revisions"."change_reason")) BETWEEN 2 AND 300)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_setting_revisions_class_revision_uq` ON `finance_setting_revisions` (`class_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_setting_revisions_class_idempotency_uq` ON `finance_setting_revisions` (`class_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `finance_setting_revisions_class_created_idx` ON `finance_setting_revisions` (`class_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `finance_settings` (
	`class_id` text PRIMARY KEY NOT NULL,
	`currency_name` text DEFAULT '우리 반 화폐' NOT NULL,
	`currency_unit` text DEFAULT '학급화폐' NOT NULL,
	`denominations_json` text DEFAULT '[100,500,1000,5000]' NOT NULL,
	`bank_open` integer DEFAULT true NOT NULL,
	`deposit_enabled` integer DEFAULT true NOT NULL,
	`withdrawal_enabled` integer DEFAULT true NOT NULL,
	`banker_processing_enabled` integer DEFAULT true NOT NULL,
	`max_request_amount` integer DEFAULT 100000 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_by_teacher_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_settings_text_ck" CHECK(LENGTH(TRIM("finance_settings"."currency_name")) BETWEEN 1 AND 30
      AND LENGTH(TRIM("finance_settings"."currency_unit")) BETWEEN 1 AND 10),
	CONSTRAINT "finance_settings_boolean_ck" CHECK("finance_settings"."bank_open" IN (0, 1)
      AND "finance_settings"."deposit_enabled" IN (0, 1)
      AND "finance_settings"."withdrawal_enabled" IN (0, 1)
      AND "finance_settings"."banker_processing_enabled" IN (0, 1)),
	CONSTRAINT "finance_settings_amount_ck" CHECK("finance_settings"."max_request_amount" BETWEEN 1 AND 1000000000),
	CONSTRAINT "finance_settings_revision_ck" CHECK("finance_settings"."revision" >= 0),
	CONSTRAINT "finance_settings_actor_ck" CHECK(("finance_settings"."revision" = 0 AND "finance_settings"."updated_by_teacher_id" IS NULL)
      OR ("finance_settings"."revision" > 0 AND "finance_settings"."updated_by_teacher_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `finance_settings_updated_by_idx` ON `finance_settings` (`updated_by_teacher_id`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_classes_create_settings`
AFTER INSERT ON `classes`
BEGIN
  INSERT OR IGNORE INTO finance_settings (
    class_id, currency_name, currency_unit, denominations_json,
    bank_open, deposit_enabled, withdrawal_enabled,
    banker_processing_enabled, max_request_amount, revision,
    updated_by_teacher_id, created_at, updated_at
  ) VALUES (
    NEW.id, '우리 반 화폐', '학급화폐', '[100,500,1000,5000]',
    1, 1, 1, 1, 100000, 0, NULL, NEW.created_at, NEW.updated_at
  );
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_settings_update_guard`
BEFORE UPDATE ON `finance_settings`
BEGIN
  SELECT CASE
    WHEN NEW.class_id <> OLD.class_id OR NEW.created_at <> OLD.created_at
    THEN RAISE(ABORT, 'FINANCE_SETTINGS_IDENTITY_IMMUTABLE')
  END;
  SELECT CASE
    WHEN NEW.revision <> OLD.revision + 1
    THEN RAISE(ABORT, 'FINANCE_SETTINGS_STALE')
  END;
  SELECT CASE
    WHEN NEW.updated_by_teacher_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM classes class_row
        WHERE class_row.id = NEW.class_id
          AND class_row.teacher_id = NEW.updated_by_teacher_id
          AND class_row.status = 'active'
      )
    THEN RAISE(ABORT, 'FINANCE_SETTINGS_ACCESS_DENIED')
  END;
  SELECT CASE
    WHEN json_valid(NEW.denominations_json) <> 1
      OR json_type(NEW.denominations_json) <> 'array'
      OR json_array_length(NEW.denominations_json) NOT BETWEEN 1 AND 8
      OR EXISTS (
        SELECT 1
        FROM json_each(NEW.denominations_json)
        WHERE type <> 'integer'
          OR value <= 0
          OR value > 1000000000
      )
          OR (
            SELECT COUNT(DISTINCT value)
            FROM json_each(NEW.denominations_json)
          ) <> json_array_length(NEW.denominations_json)
          OR EXISTS (
            SELECT 1
            FROM json_each(NEW.denominations_json)
            WHERE value % (
              SELECT MIN(CAST(value AS INTEGER))
              FROM json_each(NEW.denominations_json)
            ) <> 0
          )
    THEN RAISE(ABORT, 'FINANCE_SETTINGS_INVALID_DENOMINATIONS')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_settings_delete_guard`
BEFORE DELETE ON `finance_settings`
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_SETTINGS_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_setting_revisions_insert_guard`
BEFORE INSERT ON `finance_setting_revisions`
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM finance_settings setting
      JOIN classes class_row ON class_row.id = setting.class_id
      WHERE setting.class_id = NEW.class_id
        AND setting.revision = NEW.revision
        AND setting.updated_by_teacher_id = NEW.actor_teacher_id
        AND class_row.teacher_id = NEW.actor_teacher_id
        AND class_row.status = 'active'
    )
    THEN RAISE(ABORT, 'FINANCE_SETTINGS_STALE')
  END;
  SELECT CASE
    WHEN json_valid(NEW.previous_settings_json) <> 1
      OR json_valid(NEW.settings_json) <> 1
    THEN RAISE(ABORT, 'FINANCE_SETTINGS_INVALID_AUDIT')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_setting_revisions_update_guard`
BEFORE UPDATE ON `finance_setting_revisions`
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_SETTINGS_REVISION_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_setting_revisions_delete_guard`
BEFORE DELETE ON `finance_setting_revisions`
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_SETTINGS_REVISION_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_cash_requests_settings_guard`
BEFORE INSERT ON `finance_cash_requests`
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM finance_settings
      WHERE class_id = NEW.class_id AND bank_open = 1
    )
    THEN RAISE(ABORT, 'FINANCE_BANK_CLOSED')
  END;
  SELECT CASE
    WHEN NEW.request_type = 'deposit'
      AND NOT EXISTS (
        SELECT 1 FROM finance_settings
        WHERE class_id = NEW.class_id AND deposit_enabled = 1
      )
    THEN RAISE(ABORT, 'FINANCE_DEPOSIT_DISABLED')
  END;
  SELECT CASE
    WHEN NEW.request_type = 'withdrawal'
      AND NOT EXISTS (
        SELECT 1 FROM finance_settings
        WHERE class_id = NEW.class_id AND withdrawal_enabled = 1
      )
    THEN RAISE(ABORT, 'FINANCE_WITHDRAWAL_DISABLED')
  END;
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM finance_settings
      WHERE class_id = NEW.class_id
        AND NEW.amount <= max_request_amount
    )
    THEN RAISE(ABORT, 'FINANCE_REQUEST_AMOUNT_LIMIT')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_request_resolutions_settings_guard`
BEFORE INSERT ON `finance_request_resolutions`
WHEN NEW.actor_type = 'banker'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM finance_settings
      WHERE class_id = NEW.class_id AND bank_open = 1
    )
    THEN RAISE(ABORT, 'FINANCE_BANK_CLOSED')
  END;
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM finance_settings
      WHERE class_id = NEW.class_id AND banker_processing_enabled = 1
    )
    THEN RAISE(ABORT, 'FINANCE_BANKER_PROCESSING_DISABLED')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM finance_cash_requests request_row
      JOIN finance_settings setting
        ON setting.class_id = request_row.class_id
      WHERE request_row.id = NEW.request_id
        AND request_row.class_id = NEW.class_id
        AND NEW.decision = 'approved'
        AND request_row.request_type = 'deposit'
        AND setting.deposit_enabled = 0
    )
    THEN RAISE(ABORT, 'FINANCE_DEPOSIT_DISABLED')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM finance_cash_requests request_row
      JOIN finance_settings setting
        ON setting.class_id = request_row.class_id
      WHERE request_row.id = NEW.request_id
        AND request_row.class_id = NEW.class_id
        AND NEW.decision = 'approved'
        AND request_row.request_type = 'withdrawal'
        AND setting.withdrawal_enabled = 0
    )
    THEN RAISE(ABORT, 'FINANCE_WITHDRAWAL_DISABLED')
  END;
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM finance_cash_requests request_row
      JOIN finance_settings setting
        ON setting.class_id = request_row.class_id
      WHERE request_row.id = NEW.request_id
        AND request_row.class_id = NEW.class_id
        AND NEW.decision = 'approved'
        AND request_row.amount > setting.max_request_amount
    )
    THEN RAISE(ABORT, 'FINANCE_REQUEST_AMOUNT_LIMIT')
  END;
END;
--> statement-breakpoint
INSERT OR IGNORE INTO finance_settings (
  class_id, currency_name, currency_unit, denominations_json,
  bank_open, deposit_enabled, withdrawal_enabled,
  banker_processing_enabled, max_request_amount, revision,
  updated_by_teacher_id, created_at, updated_at
)
SELECT
  class_row.id, '우리 반 화폐', '학급화폐', '[100,500,1000,5000]',
  1, 1, 1, 1, 1000000000, 0, NULL,
  class_row.created_at, class_row.updated_at
FROM classes class_row;
