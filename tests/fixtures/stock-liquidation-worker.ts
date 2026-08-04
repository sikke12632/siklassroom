import { liquidateFinanceStockHolding } from "../../lib/finance-stocks";
import { ApiError } from "../../lib/responses";

type TestEnvironment = {
  DB: D1Database;
};

async function forceLateProjectionFailure(db: D1Database) {
  const tradeId = "trade-service-forced-rollback";
  const transactionId = "transaction:trade-service-forced-rollback";
  const metadata = JSON.stringify({
    tradeId,
    stockId: "stock-class",
    symbol: "CLASS",
    studentId: "student-trader",
    side: "sell",
    quantity: 2,
    referencePrice: 1000,
    spreadSnapshot: 100,
    unitPrice: 900,
    grossAmount: 1800,
    feeBpsSnapshot: 500,
    feeAmount: 0,
    walletDelta: 1800,
    stockRevision: 1,
    inventoryRevisionBefore: 1,
    marketRevision: 2,
    financeSettingsRevision: 0,
    walletRevisionBefore: 2,
    holdingRevisionBefore: 1,
    availableSharesBefore: 18,
    availableSharesAfter: 20,
    holdingQuantityBefore: 2,
    holdingQuantityAfter: 0,
    holdingCostBasisBefore: 2300,
    holdingCostBasisAfter: 0,
    costBasisRemoved: 2300,
    realizedGain: -500,
    isEmergency: true,
    operationId: "stock-liquidation:test:forced-rollback",
    origin: "account_recovery",
    interventionReason: "Forced rollback verification",
    studentStatusSnapshot: "locked",
    marketWasOpen: false,
    stockStatusSnapshot: "halted",
    liquidationPolicy: "current_market_terms_at_liquidation",
  });
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO finance_transactions (
           id, class_id, status, transaction_type, description,
           idempotency_key, payload_hash, source_type, source_id,
           actor_type, actor_teacher_id, actor_label, metadata_json, created_at
         ) VALUES (?, 'class-stocks', 'pending', 'stock_sell', ?, ?, ?,
                   'stock_trade', ?, 'teacher', 'teacher-stocks', ?, ?, 60)`,
      ).bind(
        transactionId,
        "Teacher emergency liquidation",
        `stock-trade:${tradeId}:ledger`,
        "tx-hash:forced-rollback",
        tradeId,
        "Teacher emergency liquidation",
        metadata,
      ),
      db.prepare(
        `INSERT INTO finance_stock_trades (
           id, class_id, stock_id, stock_revision,
           inventory_revision_before, inventory_revision_after,
           market_revision, finance_settings_revision,
           student_id, wallet_account_id,
           wallet_revision_before, wallet_revision_after,
           side, quantity, reference_price, spread_snapshot,
           unit_price, gross_amount, fee_bps_snapshot, fee_amount, wallet_delta,
           available_shares_before, available_shares_after,
           holding_quantity_before, holding_quantity_after,
           holding_cost_basis_before, holding_cost_basis_after,
           holding_revision_before, holding_revision_after,
           cost_basis_removed, realized_gain, status,
           idempotency_key, payload_hash, created_at
         ) VALUES (
           ?, 'class-stocks', 'stock-class', 1, 1, 2, 2, 0,
           'student-trader', 'finance:student:student-trader:wallet', 2, 3,
           'sell', 2, 1000, 100, 900, 1800, 500, 0, 1800,
           18, 20, 2, 0, 2300, 0, 1, 2, 2300, -500, 'pending',
           'stock-service-forced-rollback', 'payload:forced-rollback', 60
         )`,
      ).bind(tradeId),
      db.prepare(
        `INSERT INTO finance_ledger_entries (
           id, transaction_id, class_id, account_id, amount,
           balance_after, account_revision_after, created_at
         ) VALUES (
           'entry:forced-rollback:wallet', ?, 'class-stocks',
           'finance:student:student-trader:wallet', 1800, 19500, 3, 60
         )`,
      ).bind(transactionId),
      db.prepare(
        `INSERT INTO finance_ledger_entries (
           id, transaction_id, class_id, account_id, amount,
           balance_after, account_revision_after, created_at
         ) VALUES (
           'entry:forced-rollback:issuance', ?, 'class-stocks',
           'finance:class:class-stocks:issuance', -1800, -19500, 3, 60
         )`,
      ).bind(transactionId),
      db.prepare(
        `UPDATE finance_transactions SET status = 'posted', posted_at = 60
         WHERE id = ? AND status = 'pending'`,
      ).bind(transactionId),
      db.prepare(
        `UPDATE finance_stock_holdings
         SET quantity = 0, cost_basis = 0, revision = 2,
             last_trade_id = ?, updated_at = 60
         WHERE class_id = 'class-stocks' AND stock_id = 'stock-class'
           AND student_id = 'student-trader' AND revision = 1`,
      ).bind(tradeId),
      db.prepare(
        `UPDATE finance_stocks
         SET available_shares = 20, inventory_revision = 2,
             last_trade_id = ?, updated_at = 60
         WHERE id = 'stock-class' AND class_id = 'class-stocks'
           AND inventory_revision = 1`,
      ).bind(tradeId),
      db.prepare(
        `UPDATE finance_stock_trades
         SET status = 'posted', posted_transaction_id = ?,
             transaction_payload_hash = 'tx-hash:forced-rollback:tampered',
             posted_at = 60
         WHERE id = ? AND status = 'pending'`,
      ).bind(transactionId, tradeId),
    ]);
    return Response.json({ code: "ROLLBACK_NOT_ENFORCED" }, { status: 500 });
  } catch (error) {
    return Response.json(
      { code: "FORCED_LATE_FAILURE", error: String(error) },
      { status: 409 },
    );
  }
}

const stockLiquidationWorker = {
  async fetch(request: Request, environment: TestEnvironment) {
    try {
      const input = await request.json() as Record<string, unknown>;
      if (input.forceLateFailure === true) {
        return forceLateProjectionFailure(environment.DB);
      }
      const result = await liquidateFinanceStockHolding(
        request,
        "stock-class",
        input,
      );
      return Response.json(result, { status: 201 });
    } catch (error) {
      if (error instanceof ApiError) {
        return Response.json(
          { code: error.code, error: error.message },
          { status: error.status },
        );
      }
      return Response.json(
        { code: "INTERNAL_ERROR", error: String(error) },
        { status: 500 },
      );
    }
  },
};

export default stockLiquidationWorker;
