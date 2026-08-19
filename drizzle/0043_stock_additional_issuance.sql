CREATE TABLE IF NOT EXISTS `finance_stock_supply_events` (
  `id` text PRIMARY KEY NOT NULL,
  `class_id` text NOT NULL,
  `stock_id` text NOT NULL,
  `stock_revision_before` integer NOT NULL,
  `stock_revision_after` integer NOT NULL,
  `inventory_revision_before` integer NOT NULL,
  `inventory_revision_after` integer NOT NULL,
  `quantity` integer NOT NULL,
  `total_shares_before` integer NOT NULL,
  `total_shares_after` integer NOT NULL,
  `available_shares_before` integer NOT NULL,
  `available_shares_after` integer NOT NULL,
  `reason` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `payload_hash` text NOT NULL,
  `actor_teacher_id` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`stock_id`,`class_id`)
    REFERENCES `finance_stocks`(`id`,`class_id`),
  FOREIGN KEY (`actor_teacher_id`) REFERENCES `teachers`(`id`),
  CONSTRAINT `finance_stock_supply_events_id_ck` CHECK (
    `id` = 'finance:stock-supply:' || `stock_id` || ':' || `stock_revision_after`
  ),
  CONSTRAINT `finance_stock_supply_events_revision_ck` CHECK (
    `stock_revision_after` = `stock_revision_before` + 1
    AND `inventory_revision_after` = `inventory_revision_before` + 1
    AND `stock_revision_before` >= 0 AND `inventory_revision_before` >= 0
  ),
  CONSTRAINT `finance_stock_supply_events_quantity_ck` CHECK (
    `quantity` BETWEEN 1 AND 1000000000
    AND `total_shares_before` BETWEEN 1 AND 1000000000
    AND `total_shares_after` = `total_shares_before` + `quantity`
    AND `total_shares_after` BETWEEN 1 AND 1000000000
    AND `available_shares_before` BETWEEN 0 AND `total_shares_before`
    AND `available_shares_after` = `available_shares_before` + `quantity`
    AND `available_shares_after` <= `total_shares_after`
    AND `total_shares_before` - `available_shares_before`
      = `total_shares_after` - `available_shares_after`
  ),
  CONSTRAINT `finance_stock_supply_events_text_ck` CHECK (
    LENGTH(TRIM(`reason`)) BETWEEN 1 AND 300
    AND LENGTH(TRIM(`idempotency_key`)) BETWEEN 8 AND 160
    AND LENGTH(TRIM(`payload_hash`)) BETWEEN 8 AND 500
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `finance_stock_supply_events_stock_revision_uq`
  ON `finance_stock_supply_events` (`stock_id`,`stock_revision_after`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `finance_stock_supply_events_class_idempotency_uq`
  ON `finance_stock_supply_events` (`class_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `finance_stock_supply_events_class_created_idx`
  ON `finance_stock_supply_events` (`class_id`,`created_at`,`id`);--> statement-breakpoint

DROP TRIGGER IF EXISTS `finance_stocks_management_update_guard`;--> statement-breakpoint
CREATE TRIGGER `finance_stocks_management_update_guard`
  BEFORE UPDATE ON `finance_stocks`
  WHEN NEW.`last_trade_id` IS OLD.`last_trade_id`
  BEGIN
    SELECT CASE WHEN NEW.`id` <> OLD.`id` OR NEW.`class_id` <> OLD.`class_id`
      OR NEW.`name` <> OLD.`name` OR NEW.`symbol` <> OLD.`symbol`
      OR NEW.`description` <> OLD.`description`
      OR NEW.`initial_price` <> OLD.`initial_price`
      OR NEW.`max_shares_per_student` <> OLD.`max_shares_per_student`
      OR NOT (
        (
          NEW.`total_shares` = OLD.`total_shares`
          AND NEW.`available_shares` = OLD.`available_shares`
          AND NEW.`inventory_revision` = OLD.`inventory_revision`
        )
        OR (
          NEW.`total_shares` > OLD.`total_shares`
          AND NEW.`total_shares` - OLD.`total_shares`
            = NEW.`available_shares` - OLD.`available_shares`
          AND NEW.`inventory_revision` = OLD.`inventory_revision` + 1
          AND NEW.`current_price` = OLD.`current_price`
          AND NEW.`previous_price` = OLD.`previous_price`
          AND NEW.`status` = OLD.`status`
          AND NEW.`updated_by_actor_type` = 'teacher'
          AND NEW.`updated_by_teacher_id` IS NOT NULL
        )
      )
      OR NEW.`created_by_teacher_id` <> OLD.`created_by_teacher_id`
      OR NEW.`created_at` <> OLD.`created_at`
      OR NEW.`updated_at` < OLD.`updated_at`
      OR NEW.`revision` <> OLD.`revision` + 1
      OR NEW.`previous_price` <> CASE
        WHEN NEW.`current_price` <> OLD.`current_price` THEN OLD.`current_price`
        ELSE OLD.`previous_price` END
      THEN RAISE(ABORT, 'FINANCE_STOCK_STALE') END;
    SELECT CASE WHEN NEW.`updated_by_actor_type` = 'teacher' AND NOT EXISTS (
      SELECT 1 FROM `classes` classroom
      WHERE classroom.`id` = NEW.`class_id`
        AND classroom.`teacher_id` = NEW.`updated_by_teacher_id`
        AND classroom.`status` = 'active'
    ) THEN RAISE(ABORT, 'FINANCE_STOCK_ACCESS_DENIED') END;
    SELECT CASE WHEN NEW.`updated_by_actor_type` = 'system' AND (
      NEW.`updated_by_teacher_id` IS NOT NULL
      OR NEW.`status` <> OLD.`status`
      OR OLD.`status` NOT IN ('active', 'sell_only')
      OR NOT EXISTS (
        SELECT 1 FROM `finance_stock_markets` market
        WHERE market.`class_id` = NEW.`class_id` AND market.`is_open` = 1
      )
    ) THEN RAISE(ABORT, 'FINANCE_STOCK_SYSTEM_UPDATE_DENIED') END;
    SELECT CASE WHEN OLD.`status` = 'archived' AND NEW.`status` <> 'archived'
      THEN RAISE(ABORT, 'FINANCE_STOCK_IMMUTABLE') END;
    SELECT CASE WHEN NEW.`status` = 'archived'
      AND NEW.`available_shares` <> NEW.`total_shares`
      THEN RAISE(ABORT, 'FINANCE_STOCK_ACTIVE_HOLDINGS') END;
    SELECT CASE WHEN NEW.`current_price` > OLD.`current_price` AND EXISTS (
      SELECT 1 FROM `finance_stock_holdings` holding
      WHERE holding.`class_id` = NEW.`class_id`
        AND holding.`stock_id` = NEW.`id`
        AND holding.`quantity` > CAST(1000000000 / NEW.`current_price` AS INTEGER)
    ) THEN RAISE(ABORT, 'FINANCE_STOCK_POSITION_VALUE_LIMIT') END;
    SELECT CASE WHEN NOT EXISTS (
      SELECT 1
      FROM `finance_stock_markets` market
      JOIN `finance_settings` setting ON setting.`class_id` = market.`class_id`
      WHERE market.`class_id` = NEW.`class_id`
        AND NEW.`current_price` > market.`sell_spread`
        AND NEW.`current_price` + market.`buy_spread` <= 1000000000
        AND NEW.`current_price` % (
          SELECT MIN(CAST(value AS INTEGER))
          FROM json_each(setting.`denominations_json`)
        ) = 0
        AND market.`buy_spread` % (
          SELECT MIN(CAST(value AS INTEGER))
          FROM json_each(setting.`denominations_json`)
        ) = 0
        AND market.`sell_spread` % (
          SELECT MIN(CAST(value AS INTEGER))
          FROM json_each(setting.`denominations_json`)
        ) = 0
    ) THEN RAISE(ABORT, 'FINANCE_STOCK_DENOMINATION_MISMATCH') END;
  END;--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `finance_stock_events_supply_idempotency_guard`
  BEFORE INSERT ON `finance_stock_events`
  WHEN EXISTS (
    SELECT 1 FROM `finance_stock_supply_events` supply_event
    WHERE supply_event.`class_id` = NEW.`class_id`
      AND supply_event.`idempotency_key` = NEW.`idempotency_key`
  )
  BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_IDEMPOTENCY_CONFLICT'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_stock_supply_events_insert_guard`
  BEFORE INSERT ON `finance_stock_supply_events`
  BEGIN
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM `finance_stock_events` stock_event
      WHERE stock_event.`class_id` = NEW.`class_id`
        AND stock_event.`idempotency_key` = NEW.`idempotency_key`
    ) THEN RAISE(ABORT, 'FINANCE_STOCK_IDEMPOTENCY_CONFLICT') END;
    SELECT CASE WHEN NOT EXISTS (
      SELECT 1
      FROM `finance_stocks` stock
      JOIN `classes` classroom ON classroom.`id` = stock.`class_id`
      WHERE stock.`id` = NEW.`stock_id` AND stock.`class_id` = NEW.`class_id`
        AND classroom.`teacher_id` = NEW.`actor_teacher_id`
        AND classroom.`status` = 'active'
        AND stock.`status` <> 'archived'
        AND stock.`revision` = NEW.`stock_revision_after`
        AND stock.`inventory_revision` = NEW.`inventory_revision_after`
        AND stock.`total_shares` = NEW.`total_shares_after`
        AND stock.`available_shares` = NEW.`available_shares_after`
        AND stock.`updated_by_actor_type` = 'teacher'
        AND stock.`updated_by_teacher_id` = NEW.`actor_teacher_id`
        AND stock.`updated_at` = NEW.`created_at`
    ) THEN RAISE(ABORT, 'FINANCE_STOCK_SUPPLY_EVENT_INVALID') END;
  END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_stock_supply_events_update_guard`
  BEFORE UPDATE ON `finance_stock_supply_events`
  BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_SUPPLY_EVENT_IMMUTABLE'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `finance_stock_supply_events_delete_guard`
  BEFORE DELETE ON `finance_stock_supply_events`
  BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_SUPPLY_EVENT_IMMUTABLE'); END;
