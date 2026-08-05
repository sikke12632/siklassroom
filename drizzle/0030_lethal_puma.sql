CREATE TABLE `finance_stock_news_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`stock_id` text NOT NULL,
	`stock_event_id` text NOT NULL,
	`stock_event_revision` integer NOT NULL,
	`news_id` text NOT NULL,
	`news_revision` integer NOT NULL,
	`link_status` text NOT NULL,
	`impact_bps` integer NOT NULL,
	`news_payload_hash` text NOT NULL,
	`applied_at` integer NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stock_event_id`) REFERENCES `finance_stock_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`news_id`) REFERENCES `finance_stock_news`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stock_id`,`class_id`) REFERENCES `finance_stocks`(`id`,`class_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_stock_news_applications_id_ck" CHECK("finance_stock_news_applications"."id" = 'finance:stock-news-application:'
        || "finance_stock_news_applications"."stock_id" || ':' || "finance_stock_news_applications"."news_id"),
	CONSTRAINT "finance_stock_news_applications_state_ck" CHECK("finance_stock_news_applications"."link_status" IN ('exact', 'legacy_inferred')
        AND "finance_stock_news_applications"."stock_event_revision" > 0
        AND "finance_stock_news_applications"."news_revision" = 0
        AND "finance_stock_news_applications"."impact_bps" BETWEEN -10000 AND 10000
        AND LENGTH(TRIM("finance_stock_news_applications"."news_payload_hash")) BETWEEN 8 AND 500
        AND "finance_stock_news_applications"."applied_at" >= 0
        AND "finance_stock_news_applications"."recorded_at" >= "finance_stock_news_applications"."applied_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_news_applications_stock_news_uq` ON `finance_stock_news_applications` (`stock_id`,`news_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_stock_news_applications_event_news_uq` ON `finance_stock_news_applications` (`stock_event_id`,`news_id`);--> statement-breakpoint
CREATE INDEX `finance_stock_news_applications_class_applied_idx` ON `finance_stock_news_applications` (`class_id`,`applied_at`,`id`);
--> statement-breakpoint
CREATE TRIGGER `finance_stock_news_applications_insert_guard`
BEFORE INSERT ON `finance_stock_news_applications`
BEGIN
  SELECT CASE WHEN NEW.`id` != 'finance:stock-news-application:'
      || NEW.`stock_id` || ':' || NEW.`news_id`
    THEN RAISE(ABORT, 'FINANCE_STOCK_NEWS_APPLICATION_INVALID') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `finance_stock_news_events` published
    JOIN `finance_stock_events` stock_event
      ON stock_event.`id` = NEW.`stock_event_id`
     AND stock_event.`class_id` = NEW.`class_id`
     AND stock_event.`stock_id` = NEW.`stock_id`
     AND stock_event.`revision` = NEW.`stock_event_revision`
    WHERE published.`news_id` = NEW.`news_id`
      AND published.`class_id` = NEW.`class_id`
      AND published.`action` = 'published'
      AND published.`revision` = NEW.`news_revision`
      AND published.`impact_bps` = NEW.`impact_bps`
      AND published.`request_payload_hash` = NEW.`news_payload_hash`
      AND NEW.`applied_at` = stock_event.`created_at`
      AND NEW.`recorded_at` >= NEW.`applied_at`
      AND stock_event.`created_at` >= published.`created_at`
      AND stock_event.`created_at` < published.`expires_at`
      AND NOT EXISTS (
        SELECT 1 FROM `finance_stock_news_events` closure
        WHERE closure.`news_id` = published.`news_id`
          AND closure.`action` IN ('cancelled', 'expired')
          AND closure.`created_at` <= stock_event.`created_at`
      )
      AND (
        (NEW.`link_status` = 'exact'
          AND stock_event.`action` = 'news_tick'
          AND NEW.`recorded_at` = NEW.`applied_at`)
        OR (NEW.`link_status` = 'legacy_inferred'
          AND stock_event.`action` IN (
            'price_changed', 'automatic_tick', 'news_tick'
          )
          AND NOT EXISTS (
            SELECT 1 FROM `finance_stock_events` earlier
            WHERE earlier.`class_id` = stock_event.`class_id`
              AND earlier.`stock_id` = stock_event.`stock_id`
              AND earlier.`action` IN (
                'price_changed', 'automatic_tick', 'news_tick'
              )
              AND earlier.`created_at` >= published.`created_at`
              AND earlier.`created_at` < published.`expires_at`
              AND (earlier.`created_at` < stock_event.`created_at`
                OR (earlier.`created_at` = stock_event.`created_at`
                  AND earlier.`id` < stock_event.`id`))
          ))
      )
  ) THEN RAISE(ABORT, 'FINANCE_STOCK_NEWS_APPLICATION_INVALID') END;
END;
--> statement-breakpoint
CREATE TRIGGER `finance_stock_news_applications_update_guard`
BEFORE UPDATE ON `finance_stock_news_applications`
BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_NEWS_APPLICATION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `finance_stock_news_applications_delete_guard`
BEFORE DELETE ON `finance_stock_news_applications`
BEGIN SELECT RAISE(ABORT, 'FINANCE_STOCK_NEWS_APPLICATION_IMMUTABLE'); END;
--> statement-breakpoint
INSERT OR IGNORE INTO `finance_stock_news_applications` (
  `id`, `class_id`, `stock_id`, `stock_event_id`, `stock_event_revision`,
  `news_id`, `news_revision`, `link_status`, `impact_bps`,
  `news_payload_hash`, `applied_at`, `recorded_at`
)
SELECT 'finance:stock-news-application:' || stock.`id` || ':'
         || published.`news_id`,
       published.`class_id`, stock.`id`, stock_event.`id`,
       stock_event.`revision`, published.`news_id`, published.`revision`,
       'legacy_inferred', published.`impact_bps`,
       published.`request_payload_hash`, stock_event.`created_at`,
       stock_event.`created_at`
FROM `finance_stock_news_events` published
JOIN `finance_stock_news` news
  ON news.`id` = published.`news_id`
 AND news.`class_id` = published.`class_id`
 AND news.`status` = 'active'
JOIN `finance_stocks` stock ON stock.`class_id` = published.`class_id`
JOIN `finance_stock_events` stock_event
  ON stock_event.`id` = (
    SELECT candidate.`id`
    FROM `finance_stock_events` candidate
    WHERE candidate.`class_id` = published.`class_id`
      AND candidate.`stock_id` = stock.`id`
      AND candidate.`action` IN (
        'price_changed', 'automatic_tick', 'news_tick'
      )
      AND candidate.`created_at` >= published.`created_at`
      AND candidate.`created_at` < published.`expires_at`
    ORDER BY candidate.`created_at`, candidate.`id`
    LIMIT 1
  )
WHERE published.`action` = 'published' AND published.`revision` = 0;
--> statement-breakpoint
INSERT OR IGNORE INTO `system_migrations` (`key`, `applied_at`)
VALUES (
  'finance-stock-news-applications-v1',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
);
