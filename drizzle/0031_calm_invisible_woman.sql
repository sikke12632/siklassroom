CREATE TABLE `finance_deposit_product_lifecycle_events` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`product_id` text NOT NULL,
	`revision` integer NOT NULL,
	`action` text NOT NULL,
	`capture_status` text NOT NULL,
	`source_event_id` text,
	`product_snapshot_json` text NOT NULL,
	`actor_teacher_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_event_id`) REFERENCES `finance_deposit_product_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`,`class_id`) REFERENCES `finance_deposit_products`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_deposit_product_lifecycle_id_ck" CHECK("finance_deposit_product_lifecycle_events"."id" = 'finance:deposit-product-lifecycle:'
        || "finance_deposit_product_lifecycle_events"."product_id" || ':' || "finance_deposit_product_lifecycle_events"."revision"),
	CONSTRAINT "finance_deposit_product_lifecycle_state_ck" CHECK("finance_deposit_product_lifecycle_events"."action" IN ('issued', 'opened', 'paused')
        AND (("finance_deposit_product_lifecycle_events"."action" = 'issued' AND "finance_deposit_product_lifecycle_events"."revision" = 0)
          OR ("finance_deposit_product_lifecycle_events"."action" IN ('opened', 'paused') AND "finance_deposit_product_lifecycle_events"."revision" > 0))
        AND "finance_deposit_product_lifecycle_events"."capture_status" IN (
          'exact', 'legacy_event', 'legacy_current_only'
        )
        AND (("finance_deposit_product_lifecycle_events"."capture_status" = 'legacy_event'
            AND "finance_deposit_product_lifecycle_events"."source_event_id" IS NOT NULL)
          OR ("finance_deposit_product_lifecycle_events"."capture_status" IN ('exact', 'legacy_current_only')
            AND "finance_deposit_product_lifecycle_events"."source_event_id" IS NULL))
        AND json_valid("finance_deposit_product_lifecycle_events"."product_snapshot_json") = 1
        AND "finance_deposit_product_lifecycle_events"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_deposit_product_lifecycle_product_revision_uq` ON `finance_deposit_product_lifecycle_events` (`product_id`,`revision`);--> statement-breakpoint
CREATE INDEX `finance_deposit_product_lifecycle_class_created_idx` ON `finance_deposit_product_lifecycle_events` (`class_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE TRIGGER `finance_deposit_product_lifecycle_insert_guard`
BEFORE INSERT ON `finance_deposit_product_lifecycle_events`
BEGIN
  SELECT CASE WHEN NEW.`id` != 'finance:deposit-product-lifecycle:'
      || NEW.`product_id` || ':' || NEW.`revision`
    THEN RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_LIFECYCLE_INVALID') END;
  SELECT CASE WHEN NOT (
    (NEW.`capture_status` = 'legacy_event' AND EXISTS (
      SELECT 1 FROM `finance_deposit_product_events` source_event
      WHERE source_event.`id` = NEW.`source_event_id`
        AND source_event.`class_id` = NEW.`class_id`
        AND source_event.`product_id` = NEW.`product_id`
        AND source_event.`revision` = NEW.`revision`
        AND source_event.`action` = NEW.`action`
        AND source_event.`product_snapshot_json` = NEW.`product_snapshot_json`
        AND source_event.`actor_teacher_id` = NEW.`actor_teacher_id`
        AND source_event.`created_at` = NEW.`created_at`
    ))
    OR (NEW.`capture_status` IN ('exact', 'legacy_current_only')
      AND NEW.`source_event_id` IS NULL AND EXISTS (
        SELECT 1 FROM `finance_deposit_products` product
        WHERE product.`id` = NEW.`product_id`
          AND product.`class_id` = NEW.`class_id`
          AND product.`revision` = NEW.`revision`
          AND product.`updated_by_teacher_id` = NEW.`actor_teacher_id`
          AND product.`updated_at` = NEW.`created_at`
          AND ((NEW.`action` = 'issued' AND product.`revision` = 0)
            OR (NEW.`action` = 'opened' AND product.`revision` > 0
              AND product.`is_open` = 1)
            OR (NEW.`action` = 'paused' AND product.`revision` > 0
              AND product.`is_open` = 0))
          AND json_extract(NEW.`product_snapshot_json`, '$.description')
            = product.`description`
          AND json_extract(NEW.`product_snapshot_json`, '$.earlyInterestBps')
            = product.`early_interest_bps`
          AND CAST(json_extract(NEW.`product_snapshot_json`, '$.isOpen') AS INTEGER)
            = product.`is_open`
          AND json_extract(NEW.`product_snapshot_json`, '$.maturityInterestBps')
            = product.`maturity_interest_bps`
          AND json_extract(NEW.`product_snapshot_json`, '$.maxAmount')
            = product.`max_amount`
          AND json_extract(NEW.`product_snapshot_json`, '$.minAmount')
            = product.`min_amount`
          AND json_extract(NEW.`product_snapshot_json`, '$.name') = product.`name`
          AND json_extract(NEW.`product_snapshot_json`, '$.revision')
            = product.`revision`
          AND json_extract(NEW.`product_snapshot_json`, '$.termWeeks')
            = product.`term_weeks`
      ))
  ) THEN RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_LIFECYCLE_INVALID') END;
END;
--> statement-breakpoint
CREATE TRIGGER `finance_deposit_product_lifecycle_update_guard`
BEFORE UPDATE ON `finance_deposit_product_lifecycle_events`
BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_LIFECYCLE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `finance_deposit_product_lifecycle_delete_guard`
BEFORE DELETE ON `finance_deposit_product_lifecycle_events`
BEGIN SELECT RAISE(ABORT, 'FINANCE_DEPOSIT_PRODUCT_LIFECYCLE_IMMUTABLE'); END;
--> statement-breakpoint
INSERT OR IGNORE INTO `finance_deposit_product_lifecycle_events` (
  `id`, `class_id`, `product_id`, `revision`, `action`, `capture_status`,
  `source_event_id`, `product_snapshot_json`, `actor_teacher_id`, `created_at`
)
SELECT 'finance:deposit-product-lifecycle:' || source_event.`product_id`
         || ':' || source_event.`revision`,
       source_event.`class_id`, source_event.`product_id`, source_event.`revision`,
       source_event.`action`, 'legacy_event', source_event.`id`,
       source_event.`product_snapshot_json`, source_event.`actor_teacher_id`,
       source_event.`created_at`
FROM `finance_deposit_product_events` source_event;
--> statement-breakpoint
INSERT OR IGNORE INTO `finance_deposit_product_lifecycle_events` (
  `id`, `class_id`, `product_id`, `revision`, `action`, `capture_status`,
  `source_event_id`, `product_snapshot_json`, `actor_teacher_id`, `created_at`
)
SELECT 'finance:deposit-product-lifecycle:' || product.`id`
         || ':' || product.`revision`,
       product.`class_id`, product.`id`, product.`revision`,
       CASE WHEN product.`revision` = 0 THEN 'issued'
         WHEN product.`is_open` = 1 THEN 'opened' ELSE 'paused' END,
       'legacy_current_only', NULL,
       json_object(
         'description', product.`description`,
         'earlyInterestBps', product.`early_interest_bps`,
         'isOpen', json(CASE product.`is_open` WHEN 1 THEN 'true' ELSE 'false' END),
         'maturityInterestBps', product.`maturity_interest_bps`,
         'maxAmount', product.`max_amount`, 'minAmount', product.`min_amount`,
         'name', product.`name`, 'revision', product.`revision`,
         'termWeeks', product.`term_weeks`
       ),
       product.`updated_by_teacher_id`, product.`updated_at`
FROM `finance_deposit_products` product;
--> statement-breakpoint
CREATE TRIGGER `finance_deposit_product_capture_issued_lifecycle`
AFTER INSERT ON `finance_deposit_products`
BEGIN
  INSERT INTO `finance_deposit_product_lifecycle_events` (
    `id`, `class_id`, `product_id`, `revision`, `action`, `capture_status`,
    `source_event_id`, `product_snapshot_json`, `actor_teacher_id`, `created_at`
  ) VALUES (
    'finance:deposit-product-lifecycle:' || NEW.`id` || ':0',
    NEW.`class_id`, NEW.`id`, 0, 'issued', 'exact', NULL,
    json_object(
      'description', NEW.`description`,
      'earlyInterestBps', NEW.`early_interest_bps`,
      'isOpen', json(CASE NEW.`is_open` WHEN 1 THEN 'true' ELSE 'false' END),
      'maturityInterestBps', NEW.`maturity_interest_bps`,
      'maxAmount', NEW.`max_amount`, 'minAmount', NEW.`min_amount`,
      'name', NEW.`name`, 'revision', NEW.`revision`,
      'termWeeks', NEW.`term_weeks`
    ),
    NEW.`updated_by_teacher_id`, NEW.`updated_at`
  );
END;
--> statement-breakpoint
CREATE TRIGGER `finance_deposit_product_capture_state_lifecycle`
AFTER UPDATE OF `revision` ON `finance_deposit_products`
WHEN NEW.`revision` = OLD.`revision` + 1 AND NEW.`is_open` <> OLD.`is_open`
BEGIN
  INSERT INTO `finance_deposit_product_lifecycle_events` (
    `id`, `class_id`, `product_id`, `revision`, `action`, `capture_status`,
    `source_event_id`, `product_snapshot_json`, `actor_teacher_id`, `created_at`
  ) VALUES (
    'finance:deposit-product-lifecycle:' || NEW.`id` || ':' || NEW.`revision`,
    NEW.`class_id`, NEW.`id`, NEW.`revision`,
    CASE NEW.`is_open` WHEN 1 THEN 'opened' ELSE 'paused' END,
    'exact', NULL,
    json_object(
      'description', NEW.`description`,
      'earlyInterestBps', NEW.`early_interest_bps`,
      'isOpen', json(CASE NEW.`is_open` WHEN 1 THEN 'true' ELSE 'false' END),
      'maturityInterestBps', NEW.`maturity_interest_bps`,
      'maxAmount', NEW.`max_amount`, 'minAmount', NEW.`min_amount`,
      'name', NEW.`name`, 'revision', NEW.`revision`,
      'termWeeks', NEW.`term_weeks`
    ),
    NEW.`updated_by_teacher_id`, NEW.`updated_at`
  );
END;
