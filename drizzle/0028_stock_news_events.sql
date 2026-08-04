CREATE TABLE `finance_stock_news_events` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`news_id` text NOT NULL,
	`revision` integer NOT NULL,
	`action` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`impact_bps` integer NOT NULL,
	`reason` text NOT NULL,
	`request_idempotency_key` text,
	`request_payload_hash` text,
	`actor_type` text NOT NULL,
	`actor_teacher_id` text,
	`expires_at` integer NOT NULL,
	`cancelled_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`news_id`) REFERENCES `finance_stock_news`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_stock_news_events_text_ck" CHECK(LENGTH(TRIM("finance_stock_news_events"."title")) BETWEEN 1 AND 80
        AND LENGTH(TRIM("finance_stock_news_events"."content")) BETWEEN 1 AND 500
        AND LENGTH(TRIM("finance_stock_news_events"."reason")) BETWEEN 1 AND 300),
	CONSTRAINT "finance_stock_news_events_impact_ck" CHECK("finance_stock_news_events"."impact_bps" BETWEEN -10000 AND 10000),
	CONSTRAINT "finance_stock_news_events_action_ck" CHECK("finance_stock_news_events"."action" IN ('published', 'cancelled', 'expired')),
	CONSTRAINT "finance_stock_news_events_revision_ck" CHECK(("finance_stock_news_events"."action" = 'published' AND "finance_stock_news_events"."revision" = 0)
        OR ("finance_stock_news_events"."action" IN ('cancelled', 'expired') AND "finance_stock_news_events"."revision" > 0)),
	CONSTRAINT "finance_stock_news_events_request_ck" CHECK(("finance_stock_news_events"."action" IN ('published', 'cancelled')
          AND "finance_stock_news_events"."request_idempotency_key" IS NOT NULL
          AND "finance_stock_news_events"."request_payload_hash" IS NOT NULL
          AND LENGTH(TRIM("finance_stock_news_events"."request_idempotency_key")) BETWEEN 8 AND 200
          AND LENGTH(TRIM("finance_stock_news_events"."request_payload_hash")) BETWEEN 8 AND 500)
        OR ("finance_stock_news_events"."action" = 'expired'
          AND "finance_stock_news_events"."request_idempotency_key" IS NULL
          AND "finance_stock_news_events"."request_payload_hash" IS NULL)),
	CONSTRAINT "finance_stock_news_events_actor_ck" CHECK(("finance_stock_news_events"."action" IN ('published', 'cancelled')
          AND "finance_stock_news_events"."actor_type" = 'teacher'
          AND "finance_stock_news_events"."actor_teacher_id" IS NOT NULL)
        OR ("finance_stock_news_events"."action" = 'expired'
          AND "finance_stock_news_events"."actor_type" = 'system'
          AND "finance_stock_news_events"."actor_teacher_id" IS NULL)),
	CONSTRAINT "finance_stock_news_events_timing_ck" CHECK("finance_stock_news_events"."expires_at" > 0 AND "finance_stock_news_events"."created_at" >= 0
        AND (("finance_stock_news_events"."action" = 'published'
            AND "finance_stock_news_events"."cancelled_at" IS NULL
            AND "finance_stock_news_events"."created_at" < "finance_stock_news_events"."expires_at")
          OR ("finance_stock_news_events"."action" = 'cancelled'
            AND "finance_stock_news_events"."cancelled_at" = "finance_stock_news_events"."created_at")
          OR ("finance_stock_news_events"."action" = 'expired'
            AND "finance_stock_news_events"."cancelled_at" IS NULL
            AND "finance_stock_news_events"."created_at" >= "finance_stock_news_events"."expires_at")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_news_events_news_revision_uq` ON `finance_stock_news_events` (`news_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_news_events_class_action_request_uq` ON `finance_stock_news_events` (`class_id`,`action`,`request_idempotency_key`) WHERE "finance_stock_news_events"."request_idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `finance_stock_news_events_class_created_idx` ON `finance_stock_news_events` (`class_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `finance_stock_news_events_insert_guard`
BEFORE INSERT ON `finance_stock_news_events`
BEGIN
  SELECT CASE WHEN NEW.`id` != 'finance:stock-news-event:'
      || NEW.`news_id` || ':' || NEW.`revision`
    THEN RAISE(ABORT, 'FINANCE_STOCK_NEWS_EVENT_INVALID') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `finance_stock_news` news
    WHERE news.`id` = NEW.`news_id` AND news.`class_id` = NEW.`class_id`
      AND news.`title` = NEW.`title` AND news.`content` = NEW.`content`
      AND news.`impact_bps` = NEW.`impact_bps`
      AND news.`expires_at` = NEW.`expires_at`
      AND (
        (NEW.`action` = 'published' AND NEW.`revision` = 0
          AND NEW.`reason` = '주식 뉴스를 게시했습니다.'
          AND NEW.`request_idempotency_key` = news.`idempotency_key`
          AND NEW.`request_payload_hash` = news.`payload_hash`
          AND NEW.`actor_type` = 'teacher'
          AND NEW.`actor_teacher_id` = news.`created_by_teacher_id`
          AND NEW.`cancelled_at` IS NULL
          AND NEW.`created_at` = news.`created_at`)
        OR (NEW.`action` = 'cancelled' AND news.`status` = 'cancelled'
          AND NEW.`revision` = news.`revision`
          AND NEW.`reason` = news.`cancellation_reason`
          AND NEW.`request_idempotency_key`
            = news.`cancellation_idempotency_key`
          AND NEW.`request_payload_hash` = news.`cancellation_payload_hash`
          AND NEW.`actor_type` = news.`updated_by_actor_type`
          AND NEW.`actor_teacher_id` IS news.`updated_by_teacher_id`
          AND NEW.`cancelled_at` = news.`cancelled_at`
          AND NEW.`created_at` = news.`updated_at`)
        OR (NEW.`action` = 'expired' AND news.`status` = 'expired'
          AND NEW.`revision` = news.`revision`
          AND NEW.`reason` = '설정한 공개 시간이 끝났습니다.'
          AND NEW.`request_idempotency_key` IS NULL
          AND NEW.`request_payload_hash` IS NULL
          AND NEW.`actor_type` = 'system'
          AND NEW.`actor_teacher_id` IS NULL
          AND NEW.`cancelled_at` IS NULL
          AND NEW.`created_at` = news.`updated_at`)
      )
  ) THEN RAISE(ABORT, 'FINANCE_STOCK_NEWS_EVENT_INVALID') END;
END;
--> statement-breakpoint
CREATE TRIGGER `finance_stock_news_events_update_guard`
BEFORE UPDATE ON `finance_stock_news_events`
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_STOCK_NEWS_EVENT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `finance_stock_news_events_delete_guard`
BEFORE DELETE ON `finance_stock_news_events`
BEGIN
  SELECT RAISE(ABORT, 'FINANCE_STOCK_NEWS_EVENT_IMMUTABLE');
END;
--> statement-breakpoint
INSERT OR IGNORE INTO `finance_stock_news_events` (
  `id`, `class_id`, `news_id`, `revision`, `action`, `title`, `content`,
  `impact_bps`, `reason`, `request_idempotency_key`,
  `request_payload_hash`, `actor_type`, `actor_teacher_id`, `expires_at`,
  `cancelled_at`, `created_at`
)
SELECT
  'finance:stock-news-event:' || news.`id` || ':0',
  news.`class_id`, news.`id`, 0, 'published', news.`title`, news.`content`,
  news.`impact_bps`, '주식 뉴스를 게시했습니다.',
  news.`idempotency_key`, news.`payload_hash`,
  'teacher', news.`created_by_teacher_id`, news.`expires_at`, NULL,
  news.`created_at`
FROM `finance_stock_news` news;
--> statement-breakpoint
INSERT OR IGNORE INTO `finance_stock_news_events` (
  `id`, `class_id`, `news_id`, `revision`, `action`, `title`, `content`,
  `impact_bps`, `reason`, `request_idempotency_key`,
  `request_payload_hash`, `actor_type`, `actor_teacher_id`, `expires_at`,
  `cancelled_at`, `created_at`
)
SELECT
  'finance:stock-news-event:' || news.`id` || ':' || news.`revision`,
  news.`class_id`, news.`id`, news.`revision`, news.`status`,
  news.`title`, news.`content`, news.`impact_bps`,
  CASE news.`status`
    WHEN 'cancelled' THEN news.`cancellation_reason`
    ELSE '설정한 공개 시간이 끝났습니다.'
  END,
  CASE news.`status`
    WHEN 'cancelled' THEN news.`cancellation_idempotency_key`
    ELSE NULL
  END,
  CASE news.`status`
    WHEN 'cancelled' THEN news.`cancellation_payload_hash`
    ELSE NULL
  END,
  news.`updated_by_actor_type`, news.`updated_by_teacher_id`,
  news.`expires_at`, news.`cancelled_at`, news.`updated_at`
FROM `finance_stock_news` news
WHERE news.`status` IN ('cancelled', 'expired');
--> statement-breakpoint
CREATE TRIGGER `finance_stock_news_capture_publish_event`
AFTER INSERT ON `finance_stock_news`
BEGIN
  INSERT INTO `finance_stock_news_events` (
    `id`, `class_id`, `news_id`, `revision`, `action`, `title`, `content`,
    `impact_bps`, `reason`, `request_idempotency_key`,
    `request_payload_hash`, `actor_type`, `actor_teacher_id`, `expires_at`,
    `cancelled_at`, `created_at`
  ) VALUES (
    'finance:stock-news-event:' || NEW.`id` || ':0',
    NEW.`class_id`, NEW.`id`, 0, 'published', NEW.`title`, NEW.`content`,
    NEW.`impact_bps`, '주식 뉴스를 게시했습니다.',
    NEW.`idempotency_key`, NEW.`payload_hash`,
    'teacher', NEW.`created_by_teacher_id`, NEW.`expires_at`, NULL,
    NEW.`created_at`
  );
END;
--> statement-breakpoint
CREATE TRIGGER `finance_stock_news_capture_transition_event`
AFTER UPDATE OF `status` ON `finance_stock_news`
WHEN OLD.`status` = 'active' AND NEW.`status` IN ('cancelled', 'expired')
BEGIN
  INSERT INTO `finance_stock_news_events` (
    `id`, `class_id`, `news_id`, `revision`, `action`, `title`, `content`,
    `impact_bps`, `reason`, `request_idempotency_key`,
    `request_payload_hash`, `actor_type`, `actor_teacher_id`, `expires_at`,
    `cancelled_at`, `created_at`
  ) VALUES (
    'finance:stock-news-event:' || NEW.`id` || ':' || NEW.`revision`,
    NEW.`class_id`, NEW.`id`, NEW.`revision`, NEW.`status`,
    NEW.`title`, NEW.`content`, NEW.`impact_bps`,
    CASE NEW.`status`
      WHEN 'cancelled' THEN NEW.`cancellation_reason`
      ELSE '설정한 공개 시간이 끝났습니다.'
    END,
    CASE NEW.`status`
      WHEN 'cancelled' THEN NEW.`cancellation_idempotency_key`
      ELSE NULL
    END,
    CASE NEW.`status`
      WHEN 'cancelled' THEN NEW.`cancellation_payload_hash`
      ELSE NULL
    END,
    NEW.`updated_by_actor_type`, NEW.`updated_by_teacher_id`,
    NEW.`expires_at`, NEW.`cancelled_at`, NEW.`updated_at`
  );
END;
