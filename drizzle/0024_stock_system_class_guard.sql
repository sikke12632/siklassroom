CREATE TRIGGER `finance_stock_system_class_guard`
BEFORE UPDATE ON `finance_stocks`
WHEN NEW.`last_trade_id` IS OLD.`last_trade_id`
  AND NEW.`updated_by_actor_type` = 'system'
BEGIN
	SELECT CASE WHEN NOT EXISTS (
		SELECT 1 FROM `classes` classroom
		WHERE classroom.`id` = NEW.`class_id` AND classroom.`status` = 'active'
	) THEN RAISE(ABORT, 'FINANCE_STOCK_SYSTEM_UPDATE_DENIED') END;
END;--> statement-breakpoint
CREATE TRIGGER `finance_stock_market_system_class_guard`
BEFORE UPDATE OF `next_tick_at` ON `finance_stock_markets`
WHEN NEW.`updated_by_teacher_id` IS OLD.`updated_by_teacher_id`
  AND NEW.`revision` = OLD.`revision`
  AND NEW.`next_tick_at` IS NOT OLD.`next_tick_at`
BEGIN
	SELECT CASE WHEN NOT EXISTS (
		SELECT 1 FROM `classes` classroom
		WHERE classroom.`id` = NEW.`class_id` AND classroom.`status` = 'active'
	) THEN RAISE(ABORT, 'FINANCE_STOCK_MARKET_SYSTEM_UPDATE_DENIED') END;
END;--> statement-breakpoint
CREATE TRIGGER `finance_stock_system_event_class_guard`
BEFORE INSERT ON `finance_stock_events`
WHEN NEW.`actor_type` = 'system'
BEGIN
	SELECT CASE WHEN NOT EXISTS (
		SELECT 1 FROM `classes` classroom
		WHERE classroom.`id` = NEW.`class_id` AND classroom.`status` = 'active'
	) THEN RAISE(ABORT, 'FINANCE_STOCK_EVENT_INVALID') END;
END;
