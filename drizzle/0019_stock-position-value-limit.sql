-- Custom SQL migration file, put your code below! --
DROP TRIGGER IF EXISTS finance_stocks_management_update_guard;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stocks_management_update_guard
    BEFORE UPDATE ON finance_stocks
    WHEN NEW.last_trade_id IS OLD.last_trade_id
    BEGIN
      SELECT CASE WHEN NEW.id <> OLD.id OR NEW.class_id <> OLD.class_id
        OR NEW.name <> OLD.name OR NEW.symbol <> OLD.symbol
        OR NEW.description <> OLD.description
        OR NEW.initial_price <> OLD.initial_price
        OR NEW.total_shares <> OLD.total_shares
        OR NEW.max_shares_per_student <> OLD.max_shares_per_student
        OR NEW.available_shares <> OLD.available_shares
        OR NEW.inventory_revision <> OLD.inventory_revision
        OR NEW.created_by_teacher_id <> OLD.created_by_teacher_id
        OR NEW.created_at <> OLD.created_at OR NEW.updated_at < OLD.updated_at
        OR NEW.revision <> OLD.revision + 1
        OR NEW.previous_price <> CASE
          WHEN NEW.current_price <> OLD.current_price THEN OLD.current_price
          ELSE OLD.previous_price END
        THEN RAISE(ABORT, 'FINANCE_STOCK_STALE') END;
      SELECT CASE WHEN NEW.updated_by_actor_type = 'teacher' AND NOT EXISTS (
        SELECT 1 FROM classes classroom
        WHERE classroom.id = NEW.class_id
          AND classroom.teacher_id = NEW.updated_by_teacher_id
          AND classroom.status = 'active'
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_ACCESS_DENIED') END;
      SELECT CASE WHEN NEW.updated_by_actor_type = 'system' AND (
        NEW.updated_by_teacher_id IS NOT NULL
        OR NEW.status <> OLD.status
        OR OLD.status NOT IN ('active', 'sell_only')
        OR NOT EXISTS (
          SELECT 1 FROM finance_stock_markets market
          WHERE market.class_id = NEW.class_id AND market.is_open = 1
        )
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_SYSTEM_UPDATE_DENIED') END;
      SELECT CASE WHEN OLD.status = 'archived' AND NEW.status <> 'archived'
        THEN RAISE(ABORT, 'FINANCE_STOCK_IMMUTABLE') END;
      SELECT CASE WHEN NEW.status = 'archived'
        AND NEW.available_shares <> NEW.total_shares
        THEN RAISE(ABORT, 'FINANCE_STOCK_ACTIVE_HOLDINGS') END;
      SELECT CASE WHEN NEW.current_price > OLD.current_price AND EXISTS (
        SELECT 1 FROM finance_stock_holdings holding
        WHERE holding.class_id = NEW.class_id
          AND holding.stock_id = NEW.id
          AND holding.quantity > CAST(1000000000 / NEW.current_price AS INTEGER)
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_POSITION_VALUE_LIMIT') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stock_markets market
        JOIN finance_settings setting ON setting.class_id = market.class_id
        WHERE market.class_id = NEW.class_id
          AND NEW.current_price > market.sell_spread
          AND NEW.current_price + market.buy_spread <= 1000000000
          AND NEW.current_price % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
          AND market.buy_spread % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
          AND market.sell_spread % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_DENOMINATION_MISMATCH') END;
    END;--> statement-breakpoint
DROP TRIGGER IF EXISTS finance_stock_trades_insert_guard;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_trades_insert_guard
    BEFORE INSERT ON finance_stock_trades
    BEGIN
      SELECT CASE WHEN NEW.status <> 'pending'
        OR NEW.posted_transaction_id IS NOT NULL
        OR NEW.transaction_payload_hash IS NOT NULL
        OR NEW.posted_at IS NOT NULL
        THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_INVALID_INITIAL_STATE') END;
      SELECT CASE WHEN NEW.side = 'buy' AND EXISTS (
        SELECT 1 FROM finance_stocks stock
        WHERE stock.id = NEW.stock_id AND stock.class_id = NEW.class_id
          AND NEW.holding_quantity_after
            > CAST(1000000000 / stock.current_price AS INTEGER)
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_POSITION_VALUE_LIMIT') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_stocks stock
        JOIN finance_stock_markets market ON market.class_id = stock.class_id
        JOIN finance_settings setting ON setting.class_id = stock.class_id
        JOIN students student ON student.id = NEW.student_id
          AND student.class_id = stock.class_id
        JOIN finance_accounts wallet ON wallet.id = NEW.wallet_account_id
          AND wallet.class_id = stock.class_id
          AND wallet.student_id = student.id
          AND wallet.account_type = 'student_wallet'
          AND wallet.status = 'active'
        WHERE stock.id = NEW.stock_id AND stock.class_id = NEW.class_id
          AND stock.revision = NEW.stock_revision
          AND stock.inventory_revision = NEW.inventory_revision_before
          AND stock.available_shares = NEW.available_shares_before
          AND setting.revision = NEW.finance_settings_revision
          AND market.revision = NEW.market_revision
          AND wallet.revision = NEW.wallet_revision_before
          AND NEW.reference_price = stock.current_price
          AND NEW.spread_snapshot = CASE NEW.side
            WHEN 'buy' THEN market.buy_spread ELSE market.sell_spread END
          AND NEW.fee_bps_snapshot = CASE NEW.side
            WHEN 'buy' THEN market.buy_fee_bps ELSE market.sell_fee_bps END
          AND NEW.reference_price > market.sell_spread
          AND NEW.reference_price + market.buy_spread <= 1000000000
          AND NEW.reference_price % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
          AND NEW.spread_snapshot % (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          ) = 0
          AND NEW.fee_amount = CAST(
            CAST((NEW.gross_amount * NEW.fee_bps_snapshot) / 10000 AS INTEGER)
              / (
                SELECT MIN(CAST(value AS INTEGER))
                FROM json_each(setting.denominations_json)
              ) AS INTEGER
          ) * (
            SELECT MIN(CAST(value AS INTEGER))
            FROM json_each(setting.denominations_json)
          )
          AND NEW.available_shares_after BETWEEN 0 AND stock.total_shares
          AND NEW.holding_quantity_after <= stock.max_shares_per_student
          AND (
            (
              student.status = 'active'
              AND market.is_open = 1
              AND stock.status IN ('active', 'sell_only')
              AND (NEW.side = 'sell' OR stock.status = 'active')
            )
            OR (
              NEW.side = 'sell'
              AND student.status IN ('active', 'locked', 'reset_required', 'pending')
              AND stock.status IN ('active', 'sell_only', 'halted')
              AND EXISTS (
                SELECT 1
                FROM finance_transactions transaction_row
                JOIN classes classroom ON classroom.id = transaction_row.class_id
                WHERE transaction_row.class_id = NEW.class_id
                  AND transaction_row.status = 'pending'
                  AND transaction_row.transaction_type = 'stock_sell'
                  AND transaction_row.source_type = 'stock_trade'
                  AND transaction_row.source_id = NEW.id
                  AND transaction_row.idempotency_key = 'stock-trade:' || NEW.id || ':ledger'
                  AND transaction_row.actor_type = 'teacher'
                  AND transaction_row.actor_teacher_id = classroom.teacher_id
                  AND transaction_row.actor_student_id IS NULL
                  AND transaction_row.actor_job_period_id IS NULL
                  AND classroom.status = 'active'
              )
            )
          )
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
      SELECT CASE WHEN COALESCE((
          SELECT holding.quantity FROM finance_stock_holdings holding
          WHERE holding.class_id = NEW.class_id
            AND holding.stock_id = NEW.stock_id
            AND holding.student_id = NEW.student_id
        ), 0) <> NEW.holding_quantity_before
        OR COALESCE((
          SELECT holding.cost_basis FROM finance_stock_holdings holding
          WHERE holding.class_id = NEW.class_id
            AND holding.stock_id = NEW.stock_id
            AND holding.student_id = NEW.student_id
        ), 0) <> NEW.holding_cost_basis_before
        OR COALESCE((
          SELECT holding.revision FROM finance_stock_holdings holding
          WHERE holding.class_id = NEW.class_id
            AND holding.stock_id = NEW.stock_id
            AND holding.student_id = NEW.student_id
        ), 0) <> NEW.holding_revision_before
        THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
    END;
