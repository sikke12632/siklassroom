DROP TRIGGER IF EXISTS finance_stock_trades_insert_guard;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_trades_insert_guard
    BEFORE INSERT ON finance_stock_trades
    BEGIN
      SELECT CASE WHEN NEW.status <> 'pending'
        OR NEW.posted_transaction_id IS NOT NULL
        OR NEW.transaction_payload_hash IS NOT NULL
        OR NEW.posted_at IS NOT NULL
        THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_INVALID_INITIAL_STATE') END;
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
--> statement-breakpoint
DROP TRIGGER IF EXISTS finance_stock_trades_teacher_insert_guard;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_trades_teacher_insert_guard
    BEFORE INSERT ON finance_stock_trades
    WHEN EXISTS (
      SELECT 1 FROM finance_transactions transaction_row
      WHERE transaction_row.class_id = NEW.class_id
        AND transaction_row.source_type = 'stock_trade'
        AND transaction_row.source_id = NEW.id
        AND transaction_row.status = 'pending'
        AND transaction_row.actor_type = 'teacher'
    )
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_transactions transaction_row
        WHERE transaction_row.class_id = NEW.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND json_valid(transaction_row.metadata_json) = 1
          AND json_extract(transaction_row.metadata_json, '$.isEmergency') = 1
          AND json_extract(transaction_row.metadata_json, '$.liquidationPolicy')
            = 'current_market_terms_at_liquidation'
          AND json_extract(transaction_row.metadata_json, '$.origin') IN (
            'finance_center', 'student_exclusion', 'class_archive', 'account_recovery'
          )
          AND json_type(transaction_row.metadata_json, '$.operationId') = 'text'
          AND LENGTH(TRIM(CAST(json_extract(
            transaction_row.metadata_json, '$.operationId'
          ) AS TEXT))) BETWEEN 8 AND 160
          AND json_type(transaction_row.metadata_json, '$.interventionReason') = 'text'
          AND LENGTH(TRIM(CAST(json_extract(
            transaction_row.metadata_json, '$.interventionReason'
          ) AS TEXT))) BETWEEN 2 AND 300
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_transactions transaction_row
        WHERE transaction_row.class_id = NEW.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND json_extract(transaction_row.metadata_json, '$.studentId') = NEW.student_id
          AND json_extract(transaction_row.metadata_json, '$.stockId') = NEW.stock_id
          AND json_extract(transaction_row.metadata_json, '$.side') = NEW.side
          AND CAST(json_extract(transaction_row.metadata_json, '$.quantity') AS INTEGER) = NEW.quantity
          AND CAST(json_extract(transaction_row.metadata_json, '$.referencePrice') AS INTEGER) = NEW.reference_price
          AND CAST(json_extract(transaction_row.metadata_json, '$.spreadSnapshot') AS INTEGER) = NEW.spread_snapshot
          AND CAST(json_extract(transaction_row.metadata_json, '$.unitPrice') AS INTEGER) = NEW.unit_price
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_transactions transaction_row
        WHERE transaction_row.class_id = NEW.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND CAST(json_extract(transaction_row.metadata_json, '$.grossAmount') AS INTEGER) = NEW.gross_amount
          AND CAST(json_extract(transaction_row.metadata_json, '$.feeBpsSnapshot') AS INTEGER) = NEW.fee_bps_snapshot
          AND CAST(json_extract(transaction_row.metadata_json, '$.feeAmount') AS INTEGER) = NEW.fee_amount
          AND CAST(json_extract(transaction_row.metadata_json, '$.walletDelta') AS INTEGER) = NEW.wallet_delta
          AND CAST(json_extract(transaction_row.metadata_json, '$.costBasisRemoved') AS INTEGER) = NEW.cost_basis_removed
          AND CAST(json_extract(transaction_row.metadata_json, '$.realizedGain') AS INTEGER) = NEW.realized_gain
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_transactions transaction_row
        WHERE transaction_row.class_id = NEW.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND CAST(json_extract(transaction_row.metadata_json, '$.stockRevision') AS INTEGER) = NEW.stock_revision
          AND CAST(json_extract(transaction_row.metadata_json, '$.inventoryRevisionBefore') AS INTEGER) = NEW.inventory_revision_before
          AND CAST(json_extract(transaction_row.metadata_json, '$.marketRevision') AS INTEGER) = NEW.market_revision
          AND CAST(json_extract(transaction_row.metadata_json, '$.financeSettingsRevision') AS INTEGER) = NEW.finance_settings_revision
          AND CAST(json_extract(transaction_row.metadata_json, '$.walletRevisionBefore') AS INTEGER) = NEW.wallet_revision_before
          AND CAST(json_extract(transaction_row.metadata_json, '$.holdingRevisionBefore') AS INTEGER) = NEW.holding_revision_before
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_transactions transaction_row
        WHERE transaction_row.class_id = NEW.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND CAST(json_extract(transaction_row.metadata_json, '$.availableSharesBefore') AS INTEGER) = NEW.available_shares_before
          AND CAST(json_extract(transaction_row.metadata_json, '$.availableSharesAfter') AS INTEGER) = NEW.available_shares_after
          AND CAST(json_extract(transaction_row.metadata_json, '$.holdingQuantityBefore') AS INTEGER) = NEW.holding_quantity_before
          AND CAST(json_extract(transaction_row.metadata_json, '$.holdingQuantityAfter') AS INTEGER) = NEW.holding_quantity_after
          AND CAST(json_extract(transaction_row.metadata_json, '$.holdingCostBasisBefore') AS INTEGER) = NEW.holding_cost_basis_before
          AND CAST(json_extract(transaction_row.metadata_json, '$.holdingCostBasisAfter') AS INTEGER) = NEW.holding_cost_basis_after
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_transactions transaction_row
        JOIN students student ON student.id = NEW.student_id
          AND student.class_id = NEW.class_id
        JOIN finance_stocks stock ON stock.id = NEW.stock_id
          AND stock.class_id = NEW.class_id
        JOIN finance_stock_markets market ON market.class_id = NEW.class_id
        WHERE transaction_row.class_id = NEW.class_id
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND json_extract(transaction_row.metadata_json, '$.studentStatusSnapshot') = student.status
          AND CAST(json_extract(transaction_row.metadata_json, '$.marketWasOpen') AS INTEGER) = market.is_open
          AND json_extract(transaction_row.metadata_json, '$.stockStatusSnapshot') = stock.status
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
    END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS finance_stock_trades_finalize_guard;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS finance_stock_trades_finalize_guard
    BEFORE UPDATE OF status, posted_transaction_id,
      transaction_payload_hash, posted_at ON finance_stock_trades
    BEGIN
      SELECT CASE WHEN OLD.status <> 'pending' OR NEW.status <> 'posted'
        OR OLD.posted_transaction_id IS NOT NULL
        OR OLD.transaction_payload_hash IS NOT NULL OR OLD.posted_at IS NOT NULL
        OR NEW.posted_transaction_id IS NULL
        OR NEW.transaction_payload_hash IS NULL OR NEW.posted_at IS NULL
        OR NEW.posted_at < NEW.created_at
        THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_INVALID_TRANSITION') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM finance_transactions transaction_row
        WHERE transaction_row.id = NEW.posted_transaction_id
          AND transaction_row.class_id = NEW.class_id
          AND transaction_row.status = 'posted'
          AND transaction_row.transaction_type = CASE NEW.side
            WHEN 'buy' THEN 'stock_buy' ELSE 'stock_sell' END
          AND transaction_row.source_type = 'stock_trade'
          AND transaction_row.source_id = NEW.id
          AND (
            (
              transaction_row.actor_type = 'system'
              AND COALESCE(json_extract(
                transaction_row.metadata_json, '$.isEmergency'
              ), 0) <> 1
            )
            OR (
              NEW.side = 'sell'
              AND transaction_row.actor_type = 'teacher'
              AND transaction_row.actor_student_id IS NULL
              AND transaction_row.actor_job_period_id IS NULL
              AND json_valid(transaction_row.metadata_json) = 1
              AND json_extract(transaction_row.metadata_json, '$.isEmergency') = 1
              AND json_extract(transaction_row.metadata_json, '$.liquidationPolicy')
                = 'current_market_terms_at_liquidation'
              AND json_type(transaction_row.metadata_json, '$.interventionReason') = 'text'
              AND LENGTH(TRIM(CAST(json_extract(
                transaction_row.metadata_json, '$.interventionReason'
              ) AS TEXT))) BETWEEN 2 AND 300
              AND json_extract(transaction_row.metadata_json, '$.studentId') = NEW.student_id
              AND json_extract(transaction_row.metadata_json, '$.stockId') = NEW.stock_id
              AND EXISTS (
                SELECT 1 FROM classes classroom
                WHERE classroom.id = NEW.class_id
                  AND classroom.teacher_id = transaction_row.actor_teacher_id
                  AND classroom.status = 'active'
              )
            )
          )
          AND transaction_row.payload_hash = NEW.transaction_payload_hash
          AND (SELECT COUNT(*) FROM finance_ledger_entries entry
               WHERE entry.transaction_id = transaction_row.id) = 2
          AND EXISTS (
            SELECT 1 FROM finance_ledger_entries entry
            WHERE entry.transaction_id = transaction_row.id
              AND entry.account_id = NEW.wallet_account_id
              AND entry.amount = NEW.wallet_delta
              AND entry.account_revision_after = NEW.wallet_revision_after
          )
          AND EXISTS (
            SELECT 1
            FROM finance_ledger_entries entry
            JOIN finance_accounts issuance ON issuance.id = entry.account_id
              AND issuance.class_id = entry.class_id
              AND issuance.account_type = 'class_issuance'
            WHERE entry.transaction_id = transaction_row.id
              AND entry.amount = -NEW.wallet_delta
          )
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_LEDGER_MISMATCH') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_accounts wallet
        WHERE wallet.id = NEW.wallet_account_id
          AND wallet.class_id = NEW.class_id
          AND wallet.revision = NEW.wallet_revision_after
      ) THEN RAISE(ABORT, 'FINANCE_ACCOUNT_STALE') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_stock_holdings holding
        WHERE holding.class_id = NEW.class_id
          AND holding.stock_id = NEW.stock_id
          AND holding.student_id = NEW.student_id
          AND holding.wallet_account_id = NEW.wallet_account_id
          AND holding.quantity = NEW.holding_quantity_after
          AND holding.cost_basis = NEW.holding_cost_basis_after
          AND holding.revision = NEW.holding_revision_after
          AND holding.last_trade_id = NEW.id
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_PROJECTION_MISMATCH') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finance_stocks stock
        WHERE stock.id = NEW.stock_id AND stock.class_id = NEW.class_id
          AND stock.available_shares = NEW.available_shares_after
          AND stock.inventory_revision = NEW.inventory_revision_after
          AND stock.last_trade_id = NEW.id
      ) THEN RAISE(ABORT, 'FINANCE_STOCK_TRADE_STALE') END;
    END;
