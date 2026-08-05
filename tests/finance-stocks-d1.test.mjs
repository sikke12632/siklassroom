import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
const stockLiquidationWorkerPath = "tests/fixtures/stock-liquidation-worker.ts";
const stockLiquidationConfigPath = "tests/fixtures/wrangler.stock-liquidation.jsonc";
const stockPositionLimitWorkerPath = "tests/fixtures/stock-position-limit-worker.ts";
const stockPositionLimitConfigPath = "tests/fixtures/wrangler.stock-position-limit.jsonc";
const stockTickRaceWorkerPath = "tests/fixtures/stock-tick-race-worker.ts";
const stockTickRaceConfigPath = "tests/fixtures/wrangler.stock-tick-race.jsonc";
const stockTickAuditWorkerPath = "tests/fixtures/stock-tick-audit-worker.ts";
const stockTickAuditConfigPath = "tests/fixtures/wrangler.stock-tick-audit.jsonc";

function runWrangler(args, { expectSuccess = true } = {}) {
  let result;
  let output = "";
  const retrySignal = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    result = spawnSync(process.execPath, [wranglerPath, ...args], {
      cwd: projectRoot,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    });
    output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (
      result.status === 0
      || (!output.includes("bad port") && !output.includes("fetch failed"))
    ) break;
    Atomics.wait(retrySignal, 0, 0, 250 * (attempt + 1));
  }
  assert.ok(result, "Wrangler did not start.");
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

function closeWorkerConnectionAfterEachFetch(worker) {
  const workerFetch = worker.fetch.bind(worker);
  worker.fetch = (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("connection", "close");
    return workerFetch(input, { ...init, headers });
  };
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

function teacherLiquidationMetadata(trade) {
  return JSON.stringify({
    tradeId: trade.id,
    stockId: "stock-class",
    symbol: "CLASS",
    studentId: trade.studentId,
    side: trade.side,
    quantity: trade.quantity,
    referencePrice: trade.referencePrice ?? 1000,
    spreadSnapshot: trade.spread ?? 100,
    unitPrice: trade.unitPrice,
    grossAmount: trade.grossAmount,
    feeBpsSnapshot: trade.feeBps ?? 500,
    feeAmount: trade.feeAmount,
    walletDelta: trade.walletDelta,
    stockRevision: trade.stockRevision ?? 0,
    inventoryRevisionBefore: trade.inventoryRevisionBefore,
    marketRevision: trade.marketRevision ?? 1,
    financeSettingsRevision: trade.financeSettingsRevision ?? 0,
    walletRevisionBefore: trade.walletRevisionBefore,
    holdingRevisionBefore: trade.holdingRevisionBefore,
    availableSharesBefore: trade.availableBefore,
    availableSharesAfter: trade.availableAfter,
    holdingQuantityBefore: trade.holdingQuantityBefore,
    holdingQuantityAfter: trade.holdingQuantityAfter,
    holdingCostBasisBefore: trade.holdingCostBefore,
    holdingCostBasisAfter: trade.holdingCostAfter,
    costBasisRemoved: trade.costBasisRemoved ?? 0,
    realizedGain: trade.realizedGain ?? 0,
    isEmergency: true,
    operationId: `stock-liquidation:test:${trade.id}`,
    origin: trade.origin ?? "finance_center",
    interventionReason: trade.interventionReason ?? "Test emergency liquidation",
    studentStatusSnapshot: trade.studentStatus ?? "active",
    marketWasOpen: trade.marketWasOpen ?? true,
    stockStatusSnapshot: trade.stockStatus ?? "active",
    liquidationPolicy: "current_market_terms_at_liquidation",
    ...(trade.metadataOverrides ?? {}),
  });
}

function insertTeacherLiquidationHeader(persistPath, trade, options) {
  const transactionId = `transaction:${trade.id}`;
  const metadataJson = teacherLiquidationMetadata(trade).replaceAll("'", "''");
  return executeSql(
    persistPath,
    `
      INSERT INTO finance_transactions (
        id, class_id, status, transaction_type, description,
        idempotency_key, payload_hash, source_type, source_id,
        actor_type, actor_teacher_id, actor_label, metadata_json, created_at
      ) VALUES (
        '${transactionId}', 'class-stocks', 'pending', 'stock_sell',
        'Teacher emergency liquidation', 'stock-trade:${trade.id}:ledger',
        'tx-hash:${trade.id}', 'stock_trade', '${trade.id}',
        'teacher', '${trade.actorTeacherId ?? "teacher-stocks"}',
        'Teacher emergency liquidation', '${metadataJson}', ${trade.createdAt}
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
  if (!teacherLiquidation) {
    executeSql(
      persistPath,
      `
        INSERT INTO finance_transactions (
          id, class_id, status, transaction_type, description,
          idempotency_key, payload_hash, source_type, source_id,
          actor_type, actor_label, created_at
        ) VALUES (
          '${transactionId}', 'class-stocks', 'pending',
          '${trade.side === "buy" ? "stock_buy" : "stock_sell"}',
          'Post a stock trade', 'stock-trade:${trade.id}:ledger',
          'tx-hash:${trade.id}', 'stock_trade', '${trade.id}',
          'system', 'Stock system', ${trade.createdAt}
        );
      `,
    );
  }
  executeSql(
    persistPath,
    `
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
        ) VALUES
          (
            'teacher-stocks', 'teacher-stocks@test.local', 'hash',
            'active', 1, 1
          ),
          (
            'teacher-other', 'teacher-other@test.local', 'hash',
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

    const excessivePriceIncrease = executeSql(
      persistPath,
      `UPDATE finance_stocks
       SET current_price = 166666667, previous_price = 1000,
           revision = revision + 1,
           updated_by_actor_type = 'teacher',
           updated_by_teacher_id = 'teacher-stocks', updated_at = 449
       WHERE id = 'stock-class' AND class_id = 'class-stocks'
         AND revision = 0;`,
      { expectSuccess: false },
    );
    assert.match(
      excessivePriceIncrease.output,
      /FINANCE_STOCK_POSITION_VALUE_LIMIT/,
    );
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT current_price, previous_price, revision
       FROM finance_stocks WHERE id = 'stock-class';`,
    )), [{ current_price: 1000, previous_price: 1000, revision: 0 }]);

    executeSql(
      persistPath,
      `
        UPDATE finance_stock_markets
        SET is_open = 0, revision = 2,
            updated_by_teacher_id = 'teacher-stocks', updated_at = 450
        WHERE class_id = 'class-stocks';
      `,
    );

    const blockedStudentSell = {
      id: "trade-student-closed-market",
      idempotencyKey: "stock-student-closed-market-1",
      studentId: "student-trader",
      side: "sell",
      quantity: 1,
      stockRevision: 0,
      marketRevision: 2,
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
      createdAt: 460,
    };
    const blockedStudentSellResult = insertPendingTrade(
      persistPath,
      blockedStudentSell,
      { expectSuccess: false },
    );
    assert.match(blockedStudentSellResult.output, /FINANCE_STOCK_TRADE_STALE/);

    executeSql(
      persistPath,
      `
        UPDATE finance_stock_markets
        SET is_open = 1, revision = 3,
            updated_by_teacher_id = 'teacher-stocks', updated_at = 451
        WHERE class_id = 'class-stocks';
        UPDATE finance_stocks
        SET status = 'halted', revision = 1,
            updated_by_actor_type = 'teacher',
            updated_by_teacher_id = 'teacher-stocks', updated_at = 451
        WHERE id = 'stock-class' AND class_id = 'class-stocks';
      `,
    );
    const haltedStockStudentSell = {
      ...blockedStudentSell,
      id: "trade-student-halted-stock",
      idempotencyKey: "stock-student-halted-stock-1",
      stockRevision: 1,
      marketRevision: 3,
      createdAt: 461,
    };
    const haltedStockStudentSellResult = insertPendingTrade(
      persistPath,
      haltedStockStudentSell,
      { expectSuccess: false },
    );
    assert.match(haltedStockStudentSellResult.output, /FINANCE_STOCK_TRADE_STALE/);

    executeSql(
      persistPath,
      `
        UPDATE finance_stocks
        SET status = 'active', revision = 2,
            updated_by_actor_type = 'teacher',
            updated_by_teacher_id = 'teacher-stocks', updated_at = 452
        WHERE id = 'stock-class' AND class_id = 'class-stocks';
        UPDATE students SET status = 'locked', updated_at = 452
        WHERE id = 'student-trader' AND class_id = 'class-stocks';
      `,
    );
    const lockedStudentSell = {
      ...blockedStudentSell,
      id: "trade-locked-student-open-market",
      idempotencyKey: "stock-locked-student-open-market-1",
      stockRevision: 2,
      marketRevision: 3,
      createdAt: 462,
    };
    const lockedStudentSellResult = insertPendingTrade(
      persistPath,
      lockedStudentSell,
      { expectSuccess: false },
    );
    assert.match(lockedStudentSellResult.output, /FINANCE_STOCK_TRADE_STALE/);

    executeSql(
      persistPath,
      `
        UPDATE finance_stock_markets
        SET is_open = 0, revision = 4,
            updated_by_teacher_id = 'teacher-stocks', updated_at = 453
        WHERE class_id = 'class-stocks';
        UPDATE finance_stocks
        SET status = 'halted', revision = 3,
            updated_by_actor_type = 'teacher',
            updated_by_teacher_id = 'teacher-stocks', updated_at = 453
        WHERE id = 'stock-class' AND class_id = 'class-stocks';
      `,
    );

    const teacherLiquidation = {
      id: "trade-teacher-liquidation",
      idempotencyKey: "stock-teacher-liquidation-1",
      studentId: "student-trader",
      side: "sell",
      quantity: 6,
      stockRevision: 3,
      marketRevision: 4,
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
      studentStatus: "locked",
      marketWasOpen: false,
      stockStatus: "halted",
      createdAt: 500,
    };

    const shortReasonLiquidation = {
      ...teacherLiquidation,
      id: "trade-teacher-short-reason",
      idempotencyKey: "stock-teacher-short-reason-1",
      interventionReason: "x",
      createdAt: 490,
    };
    insertTeacherLiquidationHeader(persistPath, shortReasonLiquidation);
    const shortReasonResult = insertPendingTrade(
      persistPath,
      shortReasonLiquidation,
      { expectSuccess: false },
    );
    assert.match(shortReasonResult.output, /FINANCE_STOCK_TRADE_STALE/);

    const wrongOwnerLiquidation = {
      ...teacherLiquidation,
      id: "trade-teacher-wrong-owner",
      idempotencyKey: "stock-teacher-wrong-owner-1",
      actorTeacherId: "teacher-other",
      createdAt: 491,
    };
    const wrongOwnerResult = insertTeacherLiquidationHeader(
      persistPath,
      wrongOwnerLiquidation,
      { expectSuccess: false },
    );
    assert.match(wrongOwnerResult.output, /FINANCE_CLASS_ACCESS_DENIED/);

    const rejectedTeacherLiquidations = [
      {
        ...teacherLiquidation,
        id: "trade-teacher-price-tamper",
        idempotencyKey: "stock-teacher-price-tamper-1",
        metadataOverrides: { unitPrice: 800 },
        createdAt: 492,
      },
      {
        ...teacherLiquidation,
        id: "trade-teacher-fee-tamper",
        idempotencyKey: "stock-teacher-fee-tamper-1",
        metadataOverrides: { feeAmount: 100 },
        createdAt: 493,
      },
      {
        ...teacherLiquidation,
        id: "trade-teacher-revision-tamper",
        idempotencyKey: "stock-teacher-revision-tamper-1",
        metadataOverrides: { financeSettingsRevision: 99 },
        createdAt: 494,
      },
    ];
    for (const rejectedLiquidation of rejectedTeacherLiquidations) {
      insertTeacherLiquidationHeader(persistPath, rejectedLiquidation);
      const rejectedResult = insertPendingTrade(
        persistPath,
        rejectedLiquidation,
        { expectSuccess: false },
      );
      assert.match(rejectedResult.output, /FINANCE_STOCK_TRADE_STALE/);
    }

    insertTeacherLiquidationHeader(persistPath, teacherLiquidation);
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
    executeSql(
      persistPath,
      `
        UPDATE students SET status = 'excluded', updated_at = 600
        WHERE id = 'student-trader' AND class_id = 'class-stocks';
        UPDATE classes SET status = 'archived', updated_at = 610
        WHERE id = 'class-stocks';
      `,
    );
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT classroom.status AS class_status, student.status AS student_status
       FROM classes classroom
       JOIN students student ON student.class_id = classroom.id
       WHERE classroom.id = 'class-stocks' AND student.id = 'student-trader';`,
    )), [{ class_status: "archived", student_status: "excluded" }]);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      "PRAGMA foreign_key_check;",
    )), []);
  } finally {
    await rm(persistPath, { recursive: true, force: true });
  }
});

test("teacher liquidation keeps the confirmed quote and retries only once in the service", {
  timeout: 120_000,
}, async () => {
  const persistPath = await mkdtemp(
    path.join(tmpdir(), "siklassroom-stock-liquidation-service-d1-"),
  );
  let worker;
  try {
    runWrangler([
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      `--persist-to=${persistPath}`,
    ]);

    const rawSessionToken = "teacher-stock-liquidation-session";
    const sessionTokenHash = createHash("sha256")
      .update(rawSessionToken)
      .digest("base64url");
    executeSql(persistPath, `
      INSERT INTO teachers (
        id, email, password_hash, status, email_verified_at,
        teacher_access_status, teacher_access_verified_at, school_id,
        created_at, updated_at
      ) VALUES (
        'teacher-stocks', 'teacher-stocks@test.local', 'hash', 'active', 1,
        'invite_verified', 1, 'school-test', 1, 1
      );
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized, school_id,
        school_year, grade, class_number, status, created_at, updated_at
      ) VALUES (
        'class-stocks', 'teacher-stocks', 'Test School', 'test school',
        'school-test', 2099, 6, 7, 'active', 1, 1
      );
      INSERT INTO students (
        id, class_id, student_number, official_name, status,
        created_at, updated_at
      ) VALUES (
        'student-trader', 'class-stocks', 1, 'Trader Student', 'active', 1, 1
      );
      INSERT INTO sessions (
        id, token_hash, actor_type, teacher_id, student_id,
        expires_at, created_at, last_seen_at
      ) VALUES (
        'session-stock-liquidation', '${sessionTokenHash}', 'teacher',
        'teacher-stocks', NULL, 4102444800000, 1, 1
      );
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
        idempotency_key, payload_hash, stock_snapshot_json,
        actor_type, actor_teacher_id, created_at
      ) VALUES (
        'stock-event-service-issued', 'class-stocks', 'stock-class', 0,
        'issued', 'Initial classroom issue', 'stock:event:service:issued',
        'hash:stock:event:service:issued', '{"price":1000}',
        'teacher', 'teacher-stocks', 10
      );
      UPDATE finance_stock_markets
      SET is_open = 1, buy_fee_bps = 500, sell_fee_bps = 500,
          buy_spread = 100, sell_spread = 100,
          next_tick_at = 1000, revision = 1,
          updated_by_teacher_id = 'teacher-stocks', updated_at = 20
      WHERE class_id = 'class-stocks';
    `);

    fundWallet(persistPath, {
      transactionId: "fund-service-trader",
      studentId: "student-trader",
      amount: 20_000,
      createdAt: 30,
    });
    const buy = {
      id: "trade-service-buy",
      idempotencyKey: "stock-service-buy-1",
      studentId: "student-trader",
      side: "buy",
      quantity: 2,
      inventoryRevisionBefore: 0,
      walletRevisionBefore: 1,
      unitPrice: 1100,
      grossAmount: 2200,
      feeAmount: 100,
      walletDelta: -2300,
      availableBefore: 20,
      availableAfter: 18,
      holdingQuantityBefore: 0,
      holdingQuantityAfter: 2,
      holdingCostBefore: 0,
      holdingCostAfter: 2300,
      holdingRevisionBefore: 0,
      createdAt: 40,
    };
    insertPendingTrade(persistPath, buy);
    projectAndPostTrade(persistPath, buy);
    executeSql(persistPath, `
      UPDATE finance_stock_markets
      SET is_open = 0, revision = 2,
          updated_by_teacher_id = 'teacher-stocks', updated_at = 50
      WHERE class_id = 'class-stocks';
      UPDATE finance_stocks
      SET status = 'halted', revision = 1,
          updated_by_actor_type = 'teacher',
          updated_by_teacher_id = 'teacher-stocks', updated_at = 50
      WHERE id = 'stock-class' AND class_id = 'class-stocks';
      UPDATE students SET status = 'locked', updated_at = 50
      WHERE id = 'student-trader' AND class_id = 'class-stocks';
    `);

    worker = await (await import("wrangler")).unstable_dev(
      stockLiquidationWorkerPath,
      {
        config: stockLiquidationConfigPath,
        moduleRoot: projectRoot,
        persistTo: persistPath,
        logLevel: "none",
        experimental: {
          disableDevRegistry: true,
          disableExperimentalWarning: true,
          watch: false,
        },
      },
    );
    closeWorkerConnectionAfterEachFetch(worker);
    const requestBody = {
      studentId: "student-trader",
      reason: "Account recovery liquidation",
      origin: "account_recovery",
      expectedStockRevision: 1,
      expectedMarketRevision: 2,
      expectedFinanceSettingsRevision: 0,
      expectedHoldingRevision: 1,
      idempotencyKey: "stock-service-liquidation-1",
    };
    const cookie = `job_classroom_session=${rawSessionToken}`;

    const liquidationState = () => lastResults(executeSql(
      persistPath,
      `SELECT
         (SELECT balance FROM finance_accounts
          WHERE id = 'finance:student:student-trader:wallet') AS wallet_balance,
         (SELECT revision FROM finance_accounts
          WHERE id = 'finance:student:student-trader:wallet') AS wallet_revision,
         (SELECT balance FROM finance_accounts
          WHERE id = 'finance:class:class-stocks:issuance') AS issuance_balance,
         (SELECT revision FROM finance_accounts
          WHERE id = 'finance:class:class-stocks:issuance') AS issuance_revision,
         (SELECT quantity FROM finance_stock_holdings
          WHERE student_id = 'student-trader') AS holding_quantity,
         (SELECT cost_basis FROM finance_stock_holdings
          WHERE student_id = 'student-trader') AS holding_cost_basis,
         (SELECT revision FROM finance_stock_holdings
          WHERE student_id = 'student-trader') AS holding_revision,
         (SELECT last_trade_id FROM finance_stock_holdings
          WHERE student_id = 'student-trader') AS holding_last_trade_id,
         (SELECT available_shares FROM finance_stocks
          WHERE id = 'stock-class') AS available_shares,
         (SELECT inventory_revision FROM finance_stocks
          WHERE id = 'stock-class') AS inventory_revision,
         (SELECT last_trade_id FROM finance_stocks
          WHERE id = 'stock-class') AS stock_last_trade_id,
         (SELECT COUNT(*) FROM finance_stock_trades) AS trade_count,
         (SELECT COUNT(*) FROM finance_transactions) AS transaction_count,
         (SELECT COUNT(*) FROM finance_ledger_entries) AS entry_count;`,
    ));
    const before = liquidationState();
    const rollbackResponse = await worker.fetch(
      "http://test.local/liquidate?classId=class-stocks",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ forceLateFailure: true }),
      },
    );
    assert.equal(rollbackResponse.status, 409);
    const rollbackResult = await rollbackResponse.json();
    assert.equal(rollbackResult.code, "FORCED_LATE_FAILURE");
    assert.match(
      rollbackResult.error,
      /FINANCE_STOCK_LEDGER_MISMATCH/,
    );
    assert.deepEqual(liquidationState(), before);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT
         (SELECT COUNT(*) FROM finance_transactions
          WHERE id = 'transaction:trade-service-forced-rollback') AS transaction_count,
         (SELECT COUNT(*) FROM finance_stock_trades
          WHERE id = 'trade-service-forced-rollback') AS trade_count,
         (SELECT COUNT(*) FROM finance_ledger_entries
          WHERE transaction_id = 'transaction:trade-service-forced-rollback') AS entry_count;`,
    )), [{ transaction_count: 0, trade_count: 0, entry_count: 0 }]);

    const staleResponse = await worker.fetch(
      "http://test.local/liquidate?classId=class-stocks",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          ...requestBody,
          expectedFinanceSettingsRevision: 99,
          idempotencyKey: "stock-service-liquidation-stale",
        }),
      },
    );
    assert.equal(staleResponse.status, 409);
    assert.equal((await staleResponse.json()).code, "FINANCE_STOCK_TRADE_STALE");
    assert.deepEqual(liquidationState(), before);

    const response = await worker.fetch(
      "http://test.local/liquidate?classId=class-stocks",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(requestBody),
      },
    );
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.deduplicated, false);
    assert.equal(result.trade.quantity, 2);
    assert.equal(result.trade.netAmount, 1800);

    const conflictingRetryResponse = await worker.fetch(
      "http://test.local/liquidate?classId=class-stocks",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          ...requestBody,
          expectedFinanceSettingsRevision: 99,
        }),
      },
    );
    assert.equal(conflictingRetryResponse.status, 409);
    assert.equal(
      (await conflictingRetryResponse.json()).code,
      "FINANCE_STOCK_IDEMPOTENCY_CONFLICT",
    );

    const retryResponse = await worker.fetch(
      "http://test.local/liquidate?classId=class-stocks",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(requestBody),
      },
    );
    assert.equal(retryResponse.status, 201);
    assert.equal((await retryResponse.json()).deduplicated, true);

    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT
         wallet.balance AS wallet_balance,
         wallet.revision AS wallet_revision,
         holding.quantity AS holding_quantity,
         stock.available_shares,
         (SELECT COUNT(*) FROM finance_stock_trades) AS trade_count,
         (SELECT COUNT(*) FROM finance_transactions) AS transaction_count,
         (SELECT COUNT(*) FROM finance_ledger_entries) AS entry_count,
         transaction_row.description,
         json_extract(transaction_row.metadata_json, '$.interventionReason') AS reason
       FROM finance_accounts wallet
       JOIN finance_stock_holdings holding
         ON holding.wallet_account_id = wallet.id
       JOIN finance_stocks stock ON stock.id = holding.stock_id
       JOIN finance_stock_trades trade ON trade.id = holding.last_trade_id
       JOIN finance_transactions transaction_row
         ON transaction_row.id = trade.posted_transaction_id
       WHERE wallet.id = 'finance:student:student-trader:wallet';`,
    )), [{
      wallet_balance: 19500,
      wallet_revision: 3,
      holding_quantity: 0,
      available_shares: 20,
      trade_count: 2,
      transaction_count: 3,
      entry_count: 6,
      description: "Classroom Company 2주 담임교사 비상 청산",
      reason: "Account recovery liquidation",
    }]);
    assert.equal(
      lastResults(executeSql(
        persistPath,
        `SELECT COUNT(*) AS count FROM finance_transactions
         WHERE description LIKE '%Account recovery liquidation%';`,
      ))[0].count,
      0,
    );
  } finally {
    await worker?.stop();
    await rm(persistPath, { recursive: true, force: true });
  }
});

test("position value limits protect teacher prices, real buys, and idempotent capped ticks", {
  timeout: 120_000,
}, async () => {
  const persistPath = await mkdtemp(
    path.join(tmpdir(), "siklassroom-stock-position-limit-service-d1-"),
  );
  let worker;
  try {
    runWrangler([
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      `--persist-to=${persistPath}`,
    ]);

    const rawTeacherToken = "teacher-stock-position-limit-session";
    const rawStudentToken = "student-stock-position-limit-session";
    const teacherTokenHash = createHash("sha256")
      .update(rawTeacherToken)
      .digest("base64url");
    const studentTokenHash = createHash("sha256")
      .update(rawStudentToken)
      .digest("base64url");
    executeSql(persistPath, `
      INSERT INTO teachers (
        id, email, password_hash, status, email_verified_at,
        teacher_access_status, teacher_access_verified_at, school_id,
        created_at, updated_at
      ) VALUES (
        'teacher-stocks', 'teacher-position-limit@test.local', 'hash',
        'active', 1, 'invite_verified', 1, 'school-test', 1, 1
      );
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized, school_id,
        school_year, grade, class_number, status, created_at, updated_at
      ) VALUES (
        'class-stocks', 'teacher-stocks', 'Test School', 'test school',
        'school-test', 2099, 6, 8, 'active', 1, 1
      );
      INSERT INTO students (
        id, class_id, student_number, official_name, status,
        created_at, updated_at
      ) VALUES (
        'student-limit', 'class-stocks', 1, 'Limit Student', 'active', 1, 1
      );
      INSERT INTO sessions (
        id, token_hash, actor_type, teacher_id, student_id,
        expires_at, created_at, last_seen_at
      ) VALUES
        ('session-position-limit-teacher', '${teacherTokenHash}', 'teacher',
         'teacher-stocks', NULL, 4102444800000, 1, 1),
        ('session-position-limit-student', '${studentTokenHash}', 'student',
         NULL, 'student-limit', 4102444800000, 1, 1);
      INSERT INTO finance_stocks (
        id, class_id, name, symbol, description,
        initial_price, current_price, previous_price,
        total_shares, available_shares, max_shares_per_student,
        status, revision, inventory_revision, last_trade_id,
        created_by_teacher_id, updated_by_actor_type,
        updated_by_teacher_id, created_at, updated_at
      ) VALUES (
        'stock-class', 'class-stocks', 'Limit Company', 'LIMIT',
        'Position-value boundary stock', 1000, 1000, 1000,
        1000000, 1000000, 1000000, 'active', 0, 0, NULL,
        'teacher-stocks', 'teacher', 'teacher-stocks', 10, 10
      );
      INSERT INTO finance_stock_events (
        id, class_id, stock_id, revision, action, reason,
        idempotency_key, payload_hash, stock_snapshot_json,
        actor_type, actor_teacher_id, created_at
      ) VALUES (
        'stock-event-position-limit-issued', 'class-stocks', 'stock-class', 0,
        'issued', 'Initial boundary issue', 'stock:event:position-limit:issued',
        'hash:stock:event:position-limit:issued',
        '{"currentPrice":1000,"revision":0}',
        'teacher', 'teacher-stocks', 10
      );
      UPDATE finance_stock_markets
      SET is_open = 1, buy_fee_bps = 0, sell_fee_bps = 0,
          buy_spread = 0, sell_spread = 0, market_mood = 'surge',
          tick_interval_minutes = 15, next_tick_at = 1000, revision = 1,
          updated_by_teacher_id = 'teacher-stocks', updated_at = 20
      WHERE class_id = 'class-stocks';
    `);

    fundWallet(persistPath, {
      transactionId: "fund-position-limit",
      studentId: "student-limit",
      amount: 1_000_000_000,
      createdAt: 30,
    });
    const boundaryBuy = {
      id: "trade-position-limit-initial-buy",
      idempotencyKey: "stock-position-limit-initial-buy-1",
      studentId: "student-limit",
      side: "buy",
      quantity: 1_000_000,
      spread: 0,
      feeBps: 0,
      inventoryRevisionBefore: 0,
      walletRevisionBefore: 1,
      unitPrice: 1000,
      grossAmount: 1_000_000_000,
      feeAmount: 0,
      walletDelta: -1_000_000_000,
      availableBefore: 1_000_000,
      availableAfter: 0,
      holdingQuantityBefore: 0,
      holdingQuantityAfter: 1_000_000,
      holdingCostBefore: 0,
      holdingCostAfter: 1_000_000_000,
      holdingRevisionBefore: 0,
      createdAt: 40,
    };
    insertPendingTrade(persistPath, boundaryBuy);
    projectAndPostTrade(persistPath, boundaryBuy);

    worker = await (await import("wrangler")).unstable_dev(
      stockPositionLimitWorkerPath,
      {
        config: stockPositionLimitConfigPath,
        moduleRoot: projectRoot,
        persistTo: persistPath,
        logLevel: "none",
        experimental: {
          disableDevRegistry: true,
          disableExperimentalWarning: true,
          watch: false,
        },
      },
    );
    closeWorkerConnectionAfterEachFetch(worker);
    const teacherCookie = `job_classroom_session=${rawTeacherToken}`;
    const studentCookie = `job_classroom_session=${rawStudentToken}`;

    const beforeBlockedIncrease = lastResults(executeSql(
      persistPath,
      `SELECT stock.current_price, stock.previous_price, stock.revision,
              (SELECT COUNT(*) FROM finance_stock_events) AS event_count
       FROM finance_stocks stock WHERE stock.id = 'stock-class';`,
    ));
    const blockedIncreaseResponse = await worker.fetch(
      "http://test.local/update?classId=class-stocks",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: teacherCookie },
        body: JSON.stringify({
          action: "update",
          currentPrice: 1100,
          expectedRevision: 0,
          reason: "Attempt unsafe price increase",
          idempotencyKey: "stock-position-limit-price-blocked-1",
        }),
      },
    );
    assert.equal(blockedIncreaseResponse.status, 400);
    assert.equal(
      (await blockedIncreaseResponse.json()).code,
      "FINANCE_STOCK_POSITION_VALUE_LIMIT",
    );
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT stock.current_price, stock.previous_price, stock.revision,
              (SELECT COUNT(*) FROM finance_stock_events) AS event_count
       FROM finance_stocks stock WHERE stock.id = 'stock-class';`,
    )), beforeBlockedIncrease);

    const halfSale = {
      id: "trade-position-limit-half-sale",
      idempotencyKey: "stock-position-limit-half-sale-1",
      studentId: "student-limit",
      side: "sell",
      quantity: 500_000,
      spread: 0,
      feeBps: 0,
      inventoryRevisionBefore: 1,
      walletRevisionBefore: 2,
      unitPrice: 1000,
      grossAmount: 500_000_000,
      feeAmount: 0,
      walletDelta: 500_000_000,
      availableBefore: 0,
      availableAfter: 500_000,
      holdingQuantityBefore: 1_000_000,
      holdingQuantityAfter: 500_000,
      holdingCostBefore: 1_000_000_000,
      holdingCostAfter: 500_000_000,
      holdingRevisionBefore: 1,
      costBasisRemoved: 500_000_000,
      realizedGain: 0,
      createdAt: 50,
    };
    insertPendingTrade(persistPath, halfSale);
    projectAndPostTrade(persistPath, halfSale);

    const safeIncreaseResponse = await worker.fetch(
      "http://test.local/update?classId=class-stocks",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: teacherCookie },
        body: JSON.stringify({
          action: "update",
          currentPrice: 2000,
          expectedRevision: 0,
          reason: "Move exactly to the safe valuation boundary",
          idempotencyKey: "stock-position-limit-price-safe-1",
        }),
      },
    );
    assert.equal(safeIncreaseResponse.status, 200);
    const safeIncrease = await safeIncreaseResponse.json();
    assert.equal(safeIncrease.stock.currentPrice, 2000);
    assert.equal(safeIncrease.stock.revision, 1);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT stock.current_price, stock.revision, holding.quantity,
              stock.current_price * holding.quantity AS market_value,
              (SELECT COUNT(*) FROM finance_stock_events) AS event_count
       FROM finance_stocks stock
       JOIN finance_stock_holdings holding ON holding.stock_id = stock.id
       WHERE stock.id = 'stock-class' AND holding.student_id = 'student-limit';`,
    )), [{
      current_price: 2000,
      revision: 1,
      quantity: 500_000,
      market_value: 1_000_000_000,
      event_count: 2,
    }]);

    const oneShareSale = {
      id: "trade-position-limit-one-share-sale",
      idempotencyKey: "stock-position-limit-one-share-sale-1",
      studentId: "student-limit",
      side: "sell",
      quantity: 1,
      stockRevision: 1,
      spread: 0,
      feeBps: 0,
      inventoryRevisionBefore: 2,
      walletRevisionBefore: 3,
      unitPrice: 2000,
      referencePrice: 2000,
      grossAmount: 2000,
      feeAmount: 0,
      walletDelta: 2000,
      availableBefore: 500_000,
      availableAfter: 500_001,
      holdingQuantityBefore: 500_000,
      holdingQuantityAfter: 499_999,
      holdingCostBefore: 500_000_000,
      holdingCostAfter: 499_999_000,
      holdingRevisionBefore: 2,
      costBasisRemoved: 1000,
      realizedGain: 1000,
      createdAt: 70,
    };
    insertPendingTrade(persistPath, oneShareSale);
    projectAndPostTrade(persistPath, oneShareSale);

    const allowedBuyInput = {
      action: "trade",
      side: "buy",
      quantity: 1,
      expectedStockRevision: 1,
      expectedMarketRevision: 1,
      expectedFinanceSettingsRevision: 0,
      expectedHoldingRevision: 3,
      expectedWalletRevision: 4,
      idempotencyKey: "stock-position-limit-boundary-buy-1",
    };
    const allowedBuyResponse = await worker.fetch(
      "http://test.local/trade?classId=class-stocks",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: studentCookie },
        body: JSON.stringify(allowedBuyInput),
      },
    );
    assert.equal(allowedBuyResponse.status, 201);
    const allowedBuy = await allowedBuyResponse.json();
    assert.equal(allowedBuy.deduplicated, false);
    assert.equal(allowedBuy.trade.holdingQuantityAfter, 500_000);

    const beforeBlockedBuy = lastResults(executeSql(
      persistPath,
      `SELECT holding.quantity, holding.cost_basis, holding.revision,
              wallet.balance AS wallet_balance, wallet.revision AS wallet_revision,
              stock.current_price, stock.revision AS stock_revision,
              stock.available_shares, stock.inventory_revision, stock.last_trade_id,
              (SELECT COUNT(*) FROM finance_stock_trades) AS trade_count,
              (SELECT COUNT(*) FROM finance_transactions) AS transaction_count,
              (SELECT COUNT(*) FROM finance_ledger_entries) AS entry_count,
              (SELECT COUNT(*) FROM finance_stock_events) AS event_count
       FROM finance_stock_holdings holding
       JOIN finance_accounts wallet ON wallet.id = holding.wallet_account_id
       JOIN finance_stocks stock ON stock.id = holding.stock_id
       WHERE holding.student_id = 'student-limit';`,
    ));
    const blockedBuyResponse = await worker.fetch(
      "http://test.local/trade?classId=class-stocks",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: studentCookie },
        body: JSON.stringify({
          ...allowedBuyInput,
          expectedHoldingRevision: 4,
          expectedWalletRevision: 5,
          idempotencyKey: "stock-position-limit-boundary-buy-blocked-1",
        }),
      },
    );
    assert.equal(blockedBuyResponse.status, 400);
    assert.equal(
      (await blockedBuyResponse.json()).code,
      "FINANCE_STOCK_POSITION_VALUE_LIMIT",
    );
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT holding.quantity, holding.cost_basis, holding.revision,
              wallet.balance AS wallet_balance, wallet.revision AS wallet_revision,
              stock.current_price, stock.revision AS stock_revision,
              stock.available_shares, stock.inventory_revision, stock.last_trade_id,
              (SELECT COUNT(*) FROM finance_stock_trades) AS trade_count,
              (SELECT COUNT(*) FROM finance_transactions) AS transaction_count,
              (SELECT COUNT(*) FROM finance_ledger_entries) AS entry_count,
              (SELECT COUNT(*) FROM finance_stock_events) AS event_count
       FROM finance_stock_holdings holding
       JOIN finance_accounts wallet ON wallet.id = holding.wallet_account_id
       JOIN finance_stocks stock ON stock.id = holding.stock_id
       WHERE holding.student_id = 'student-limit';`,
    )), beforeBlockedBuy);

    const maliciousPendingBuy = insertPendingTrade(persistPath, {
      id: "trade-position-limit-malicious-pending-buy",
      idempotencyKey: "stock-position-limit-malicious-pending-buy-1",
      studentId: "student-limit",
      side: "buy",
      quantity: 1,
      stockRevision: 1,
      marketRevision: 1,
      financeSettingsRevision: 0,
      spread: 0,
      feeBps: 0,
      inventoryRevisionBefore: 4,
      walletRevisionBefore: 5,
      unitPrice: 2000,
      referencePrice: 2000,
      grossAmount: 2000,
      feeAmount: 0,
      walletDelta: -2000,
      availableBefore: 500_000,
      availableAfter: 499_999,
      holdingQuantityBefore: 500_000,
      holdingQuantityAfter: 500_001,
      holdingCostBefore: 500_001_000,
      holdingCostAfter: 500_003_000,
      holdingRevisionBefore: 4,
      createdAt: 80,
    }, { expectSuccess: false });
    assert.match(
      maliciousPendingBuy.output,
      /FINANCE_STOCK_POSITION_VALUE_LIMIT/,
    );
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT holding.quantity, holding.cost_basis, holding.revision,
              wallet.balance AS wallet_balance, wallet.revision AS wallet_revision,
              stock.current_price, stock.revision AS stock_revision,
              stock.available_shares, stock.inventory_revision, stock.last_trade_id,
              (SELECT COUNT(*) FROM finance_stock_trades) AS trade_count,
              (SELECT COUNT(*) FROM finance_transactions) AS transaction_count,
              (SELECT COUNT(*) FROM finance_ledger_entries) AS entry_count,
              (SELECT COUNT(*) FROM finance_stock_events) AS event_count
       FROM finance_stock_holdings holding
       JOIN finance_accounts wallet ON wallet.id = holding.wallet_account_id
       JOIN finance_stocks stock ON stock.id = holding.stock_id
       WHERE holding.student_id = 'student-limit';`,
    )), beforeBlockedBuy);

    executeSql(persistPath, `
      INSERT INTO finance_stock_news (
        id, class_id, title, content, impact_bps, status, revision,
        idempotency_key, payload_hash, created_by_teacher_id,
        updated_by_actor_type, updated_by_teacher_id,
        created_at, expires_at, updated_at
      )
      SELECT 'news-position-limit-first', 'class-stocks',
             'Same millisecond news',
             'This news must be linked even when its timestamp equals the prior tick.',
             500, 'active', 0, 'stock-news:create:position-limit-first',
             'hash:stock-news:create:position-limit-first',
             'teacher-stocks', 'teacher', 'teacher-stocks',
             latest.created_at, latest.created_at + 86400000, latest.created_at
      FROM (
        SELECT MAX(created_at) AS created_at
        FROM finance_stock_events WHERE stock_id = 'stock-class'
      ) latest;
      CREATE TRIGGER test_stock_news_application_failure
      BEFORE INSERT ON finance_stock_news_applications
      WHEN NEW.news_id = 'news-position-limit-first'
      BEGIN SELECT RAISE(ABORT, 'TEST_STOCK_NEWS_APPLICATION_FAILURE'); END;
    `);
    const tickInput = {
      action: "tick",
      expectedStockRevision: 1,
      expectedMarketRevision: 1,
      idempotencyKey: "stock-position-limit-capped-tick-1",
    };
    const failedApplicationResponse = await worker.fetch(
      "http://test.local/tick?classId=class-stocks",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: teacherCookie },
        body: JSON.stringify(tickInput),
      },
    );
    assert.equal(failedApplicationResponse.status, 500);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT stock.revision,
              (SELECT COUNT(*) FROM finance_stock_events
               WHERE idempotency_key = 'stock-position-limit-capped-tick-1')
                AS tick_event_count,
              (SELECT COUNT(*) FROM finance_stock_news_applications
               WHERE news_id = 'news-position-limit-first')
                AS application_count
       FROM finance_stocks stock WHERE stock.id = 'stock-class';`,
    )), [{ revision: 1, tick_event_count: 0, application_count: 0 }]);
    executeSql(persistPath, "DROP TRIGGER test_stock_news_application_failure;");
    const firstTickResponse = await worker.fetch(
      "http://test.local/tick?classId=class-stocks",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: teacherCookie },
        body: JSON.stringify(tickInput),
      },
    );
    assert.equal(firstTickResponse.status, 200);
    const firstTick = await firstTickResponse.json();
    assert.equal(firstTick.deduplicated, false);
    assert.equal(firstTick.skipped, true);
    assert.equal(firstTick.stock.currentPrice, 2000);
    assert.equal(firstTick.stock.revision, 2);

    const afterFirstTick = lastResults(executeSql(
      persistPath,
      `SELECT stock.current_price, stock.revision, market.next_tick_at,
              (SELECT COUNT(*) FROM finance_stock_events) AS event_count,
              (SELECT COUNT(*) FROM finance_stock_events
               WHERE idempotency_key = 'stock-position-limit-capped-tick-1') AS tick_event_count,
              (SELECT MAX(revision) FROM finance_stock_events
               WHERE idempotency_key = 'stock-position-limit-capped-tick-1') AS tick_event_revision
       FROM finance_stocks stock
       JOIN finance_stock_markets market ON market.class_id = stock.class_id
       WHERE stock.id = 'stock-class';`,
    ));
    assert.equal(afterFirstTick[0].current_price, 2000);
    assert.equal(afterFirstTick[0].revision, 2);
    assert.ok(afterFirstTick[0].next_tick_at > 1000);
    assert.equal(afterFirstTick[0].event_count, 3);
    assert.equal(afterFirstTick[0].tick_event_count, 1);
    assert.equal(afterFirstTick[0].tick_event_revision, 2);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT application.news_id, application.link_status,
              application.stock_event_revision,
              event.action AS event_action,
              event.idempotency_key AS event_idempotency_key,
              application.applied_at = event.created_at AS matching_time
       FROM finance_stock_news_applications application
       JOIN finance_stock_events event ON event.id = application.stock_event_id
       WHERE application.stock_id = 'stock-class';`,
    )), [{
      news_id: "news-position-limit-first",
      link_status: "exact",
      stock_event_revision: 2,
      event_action: "news_tick",
      event_idempotency_key: "stock-position-limit-capped-tick-1",
      matching_time: 1,
    }]);

    executeSql(persistPath, `
      INSERT INTO finance_stock_news (
        id, class_id, title, content, impact_bps, status, revision,
        idempotency_key, payload_hash, created_by_teacher_id,
        updated_by_actor_type, updated_by_teacher_id,
        created_at, expires_at, updated_at
      )
      SELECT 'news-position-limit-second', 'class-stocks',
             'News published before a retry',
             'This news belongs to the next tick, not the retried request.',
             -300, 'active', 0, 'stock-news:create:position-limit-second',
             'hash:stock-news:create:position-limit-second',
             'teacher-stocks', 'teacher', 'teacher-stocks',
             event.created_at, event.created_at + 86400000, event.created_at
      FROM finance_stock_events event
      WHERE event.idempotency_key = 'stock-position-limit-capped-tick-1';
      INSERT INTO finance_stock_news (
        id, class_id, title, content, impact_bps, status, revision,
        idempotency_key, payload_hash, created_by_teacher_id,
        updated_by_actor_type, updated_by_teacher_id,
        created_at, expires_at, updated_at
      )
      SELECT 'news-position-limit-third', 'class-stocks',
             'Another pending news item',
             'Multiple news items must share one exact tick atomically.',
             100, 'active', 0, 'stock-news:create:position-limit-third',
             'hash:stock-news:create:position-limit-third',
             'teacher-stocks', 'teacher', 'teacher-stocks',
             event.created_at, event.created_at + 86400000, event.created_at
      FROM finance_stock_events event
      WHERE event.idempotency_key = 'stock-position-limit-capped-tick-1';
    `);

    const retryTickResponse = await worker.fetch(
      "http://test.local/tick?classId=class-stocks",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: teacherCookie },
        body: JSON.stringify(tickInput),
      },
    );
    assert.equal(retryTickResponse.status, 200);
    const retryTick = await retryTickResponse.json();
    assert.equal(retryTick.deduplicated, true);
    assert.equal(retryTick.skipped, true);
    assert.equal(retryTick.stock.currentPrice, firstTick.stock.currentPrice);
    assert.equal(retryTick.stock.revision, firstTick.stock.revision);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT stock.current_price, stock.revision, market.next_tick_at,
              (SELECT COUNT(*) FROM finance_stock_events) AS event_count,
              (SELECT COUNT(*) FROM finance_stock_events
               WHERE idempotency_key = 'stock-position-limit-capped-tick-1') AS tick_event_count,
              (SELECT MAX(revision) FROM finance_stock_events
               WHERE idempotency_key = 'stock-position-limit-capped-tick-1') AS tick_event_revision
       FROM finance_stocks stock
       JOIN finance_stock_markets market ON market.class_id = stock.class_id
       WHERE stock.id = 'stock-class';`,
    )), afterFirstTick);
    assert.equal(lastResults(executeSql(
      persistPath,
      `SELECT COUNT(*) AS count FROM finance_stock_news_applications
       WHERE news_id IN (
         'news-position-limit-second', 'news-position-limit-third'
       );`,
    ))[0].count, 0);

    const secondTickResponse = await worker.fetch(
      "http://test.local/tick?classId=class-stocks",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: teacherCookie },
        body: JSON.stringify({
          action: "tick",
          expectedStockRevision: 2,
          expectedMarketRevision: 1,
          idempotencyKey: "stock-position-limit-capped-tick-2",
        }),
      },
    );
    const secondTick = await secondTickResponse.json();
    assert.equal(secondTickResponse.status, 200, JSON.stringify(secondTick));
    assert.equal(secondTick.deduplicated, false);
    assert.equal(secondTick.stock.revision, 3);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT application.news_id, application.link_status,
              event.idempotency_key AS event_idempotency_key
       FROM finance_stock_news_applications application
       JOIN finance_stock_events event ON event.id = application.stock_event_id
       WHERE application.stock_id = 'stock-class'
       ORDER BY application.news_id;`,
    )), [
      {
        news_id: "news-position-limit-first",
        link_status: "exact",
        event_idempotency_key: "stock-position-limit-capped-tick-1",
      },
      {
        news_id: "news-position-limit-second",
        link_status: "exact",
        event_idempotency_key: "stock-position-limit-capped-tick-2",
      },
      {
        news_id: "news-position-limit-third",
        link_status: "exact",
        event_idempotency_key: "stock-position-limit-capped-tick-2",
      },
    ]);

    const newsReadResponse = await worker.fetch(
      "http://test.local/read?classId=class-stocks",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: teacherCookie },
        body: JSON.stringify({ action: "read" }),
      },
    );
    const newsRead = await newsReadResponse.json();
    assert.equal(newsReadResponse.status, 200, JSON.stringify(newsRead));
    assert.deepEqual(newsRead.news.map((news) => ({
      id: news.id,
      status: news.status,
      applicationLinkStatus: news.applicationLinkStatus,
    })), [
      {
        id: "news-position-limit-third",
        status: "applied",
        applicationLinkStatus: "exact",
      },
      {
        id: "news-position-limit-second",
        status: "applied",
        applicationLinkStatus: "exact",
      },
      {
        id: "news-position-limit-first",
        status: "applied",
        applicationLinkStatus: "exact",
      },
    ]);

    const newsAuditResponse = await worker.fetch(
      "http://test.local/audit?classId=class-stocks&category=stock&query=Same%20millisecond",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: teacherCookie },
        body: JSON.stringify({ action: "audit" }),
      },
    );
    const newsAudit = await newsAuditResponse.json();
    assert.equal(newsAuditResponse.status, 200, JSON.stringify(newsAudit));
    assert.ok(newsAudit.events.some((event) => (
      event.action === "stock_news_applied"
      && event.relatedId === "news-position-limit-first"
    )));

    const applicationUpdate = executeSql(
      persistPath,
      `UPDATE finance_stock_news_applications SET impact_bps = 999
       WHERE news_id = 'news-position-limit-first';`,
      { expectSuccess: false },
    );
    assert.match(applicationUpdate.output, /FINANCE_STOCK_NEWS_APPLICATION_IMMUTABLE/);
    const applicationReplace = executeSql(
      persistPath,
      `INSERT OR REPLACE INTO finance_stock_news_applications (
         id, class_id, stock_id, stock_event_id, stock_event_revision,
         news_id, news_revision, link_status, impact_bps,
         news_payload_hash, applied_at, recorded_at
       )
       SELECT id, class_id, stock_id, stock_event_id, stock_event_revision,
              news_id, news_revision, link_status, 999,
              news_payload_hash, applied_at, recorded_at
       FROM finance_stock_news_applications
       WHERE news_id = 'news-position-limit-first';`,
      { expectSuccess: false },
    );
    assert.match(applicationReplace.output, /FINANCE_STOCK_NEWS_APPLICATION_INVALID/);
    assert.equal(lastResults(executeSql(
      persistPath,
      `SELECT impact_bps FROM finance_stock_news_applications
       WHERE news_id = 'news-position-limit-first';`,
    ))[0].impact_bps, 500);
  } finally {
    await worker?.stop();
    await rm(persistPath, { recursive: true, force: true });
  }
});

test("overlapping automatic stock runs apply one due tick only once", {
  timeout: 120_000,
}, async () => {
  const persistPath = await mkdtemp(
    path.join(tmpdir(), "siklassroom-stock-tick-race-d1-"),
  );
  let worker;
  try {
    runWrangler([
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      `--persist-to=${persistPath}`,
    ]);

    executeSql(persistPath, `
      INSERT INTO teachers (
        id, email, password_hash, status, created_at, updated_at
      ) VALUES (
        'teacher-stock-race', 'teacher-stock-race@test.local', 'hash',
        'active', 1, 1
      );
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized,
        school_year, grade, class_number, status, created_at, updated_at
      ) VALUES (
        'class-stock-race', 'teacher-stock-race', 'Test School', 'test school',
        2099, 6, 9, 'active', 1, 1
      );
      INSERT INTO finance_stocks (
        id, class_id, name, symbol, description,
        initial_price, current_price, previous_price,
        total_shares, available_shares, max_shares_per_student,
        status, revision, inventory_revision, last_trade_id,
        created_by_teacher_id, updated_by_actor_type,
        updated_by_teacher_id, created_at, updated_at
      ) VALUES (
        'stock-race', 'class-stock-race', 'Race Company', 'RACE',
        'Automatic tick overlap probe', 1000, 1000, 1000,
        20, 20, 10, 'active', 0, 0, NULL,
        'teacher-stock-race', 'teacher', 'teacher-stock-race', 10, 10
      );
      INSERT INTO finance_stock_events (
        id, class_id, stock_id, revision, action, reason,
        idempotency_key, payload_hash, previous_snapshot_json,
        stock_snapshot_json, actor_type, actor_teacher_id, created_at
      ) VALUES (
        'stock-race-issued', 'class-stock-race', 'stock-race', 0, 'issued',
        'Initial issue', 'stock:race:issued', 'hash:stock:race:issued',
        NULL, '{"price":1000,"availableShares":20}',
        'teacher', 'teacher-stock-race', 10
      );
      UPDATE finance_stock_markets
      SET is_open = 1, buy_fee_bps = 0, sell_fee_bps = 0,
          buy_spread = 0, sell_spread = 0,
          market_mood = 'surge', tick_interval_minutes = 15,
          next_tick_at = 1000, revision = 1,
          updated_by_teacher_id = 'teacher-stock-race', updated_at = 20
      WHERE class_id = 'class-stock-race';
      INSERT INTO finance_stock_market_events (
        id, class_id, revision, action, idempotency_key, payload_hash,
        previous_snapshot_json, market_snapshot_json,
        actor_teacher_id, created_at
      ) VALUES (
        'market-race-opened', 'class-stock-race', 1, 'opened',
        'stock:race:market:opened', 'hash:stock:race:market:opened',
        '{"isOpen":false,"revision":0}',
        '{"isOpen":true,"mood":"surge","revision":1}',
        'teacher-stock-race', 20
      );
    `);

    worker = await (await import("wrangler")).unstable_dev(
      stockTickRaceWorkerPath,
      {
        config: stockTickRaceConfigPath,
        moduleRoot: projectRoot,
        persistTo: persistPath,
        logLevel: "none",
        experimental: {
          disableDevRegistry: true,
          disableExperimentalWarning: true,
          watch: false,
        },
      },
    );
    closeWorkerConnectionAfterEachFetch(worker);

    const response = await worker.fetch("http://test.local/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ now: 2000, limit: 1 }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.innerRuns, 1);
    assert.equal(result.innerResult.due, 1);
    assert.equal(result.innerResult.failed, 0);
    assert.equal(result.innerResult.ticked + result.innerResult.skipped, 1);
    assert.deepEqual(result.outerResult, {
      due: 1,
      ticked: 0,
      skipped: 0,
      failed: 0,
      deferred: 0,
      retrySchedulingFailed: 0,
      expiredNews: 0,
    });

    const finalState = result.finalState;
    assert.deepEqual(finalState, result.innerState);
    assert.equal(finalState.class_status, "active");
    assert.equal(finalState.previous_price, 1000);
    assert.equal(finalState.revision, 1);
    assert.equal(finalState.next_tick_at, 902000);
    assert.equal(finalState.tick_event_count, 1);
    assert.equal(finalState.maximum_event_revision, 1);
    assert.equal(finalState.retry_count, 0);

    const archiveAfterDueResponse = await worker.fetch("http://test.local/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        now: 903000,
        limit: 1,
        mode: "archive-after-due",
        classId: "class-stock-race",
      }),
    });
    assert.equal(archiveAfterDueResponse.status, 200);
    const archiveAfterDue = await archiveAfterDueResponse.json();
    assert.equal(archiveAfterDue.archiveRuns, 1);
    assert.deepEqual(archiveAfterDue.result, {
      due: 1,
      ticked: 0,
      skipped: 0,
      failed: 0,
      deferred: 0,
      retrySchedulingFailed: 0,
      expiredNews: 0,
    });
    assert.deepEqual(archiveAfterDue.state, {
      ...finalState,
      class_status: "archived",
    });

    const activateResponse = await worker.fetch("http://test.local/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        now: 903500,
        limit: 1,
        mode: "activate",
        classId: "class-stock-race",
      }),
    });
    assert.equal(activateResponse.status, 200);
    assert.deepEqual((await activateResponse.json()).state, finalState);

    const archiveBeforeBatchResponse = await worker.fetch("http://test.local/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        now: 904000,
        limit: 1,
        mode: "archive-before-batch",
        classId: "class-stock-race",
      }),
    });
    assert.equal(archiveBeforeBatchResponse.status, 200);
    const archiveBeforeBatch = await archiveBeforeBatchResponse.json();
    assert.equal(archiveBeforeBatch.archiveRuns, 1);
    assert.deepEqual(archiveBeforeBatch.result, {
      due: 1,
      ticked: 0,
      skipped: 0,
      failed: 0,
      deferred: 0,
      retrySchedulingFailed: 0,
      expiredNews: 0,
    });
    assert.deepEqual(archiveBeforeBatch.state, {
      ...finalState,
      class_status: "archived",
    });

    const guardProbeResponse = await worker.fetch("http://test.local/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        now: 904500,
        limit: 1,
        mode: "probe-archive-guards",
        classId: "class-stock-race",
      }),
    });
    assert.equal(guardProbeResponse.status, 200);
    const guardProbe = await guardProbeResponse.json();
    assert.equal(guardProbe.errors.length, 3);
    assert.match(guardProbe.errors[0], /FINANCE_STOCK_SYSTEM_UPDATE_DENIED/);
    assert.match(guardProbe.errors[1], /FINANCE_STOCK_MARKET_SYSTEM_UPDATE_DENIED/);
    assert.match(guardProbe.errors[2], /FINANCE_STOCK_EVENT_INVALID/);
    assert.deepEqual(guardProbe.state, archiveBeforeBatch.state);
  } finally {
    await worker?.stop();
    await rm(persistPath, { recursive: true, force: true });
  }
});

test("automatic stock tick keys survive an interval change at the same bucket", {
  timeout: 120_000,
}, async () => {
  const persistPath = await mkdtemp(
    path.join(tmpdir(), "siklassroom-stock-tick-interval-key-d1-"),
  );
  let worker;
  try {
    runWrangler([
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      `--persist-to=${persistPath}`,
    ]);

    executeSql(persistPath, `
      INSERT INTO teachers (
        id, email, password_hash, status, created_at, updated_at
      ) VALUES (
        'teacher-stock-interval', 'teacher-stock-interval@test.local', 'hash',
        'active', 1, 1
      );
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized,
        school_year, grade, class_number, status, created_at, updated_at
      ) VALUES (
        'class-stock-interval', 'teacher-stock-interval',
        'Test School', 'test school', 2099, 6, 12, 'active', 1, 1
      );
      INSERT INTO finance_stocks (
        id, class_id, name, symbol, description,
        initial_price, current_price, previous_price,
        total_shares, available_shares, max_shares_per_student,
        status, revision, inventory_revision, last_trade_id,
        created_by_teacher_id, updated_by_actor_type,
        updated_by_teacher_id, created_at, updated_at
      ) VALUES (
        'stock-interval', 'class-stock-interval', 'Interval Company', 'INTV',
        'Automatic interval idempotency probe', 1000, 1000, 1000,
        20, 20, 10, 'active', 0, 0, NULL,
        'teacher-stock-interval', 'teacher', 'teacher-stock-interval', 10, 10
      );
      INSERT INTO finance_stock_events (
        id, class_id, stock_id, revision, action, reason,
        idempotency_key, payload_hash, previous_snapshot_json,
        stock_snapshot_json, actor_type, actor_teacher_id, created_at
      ) VALUES (
        'stock-interval-issued', 'class-stock-interval', 'stock-interval',
        0, 'issued', 'Initial issue', 'stock:interval:issued',
        'hash:stock:interval:issued', NULL,
        '{"price":1000,"availableShares":20}',
        'teacher', 'teacher-stock-interval', 10
      );
      UPDATE finance_stock_markets
      SET is_open = 1, buy_fee_bps = 0, sell_fee_bps = 0,
          buy_spread = 0, sell_spread = 0,
          market_mood = 'surge', tick_interval_minutes = 15,
          next_tick_at = 900000, revision = 1,
          updated_by_teacher_id = 'teacher-stock-interval', updated_at = 20
      WHERE class_id = 'class-stock-interval';
      INSERT INTO finance_stock_market_events (
        id, class_id, revision, action, idempotency_key, payload_hash,
        previous_snapshot_json, market_snapshot_json,
        actor_teacher_id, created_at
      ) VALUES (
        'market-interval-opened', 'class-stock-interval', 1, 'opened',
        'stock:interval:market:opened', 'hash:stock:interval:market:opened',
        '{"isOpen":false,"revision":0}',
        '{"isOpen":true,"tickIntervalMinutes":15,"nextTickAt":900000,"revision":1}',
        'teacher-stock-interval', 20
      );
    `);

    worker = await (await import("wrangler")).unstable_dev(
      stockTickRaceWorkerPath,
      {
        config: stockTickRaceConfigPath,
        moduleRoot: projectRoot,
        persistTo: persistPath,
        logLevel: "none",
        experimental: {
          disableDevRegistry: true,
          disableExperimentalWarning: true,
          watch: false,
        },
      },
    );
    closeWorkerConnectionAfterEachFetch(worker);
    const runPlainTick = async (now) => {
      const response = await worker.fetch("http://test.local/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "plain", now, limit: 1 }),
      });
      assert.equal(response.status, 200);
      return response.json();
    };

    const firstTick = await runPlainTick(900000);
    assert.equal(firstTick.due, 1);
    assert.equal(firstTick.failed, 0);
    assert.equal(firstTick.ticked + firstTick.skipped, 1);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT stock.revision AS stock_revision,
              market.revision AS market_revision,
              market.tick_interval_minutes, market.next_tick_at,
              (SELECT COUNT(*) FROM finance_stock_events event
               WHERE event.stock_id = stock.id
                 AND event.action IN ('automatic_tick', 'news_tick')) AS tick_event_count
       FROM finance_stocks stock
       JOIN finance_stock_markets market ON market.class_id = stock.class_id
       WHERE stock.id = 'stock-interval';`,
    )), [{
      stock_revision: 1,
      market_revision: 1,
      tick_interval_minutes: 15,
      next_tick_at: 1800000,
      tick_event_count: 1,
    }]);

    assert.deepEqual(lastResults(executeSql(persistPath, `
      UPDATE finance_stock_markets
      SET tick_interval_minutes = 30, market_mood = 'bear',
          next_tick_at = 900000, revision = revision + 1,
          updated_by_teacher_id = 'teacher-stock-interval', updated_at = 900001
      WHERE class_id = 'class-stock-interval' AND revision = 1
        AND next_tick_at IS 900000;
      SELECT changes() AS changed_rows;
    `)), [{ changed_rows: 0 }]);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT revision, market_mood, tick_interval_minutes, next_tick_at
       FROM finance_stock_markets WHERE class_id = 'class-stock-interval';`,
    )), [{
      revision: 1,
      market_mood: "surge",
      tick_interval_minutes: 15,
      next_tick_at: 1800000,
    }]);

    assert.deepEqual(lastResults(executeSql(persistPath, `
      UPDATE finance_stock_markets
      SET tick_interval_minutes = 30, revision = 2,
          updated_by_teacher_id = 'teacher-stock-interval', updated_at = 900001
      WHERE class_id = 'class-stock-interval' AND revision = 1
        AND next_tick_at IS 1800000;
      SELECT changes() AS changed_rows;
    `)), [{ changed_rows: 1 }]);
    executeSql(persistPath, `
      INSERT INTO finance_stock_market_events (
        id, class_id, revision, action, idempotency_key, payload_hash,
        previous_snapshot_json, market_snapshot_json,
        actor_teacher_id, created_at
      ) VALUES (
        'market-interval-updated', 'class-stock-interval', 2, 'updated',
        'stock:interval:market:updated', 'hash:stock:interval:market:updated',
        '{"isOpen":true,"tickIntervalMinutes":15,"nextTickAt":1800000,"revision":1}',
        '{"isOpen":true,"tickIntervalMinutes":30,"nextTickAt":1800000,"revision":2}',
        'teacher-stock-interval', 900001
      );
    `);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT revision, tick_interval_minutes, next_tick_at
       FROM finance_stock_markets WHERE class_id = 'class-stock-interval';`,
    )), [{
      revision: 2,
      tick_interval_minutes: 30,
      next_tick_at: 1800000,
    }]);

    const secondTick = await runPlainTick(1800000);
    assert.equal(secondTick.due, 1);
    assert.equal(secondTick.failed, 0);
    assert.equal(secondTick.ticked + secondTick.skipped, 1);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT stock.revision AS stock_revision,
              market.revision AS market_revision,
              market.tick_interval_minutes, market.next_tick_at,
              (SELECT COUNT(*) FROM finance_stock_events event
               WHERE event.stock_id = stock.id
                 AND event.action IN ('automatic_tick', 'news_tick')) AS tick_event_count
       FROM finance_stocks stock
       JOIN finance_stock_markets market ON market.class_id = stock.class_id
       WHERE stock.id = 'stock-interval';`,
    )), [{
      stock_revision: 2,
      market_revision: 2,
      tick_interval_minutes: 30,
      next_tick_at: 3600000,
      tick_event_count: 2,
    }]);
    const tickKeys = lastResults(executeSql(
      persistPath,
      `SELECT revision, idempotency_key
       FROM finance_stock_events
       WHERE stock_id = 'stock-interval'
         AND action IN ('automatic_tick', 'news_tick')
       ORDER BY revision;`,
    ));
    assert.equal(tickKeys.length, 2);
    assert.notEqual(tickKeys[0].idempotency_key, tickKeys[1].idempotency_key);
    assert.equal(
      tickKeys[1].idempotency_key,
      "stock-tick:v2:stock-interval:2:1800000",
    );
  } finally {
    await worker?.stop();
    await rm(persistPath, { recursive: true, force: true });
  }
});

test("failed automatic stock ticks back off without starving healthy classes", {
  timeout: 120_000,
}, async () => {
  const persistPath = await mkdtemp(
    path.join(tmpdir(), "siklassroom-stock-tick-backoff-d1-"),
  );
  const dueNow = 1_000_000;
  const tickIntervalMs = 120 * 60_000;
  const auditSessionToken = "teacher-stock-tick-attempt-audit-token";
  const auditSessionHash = createHash("sha256")
    .update(auditSessionToken)
    .digest("base64url");
  let worker;
  try {
    runWrangler([
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      `--persist-to=${persistPath}`,
    ]);

    executeSql(persistPath, `
      INSERT INTO teachers (
        id, email, password_hash, status, email_verified_at,
        teacher_access_status, teacher_access_verified_at, school_id,
        created_at, updated_at
      ) VALUES (
        'teacher-stock-backoff', 'teacher-stock-backoff@test.local', 'hash',
        'active', 1, 'invite_verified', 1, 'school-stock-backoff', 1, 1
      );
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized,
        school_year, grade, class_number, status, created_at, updated_at
      ) VALUES
        ('class-stock-backoff-a', 'teacher-stock-backoff',
         'Test School', 'test school', 2099, 6, 13, 'active', 1, 1),
        ('class-stock-backoff-b', 'teacher-stock-backoff',
         'Test School', 'test school', 2099, 6, 14, 'active', 1, 1),
        ('class-stock-backoff-c', 'teacher-stock-backoff',
         'Test School', 'test school', 2099, 6, 15, 'active', 1, 1);
      INSERT INTO sessions (
        id, token_hash, actor_type, teacher_id, student_id,
        expires_at, created_at, last_seen_at
      ) VALUES (
        'session-stock-backoff', '${auditSessionHash}', 'teacher',
        'teacher-stock-backoff', NULL, 9999999999999, 1, 1
      );
      INSERT INTO finance_stocks (
        id, class_id, name, symbol, description,
        initial_price, current_price, previous_price,
        total_shares, available_shares, max_shares_per_student,
        status, revision, inventory_revision, last_trade_id,
        created_by_teacher_id, updated_by_actor_type,
        updated_by_teacher_id, created_at, updated_at
      ) VALUES
        ('stock-backoff-a', 'class-stock-backoff-a', 'Backoff A', 'BKA',
         'Oldest failing automatic tick', 1000, 1000, 1000,
         20, 20, 10, 'active', 0, 0, NULL,
         'teacher-stock-backoff', 'teacher', 'teacher-stock-backoff', 10, 10),
        ('stock-backoff-b', 'class-stock-backoff-b', 'Backoff B', 'BKB',
         'Second failing automatic tick', 1000, 1000, 1000,
         20, 20, 10, 'active', 0, 0, NULL,
         'teacher-stock-backoff', 'teacher', 'teacher-stock-backoff', 10, 10),
        ('stock-backoff-c', 'class-stock-backoff-c', 'Backoff C', 'BKC',
         'Healthy automatic tick behind failures', 1000, 1000, 1000,
         20, 20, 10, 'active', 0, 0, NULL,
         'teacher-stock-backoff', 'teacher', 'teacher-stock-backoff', 10, 10);
      INSERT INTO finance_stock_events (
        id, class_id, stock_id, revision, action, reason,
        idempotency_key, payload_hash, previous_snapshot_json,
        stock_snapshot_json, actor_type, actor_teacher_id, created_at
      ) VALUES
        ('stock-backoff-a-issued', 'class-stock-backoff-a', 'stock-backoff-a',
         0, 'issued', 'Initial issue A', 'stock:backoff:a:issued',
         'hash:stock:backoff:a:issued', NULL,
         '{"price":1000,"availableShares":20}',
         'teacher', 'teacher-stock-backoff', 10),
        ('stock-backoff-b-issued', 'class-stock-backoff-b', 'stock-backoff-b',
         0, 'issued', 'Initial issue B', 'stock:backoff:b:issued',
         'hash:stock:backoff:b:issued', NULL,
         '{"price":1000,"availableShares":20}',
         'teacher', 'teacher-stock-backoff', 10),
        ('stock-backoff-c-issued', 'class-stock-backoff-c', 'stock-backoff-c',
         0, 'issued', 'Initial issue C', 'stock:backoff:c:issued',
         'hash:stock:backoff:c:issued', NULL,
         '{"price":1000,"availableShares":20}',
         'teacher', 'teacher-stock-backoff', 10);
      UPDATE finance_stock_markets
      SET is_open = 1, buy_fee_bps = 0, sell_fee_bps = 0,
          buy_spread = 0, sell_spread = 0,
          market_mood = 'surge', tick_interval_minutes = 120,
          next_tick_at = CASE class_id
            WHEN 'class-stock-backoff-a' THEN ${dueNow - 3}
            WHEN 'class-stock-backoff-b' THEN ${dueNow - 2}
            ELSE ${dueNow - 1}
          END,
          revision = 1, updated_by_teacher_id = 'teacher-stock-backoff',
          updated_at = 20
      WHERE class_id IN (
        'class-stock-backoff-a',
        'class-stock-backoff-b',
        'class-stock-backoff-c'
      );
      INSERT INTO finance_stock_market_events (
        id, class_id, revision, action, idempotency_key, payload_hash,
        previous_snapshot_json, market_snapshot_json,
        actor_teacher_id, created_at
      ) VALUES
        ('market-backoff-a-opened', 'class-stock-backoff-a', 1, 'opened',
         'stock:backoff:a:market:opened', 'hash:stock:backoff:a:market:opened',
         '{"isOpen":false,"revision":0}',
         '{"isOpen":true,"tickIntervalMinutes":120,"revision":1}',
         'teacher-stock-backoff', 20),
        ('market-backoff-b-opened', 'class-stock-backoff-b', 1, 'opened',
         'stock:backoff:b:market:opened', 'hash:stock:backoff:b:market:opened',
         '{"isOpen":false,"revision":0}',
         '{"isOpen":true,"tickIntervalMinutes":120,"revision":1}',
         'teacher-stock-backoff', 20),
        ('market-backoff-c-opened', 'class-stock-backoff-c', 1, 'opened',
         'stock:backoff:c:market:opened', 'hash:stock:backoff:c:market:opened',
         '{"isOpen":false,"revision":0}',
         '{"isOpen":true,"tickIntervalMinutes":120,"revision":1}',
         'teacher-stock-backoff', 20);
      CREATE TRIGGER test_stock_tick_failure_ab
      BEFORE INSERT ON finance_stock_events
      WHEN NEW.action IN ('automatic_tick', 'news_tick')
        AND NEW.stock_id IN ('stock-backoff-a', 'stock-backoff-b')
      BEGIN
        SELECT RAISE(ABORT, 'FINANCE_STOCK_TEST_TICK_FAILURE');
      END;
    `);

    executeSql(persistPath, `
      CREATE TRIGGER test_stock_tick_attempt_capture_failure
      BEFORE INSERT ON finance_stock_tick_attempts
      WHEN NEW.stock_id = 'stock-backoff-a'
      BEGIN SELECT RAISE(ABORT, 'TEST_STOCK_TICK_ATTEMPT_FAILURE'); END;
    `);
    const attemptCaptureFailure = executeSql(
      persistPath,
      `INSERT INTO finance_stock_tick_retries (
         id, class_id, stock_id, stock_revision, market_revision,
         scheduled_tick_at, attempt_count, next_attempt_at,
         last_error_code, last_failed_at, created_at, updated_at
       ) VALUES (
         'stock-retry-attempt-capture-failure', 'class-stock-backoff-a',
         'stock-backoff-a', 0, 1, ${dueNow - 3}, 1, ${dueNow + 120_000},
         'FINANCE_STOCK_TEST_TICK_FAILURE', ${dueNow}, ${dueNow}, ${dueNow}
       );`,
      { expectSuccess: false },
    );
    assert.match(attemptCaptureFailure.output, /TEST_STOCK_TICK_ATTEMPT_FAILURE/);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT COUNT(*) AS retry_count,
              (SELECT COUNT(*) FROM finance_stock_tick_attempts) AS attempt_count
       FROM finance_stock_tick_retries;`,
    )), [{ retry_count: 0, attempt_count: 0 }]);
    executeSql(persistPath, "DROP TRIGGER test_stock_tick_attempt_capture_failure;");

    worker = await (await import("wrangler")).unstable_dev(
      stockTickRaceWorkerPath,
      {
        config: stockTickRaceConfigPath,
        moduleRoot: projectRoot,
        persistTo: persistPath,
        logLevel: "none",
        experimental: {
          disableDevRegistry: true,
          disableExperimentalWarning: true,
          watch: false,
        },
      },
    );
    closeWorkerConnectionAfterEachFetch(worker);
    const runPlainTick = async (now, limit = 2) => {
      let response = null;
      let lastError = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          response = await worker.fetch("http://test.local/run", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode: "plain", now, limit }),
          });
          break;
        } catch (error) {
          lastError = error;
          if (attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }
      }
      if (!response) {
        throw new Error(`Stock tick worker failed at ${now}.`, { cause: lastError });
      }
      assert.equal(response.status, 200);
      return response.json();
    };
    const marketState = () => lastResults(executeSql(
      persistPath,
      `SELECT stock.id AS stock_id, stock.revision AS stock_revision,
              market.next_tick_at,
              (SELECT COUNT(*) FROM finance_stock_events event
               WHERE event.stock_id = stock.id
                 AND event.action IN ('automatic_tick', 'news_tick')) AS tick_event_count
       FROM finance_stocks stock
       JOIN finance_stock_markets market ON market.class_id = stock.class_id
       WHERE stock.id IN ('stock-backoff-a', 'stock-backoff-b', 'stock-backoff-c')
       ORDER BY stock.id;`,
    ));

    assert.deepEqual(await runPlainTick(dueNow), {
      due: 2,
      ticked: 0,
      skipped: 0,
      failed: 2,
      deferred: 0,
      retrySchedulingFailed: 0,
      expiredNews: 0,
    });
    assert.deepEqual(marketState(), [
      { stock_id: "stock-backoff-a", stock_revision: 0, next_tick_at: dueNow - 3, tick_event_count: 0 },
      { stock_id: "stock-backoff-b", stock_revision: 0, next_tick_at: dueNow - 2, tick_event_count: 0 },
      { stock_id: "stock-backoff-c", stock_revision: 0, next_tick_at: dueNow - 1, tick_event_count: 0 },
    ]);
    const firstRetries = lastResults(executeSql(
      persistPath,
      `SELECT class_id, stock_id, stock_revision, market_revision,
              scheduled_tick_at, attempt_count, next_attempt_at,
              last_error_code, last_failed_at, created_at, updated_at
       FROM finance_stock_tick_retries ORDER BY stock_id;`,
    ));
    assert.deepEqual(firstRetries, [
      {
        class_id: "class-stock-backoff-a",
        stock_id: "stock-backoff-a",
        stock_revision: 0,
        market_revision: 1,
        scheduled_tick_at: dueNow - 3,
        attempt_count: 1,
        next_attempt_at: dueNow + 120_000,
        last_error_code: "FINANCE_STOCK_TEST_TICK_FAILURE",
        last_failed_at: dueNow,
        created_at: dueNow,
        updated_at: dueNow,
      },
      {
        class_id: "class-stock-backoff-b",
        stock_id: "stock-backoff-b",
        stock_revision: 0,
        market_revision: 1,
        scheduled_tick_at: dueNow - 2,
        attempt_count: 1,
        next_attempt_at: dueNow + 120_000,
        last_error_code: "FINANCE_STOCK_TEST_TICK_FAILURE",
        last_failed_at: dueNow,
        created_at: dueNow,
        updated_at: dueNow,
      },
    ]);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT stock_id, attempt_count, stock_price_snapshot, error_code,
              failed_at, next_attempt_at, capture_status
       FROM finance_stock_tick_attempts
       ORDER BY stock_id, attempt_count;`,
    )), [
      {
        stock_id: "stock-backoff-a",
        attempt_count: 1,
        stock_price_snapshot: 1000,
        error_code: "FINANCE_STOCK_TEST_TICK_FAILURE",
        failed_at: dueNow,
        next_attempt_at: dueNow + 120_000,
        capture_status: "exact",
      },
      {
        stock_id: "stock-backoff-b",
        attempt_count: 1,
        stock_price_snapshot: 1000,
        error_code: "FINANCE_STOCK_TEST_TICK_FAILURE",
        failed_at: dueNow,
        next_attempt_at: dueNow + 120_000,
        capture_status: "exact",
      },
    ]);

    const healthyTickAt = dueNow + 60_000;
    const healthyResult = await runPlainTick(healthyTickAt);
    assert.equal(healthyResult.due, 3);
    assert.equal(healthyResult.failed, 0);
    assert.equal(healthyResult.deferred, 2);
    assert.equal(healthyResult.retrySchedulingFailed, 0);
    assert.equal(healthyResult.ticked + healthyResult.skipped, 1);
    assert.deepEqual(marketState(), [
      { stock_id: "stock-backoff-a", stock_revision: 0, next_tick_at: dueNow - 3, tick_event_count: 0 },
      { stock_id: "stock-backoff-b", stock_revision: 0, next_tick_at: dueNow - 2, tick_event_count: 0 },
      { stock_id: "stock-backoff-c", stock_revision: 1, next_tick_at: healthyTickAt + tickIntervalMs, tick_event_count: 1 },
    ]);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT stock_id, attempt_count, next_attempt_at
       FROM finance_stock_tick_retries ORDER BY stock_id;`,
    )), firstRetries.map(({ stock_id, attempt_count, next_attempt_at }) => ({
      stock_id,
      attempt_count,
      next_attempt_at,
    })));

    assert.deepEqual(await runPlainTick(dueNow + 119_999), {
      due: 2,
      ticked: 0,
      skipped: 0,
      failed: 0,
      deferred: 2,
      retrySchedulingFailed: 0,
      expiredNews: 0,
    });
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT stock_id, attempt_count, next_attempt_at
       FROM finance_stock_tick_retries ORDER BY stock_id;`,
    )), firstRetries.map(({ stock_id, attempt_count, next_attempt_at }) => ({
      stock_id,
      attempt_count,
      next_attempt_at,
    })));

    const secondAttemptAt = dueNow + 120_000;
    assert.deepEqual(await runPlainTick(secondAttemptAt), {
      due: 2,
      ticked: 0,
      skipped: 0,
      failed: 2,
      deferred: 0,
      retrySchedulingFailed: 0,
      expiredNews: 0,
    });
    const secondRetries = lastResults(executeSql(
      persistPath,
      `SELECT stock_id, attempt_count, next_attempt_at,
              last_error_code, last_failed_at, created_at, updated_at
       FROM finance_stock_tick_retries ORDER BY stock_id;`,
    ));
    assert.deepEqual(secondRetries, firstRetries.map((retry) => ({
      stock_id: retry.stock_id,
      attempt_count: 2,
      next_attempt_at: secondAttemptAt + 240_000,
      last_error_code: retry.last_error_code,
      last_failed_at: secondAttemptAt,
      created_at: dueNow,
      updated_at: secondAttemptAt,
    })));
    assert.equal(lastResults(executeSql(
      persistPath,
      `SELECT COUNT(*) AS count FROM finance_stock_tick_attempts
       WHERE attempt_count IN (1, 2) AND capture_status = 'exact';`,
    ))[0].count, 4);

    const fairnessAt = secondAttemptAt + 240_000;
    executeSql(persistPath, `
      UPDATE finance_stock_tick_retries
      SET next_attempt_at = ${fairnessAt - 1}
      WHERE stock_id = 'stock-backoff-a';
      UPDATE finance_stock_tick_retries
      SET next_attempt_at = ${fairnessAt - 1000}
      WHERE stock_id = 'stock-backoff-b';
      UPDATE finance_stock_markets
      SET next_tick_at = ${fairnessAt - 500}, revision = revision + 1,
          updated_by_teacher_id = 'teacher-stock-backoff',
          updated_at = ${fairnessAt - 2}
      WHERE class_id = 'class-stock-backoff-c';
      INSERT INTO finance_stock_market_events (
        id, class_id, revision, action, idempotency_key, payload_hash,
        previous_snapshot_json, market_snapshot_json,
        actor_teacher_id, created_at
      ) VALUES (
        'market-backoff-c-rescheduled', 'class-stock-backoff-c', 2, 'updated',
        'stock:backoff:c:market:rescheduled',
        'hash:stock:backoff:c:market:rescheduled',
        '{"isOpen":true,"revision":1}',
        '{"isOpen":true,"nextTickAt":${fairnessAt - 500},"revision":2}',
        'teacher-stock-backoff', ${fairnessAt - 2}
      );
      DROP TRIGGER test_stock_tick_failure_ab;
      CREATE TRIGGER test_stock_tick_failure_a
      BEFORE INSERT ON finance_stock_events
      WHEN NEW.action IN ('automatic_tick', 'news_tick')
        AND NEW.stock_id = 'stock-backoff-a'
      BEGIN
        SELECT RAISE(ABORT, 'FINANCE_STOCK_TEST_TICK_FAILURE');
      END;
    `);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT stock.id AS stock_id, market.next_tick_at, retry.next_attempt_at
       FROM finance_stocks stock
       JOIN finance_stock_markets market ON market.class_id = stock.class_id
       JOIN finance_stock_tick_retries retry ON retry.stock_id = stock.id
       ORDER BY market.next_tick_at, stock.id;`,
    )), [
      { stock_id: "stock-backoff-a", next_tick_at: dueNow - 3, next_attempt_at: fairnessAt - 1 },
      { stock_id: "stock-backoff-b", next_tick_at: dueNow - 2, next_attempt_at: fairnessAt - 1000 },
    ]);
    const fairnessResult = await runPlainTick(fairnessAt, 1);
    assert.equal(fairnessResult.due, 1);
    assert.equal(fairnessResult.failed, 0);
    assert.equal(fairnessResult.ticked + fairnessResult.skipped, 1);
    assert.deepEqual(marketState(), [
      { stock_id: "stock-backoff-a", stock_revision: 0, next_tick_at: dueNow - 3, tick_event_count: 0 },
      { stock_id: "stock-backoff-b", stock_revision: 1, next_tick_at: fairnessAt + tickIntervalMs, tick_event_count: 1 },
      { stock_id: "stock-backoff-c", stock_revision: 1, next_tick_at: fairnessAt - 500, tick_event_count: 1 },
    ]);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT stock_id, attempt_count, next_attempt_at
       FROM finance_stock_tick_retries;`,
    )), [{
      stock_id: "stock-backoff-a",
      attempt_count: 2,
      next_attempt_at: fairnessAt - 1,
    }]);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT attempt_count, error_code FROM finance_stock_tick_attempts
       WHERE stock_id = 'stock-backoff-b' ORDER BY attempt_count;`,
    )), [
      { attempt_count: 1, error_code: "FINANCE_STOCK_TEST_TICK_FAILURE" },
      { attempt_count: 2, error_code: "FINANCE_STOCK_TEST_TICK_FAILURE" },
    ]);

    const freshResult = await runPlainTick(fairnessAt, 1);
    assert.equal(freshResult.due, 1);
    assert.equal(freshResult.failed, 0);
    assert.equal(freshResult.ticked + freshResult.skipped, 1);
    assert.deepEqual(marketState(), [
      { stock_id: "stock-backoff-a", stock_revision: 0, next_tick_at: dueNow - 3, tick_event_count: 0 },
      { stock_id: "stock-backoff-b", stock_revision: 1, next_tick_at: fairnessAt + tickIntervalMs, tick_event_count: 1 },
      { stock_id: "stock-backoff-c", stock_revision: 2, next_tick_at: fairnessAt + tickIntervalMs, tick_event_count: 2 },
    ]);

    const capAttemptAt = fairnessAt + 1;
    executeSql(persistPath, `
      UPDATE finance_stock_tick_retries
      SET attempt_count = 5, next_attempt_at = ${capAttemptAt},
          last_failed_at = ${fairnessAt}, updated_at = ${fairnessAt}
      WHERE stock_id = 'stock-backoff-a';
    `);
    assert.deepEqual(await runPlainTick(capAttemptAt, 1), {
      due: 1,
      ticked: 0,
      skipped: 0,
      failed: 1,
      deferred: 0,
      retrySchedulingFailed: 0,
      expiredNews: 0,
    });
    const recoveryAt = capAttemptAt + 60 * 60_000;
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT stock_id, attempt_count, next_attempt_at,
              last_error_code, last_failed_at, created_at, updated_at
       FROM finance_stock_tick_retries;`,
    )), [{
      stock_id: "stock-backoff-a",
      attempt_count: 6,
      next_attempt_at: recoveryAt,
      last_error_code: "FINANCE_STOCK_TEST_TICK_FAILURE",
      last_failed_at: capAttemptAt,
      created_at: dueNow,
      updated_at: capAttemptAt,
    }]);

    executeSql(persistPath, "DROP TRIGGER test_stock_tick_failure_a;");
    const recoveryResult = await runPlainTick(recoveryAt, 1);
    assert.equal(recoveryResult.due, 1);
    assert.equal(recoveryResult.failed, 0);
    assert.equal(recoveryResult.ticked + recoveryResult.skipped, 1);
    const finalState = marketState();
    assert.deepEqual(finalState, [
      { stock_id: "stock-backoff-a", stock_revision: 1, next_tick_at: recoveryAt + tickIntervalMs, tick_event_count: 1 },
      { stock_id: "stock-backoff-b", stock_revision: 1, next_tick_at: fairnessAt + tickIntervalMs, tick_event_count: 1 },
      { stock_id: "stock-backoff-c", stock_revision: 2, next_tick_at: fairnessAt + tickIntervalMs, tick_event_count: 2 },
    ]);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      "SELECT COUNT(*) AS count FROM finance_stock_tick_retries;",
    )), [{ count: 0 }]);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT stock_id, GROUP_CONCAT(attempt_count, ',') AS attempts
       FROM (
         SELECT stock_id, attempt_count FROM finance_stock_tick_attempts
         ORDER BY stock_id, attempt_count
       )
       GROUP BY stock_id ORDER BY stock_id;`,
    )), [
      { stock_id: "stock-backoff-a", attempts: "1,2,5,6" },
      { stock_id: "stock-backoff-b", attempts: "1,2" },
    ]);
    const immutableAttempt = executeSql(
      persistPath,
      `DELETE FROM finance_stock_tick_attempts
       WHERE stock_id = 'stock-backoff-a' AND attempt_count = 1;`,
      { expectSuccess: false },
    );
    assert.match(immutableAttempt.output, /FINANCE_STOCK_TICK_ATTEMPT_IMMUTABLE/);
    const forgedAttempt = executeSql(
      persistPath,
      `INSERT OR REPLACE INTO finance_stock_tick_attempts
       SELECT id, class_id, retry_id, stock_id, stock_revision,
              market_revision, scheduled_tick_at, stock_price_snapshot,
              attempt_count, 'FORGED_ERROR', failed_at, next_attempt_at,
              capture_status
       FROM finance_stock_tick_attempts
       WHERE stock_id = 'stock-backoff-a' AND attempt_count = 6;`,
      { expectSuccess: false },
    );
    assert.match(forgedAttempt.output, /FINANCE_STOCK_TICK_ATTEMPT_INVALID/);

    executeSql(persistPath, `
      INSERT INTO finance_stock_tick_retries (
        id, class_id, stock_id, stock_revision, market_revision,
        scheduled_tick_at, attempt_count, next_attempt_at,
        last_error_code, last_failed_at, created_at, updated_at
      ) VALUES (
        'stock-retry-stale-after-success', 'class-stock-backoff-a',
        'stock-backoff-a', 0, 1, ${dueNow - 3}, 1,
        ${recoveryAt + 120_000}, 'FINANCE_STOCK_TICK_AUTOMATION_FAILED',
        ${recoveryAt}, ${recoveryAt}, ${recoveryAt}
      );
    `);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      "SELECT COUNT(*) AS count FROM finance_stock_tick_retries;",
    )), [{ count: 0 }]);
    assert.equal(lastResults(executeSql(
      persistPath,
      "SELECT COUNT(*) AS count FROM finance_stock_tick_attempts;",
    ))[0].count, 6);

    assert.deepEqual(await runPlainTick(recoveryAt, 2), {
      due: 0,
      ticked: 0,
      skipped: 0,
      failed: 0,
      deferred: 0,
      retrySchedulingFailed: 0,
      expiredNews: 0,
    });
    assert.deepEqual(marketState(), finalState);

    await worker.stop();
    worker = await (await import("wrangler")).unstable_dev(
      stockTickAuditWorkerPath,
      {
        config: stockTickAuditConfigPath,
        moduleRoot: projectRoot,
        persistTo: persistPath,
        logLevel: "none",
        experimental: {
          disableDevRegistry: true,
          disableExperimentalWarning: true,
          watch: false,
        },
      },
    );
    closeWorkerConnectionAfterEachFetch(worker);

    let auditResponse;
    try {
      auditResponse = await worker.fetch(
        "http://test.local/audit?classId=class-stock-backoff-a&category=stock&query=FINANCE_STOCK_TEST_TICK_FAILURE",
        { headers: { cookie: `job_classroom_session=${auditSessionToken}` } },
      );
    } catch (error) {
      throw new Error("Stock tick audit worker request failed.", { cause: error });
    }
    const auditBody = await auditResponse.json();
    assert.equal(auditResponse.status, 200, JSON.stringify(auditBody));
    assert.deepEqual(auditBody.events.map((event) => ({
      action: event.action,
      amount: event.amount,
      outcome: event.outcome,
    })), [
      { action: "stock_tick_retry_scheduled", amount: 1000, outcome: "failed" },
      { action: "stock_tick_retry_scheduled", amount: 1000, outcome: "failed" },
      { action: "stock_tick_retry_scheduled", amount: 1000, outcome: "failed" },
      { action: "stock_tick_retry_scheduled", amount: 1000, outcome: "failed" },
    ]);

  } finally {
    await worker?.stop();
    await rm(persistPath, { recursive: true, force: true });
  }
});

test("stock news publication and closure stay in append-only history", async () => {
  const persistPath = await mkdtemp(
    path.join(tmpdir(), "siklassroom-stock-news-history-d1-"),
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
    executeSql(persistPath, `
      INSERT INTO teachers (
        id, email, password_hash, status, created_at, updated_at
      ) VALUES (
        'teacher-stock-news', 'teacher-stock-news@test.local', 'hash',
        'active', 1, 1
      );
      INSERT INTO classes (
        id, teacher_id, school_name, school_normalized,
        school_year, grade, class_number, status, created_at, updated_at
      ) VALUES (
        'class-stock-news', 'teacher-stock-news', 'News School', 'news school',
        2099, 6, 1, 'active', 1, 1
      );
      INSERT INTO finance_stock_news (
        id, class_id, title, content, impact_bps, status, revision,
        idempotency_key, payload_hash, created_by_teacher_id,
        updated_by_actor_type, updated_by_teacher_id,
        cancellation_reason, cancellation_idempotency_key,
        cancellation_payload_hash, created_at, expires_at,
        cancelled_at, updated_at
      ) VALUES
        (
          'news-cancelled', 'class-stock-news', 'Cancelled news',
          'This news is cancelled later.', 250, 'active', 0,
          'stock-news-create:cancelled', 'hash:stock-news:create:cancelled',
          'teacher-stock-news', 'teacher', 'teacher-stock-news',
          NULL, NULL, NULL, 100, 10000, NULL, 100
        ),
        (
          'news-expired', 'class-stock-news', 'Expired news',
          'This news expires automatically.', -150, 'active', 0,
          'stock-news-create:expired', 'hash:stock-news:create:expired',
          'teacher-stock-news', 'teacher', 'teacher-stock-news',
          NULL, NULL, NULL, 300, 400, NULL, 300
        );
      UPDATE finance_stock_news
      SET status = 'cancelled', revision = 1,
          updated_by_actor_type = 'teacher',
          updated_by_teacher_id = 'teacher-stock-news',
          cancellation_reason = 'Incorrect classroom announcement',
          cancellation_idempotency_key = 'stock-news-cancel:cancelled',
          cancellation_payload_hash = 'hash:stock-news:cancel:cancelled',
          cancelled_at = 200, updated_at = 200
      WHERE id = 'news-cancelled';
      UPDATE finance_stock_news
      SET status = 'expired', revision = 1,
          updated_by_actor_type = 'system', updated_by_teacher_id = NULL,
          updated_at = 500
      WHERE id = 'news-expired';
    `);

    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT news_id, revision, action, title, content, impact_bps,
              reason, request_idempotency_key, actor_type,
              actor_teacher_id, expires_at, cancelled_at, created_at
       FROM finance_stock_news_events
       WHERE class_id = 'class-stock-news'
       ORDER BY news_id, revision;`,
    )), [
      {
        news_id: "news-cancelled",
        revision: 0,
        action: "published",
        title: "Cancelled news",
        content: "This news is cancelled later.",
        impact_bps: 250,
        reason: "주식 뉴스를 게시했습니다.",
        request_idempotency_key: "stock-news-create:cancelled",
        actor_type: "teacher",
        actor_teacher_id: "teacher-stock-news",
        expires_at: 10000,
        cancelled_at: null,
        created_at: 100,
      },
      {
        news_id: "news-cancelled",
        revision: 1,
        action: "cancelled",
        title: "Cancelled news",
        content: "This news is cancelled later.",
        impact_bps: 250,
        reason: "Incorrect classroom announcement",
        request_idempotency_key: "stock-news-cancel:cancelled",
        actor_type: "teacher",
        actor_teacher_id: "teacher-stock-news",
        expires_at: 10000,
        cancelled_at: 200,
        created_at: 200,
      },
      {
        news_id: "news-expired",
        revision: 0,
        action: "published",
        title: "Expired news",
        content: "This news expires automatically.",
        impact_bps: -150,
        reason: "주식 뉴스를 게시했습니다.",
        request_idempotency_key: "stock-news-create:expired",
        actor_type: "teacher",
        actor_teacher_id: "teacher-stock-news",
        expires_at: 400,
        cancelled_at: null,
        created_at: 300,
      },
      {
        news_id: "news-expired",
        revision: 1,
        action: "expired",
        title: "Expired news",
        content: "This news expires automatically.",
        impact_bps: -150,
        reason: "설정한 공개 시간이 끝났습니다.",
        request_idempotency_key: null,
        actor_type: "system",
        actor_teacher_id: null,
        expires_at: 400,
        cancelled_at: null,
        created_at: 500,
      },
    ]);

    executeSql(persistPath, `
      CREATE TRIGGER test_stock_news_publish_event_failure
      BEFORE INSERT ON finance_stock_news_events
      WHEN NEW.news_id = 'news-publish-failure'
      BEGIN
        SELECT RAISE(ABORT, 'TEST_STOCK_NEWS_PUBLISH_EVENT_FAILURE');
      END;
    `);
    const publishFailure = executeSql(
      persistPath,
      `INSERT INTO finance_stock_news (
         id, class_id, title, content, impact_bps, status, revision,
         idempotency_key, payload_hash, created_by_teacher_id,
         updated_by_actor_type, updated_by_teacher_id,
         created_at, expires_at, updated_at
       ) VALUES (
         'news-publish-failure', 'class-stock-news', 'Rollback publication',
         'The source row must roll back too.', 100, 'active', 0,
         'stock-news-create:publish-failure',
         'hash:stock-news:create:publish-failure',
         'teacher-stock-news', 'teacher', 'teacher-stock-news',
         600, 1000, 600
       );`,
      { expectSuccess: false },
    );
    assert.match(
      publishFailure.output,
      /TEST_STOCK_NEWS_PUBLISH_EVENT_FAILURE/,
    );
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT
         (SELECT COUNT(*) FROM finance_stock_news
          WHERE id = 'news-publish-failure') AS news_count,
         (SELECT COUNT(*) FROM finance_stock_news_events
          WHERE news_id = 'news-publish-failure') AS event_count;`,
    )), [{ news_count: 0, event_count: 0 }]);
    executeSql(persistPath, "DROP TRIGGER test_stock_news_publish_event_failure;");

    executeSql(persistPath, `
      INSERT INTO finance_stock_news (
        id, class_id, title, content, impact_bps, status, revision,
        idempotency_key, payload_hash, created_by_teacher_id,
        updated_by_actor_type, updated_by_teacher_id,
        created_at, expires_at, updated_at
      ) VALUES (
        'news-transition-failure', 'class-stock-news', 'Rollback transition',
        'A failed terminal event keeps this active.', 75, 'active', 0,
        'stock-news-create:transition-failure',
        'hash:stock-news:create:transition-failure',
        'teacher-stock-news', 'teacher', 'teacher-stock-news',
        700, 1100, 700
      );
      CREATE TRIGGER test_stock_news_transition_event_failure
      BEFORE INSERT ON finance_stock_news_events
      WHEN NEW.news_id = 'news-transition-failure'
        AND NEW.action = 'cancelled'
      BEGIN
        SELECT RAISE(ABORT, 'TEST_STOCK_NEWS_TRANSITION_EVENT_FAILURE');
      END;
    `);
    const transitionFailure = executeSql(
      persistPath,
      `UPDATE finance_stock_news
       SET status = 'cancelled', revision = 1,
           updated_by_actor_type = 'teacher',
           updated_by_teacher_id = 'teacher-stock-news',
           cancellation_reason = 'This transition must roll back',
           cancellation_idempotency_key = 'stock-news-cancel:transition-failure',
           cancellation_payload_hash = 'hash:stock-news:cancel:transition-failure',
           cancelled_at = 800, updated_at = 800
       WHERE id = 'news-transition-failure';`,
      { expectSuccess: false },
    );
    assert.match(
      transitionFailure.output,
      /TEST_STOCK_NEWS_TRANSITION_EVENT_FAILURE/,
    );
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT news.status, news.revision,
              (SELECT COUNT(*) FROM finance_stock_news_events event
               WHERE event.news_id = news.id) AS event_count
       FROM finance_stock_news news
       WHERE news.id = 'news-transition-failure';`,
    )), [{ status: "active", revision: 0, event_count: 1 }]);
    executeSql(persistPath, "DROP TRIGGER test_stock_news_transition_event_failure;");

    const eventUpdate = executeSql(
      persistPath,
      `UPDATE finance_stock_news_events
       SET reason = 'Changed history'
       WHERE news_id = 'news-cancelled' AND revision = 0;`,
      { expectSuccess: false },
    );
    assert.match(eventUpdate.output, /FINANCE_STOCK_NEWS_EVENT_IMMUTABLE/);
    const eventDelete = executeSql(
      persistPath,
      `DELETE FROM finance_stock_news_events
       WHERE news_id = 'news-cancelled' AND revision = 0;`,
      { expectSuccess: false },
    );
    assert.match(eventDelete.output, /FINANCE_STOCK_NEWS_EVENT_IMMUTABLE/);

    const eventReplace = executeSql(
      persistPath,
      `INSERT OR REPLACE INTO finance_stock_news_events (
         id, class_id, news_id, revision, action, title, content, impact_bps,
         reason, request_idempotency_key, request_payload_hash,
         actor_type, actor_teacher_id, expires_at, cancelled_at, created_at
       )
       SELECT 'finance:stock-news-event:replaced', class_id, news_id,
              revision, action, title, content, impact_bps, reason,
              request_idempotency_key, request_payload_hash, actor_type,
              actor_teacher_id, expires_at, cancelled_at, created_at
       FROM finance_stock_news_events
       WHERE news_id = 'news-cancelled' AND revision = 0;`,
      { expectSuccess: false },
    );
    assert.match(eventReplace.output, /FINANCE_STOCK_NEWS_EVENT_INVALID/);
    assert.deepEqual(lastResults(executeSql(
      persistPath,
      `SELECT id FROM finance_stock_news_events
       WHERE news_id = 'news-cancelled' AND revision = 0;`,
    )), [{ id: "finance:stock-news-event:news-cancelled:0" }]);

    const forgedEvent = executeSql(
      persistPath,
      `INSERT INTO finance_stock_news_events (
         id, class_id, news_id, revision, action, title, content, impact_bps,
         reason, request_idempotency_key, request_payload_hash,
         actor_type, actor_teacher_id, expires_at, cancelled_at, created_at
       ) VALUES (
         'finance:stock-news-event:forged', 'class-stock-news',
         'news-cancelled', 2, 'expired', 'Cancelled news',
         'This news is cancelled later.', 250,
         '설정한 공개 시간이 끝났습니다.', NULL, NULL,
         'system', NULL, 10000, NULL, 10001
       );`,
      { expectSuccess: false },
    );
    assert.match(forgedEvent.output, /FINANCE_STOCK_NEWS_EVENT_INVALID/);
  } finally {
    await rm(persistPath, { recursive: true, force: true });
  }
});
