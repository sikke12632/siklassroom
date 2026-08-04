import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const wranglerPath = path.join(
  projectRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);

function runWrangler(args, { expectSuccess = true } = {}) {
  const result = spawnSync(process.execPath, [wranglerPath, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (expectSuccess) {
    assert.equal(
      result.status,
      0,
      `Wrangler command failed.\n${output.slice(-6000)}`,
    );
  } else {
    assert.notEqual(result.status, 0, "The D1 command should have failed.");
  }
  return { ...result, output };
}

function executeSql(persistPath, sql, options) {
  const result = runWrangler([
    "d1",
    "execute",
    "DB",
    "--local",
    `--persist-to=${persistPath}`,
    "--json",
    "--command",
    sql,
  ], options);
  if (result.status !== 0) return result;
  return {
    ...result,
    data: JSON.parse(result.stdout),
  };
}

function lastResults(execution) {
  const last = execution.data.at(-1);
  assert.equal(last?.success, true);
  return last.results;
}

function fundWallet(persistPath, {
  transactionId,
  studentId,
  amount,
  createdAt,
}) {
  const walletId = `finance:student:${studentId}:wallet`;
  executeSql(
    persistPath,
    `
      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, actor_type, actor_teacher_id,
        actor_label, created_at
      ) VALUES (
        '${transactionId}', 'class-stocks', 'pending', 'manual_credit',
        'Fund stock test wallet', 'idem:${transactionId}', 'hash:${transactionId}',
        'teacher', 'teacher-stocks', 'Teacher', ${createdAt}
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES (
        'entry:${transactionId}:wallet', '${transactionId}', 'class-stocks',
        '${walletId}', ${amount},
        (SELECT balance + ${amount} FROM finance_accounts WHERE id = '${walletId}'),
        (SELECT revision + 1 FROM finance_accounts WHERE id = '${walletId}'),
        ${createdAt}
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES (
        'entry:${transactionId}:issuance', '${transactionId}', 'class-stocks',
        'finance:class:class-stocks:issuance', ${-amount},
        (SELECT balance - ${amount} FROM finance_accounts
         WHERE id = 'finance:class:class-stocks:issuance'),
        (SELECT revision + 1 FROM finance_accounts
         WHERE id = 'finance:class:class-stocks:issuance'),
        ${createdAt}
      );
      UPDATE finance_transactions
      SET status = 'posted', posted_at = ${createdAt}
      WHERE id = '${transactionId}';
    `,
  );
}

function insertPendingTrade(persistPath, trade, options) {
  return executeSql(
    persistPath,
    `
      INSERT INTO finance_stock_trades (
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
        '${trade.id}', 'class-stocks', 'stock-class', ${trade.stockRevision ?? 0},
        ${trade.inventoryRevisionBefore}, ${trade.inventoryRevisionBefore + 1},
        ${trade.marketRevision ?? 1}, ${trade.financeSettingsRevision ?? 0},
        '${trade.studentId}', 'finance:student:${trade.studentId}:wallet',
        ${trade.walletRevisionBefore}, ${trade.walletRevisionBefore + 1},
        '${trade.side}', ${trade.quantity}, ${trade.referencePrice ?? 1000},
        ${trade.spread ?? 100}, ${trade.unitPrice}, ${trade.grossAmount},
        ${trade.feeBps ?? 500}, ${trade.feeAmount}, ${trade.walletDelta},
        ${trade.availableBefore}, ${trade.availableAfter},
        ${trade.holdingQuantityBefore}, ${trade.holdingQuantityAfter},
        ${trade.holdingCostBefore}, ${trade.holdingCostAfter},
        ${trade.holdingRevisionBefore}, ${trade.holdingRevisionBefore + 1},
        ${trade.costBasisRemoved ?? 0}, ${trade.realizedGain ?? 0}, 'pending',
        '${trade.idempotencyKey}', 'payload:${trade.id}', ${trade.createdAt}
      );
    `,
    options,
  );
}

function projectAndPostTrade(persistPath, trade) {
  if (trade.holdingRevisionBefore === 0) {
    executeSql(
      persistPath,
      `
        INSERT INTO finance_stock_holdings (
          id, class_id, stock_id, student_id, wallet_account_id,
          quantity, cost_basis, revision, last_trade_id, created_at, updated_at
        ) VALUES (
          'holding:${trade.studentId}', 'class-stocks', 'stock-class',
          '${trade.studentId}', 'finance:student:${trade.studentId}:wallet',
          ${trade.holdingQuantityAfter}, ${trade.holdingCostAfter},
          ${trade.holdingRevisionBefore + 1}, '${trade.id}',
          ${trade.createdAt}, ${trade.createdAt}
        );
      `,
    );
  } else {
    executeSql(
      persistPath,
      `
        UPDATE finance_stock_holdings
        SET quantity = ${trade.holdingQuantityAfter},
            cost_basis = ${trade.holdingCostAfter},
            revision = ${trade.holdingRevisionBefore + 1},
            last_trade_id = '${trade.id}', updated_at = ${trade.createdAt}
        WHERE class_id = 'class-stocks'
          AND stock_id = 'stock-class'
          AND student_id = '${trade.studentId}';
      `,
    );
  }

  executeSql(
    persistPath,
    `
      UPDATE finance_stocks
      SET available_shares = ${trade.availableAfter},
          inventory_revision = ${trade.inventoryRevisionBefore + 1},
          last_trade_id = '${trade.id}', updated_at = ${trade.createdAt}
      WHERE id = 'stock-class' AND class_id = 'class-stocks';
    `,
  );

  const transactionId = `transaction:${trade.id}`;
  const walletId = `finance:student:${trade.studentId}:wallet`;
  const teacherLiquidation = Boolean(trade.teacherLiquidation);
  const actorType = teacherLiquidation ? "teacher" : "system";
  const actorTeacherId = teacherLiquidation ? "'teacher-stocks'" : "NULL";
  const actorLabel = teacherLiquidation ? "Teacher emergency liquidation" : "Stock system";
  const metadataJson = teacherLiquidation
    ? `'${JSON.stringify({
        interventionReason: "Test emergency liquidation",
        studentId: trade.studentId,
      })}'`
    : "NULL";
  executeSql(
    persistPath,
    `
      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_teacher_id, actor_label, metadata_json, created_at
      ) VALUES (
        '${transactionId}', 'class-stocks', 'pending',
        '${trade.side === "buy" ? "stock_buy" : "stock_sell"}',
        'Post a stock trade', 'idem:${transactionId}', 'tx-hash:${trade.id}',
        'stock_trade', '${trade.id}', '${actorType}', ${actorTeacherId},
        '${actorLabel}', ${metadataJson}, ${trade.createdAt}
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES (
        'entry:${trade.id}:wallet', '${transactionId}', 'class-stocks',
        '${walletId}', ${trade.walletDelta},
        (SELECT balance + ${trade.walletDelta} FROM finance_accounts
         WHERE id = '${walletId}'),
        (SELECT revision + 1 FROM finance_accounts WHERE id = '${walletId}'),
        ${trade.createdAt}
      );
      INSERT INTO finance_ledger_entries (
        id, transaction_id, class_id, account_id, amount,
        balance_after, account_revision_after, created_at
      ) VALUES (
        'entry:${trade.id}:issuance', '${transactionId}', 'class-stocks',
        'finance:class:class-stocks:issuance', ${-trade.walletDelta},
        (SELECT balance - (${trade.walletDelta}) FROM finance_accounts
         WHERE id = 'finance:class:class-stocks:issuance'),
        (SELECT revision + 1 FROM finance_accounts
         WHERE id = 'finance:class:class-stocks:issuance'),
        ${trade.createdAt}
      );
      UPDATE finance_transactions
      SET status = 'posted', posted_at = ${trade.createdAt}
      WHERE id = '${transactionId}';
      UPDATE finance_stock_trades
      SET status = 'posted', posted_transaction_id = '${transactionId}',
          transaction_payload_hash = 'tx-hash:${trade.id}',
          posted_at = ${trade.createdAt}
      WHERE id = '${trade.id}';
    `,
  );
}

test("stock trades keep inventory, holdings, and the financial ledger safe in D1", async () => {
  const persistPath = await mkdtemp(
    path.join(tmpdir(), "siklassroom-finance-stocks-d1-"),
  );
  try {
    runWrangler([
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      `--persist-to=${persistPath}`,
    ]);

    executeSql(
      persistPath,
      `
        INSERT INTO teachers (
          id, email, password_hash, status, created_at, updated_at
        ) VALUES (
          'teacher-stocks', 'teacher-stocks@test.local', 'hash',
          'active', 1, 1
        );
        INSERT INTO classes (
          id, teacher_id, school_name, school_normalized,
          school_year, grade, class_number, status, created_at, updated_at
        ) VALUES (
          'class-stocks', 'teacher-stocks', 'Test School', 'test school',
          2099, 6, 5, 'active', 1, 1
        );
        INSERT INTO students (
          id, class_id, student_number, official_name, status,
          created_at, updated_at
        ) VALUES
          ('student-trader', 'class-stocks', 1, 'Trader Student', 'active', 1, 1),
          ('student-other', 'class-stocks', 2, 'Other Student', 'active', 1, 1),
          ('student-poor', 'class-stocks', 3, 'Poor Student', 'active', 1, 1);
      `,
    );

    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT class_id, is_open, market_mood, revision
       FROM finance_stock_markets WHERE class_id = 'class-stocks';`,
    )), [{ class_id: "class-stocks", is_open: 0, market_mood: "mixed", revision: 0 }]);

    executeSql(
      persistPath,
      `
        INSERT INTO finance_stocks (
          id, class_id, name, symbol, description,
          initial_price, current_price, previous_price,
          total_shares, available_shares, max_shares_per_student,
          status, revision, inventory_revision, last_trade_id,
          created_by_teacher_id, updated_by_actor_type,
          updated_by_teacher_id, created_at, updated_at
        ) VALUES (
          'stock-class', 'class-stocks', 'Classroom Company', 'CLASS',
          'A single classroom stock', 1000, 1000, 1000,
          20, 20, 10, 'active', 0, 0, NULL,
          'teacher-stocks', 'teacher', 'teacher-stocks', 10, 10
        );
        INSERT INTO finance_stock_events (
          id, class_id, stock_id, revision, action, reason,
          idempotency_key, payload_hash, previous_snapshot_json,
          stock_snapshot_json, actor_type, actor_teacher_id, created_at
        ) VALUES (
          'stock-event-issued', 'class-stocks', 'stock-class', 0, 'issued',
          'Initial classroom issue', 'stock:event:issued', 'hash:stock:event:issued',
          NULL, '{"price":1000,"availableShares":20}',
          'teacher', 'teacher-stocks', 10
        );
        UPDATE finance_stock_markets
        SET is_open = 1, buy_fee_bps = 500, sell_fee_bps = 500,
            buy_spread = 100, sell_spread = 100,
            market_mood = 'bull', next_tick_at = 1000,
            revision = 1, updated_by_teacher_id = 'teacher-stocks',
            updated_at = 20
        WHERE class_id = 'class-stocks';
        INSERT INTO finance_stock_market_events (
          id, class_id, revision, action, idempotency_key, payload_hash,
          previous_snapshot_json, market_snapshot_json,
          actor_teacher_id, created_at
        ) VALUES (
          'market-event-opened', 'class-stocks', 1, 'opened',
          'stock:market:opened', 'hash:stock:market:opened',
          '{"isOpen":false,"revision":0}',
          '{"isOpen":true,"mood":"bull","revision":1}',
          'teacher-stocks', 20
        );
      `,
    );

    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT
         (SELECT action FROM finance_stock_events
          WHERE id = 'stock-event-issued') AS stock_action,
         (SELECT action FROM finance_stock_market_events
          WHERE id = 'market-event-opened') AS market_action,
         (SELECT revision FROM finance_stock_markets
          WHERE class_id = 'class-stocks') AS market_revision,
         (SELECT is_open FROM finance_stock_markets
          WHERE class_id = 'class-stocks') AS market_open;`,
    )), [{
      stock_action: "issued",
      market_action: "opened",
      market_revision: 1,
      market_open: 1,
    }]);

    const marketEventMutation = executeSql(
      persistPath,
      "UPDATE finance_stock_market_events SET action = 'updated' WHERE id = 'market-event-opened';",
      { expectSuccess: false },
    );
    assert.match(marketEventMutation.output, /FINANCE_STOCK_MARKET_EVENT_IMMUTABLE/);
    const stockEventDeletion = executeSql(
      persistPath,
      "DELETE FROM finance_stock_events WHERE id = 'stock-event-issued';",
      { expectSuccess: false },
    );
    assert.match(stockEventDeletion.output, /FINANCE_STOCK_EVENT_IMMUTABLE/);

    fundWallet(persistPath, {
      transactionId: "fund-trader",
      studentId: "student-trader",
      amount: 20000,
      createdAt: 30,
    });
    fundWallet(persistPath, {
      transactionId: "fund-other",
      studentId: "student-other",
      amount: 5000,
      createdAt: 31,
    });

    executeSql(
      persistPath,
      `
        INSERT INTO finance_cash_requests (
          id, class_id, requester_student_id, wallet_account_id,
          request_type, amount, idempotency_key, payload_hash,
          student_number_snapshot, student_name_snapshot,
          wallet_balance_snapshot, wallet_revision_snapshot, revision, created_at
        ) VALUES (
          'request-stock-reserve', 'class-stocks', 'student-trader',
          'finance:student:student-trader:wallet', 'withdrawal', 10000,
          'request:stock-reserve:1', 'hash:request:stock-reserve',
          1, 'Trader Student', 20000, 1, 0, 90
        );
        INSERT INTO finance_transactions (
          id, class_id, status, transaction_type, description,
          idempotency_key, payload_hash, source_type, source_id,
          actor_type, actor_label, created_at
        ) VALUES (
          'transaction:trade-reserved-probe', 'class-stocks', 'pending',
          'stock_buy', 'Reserved withdrawal stock probe',
          'idem:transaction:trade-reserved-probe',
          'tx-hash:trade-reserved-probe', 'stock_trade',
          'trade-reserved-probe', 'system', 'Stock system', 91
        );
      `,
    );
    const reservedStockBuy = executeSql(
      persistPath,
      `
        INSERT INTO finance_ledger_entries (
          id, transaction_id, class_id, account_id, amount,
          balance_after, account_revision_after, created_at
        ) VALUES (
          'entry:trade-reserved-probe:wallet',
          'transaction:trade-reserved-probe', 'class-stocks',
          'finance:student:student-trader:wallet', -11500, 8500, 2, 91
        );
      `,
      { expectSuccess: false },
    );
    assert.match(
      reservedStockBuy.output,
      /FINANCE_INSUFFICIENT_AVAILABLE_BALANCE/,
    );
    executeSql(
      persistPath,
      `
        DELETE FROM finance_transactions
        WHERE id = 'transaction:trade-reserved-probe' AND status = 'pending';
        INSERT INTO finance_request_resolutions (
          id, request_id, class_id, decision, idempotency_key, payload_hash,
          expected_request_revision, actor_type, actor_student_id,
          actor_label, is_emergency, posted_transaction_id,
          transaction_payload_hash, resolved_at, created_at
        ) VALUES (
          'resolution-stock-reserve', 'request-stock-reserve', 'class-stocks',
          'cancelled', 'decision:stock-reserve:1', 'hash:decision:stock-reserve',
          0, 'student', 'student-trader', 'Trader Student', 0,
          NULL, NULL, 92, 92
        );
      `,
    );

    const buy = {
      id: "trade-buy-main",
      idempotencyKey: "stock-buy-main-1",
      studentId: "student-trader",
      side: "buy",
      quantity: 10,
      inventoryRevisionBefore: 0,
      walletRevisionBefore: 1,
      unitPrice: 1100,
      grossAmount: 11000,
      feeAmount: 500,
      walletDelta: -11500,
      availableBefore: 20,
      availableAfter: 10,
      holdingQuantityBefore: 0,
      holdingQuantityAfter: 10,
      holdingCostBefore: 0,
      holdingCostAfter: 11500,
      holdingRevisionBefore: 0,
      createdAt: 100,
    };
    insertPendingTrade(persistPath, buy);
    projectAndPostTrade(persistPath, buy);

    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT
         trade.status, trade.side, trade.quantity,
         (SELECT COALESCE(SUM(amount), 0) FROM finance_ledger_entries
          WHERE transaction_id = trade.posted_transaction_id) AS ledger_sum,
         wallet.balance AS wallet_balance,
         wallet.revision AS wallet_revision,
         stock.available_shares, stock.inventory_revision,
         holding.quantity AS holding_quantity,
         holding.cost_basis, holding.revision AS holding_revision
       FROM finance_stock_trades trade
       JOIN finance_accounts wallet ON wallet.id = trade.wallet_account_id
       JOIN finance_stocks stock ON stock.id = trade.stock_id
       JOIN finance_stock_holdings holding
         ON holding.stock_id = trade.stock_id
        AND holding.student_id = trade.student_id
       WHERE trade.id = 'trade-buy-main';`,
    )), [{
      status: "posted",
      side: "buy",
      quantity: 10,
      ledger_sum: 0,
      wallet_balance: 8500,
      wallet_revision: 2,
      available_shares: 10,
      inventory_revision: 1,
      holding_quantity: 10,
      cost_basis: 11500,
      holding_revision: 1,
    }]);

    const sell = {
      id: "trade-sell-main",
      idempotencyKey: "stock-sell-main-1",
      studentId: "student-trader",
      side: "sell",
      quantity: 4,
      inventoryRevisionBefore: 1,
      walletRevisionBefore: 2,
      unitPrice: 900,
      grossAmount: 3600,
      feeAmount: 100,
      walletDelta: 3500,
      availableBefore: 10,
      availableAfter: 14,
      holdingQuantityBefore: 10,
      holdingQuantityAfter: 6,
      holdingCostBefore: 11500,
      holdingCostAfter: 6900,
      holdingRevisionBefore: 1,
      costBasisRemoved: 4600,
      realizedGain: -1100,
      createdAt: 200,
    };
    insertPendingTrade(persistPath, sell);
    projectAndPostTrade(persistPath, sell);

    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT
         trade.status, trade.side, trade.quantity, trade.fee_amount,
         trade.cost_basis_removed, trade.realized_gain,
         (SELECT COALESCE(SUM(amount), 0) FROM finance_ledger_entries
          WHERE transaction_id = trade.posted_transaction_id) AS ledger_sum,
         wallet.balance AS wallet_balance,
         wallet.revision AS wallet_revision,
         stock.available_shares, stock.inventory_revision,
         holding.quantity AS holding_quantity,
         holding.cost_basis, holding.revision AS holding_revision
       FROM finance_stock_trades trade
       JOIN finance_accounts wallet ON wallet.id = trade.wallet_account_id
       JOIN finance_stocks stock ON stock.id = trade.stock_id
       JOIN finance_stock_holdings holding
         ON holding.stock_id = trade.stock_id
        AND holding.student_id = trade.student_id
       WHERE trade.id = 'trade-sell-main';`,
    )), [{
      status: "posted",
      side: "sell",
      quantity: 4,
      fee_amount: 100,
      cost_basis_removed: 4600,
      realized_gain: -1100,
      ledger_sum: 0,
      wallet_balance: 12000,
      wallet_revision: 3,
      available_shares: 14,
      inventory_revision: 2,
      holding_quantity: 6,
      cost_basis: 6900,
      holding_revision: 2,
    }]);

    const insufficientBalanceTrade = {
      id: "trade-poor-buy",
      idempotencyKey: "stock-buy-poor-1",
      studentId: "student-poor",
      side: "buy",
      quantity: 1,
      inventoryRevisionBefore: 2,
      walletRevisionBefore: 0,
      unitPrice: 1100,
      grossAmount: 1100,
      feeAmount: 0,
      walletDelta: -1100,
      availableBefore: 14,
      availableAfter: 13,
      holdingQuantityBefore: 0,
      holdingQuantityAfter: 1,
      holdingCostBefore: 0,
      holdingCostAfter: 1100,
      holdingRevisionBefore: 0,
      createdAt: 300,
    };
    insertPendingTrade(persistPath, insufficientBalanceTrade);
    const insufficientBalance = executeSql(
      persistPath,
      `
        INSERT INTO finance_transactions (
          id, class_id, status, transaction_type, description,
          idempotency_key, payload_hash, source_type, source_id,
          actor_type, actor_label, created_at
        ) VALUES (
          'transaction:trade-poor-buy', 'class-stocks', 'pending', 'stock_buy',
          'Insufficient balance stock trade', 'idem:transaction:trade-poor-buy',
          'tx-hash:trade-poor-buy', 'stock_trade', 'trade-poor-buy',
          'system', 'Stock system', 300
        );
        INSERT INTO finance_ledger_entries (
          id, transaction_id, class_id, account_id, amount,
          balance_after, account_revision_after, created_at
        ) VALUES (
          'entry:trade-poor-buy:wallet', 'transaction:trade-poor-buy',
          'class-stocks', 'finance:student:student-poor:wallet', -1100,
          -1100, 1, 300
        );
        INSERT INTO finance_ledger_entries (
          id, transaction_id, class_id, account_id, amount,
          balance_after, account_revision_after, created_at
        ) VALUES (
          'entry:trade-poor-buy:issuance', 'transaction:trade-poor-buy',
          'class-stocks', 'finance:class:class-stocks:issuance', 1100,
          (SELECT balance + 1100 FROM finance_accounts
           WHERE id = 'finance:class:class-stocks:issuance'),
          (SELECT revision + 1 FROM finance_accounts
           WHERE id = 'finance:class:class-stocks:issuance'), 300
        );
        UPDATE finance_transactions SET status = 'posted', posted_at = 300
        WHERE id = 'transaction:trade-poor-buy';
      `,
      { expectSuccess: false },
    );
    assert.match(insufficientBalance.output, /FINANCE_INSUFFICIENT_FUNDS/);

    const inventoryShortage = insertPendingTrade(persistPath, {
      id: "trade-inventory-shortage",
      idempotencyKey: "stock-inventory-shortage-1",
      studentId: "student-other",
      side: "buy",
      quantity: 15,
      inventoryRevisionBefore: 2,
      walletRevisionBefore: 1,
      unitPrice: 1100,
      grossAmount: 16500,
      feeAmount: 800,
      walletDelta: -17300,
      availableBefore: 14,
      availableAfter: -1,
      holdingQuantityBefore: 0,
      holdingQuantityAfter: 15,
      holdingCostBefore: 0,
      holdingCostAfter: 17300,
      holdingRevisionBefore: 0,
      createdAt: 310,
    }, { expectSuccess: false });
    assert.match(inventoryShortage.output, /FINANCE_STOCK_TRADE_STALE/);

    const holdingLimit = insertPendingTrade(persistPath, {
      id: "trade-holding-limit",
      idempotencyKey: "stock-holding-limit-1",
      studentId: "student-trader",
      side: "buy",
      quantity: 5,
      inventoryRevisionBefore: 2,
      walletRevisionBefore: 3,
      unitPrice: 1100,
      grossAmount: 5500,
      feeAmount: 200,
      walletDelta: -5700,
      availableBefore: 14,
      availableAfter: 9,
      holdingQuantityBefore: 6,
      holdingQuantityAfter: 11,
      holdingCostBefore: 6900,
      holdingCostAfter: 12600,
      holdingRevisionBefore: 2,
      createdAt: 320,
    }, { expectSuccess: false });
    assert.match(holdingLimit.output, /FINANCE_STOCK_TRADE_STALE/);

    const staleRevision = insertPendingTrade(persistPath, {
      id: "trade-stale-revision",
      idempotencyKey: "stock-stale-revision-1",
      studentId: "student-other",
      side: "buy",
      quantity: 1,
      stockRevision: 1,
      inventoryRevisionBefore: 2,
      walletRevisionBefore: 1,
      unitPrice: 1100,
      grossAmount: 1100,
      feeAmount: 0,
      walletDelta: -1100,
      availableBefore: 14,
      availableAfter: 13,
      holdingQuantityBefore: 0,
      holdingQuantityAfter: 1,
      holdingCostBefore: 0,
      holdingCostAfter: 1100,
      holdingRevisionBefore: 0,
      createdAt: 330,
    }, { expectSuccess: false });
    assert.match(staleRevision.output, /FINANCE_STOCK_TRADE_STALE/);

    const duplicateIdempotency = insertPendingTrade(persistPath, {
      id: "trade-duplicate-idempotency",
      idempotencyKey: "stock-buy-main-1",
      studentId: "student-trader",
      side: "sell",
      quantity: 1,
      inventoryRevisionBefore: 2,
      walletRevisionBefore: 3,
      unitPrice: 900,
      grossAmount: 900,
      feeAmount: 0,
      walletDelta: 900,
      availableBefore: 14,
      availableAfter: 15,
      holdingQuantityBefore: 6,
      holdingQuantityAfter: 5,
      holdingCostBefore: 6900,
      holdingCostAfter: 5750,
      holdingRevisionBefore: 2,
      costBasisRemoved: 1150,
      realizedGain: -250,
      createdAt: 340,
    }, { expectSuccess: false });
    assert.match(
      duplicateIdempotency.output,
      /UNIQUE constraint failed: finance_stock_trades\.class_id, finance_stock_trades\.student_id, finance_stock_trades\.idempotency_key/,
    );

    const tradeMutation = executeSql(
      persistPath,
      "UPDATE finance_stock_trades SET quantity = 9 WHERE id = 'trade-buy-main';",
      { expectSuccess: false },
    );
    assert.match(tradeMutation.output, /FINANCE_STOCK_TRADE_IMMUTABLE/);
    const tradeDeletion = executeSql(
      persistPath,
      "DELETE FROM finance_stock_trades WHERE id = 'trade-buy-main';",
      { expectSuccess: false },
    );
    assert.match(tradeDeletion.output, /FINANCE_STOCK_TRADE_IMMUTABLE/);

    const ledgerMutation = executeSql(
      persistPath,
      "UPDATE finance_ledger_entries SET amount = -1 WHERE id = 'entry:trade-buy-main:wallet';",
      { expectSuccess: false },
    );
    assert.match(ledgerMutation.output, /FINANCE_LEDGER_IMMUTABLE/);

    const generalReversal = executeSql(
      persistPath,
      `INSERT INTO finance_transactions (
         id, class_id, status, transaction_type, description,
         idempotency_key, payload_hash, source_type, source_id,
         reversal_of_transaction_id, actor_type, actor_teacher_id,
         actor_label, created_at
       ) VALUES (
         'transaction:stock-general-reversal', 'class-stocks', 'pending',
         'reversal', 'Unsafe stock reversal', 'stock:general-reversal',
         'hash:stock:general-reversal', 'reversal',
         'transaction:trade-buy-main', 'transaction:trade-buy-main',
         'teacher', 'teacher-stocks', 'Teacher', 350
       );`,
      { expectSuccess: false },
    );
    assert.match(generalReversal.output, /FINANCE_STOCK_REVERSAL_REQUIRES_TRADE/);

    const activeStudentExcluded = executeSql(
      persistPath,
      `UPDATE students SET status = 'excluded', updated_at = 360
       WHERE id = 'student-trader';`,
      { expectSuccess: false },
    );
    assert.match(activeStudentExcluded.output, /FINANCE_STOCK_ACTIVE_STUDENT/);
    const classWithActiveHoldingArchived = executeSql(
      persistPath,
      `UPDATE classes SET status = 'archived', updated_at = 360
       WHERE id = 'class-stocks';`,
      { expectSuccess: false },
    );
    assert.match(classWithActiveHoldingArchived.output, /FINANCE_STOCK_ACTIVE_CLASS/);

    const tamperedTrade = {
      id: "trade-ledger-tamper",
      idempotencyKey: "stock-ledger-tamper-1",
      studentId: "student-other",
      side: "buy",
      quantity: 1,
      inventoryRevisionBefore: 2,
      walletRevisionBefore: 1,
      unitPrice: 1100,
      grossAmount: 1100,
      feeAmount: 0,
      walletDelta: -1100,
      availableBefore: 14,
      availableAfter: 13,
      holdingQuantityBefore: 0,
      holdingQuantityAfter: 1,
      holdingCostBefore: 0,
      holdingCostAfter: 1100,
      holdingRevisionBefore: 0,
      createdAt: 400,
    };
    insertPendingTrade(persistPath, tamperedTrade);
    executeSql(
      persistPath,
      `
        INSERT INTO finance_transactions (
          id, class_id, status, transaction_type, description,
          idempotency_key, payload_hash, source_type, source_id,
          actor_type, actor_label, created_at
        ) VALUES (
          'transaction:trade-ledger-tamper', 'class-stocks', 'pending',
          'stock_buy', 'Tampered stock ledger',
          'idem:transaction:trade-ledger-tamper',
          'tx-hash:trade-ledger-tamper', 'stock_trade',
          'trade-ledger-tamper', 'system', 'Stock system', 400
        );
        INSERT INTO finance_ledger_entries (
          id, transaction_id, class_id, account_id, amount,
          balance_after, account_revision_after, created_at
        ) VALUES (
          'entry:trade-ledger-tamper:wallet',
          'transaction:trade-ledger-tamper', 'class-stocks',
          'finance:student:student-other:wallet', -1000,
          (SELECT balance - 1000 FROM finance_accounts
           WHERE id = 'finance:student:student-other:wallet'),
          (SELECT revision + 1 FROM finance_accounts
           WHERE id = 'finance:student:student-other:wallet'), 400
        );
        INSERT INTO finance_ledger_entries (
          id, transaction_id, class_id, account_id, amount,
          balance_after, account_revision_after, created_at
        ) VALUES (
          'entry:trade-ledger-tamper:issuance',
          'transaction:trade-ledger-tamper', 'class-stocks',
          'finance:class:class-stocks:issuance', 1000,
          (SELECT balance + 1000 FROM finance_accounts
           WHERE id = 'finance:class:class-stocks:issuance'),
          (SELECT revision + 1 FROM finance_accounts
           WHERE id = 'finance:class:class-stocks:issuance'), 400
        );
        UPDATE finance_transactions SET status = 'posted', posted_at = 400
        WHERE id = 'transaction:trade-ledger-tamper';
      `,
    );
    const ledgerMismatch = executeSql(
      persistPath,
      `UPDATE finance_stock_trades
       SET status = 'posted',
           posted_transaction_id = 'transaction:trade-ledger-tamper',
           transaction_payload_hash = 'tx-hash:trade-ledger-tamper',
           posted_at = 400
       WHERE id = 'trade-ledger-tamper';`,
      { expectSuccess: false },
    );
    assert.match(ledgerMismatch.output, /FINANCE_STOCK_LEDGER_MISMATCH/);

    const teacherLiquidation = {
      id: "trade-teacher-liquidation",
      idempotencyKey: "stock-teacher-liquidation-1",
      studentId: "student-trader",
      side: "sell",
      quantity: 6,
      inventoryRevisionBefore: 2,
      walletRevisionBefore: 3,
      unitPrice: 900,
      grossAmount: 5400,
      feeAmount: 200,
      walletDelta: 5200,
      availableBefore: 14,
      availableAfter: 20,
      holdingQuantityBefore: 6,
      holdingQuantityAfter: 0,
      holdingCostBefore: 6900,
      holdingCostAfter: 0,
      holdingRevisionBefore: 2,
      costBasisRemoved: 6900,
      realizedGain: -1700,
      teacherLiquidation: true,
      createdAt: 500,
    };
    insertPendingTrade(persistPath, teacherLiquidation);
    projectAndPostTrade(persistPath, teacherLiquidation);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT trade.status, transaction_row.actor_type,
              transaction_row.actor_teacher_id,
              json_extract(transaction_row.metadata_json, '$.interventionReason') AS reason,
              holding.quantity AS holding_quantity,
              wallet.balance AS wallet_balance,
              stock.available_shares
       FROM finance_stock_trades trade
       JOIN finance_transactions transaction_row
         ON transaction_row.id = trade.posted_transaction_id
       JOIN finance_stock_holdings holding
         ON holding.stock_id = trade.stock_id
        AND holding.student_id = trade.student_id
       JOIN finance_accounts wallet ON wallet.id = trade.wallet_account_id
       JOIN finance_stocks stock ON stock.id = trade.stock_id
       WHERE trade.id = 'trade-teacher-liquidation';`,
    )), [{
      status: "posted",
      actor_type: "teacher",
      actor_teacher_id: "teacher-stocks",
      reason: "Test emergency liquidation",
      holding_quantity: 0,
      wallet_balance: 17200,
      available_shares: 20,
    }]);

    const reconciliation = lastResults(executeSql(
      persistPath,
      `SELECT account.id
       FROM finance_accounts account
       LEFT JOIN (
         SELECT entry.account_id, SUM(entry.amount) AS balance,
                COUNT(*) AS revision
         FROM finance_ledger_entries entry
         JOIN finance_transactions transaction_row
           ON transaction_row.id = entry.transaction_id
          AND transaction_row.status = 'posted'
         GROUP BY entry.account_id
       ) ledger ON ledger.account_id = account.id
       WHERE account.class_id = 'class-stocks'
         AND (
           account.balance <> COALESCE(ledger.balance, 0)
           OR account.revision <> COALESCE(ledger.revision, 0)
         );`,
    ));
    assert.deepEqual(reconciliation, []);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      "PRAGMA foreign_key_check;",
    )), []);
  } finally {
    await rm(persistPath, { recursive: true, force: true });
  }
});
