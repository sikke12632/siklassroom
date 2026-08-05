CREATE TABLE `finance_stock_liquidation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`revision` integer NOT NULL,
	`action` text NOT NULL,
	`stock_id` text NOT NULL,
	`student_id` text NOT NULL,
	`actor_teacher_id` text NOT NULL,
	`chunk_id` text,
	`chunk_index` integer,
	`trade_id` text,
	`request_idempotency_key` text NOT NULL,
	`request_payload_hash` text NOT NULL,
	`reason` text NOT NULL,
	`initial_quantity` integer NOT NULL,
	`remaining_quantity` integer NOT NULL,
	`sold_quantity` integer NOT NULL,
	`completed_chunk_count` integer NOT NULL,
	`quantity_delta` integer NOT NULL,
	`wallet_delta` integer NOT NULL,
	`total_gross_amount` integer NOT NULL,
	`total_fee_amount` integer NOT NULL,
	`total_wallet_delta` integer NOT NULL,
	`total_cost_basis_removed` integer NOT NULL,
	`total_realized_gain` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`chunk_id`) REFERENCES `finance_stock_liquidation_chunks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trade_id`) REFERENCES `finance_stock_trades`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operation_id`,`class_id`) REFERENCES `finance_stock_liquidation_operations`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stock_id`,`class_id`) REFERENCES `finance_stocks`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_stock_liquidation_events_id_ck" CHECK("finance_stock_liquidation_events"."id" = 'finance:stock-liquidation-event:'
        || "finance_stock_liquidation_events"."operation_id" || ':' || "finance_stock_liquidation_events"."revision"
        || ':' || "finance_stock_liquidation_events"."action"),
	CONSTRAINT "finance_stock_liquidation_events_text_ck" CHECK(LENGTH(TRIM("finance_stock_liquidation_events"."request_idempotency_key")) BETWEEN 8 AND 200
        AND LENGTH(TRIM("finance_stock_liquidation_events"."request_payload_hash")) BETWEEN 8 AND 500
        AND LENGTH(TRIM("finance_stock_liquidation_events"."reason")) BETWEEN 2 AND 300),
	CONSTRAINT "finance_stock_liquidation_events_action_ck" CHECK("finance_stock_liquidation_events"."action" IN (
        'started', 'chunk_completed', 'completed', 'cancelled'
      )),
	CONSTRAINT "finance_stock_liquidation_events_amount_ck" CHECK("finance_stock_liquidation_events"."revision" BETWEEN 0 AND 3
        AND "finance_stock_liquidation_events"."initial_quantity" BETWEEN 1 AND 1000000000
        AND "finance_stock_liquidation_events"."remaining_quantity" BETWEEN 0 AND 1000000000
        AND "finance_stock_liquidation_events"."sold_quantity" BETWEEN 0 AND 1000000000
        AND "finance_stock_liquidation_events"."initial_quantity"
          = "finance_stock_liquidation_events"."remaining_quantity" + "finance_stock_liquidation_events"."sold_quantity"
        AND "finance_stock_liquidation_events"."completed_chunk_count" BETWEEN 0 AND 2
        AND "finance_stock_liquidation_events"."quantity_delta" BETWEEN 0 AND 1000000000
        AND "finance_stock_liquidation_events"."wallet_delta" BETWEEN 0 AND 1000000000
        AND "finance_stock_liquidation_events"."total_gross_amount" BETWEEN 0 AND 1111111111
        AND "finance_stock_liquidation_events"."total_fee_amount" BETWEEN 0 AND "finance_stock_liquidation_events"."total_gross_amount"
        AND "finance_stock_liquidation_events"."total_wallet_delta"
          = "finance_stock_liquidation_events"."total_gross_amount" - "finance_stock_liquidation_events"."total_fee_amount"
        AND "finance_stock_liquidation_events"."total_wallet_delta" BETWEEN 0 AND 1000000000
        AND "finance_stock_liquidation_events"."total_cost_basis_removed" BETWEEN 0 AND 1000000000
        AND "finance_stock_liquidation_events"."total_realized_gain"
          = "finance_stock_liquidation_events"."total_wallet_delta" - "finance_stock_liquidation_events"."total_cost_basis_removed"
        AND "finance_stock_liquidation_events"."created_at" >= 0),
	CONSTRAINT "finance_stock_liquidation_events_state_ck" CHECK(("finance_stock_liquidation_events"."action" = 'started'
          AND "finance_stock_liquidation_events"."revision" = 0
          AND "finance_stock_liquidation_events"."chunk_id" IS NULL AND "finance_stock_liquidation_events"."chunk_index" IS NULL
          AND "finance_stock_liquidation_events"."trade_id" IS NULL
          AND "finance_stock_liquidation_events"."remaining_quantity" > 0 AND "finance_stock_liquidation_events"."sold_quantity" = 0
          AND "finance_stock_liquidation_events"."completed_chunk_count" = 0
          AND "finance_stock_liquidation_events"."quantity_delta" = 0 AND "finance_stock_liquidation_events"."wallet_delta" = 0
          AND "finance_stock_liquidation_events"."total_gross_amount" = 0
          AND "finance_stock_liquidation_events"."total_fee_amount" = 0
          AND "finance_stock_liquidation_events"."total_wallet_delta" = 0
          AND "finance_stock_liquidation_events"."total_cost_basis_removed" = 0
          AND "finance_stock_liquidation_events"."total_realized_gain" = 0)
        OR ("finance_stock_liquidation_events"."action" = 'chunk_completed'
          AND "finance_stock_liquidation_events"."chunk_id" IS NOT NULL AND "finance_stock_liquidation_events"."chunk_index" IS NOT NULL
          AND "finance_stock_liquidation_events"."trade_id" IS NOT NULL
          AND "finance_stock_liquidation_events"."revision" = "finance_stock_liquidation_events"."completed_chunk_count"
          AND "finance_stock_liquidation_events"."completed_chunk_count" BETWEEN 1 AND 2
          AND "finance_stock_liquidation_events"."sold_quantity" > 0
          AND "finance_stock_liquidation_events"."chunk_index" = "finance_stock_liquidation_events"."completed_chunk_count" - 1
          AND "finance_stock_liquidation_events"."quantity_delta" > 0 AND "finance_stock_liquidation_events"."wallet_delta" > 0)
        OR ("finance_stock_liquidation_events"."action" = 'completed'
          AND "finance_stock_liquidation_events"."chunk_id" IS NOT NULL AND "finance_stock_liquidation_events"."chunk_index" IS NOT NULL
          AND "finance_stock_liquidation_events"."trade_id" IS NOT NULL
          AND "finance_stock_liquidation_events"."revision" = "finance_stock_liquidation_events"."completed_chunk_count"
          AND "finance_stock_liquidation_events"."completed_chunk_count" BETWEEN 1 AND 2
          AND "finance_stock_liquidation_events"."chunk_index" = "finance_stock_liquidation_events"."completed_chunk_count" - 1
          AND "finance_stock_liquidation_events"."remaining_quantity" = 0 AND "finance_stock_liquidation_events"."sold_quantity" > 0
          AND "finance_stock_liquidation_events"."quantity_delta" = 0 AND "finance_stock_liquidation_events"."wallet_delta" = 0)
        OR ("finance_stock_liquidation_events"."action" = 'cancelled'
          AND "finance_stock_liquidation_events"."chunk_id" IS NULL AND "finance_stock_liquidation_events"."chunk_index" IS NULL
          AND "finance_stock_liquidation_events"."trade_id" IS NULL
          AND "finance_stock_liquidation_events"."revision" = "finance_stock_liquidation_events"."completed_chunk_count" + 1
          AND "finance_stock_liquidation_events"."remaining_quantity" > 0
          AND "finance_stock_liquidation_events"."quantity_delta" = 0 AND "finance_stock_liquidation_events"."wallet_delta" = 0))
);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_liquidation_events_operation_revision_action_uq` ON `finance_stock_liquidation_events` (`operation_id`,`revision`,`action`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_liquidation_events_class_action_request_uq` ON `finance_stock_liquidation_events` (`class_id`,`action`,`request_idempotency_key`);--> statement-breakpoint
CREATE INDEX `finance_stock_liquidation_events_class_created_idx` ON `finance_stock_liquidation_events` (`class_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TRIGGER `finance_stock_liquidation_events_insert_guard`
BEFORE INSERT ON `finance_stock_liquidation_events`
BEGIN
  SELECT CASE WHEN NEW.`id` != 'finance:stock-liquidation-event:'
      || NEW.`operation_id` || ':' || NEW.`revision` || ':' || NEW.`action`
    THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_EVENT_INVALID') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `finance_stock_liquidation_operations` operation
    WHERE operation.`id` = NEW.`operation_id`
      AND operation.`class_id` = NEW.`class_id`
      AND operation.`stock_id` = NEW.`stock_id`
      AND operation.`student_id` = NEW.`student_id`
      AND operation.`teacher_id` = NEW.`actor_teacher_id`
      AND NEW.`initial_quantity` = operation.`initial_quantity`
      AND (
        (NEW.`action` = 'started' AND NEW.`revision` = 0
          AND NEW.`chunk_id` IS NULL AND NEW.`chunk_index` IS NULL
          AND NEW.`trade_id` IS NULL
          AND NEW.`request_idempotency_key` = operation.`root_idempotency_key`
          AND NEW.`request_payload_hash` = operation.`payload_hash`
          AND NEW.`reason` = operation.`intervention_reason`
          AND NEW.`remaining_quantity` = operation.`initial_quantity`
          AND NEW.`sold_quantity` = 0 AND NEW.`completed_chunk_count` = 0
          AND NEW.`quantity_delta` = 0 AND NEW.`wallet_delta` = 0
          AND NEW.`total_gross_amount` = 0 AND NEW.`total_fee_amount` = 0
          AND NEW.`total_wallet_delta` = 0
          AND NEW.`total_cost_basis_removed` = 0
          AND NEW.`total_realized_gain` = 0
          AND NEW.`created_at` = operation.`created_at`)
        OR (NEW.`action` = 'chunk_completed' AND EXISTS (
          SELECT 1
          FROM `finance_stock_liquidation_chunks` chunk
          JOIN `finance_stock_trades` trade
            ON trade.`id` = chunk.`trade_id`
           AND trade.`class_id` = chunk.`class_id`
          WHERE chunk.`id` = NEW.`chunk_id`
            AND chunk.`operation_id` = operation.`id`
            AND chunk.`class_id` = operation.`class_id`
            AND chunk.`chunk_index` = NEW.`chunk_index`
            AND NEW.`revision` = chunk.`chunk_index` + 1
            AND NEW.`trade_id` = chunk.`trade_id`
            AND NEW.`request_idempotency_key` = trade.`idempotency_key`
            AND NEW.`request_payload_hash` = trade.`payload_hash`
            AND NEW.`reason` = operation.`intervention_reason`
            AND NEW.`remaining_quantity` = chunk.`holding_quantity_after`
            AND NEW.`sold_quantity`
              = operation.`initial_quantity` - chunk.`holding_quantity_after`
            AND NEW.`completed_chunk_count` = chunk.`chunk_index` + 1
            AND NEW.`quantity_delta` = chunk.`quantity`
            AND NEW.`wallet_delta` = chunk.`wallet_delta`
            AND NEW.`total_gross_amount` = (
              SELECT SUM(prior.`gross_amount`)
              FROM `finance_stock_liquidation_chunks` prior
              WHERE prior.`operation_id` = operation.`id`
                AND prior.`class_id` = operation.`class_id`
                AND prior.`chunk_index` <= chunk.`chunk_index`
            )
            AND NEW.`total_fee_amount` = (
              SELECT SUM(prior.`fee_amount`)
              FROM `finance_stock_liquidation_chunks` prior
              WHERE prior.`operation_id` = operation.`id`
                AND prior.`class_id` = operation.`class_id`
                AND prior.`chunk_index` <= chunk.`chunk_index`
            )
            AND NEW.`total_wallet_delta` = (
              SELECT SUM(prior.`wallet_delta`)
              FROM `finance_stock_liquidation_chunks` prior
              WHERE prior.`operation_id` = operation.`id`
                AND prior.`class_id` = operation.`class_id`
                AND prior.`chunk_index` <= chunk.`chunk_index`
            )
            AND NEW.`total_cost_basis_removed` = (
              SELECT SUM(prior.`cost_basis_removed`)
              FROM `finance_stock_liquidation_chunks` prior
              WHERE prior.`operation_id` = operation.`id`
                AND prior.`class_id` = operation.`class_id`
                AND prior.`chunk_index` <= chunk.`chunk_index`
            )
            AND NEW.`total_realized_gain` = (
              SELECT SUM(prior.`realized_gain`)
              FROM `finance_stock_liquidation_chunks` prior
              WHERE prior.`operation_id` = operation.`id`
                AND prior.`class_id` = operation.`class_id`
                AND prior.`chunk_index` <= chunk.`chunk_index`
            )
            AND NEW.`created_at` = chunk.`created_at`
        ))
        OR (NEW.`action` = 'completed'
          AND operation.`status` = 'completed'
          AND NEW.`revision` = operation.`revision`
          AND NEW.`chunk_index` = operation.`completed_chunk_count` - 1
          AND NEW.`completed_chunk_count` = operation.`completed_chunk_count`
          AND NEW.`chunk_id` = operation.`id` || ':chunk:' || NEW.`chunk_index`
          AND NEW.`trade_id` = operation.`last_trade_id`
          AND EXISTS (
            SELECT 1 FROM `finance_stock_trades` trade
            WHERE trade.`id` = NEW.`trade_id`
              AND trade.`class_id` = operation.`class_id`
              AND NEW.`request_idempotency_key` = trade.`idempotency_key`
              AND NEW.`request_payload_hash` = trade.`payload_hash`
          )
          AND NEW.`reason` = operation.`intervention_reason`
          AND NEW.`remaining_quantity` = 0
          AND NEW.`sold_quantity` = operation.`sold_quantity`
          AND NEW.`quantity_delta` = 0 AND NEW.`wallet_delta` = 0
          AND NEW.`total_gross_amount` = operation.`total_gross_amount`
          AND NEW.`total_fee_amount` = operation.`total_fee_amount`
          AND NEW.`total_wallet_delta` = operation.`total_wallet_delta`
          AND NEW.`total_cost_basis_removed`
            = operation.`total_cost_basis_removed`
          AND NEW.`total_realized_gain` = operation.`total_realized_gain`
          AND NEW.`created_at` = operation.`completed_at`)
        OR (NEW.`action` = 'cancelled'
          AND operation.`status` = 'cancelled'
          AND NEW.`revision` = operation.`revision`
          AND NEW.`chunk_id` IS NULL AND NEW.`chunk_index` IS NULL
          AND NEW.`trade_id` IS NULL
          AND NEW.`request_idempotency_key`
            = operation.`cancellation_idempotency_key`
          AND NEW.`request_payload_hash` = operation.`cancellation_payload_hash`
          AND NEW.`reason` = operation.`cancellation_reason`
          AND NEW.`remaining_quantity` = operation.`remaining_quantity`
          AND NEW.`sold_quantity` = operation.`sold_quantity`
          AND NEW.`completed_chunk_count` = operation.`completed_chunk_count`
          AND NEW.`quantity_delta` = 0 AND NEW.`wallet_delta` = 0
          AND NEW.`total_gross_amount` = operation.`total_gross_amount`
          AND NEW.`total_fee_amount` = operation.`total_fee_amount`
          AND NEW.`total_wallet_delta` = operation.`total_wallet_delta`
          AND NEW.`total_cost_basis_removed`
            = operation.`total_cost_basis_removed`
          AND NEW.`total_realized_gain` = operation.`total_realized_gain`
          AND NEW.`created_at` = operation.`cancelled_at`)
      )
  ) THEN RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_EVENT_INVALID') END;
END;--> statement-breakpoint
CREATE TRIGGER `finance_stock_liquidation_events_update_guard`
BEFORE UPDATE ON `finance_stock_liquidation_events`
BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_EVENT_IMMUTABLE'); END;--> statement-breakpoint
CREATE TRIGGER `finance_stock_liquidation_events_delete_guard`
BEFORE DELETE ON `finance_stock_liquidation_events`
BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_LIQUIDATION_EVENT_IMMUTABLE'); END;--> statement-breakpoint
INSERT OR IGNORE INTO `finance_stock_liquidation_events` (
  `id`, `class_id`, `operation_id`, `revision`, `action`, `stock_id`,
  `student_id`, `actor_teacher_id`, `chunk_id`, `chunk_index`, `trade_id`,
  `request_idempotency_key`, `request_payload_hash`, `reason`,
  `initial_quantity`, `remaining_quantity`, `sold_quantity`,
  `completed_chunk_count`, `quantity_delta`, `wallet_delta`,
  `total_gross_amount`, `total_fee_amount`, `total_wallet_delta`,
  `total_cost_basis_removed`, `total_realized_gain`, `created_at`
)
SELECT 'finance:stock-liquidation-event:' || operation.`id`
         || ':0:started',
       operation.`class_id`, operation.`id`, 0, 'started',
       operation.`stock_id`, operation.`student_id`, operation.`teacher_id`,
       NULL, NULL, NULL, operation.`root_idempotency_key`,
       operation.`payload_hash`, operation.`intervention_reason`,
       operation.`initial_quantity`, operation.`initial_quantity`, 0, 0,
       0, 0, 0, 0, 0, 0, 0, operation.`created_at`
FROM `finance_stock_liquidation_operations` operation;--> statement-breakpoint
INSERT OR IGNORE INTO `finance_stock_liquidation_events` (
  `id`, `class_id`, `operation_id`, `revision`, `action`, `stock_id`,
  `student_id`, `actor_teacher_id`, `chunk_id`, `chunk_index`, `trade_id`,
  `request_idempotency_key`, `request_payload_hash`, `reason`,
  `initial_quantity`, `remaining_quantity`, `sold_quantity`,
  `completed_chunk_count`, `quantity_delta`, `wallet_delta`,
  `total_gross_amount`, `total_fee_amount`, `total_wallet_delta`,
  `total_cost_basis_removed`, `total_realized_gain`, `created_at`
)
SELECT 'finance:stock-liquidation-event:' || operation.`id` || ':'
         || (chunk.`chunk_index` + 1) || ':chunk_completed',
       operation.`class_id`, operation.`id`, chunk.`chunk_index` + 1,
       'chunk_completed', operation.`stock_id`, operation.`student_id`,
       operation.`teacher_id`, chunk.`id`, chunk.`chunk_index`, chunk.`trade_id`,
       trade.`idempotency_key`, trade.`payload_hash`,
       operation.`intervention_reason`, operation.`initial_quantity`,
       chunk.`holding_quantity_after`,
       operation.`initial_quantity` - chunk.`holding_quantity_after`,
       chunk.`chunk_index` + 1, chunk.`quantity`, chunk.`wallet_delta`,
       (SELECT SUM(prior.`gross_amount`)
          FROM `finance_stock_liquidation_chunks` prior
         WHERE prior.`operation_id` = operation.`id`
           AND prior.`class_id` = operation.`class_id`
           AND prior.`chunk_index` <= chunk.`chunk_index`),
       (SELECT SUM(prior.`fee_amount`)
          FROM `finance_stock_liquidation_chunks` prior
         WHERE prior.`operation_id` = operation.`id`
           AND prior.`class_id` = operation.`class_id`
           AND prior.`chunk_index` <= chunk.`chunk_index`),
       (SELECT SUM(prior.`wallet_delta`)
          FROM `finance_stock_liquidation_chunks` prior
         WHERE prior.`operation_id` = operation.`id`
           AND prior.`class_id` = operation.`class_id`
           AND prior.`chunk_index` <= chunk.`chunk_index`),
       (SELECT SUM(prior.`cost_basis_removed`)
          FROM `finance_stock_liquidation_chunks` prior
         WHERE prior.`operation_id` = operation.`id`
           AND prior.`class_id` = operation.`class_id`
           AND prior.`chunk_index` <= chunk.`chunk_index`),
       (SELECT SUM(prior.`realized_gain`)
          FROM `finance_stock_liquidation_chunks` prior
         WHERE prior.`operation_id` = operation.`id`
           AND prior.`class_id` = operation.`class_id`
           AND prior.`chunk_index` <= chunk.`chunk_index`),
       chunk.`created_at`
FROM `finance_stock_liquidation_operations` operation
JOIN `finance_stock_liquidation_chunks` chunk
  ON chunk.`operation_id` = operation.`id`
 AND chunk.`class_id` = operation.`class_id`
JOIN `finance_stock_trades` trade
  ON trade.`id` = chunk.`trade_id` AND trade.`class_id` = chunk.`class_id`;--> statement-breakpoint
INSERT OR IGNORE INTO `finance_stock_liquidation_events` (
  `id`, `class_id`, `operation_id`, `revision`, `action`, `stock_id`,
  `student_id`, `actor_teacher_id`, `chunk_id`, `chunk_index`, `trade_id`,
  `request_idempotency_key`, `request_payload_hash`, `reason`,
  `initial_quantity`, `remaining_quantity`, `sold_quantity`,
  `completed_chunk_count`, `quantity_delta`, `wallet_delta`,
  `total_gross_amount`, `total_fee_amount`, `total_wallet_delta`,
  `total_cost_basis_removed`, `total_realized_gain`, `created_at`
)
SELECT 'finance:stock-liquidation-event:' || operation.`id` || ':'
         || operation.`revision` || ':completed',
       operation.`class_id`, operation.`id`, operation.`revision`, 'completed',
       operation.`stock_id`, operation.`student_id`, operation.`teacher_id`,
       chunk.`id`, chunk.`chunk_index`, chunk.`trade_id`,
       trade.`idempotency_key`, trade.`payload_hash`,
       operation.`intervention_reason`, operation.`initial_quantity`, 0,
       operation.`sold_quantity`, operation.`completed_chunk_count`, 0, 0,
       operation.`total_gross_amount`, operation.`total_fee_amount`,
       operation.`total_wallet_delta`, operation.`total_cost_basis_removed`,
       operation.`total_realized_gain`, operation.`completed_at`
FROM `finance_stock_liquidation_operations` operation
JOIN `finance_stock_liquidation_chunks` chunk
  ON chunk.`operation_id` = operation.`id`
 AND chunk.`class_id` = operation.`class_id`
 AND chunk.`chunk_index` = operation.`completed_chunk_count` - 1
JOIN `finance_stock_trades` trade
  ON trade.`id` = chunk.`trade_id` AND trade.`class_id` = chunk.`class_id`
WHERE operation.`status` = 'completed';--> statement-breakpoint
INSERT OR IGNORE INTO `finance_stock_liquidation_events` (
  `id`, `class_id`, `operation_id`, `revision`, `action`, `stock_id`,
  `student_id`, `actor_teacher_id`, `chunk_id`, `chunk_index`, `trade_id`,
  `request_idempotency_key`, `request_payload_hash`, `reason`,
  `initial_quantity`, `remaining_quantity`, `sold_quantity`,
  `completed_chunk_count`, `quantity_delta`, `wallet_delta`,
  `total_gross_amount`, `total_fee_amount`, `total_wallet_delta`,
  `total_cost_basis_removed`, `total_realized_gain`, `created_at`
)
SELECT 'finance:stock-liquidation-event:' || operation.`id` || ':'
         || operation.`revision` || ':cancelled',
       operation.`class_id`, operation.`id`, operation.`revision`, 'cancelled',
       operation.`stock_id`, operation.`student_id`, operation.`teacher_id`,
       NULL, NULL, NULL, operation.`cancellation_idempotency_key`,
       operation.`cancellation_payload_hash`, operation.`cancellation_reason`,
       operation.`initial_quantity`, operation.`remaining_quantity`,
       operation.`sold_quantity`, operation.`completed_chunk_count`, 0, 0,
       operation.`total_gross_amount`, operation.`total_fee_amount`,
       operation.`total_wallet_delta`, operation.`total_cost_basis_removed`,
       operation.`total_realized_gain`, operation.`cancelled_at`
FROM `finance_stock_liquidation_operations` operation
WHERE operation.`status` = 'cancelled';--> statement-breakpoint
CREATE TRIGGER `finance_stock_liquidation_capture_started_event`
AFTER INSERT ON `finance_stock_liquidation_operations`
BEGIN
  INSERT INTO `finance_stock_liquidation_events` (
    `id`, `class_id`, `operation_id`, `revision`, `action`, `stock_id`,
    `student_id`, `actor_teacher_id`, `chunk_id`, `chunk_index`, `trade_id`,
    `request_idempotency_key`, `request_payload_hash`, `reason`,
    `initial_quantity`, `remaining_quantity`, `sold_quantity`,
    `completed_chunk_count`, `quantity_delta`, `wallet_delta`,
    `total_gross_amount`, `total_fee_amount`, `total_wallet_delta`,
    `total_cost_basis_removed`, `total_realized_gain`, `created_at`
  ) VALUES (
    'finance:stock-liquidation-event:' || NEW.`id` || ':0:started',
    NEW.`class_id`, NEW.`id`, 0, 'started', NEW.`stock_id`, NEW.`student_id`,
    NEW.`teacher_id`, NULL, NULL, NULL, NEW.`root_idempotency_key`,
    NEW.`payload_hash`, NEW.`intervention_reason`, NEW.`initial_quantity`,
    NEW.`initial_quantity`, 0, 0, 0, 0, 0, 0, 0, 0, 0, NEW.`created_at`
  );
END;--> statement-breakpoint
CREATE TRIGGER `finance_stock_liquidation_capture_progress_events`
AFTER UPDATE OF `revision` ON `finance_stock_liquidation_operations`
WHEN OLD.`status` = 'running' AND NEW.`revision` = OLD.`revision` + 1
  AND NEW.`completed_chunk_count` = OLD.`completed_chunk_count` + 1
BEGIN
  INSERT INTO `finance_stock_liquidation_events` (
    `id`, `class_id`, `operation_id`, `revision`, `action`, `stock_id`,
    `student_id`, `actor_teacher_id`, `chunk_id`, `chunk_index`, `trade_id`,
    `request_idempotency_key`, `request_payload_hash`, `reason`,
    `initial_quantity`, `remaining_quantity`, `sold_quantity`,
    `completed_chunk_count`, `quantity_delta`, `wallet_delta`,
    `total_gross_amount`, `total_fee_amount`, `total_wallet_delta`,
    `total_cost_basis_removed`, `total_realized_gain`, `created_at`
  )
  SELECT 'finance:stock-liquidation-event:' || NEW.`id` || ':'
           || NEW.`revision` || ':chunk_completed',
         NEW.`class_id`, NEW.`id`, NEW.`revision`, 'chunk_completed',
         NEW.`stock_id`, NEW.`student_id`, NEW.`teacher_id`,
         chunk.`id`, chunk.`chunk_index`, chunk.`trade_id`,
         trade.`idempotency_key`, trade.`payload_hash`,
         NEW.`intervention_reason`, NEW.`initial_quantity`,
         NEW.`remaining_quantity`, NEW.`sold_quantity`,
         NEW.`completed_chunk_count`, chunk.`quantity`, chunk.`wallet_delta`,
         NEW.`total_gross_amount`, NEW.`total_fee_amount`,
         NEW.`total_wallet_delta`, NEW.`total_cost_basis_removed`,
         NEW.`total_realized_gain`, chunk.`created_at`
  FROM `finance_stock_liquidation_chunks` chunk
  JOIN `finance_stock_trades` trade
    ON trade.`id` = chunk.`trade_id` AND trade.`class_id` = chunk.`class_id`
  WHERE chunk.`operation_id` = NEW.`id` AND chunk.`class_id` = NEW.`class_id`
    AND chunk.`chunk_index` = OLD.`next_chunk_index`;

  INSERT INTO `finance_stock_liquidation_events` (
    `id`, `class_id`, `operation_id`, `revision`, `action`, `stock_id`,
    `student_id`, `actor_teacher_id`, `chunk_id`, `chunk_index`, `trade_id`,
    `request_idempotency_key`, `request_payload_hash`, `reason`,
    `initial_quantity`, `remaining_quantity`, `sold_quantity`,
    `completed_chunk_count`, `quantity_delta`, `wallet_delta`,
    `total_gross_amount`, `total_fee_amount`, `total_wallet_delta`,
    `total_cost_basis_removed`, `total_realized_gain`, `created_at`
  )
  SELECT 'finance:stock-liquidation-event:' || NEW.`id` || ':'
           || NEW.`revision` || ':completed',
         NEW.`class_id`, NEW.`id`, NEW.`revision`, 'completed',
         NEW.`stock_id`, NEW.`student_id`, NEW.`teacher_id`,
         chunk.`id`, chunk.`chunk_index`, chunk.`trade_id`,
         trade.`idempotency_key`, trade.`payload_hash`,
         NEW.`intervention_reason`, NEW.`initial_quantity`, 0,
         NEW.`sold_quantity`, NEW.`completed_chunk_count`, 0, 0,
         NEW.`total_gross_amount`, NEW.`total_fee_amount`,
         NEW.`total_wallet_delta`, NEW.`total_cost_basis_removed`,
         NEW.`total_realized_gain`, NEW.`completed_at`
  FROM `finance_stock_liquidation_chunks` chunk
  JOIN `finance_stock_trades` trade
    ON trade.`id` = chunk.`trade_id` AND trade.`class_id` = chunk.`class_id`
  WHERE NEW.`status` = 'completed'
    AND chunk.`operation_id` = NEW.`id` AND chunk.`class_id` = NEW.`class_id`
    AND chunk.`chunk_index` = OLD.`next_chunk_index`;
END;--> statement-breakpoint
CREATE TRIGGER `finance_stock_liquidation_capture_cancelled_event`
AFTER UPDATE OF `revision` ON `finance_stock_liquidation_operations`
WHEN OLD.`status` = 'running' AND NEW.`status` = 'cancelled'
  AND NEW.`revision` = OLD.`revision` + 1
BEGIN
  INSERT INTO `finance_stock_liquidation_events` (
    `id`, `class_id`, `operation_id`, `revision`, `action`, `stock_id`,
    `student_id`, `actor_teacher_id`, `chunk_id`, `chunk_index`, `trade_id`,
    `request_idempotency_key`, `request_payload_hash`, `reason`,
    `initial_quantity`, `remaining_quantity`, `sold_quantity`,
    `completed_chunk_count`, `quantity_delta`, `wallet_delta`,
    `total_gross_amount`, `total_fee_amount`, `total_wallet_delta`,
    `total_cost_basis_removed`, `total_realized_gain`, `created_at`
  ) VALUES (
    'finance:stock-liquidation-event:' || NEW.`id` || ':' || NEW.`revision`
      || ':cancelled',
    NEW.`class_id`, NEW.`id`, NEW.`revision`, 'cancelled', NEW.`stock_id`,
    NEW.`student_id`, NEW.`teacher_id`, NULL, NULL, NULL,
    NEW.`cancellation_idempotency_key`, NEW.`cancellation_payload_hash`,
    NEW.`cancellation_reason`, NEW.`initial_quantity`, NEW.`remaining_quantity`,
    NEW.`sold_quantity`, NEW.`completed_chunk_count`, 0, 0,
    NEW.`total_gross_amount`, NEW.`total_fee_amount`,
    NEW.`total_wallet_delta`, NEW.`total_cost_basis_removed`,
    NEW.`total_realized_gain`, NEW.`cancelled_at`
  );
END;
