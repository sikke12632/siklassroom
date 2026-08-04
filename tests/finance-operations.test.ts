import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  depositAutomationChangedWallet,
  normalizeDepositsResponse,
  requestDepositAutomationRefresh,
} from "../app/finance/FinanceDepositsPanel";
import { normalizeStocksResponse } from "../app/finance/FinanceStocksPanel";
import { calculateFinanceWalletAvailability } from "../lib/finance-available-balance";
import {
  FINANCE_DEPOSIT_SETTLEMENT_BATCH_SIZE,
  financeDepositSettlementEnabled,
} from "../lib/finance-deposit-rules";
import {
  FinanceRequestRuleError,
  normalizeFinanceCashRequest,
  normalizeFinanceRequestCancel,
  normalizeFinanceRequestDecision,
  normalizeFinanceReversal,
} from "../lib/finance-request-rules";

test("사용 가능 금액은 지갑 잔액에서 처리 전 출금 신청액을 정확히 보관한다", async () => {
  assert.deepEqual(calculateFinanceWalletAvailability(1_000, 800), {
    balance: 1_000,
    pendingWithdrawalAmount: 800,
    availableBalance: 200,
  });
  assert.deepEqual(calculateFinanceWalletAvailability(500, 900), {
    balance: 500,
    pendingWithdrawalAmount: 900,
    availableBalance: 0,
  });

  const legacyDeposit = normalizeDepositsResponse({
    wallet: { balance: 1_000, status: "active" },
    products: [],
    contracts: [],
  });
  assert.equal(legacyDeposit.wallet?.availableBalance, 1_000);
  const reservedDeposit = normalizeDepositsResponse({
    wallet: {
      balance: 1_000,
      pending_withdrawal_amount: 800,
      status: "active",
    },
    products: [],
    contracts: [],
  });
  assert.equal(reservedDeposit.wallet?.availableBalance, 200);
  const automatedDeposit = normalizeDepositsResponse({
    wallet: { balance: 1_200, status: "active" },
    products: [],
    contracts: [],
    automation: { settled: 1 },
  });
  assert.equal(depositAutomationChangedWallet(automatedDeposit), true);

  const reservedStock = normalizeStocksResponse({
    wallet: {
      balance: 1_000,
      pendingWithdrawalAmount: 800,
      status: "active",
    },
    market: {},
    holdings: [],
    trades: [],
    news: [],
  });
  assert.equal(reservedStock.wallet?.availableBalance, 200);

  assert.equal(
    financeDepositSettlementEnabled("https://test.local/api/finance/deposits"),
    true,
  );
  assert.equal(
    financeDepositSettlementEnabled(
      "https://test.local/api/finance/deposits?settleMatured=0",
    ),
    false,
  );
  let simultaneousMaturities = 7;
  let settlementRequestCount = 0;
  for (const url of [
    "https://test.local/api/finance/deposits",
    "https://test.local/api/finance/deposits?settleMatured=0",
  ]) {
    if (!financeDepositSettlementEnabled(url)) continue;
    settlementRequestCount += 1;
    simultaneousMaturities -= Math.min(
      simultaneousMaturities,
      FINANCE_DEPOSIT_SETTLEMENT_BATCH_SIZE,
    );
  }
  assert.equal(settlementRequestCount, 1);
  assert.equal(simultaneousMaturities, 4);

  const refreshState = { pending: false, queued: false };
  let releaseFirstRefresh: (() => void) | undefined;
  const firstRefresh = new Promise<void>((resolve) => {
    releaseFirstRefresh = resolve;
  });
  let refreshCount = 0;
  const refresh = async () => {
    refreshCount += 1;
    if (refreshCount === 1) await firstRefresh;
  };
  const firstSignal = requestDepositAutomationRefresh(refreshState, refresh);
  await Promise.resolve();
  const overlappingSignal = requestDepositAutomationRefresh(refreshState, refresh);
  assert.equal(refreshCount, 1);
  releaseFirstRefresh?.();
  await Promise.all([firstSignal, overlappingSignal]);
  assert.equal(refreshCount, 2);
  assert.deepEqual(refreshState, { pending: false, queued: false });
});

test("학생 입출금 신청은 양의 정수 금액과 안정적인 중복 방지 키를 요구한다", () => {
  assert.deepEqual(
    normalizeFinanceCashRequest({
      requestType: "withdrawal",
      amount: 500,
      memo: " 화폐 교환 ",
      idempotencyKey: "request:cash:0001",
    }),
    {
      requestType: "withdrawal",
      amount: 500,
      memo: "화폐 교환",
      idempotencyKey: "request:cash:0001",
    },
  );
  for (const amount of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () => normalizeFinanceCashRequest({
        requestType: "deposit",
        amount,
        idempotencyKey: "request:cash:0002",
      }),
      (error) => (
        error instanceof FinanceRequestRuleError
        && error.code === "FINANCE_INVALID_AMOUNT"
      ),
    );
  }
});

test("거절은 학생에게 보일 이유를, 교사 개입은 별도 도움 사유를 요구한다", () => {
  assert.throws(
    () => normalizeFinanceRequestDecision({
      decision: "reject",
      expectedRevision: 0,
      idempotencyKey: "decision:cash:0001",
    }, { requireTeacherInterventionReason: false }),
    (error) => (
      error instanceof FinanceRequestRuleError
      && error.code === "FINANCE_REJECTION_REASON_REQUIRED"
    ),
  );
  assert.throws(
    () => normalizeFinanceRequestDecision({
      decision: "approve",
      expectedRevision: 0,
      idempotencyKey: "decision:cash:0002",
    }, { requireTeacherInterventionReason: true }),
    (error) => (
      error instanceof FinanceRequestRuleError
      && error.code === "FINANCE_INTERVENTION_REASON_REQUIRED"
    ),
  );
  const teacherDecision = normalizeFinanceRequestDecision({
    decision: "reject",
    expectedRevision: 0,
    idempotencyKey: "decision:cash:0003",
    reasonCode: "amount_check",
    interventionReason: "은행원 학생이 수업으로 자리를 비움",
  }, { requireTeacherInterventionReason: true });
  assert.equal(teacherDecision.reasonCode, "amount_check");
  assert.equal(
    teacherDecision.interventionReason,
    "은행원 학생이 수업으로 자리를 비움",
  );
});

test("취소와 정정은 최신 revision, 이유, 멱등 키를 검증한다", () => {
  assert.equal(
    normalizeFinanceRequestCancel({
      expectedRevision: 0,
      idempotencyKey: "cancel:cash:0001",
    }).expectedRevision,
    0,
  );
  assert.throws(
    () => normalizeFinanceRequestCancel({
      expectedRevision: -1,
      idempotencyKey: "cancel:cash:0002",
    }),
    (error) => (
      error instanceof FinanceRequestRuleError
      && error.code === "FINANCE_INVALID_REVISION"
    ),
  );
  assert.equal(
    normalizeFinanceReversal({
      reason: " 출금 금액을 잘못 확인함 ",
      idempotencyKey: "reverse:cash:0001",
    }).reason,
    "출금 금액을 잘못 확인함",
  );
});

test("금융 운영 API와 스키마는 역할 범위·불변 기록·원자 승인을 함께 둔다", async () => {
  const [
    ledgerMigration,
    migration,
    runtime,
    service,
    overview,
    createRoute,
    decisionRoute,
    reverseRoute,
  ] = await Promise.all([
    readFile(new URL("../drizzle/0009_wakeful_sersi.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0010_perfect_plazm.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-requests.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-overview.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/finance/requests/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../app/api/finance/requests/[requestId]/decision/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/api/finance/transactions/[transactionId]/reverse/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  for (const source of [migration, runtime]) {
    assert.match(source, /finance_cash_requests/);
    assert.match(source, /finance_request_resolutions/);
    assert.match(source, /FINANCE_REQUEST_PENDING_EXISTS/);
    assert.match(source, /FINANCE_REQUEST_SELF_APPROVAL_DENIED/);
    assert.match(source, /FINANCE_REQUEST_IMMUTABLE/);
    assert.match(source, /finance_request_resolutions_apply_approval/);
    assert.match(source, /FINANCE_REQUEST_LEDGER_MISMATCH/);
    assert.match(source, /COALESCE\(NEW\.source_type, ''\) <> 'cash_request'/);
  }
  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS `finance_cash_requests`/,
  );
  assert.match(
    migration,
    /CREATE TRIGGER IF NOT EXISTS `finance_request_resolutions_insert_guard`/,
  );
  assert.match(
    runtime,
    /DROP TRIGGER IF EXISTS finance_transactions_actor_guard[\s\S]*CREATE TRIGGER IF NOT EXISTS finance_transactions_actor_guard/,
  );
  for (const compatibleMigration of [ledgerMigration, migration]) {
    assert.doesNotMatch(
      compatibleMigration,
      /\bEND,/,
      "Wrangler D1 문장 분리기가 CASE END 뒤의 쉼표를 오인하지 않아야 합니다.",
    );
  }
  assert.match(service, /financeContextForRequest\(request\)/);
  assert.match(service, /reverseFinanceTransaction\(/);
  assert.match(service, /FINANCE_REQUEST_PENDING_EXISTS/);
  assert.match(overview, /request_row\.requester_student_id = \?/);
  assert.match(overview, /context\.financeRole === "teacher"/);
  for (const route of [createRoute, decisionRoute, reverseRoute]) {
    assert.match(route, /private, no-store/);
    assert.match(route, /readJson/);
  }
});

test("처리 전 출금액은 모든 지갑 차감에서 예약되고 예금·주식 화면에도 전달된다", async () => {
  const [migration, runtime, ledger, requests, deposits, stocks, depositPanel, stockPanel, portal] = await Promise.all([
    readFile(new URL("../drizzle/0016_reserve_withdrawals.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-ledger.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-requests.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-deposits.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-stocks.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/finance/FinanceDepositsPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/finance/FinanceStocksPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/finance/FinancePortal.tsx", import.meta.url), "utf8"),
  ]);

  for (const source of [migration, runtime]) {
    assert.match(source, /finance_ledger_entries_pending_withdrawal_guard/);
    assert.match(source, /finance_transactions_pending_withdrawal_guard/);
    assert.match(source, /finance_cash_requests_wallet_pending_idx/);
    assert.match(source, /FINANCE_INSUFFICIENT_AVAILABLE_BALANCE/);
    assert.match(source, /entry\.balance_after >= 0/);
  }
  for (const source of [ledger, requests, deposits, stocks]) {
    assert.match(source, /"FINANCE_INSUFFICIENT_AVAILABLE_BALANCE"/);
  }
  for (const source of [deposits, stocks]) {
    assert.match(source, /financeWalletAvailability/);
    assert.match(source, /pendingWithdrawalAmount/);
    assert.match(source, /availableBalance/);
  }
  for (const source of [depositPanel, stockPanel]) {
    assert.match(source, /pendingWithdrawalAmount/);
    assert.match(source, /availableBalance/);
    assert.match(source, /lastExternalRefresh/);
    assert.match(source, /refreshRevision/);
  }
  assert.match(depositPanel, /synchronizeAutomatedSettlement/);
  assert.match(depositPanel, /depositAutomationChangedWallet/);
  assert.match(depositPanel, /requestSequence\.current !== sequence/);
  assert.match(depositPanel, /settleMatured && depositAutomationChangedWallet\(normalized\)/);
  assert.match(depositPanel, /requestDepositAutomationRefresh/);
  assert.match(depositPanel, /loadDeposits\(true, controller\.signal, false\)/);
  assert.match(deposits, /financeDepositSettlementEnabled\(request\.url\)/);
  assert.match(portal, /moduleRefreshRevision/);
  assert.match(portal, /setModuleRefreshRevision\(\(revision\) => revision \+ 1\)/);
  assert.match(portal, /requestSequence\.current !== sequence/);
});
