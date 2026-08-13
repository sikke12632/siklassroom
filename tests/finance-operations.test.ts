import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
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

test("금융 자동화는 매분 모든 영역을 독립된 작은 묶음으로 처리한다", async () => {
  const [worker, funding, stocks] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-funding.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-stocks.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(worker, /financeAutomationLane|FINANCE_AUTOMATION_PHASES/);
  assert.match(worker, /settleDueDepositContracts\(db, \{ now, limit: 4 \}\)/);
  assert.match(worker, /\(\) => processPendingFinancePayroll\(\)/);
  assert.match(worker, /processFinanceStockMarketTicks\(db, \{ now, limit: 4, newsLimit: 4 \}\)/);
  assert.match(stocks, /UPDATE finance_stock_news[\s\S]*LIMIT \?/);
  assert.match(stocks, /FINANCE_STOCK_NEWS_PER_TICK_LIMIT = 20/);
  assert.match(stocks, /unappliedNewsForStockTick[\s\S]*ORDER BY news\.created_at, news\.id[\s\S]*LIMIT \?/);
  assert.match(worker, /processDueFundingCampaigns\(db, \{[\s\S]*limit: 2,[\s\S]*refundLimit: 8/);
  assert.match(worker, /controller\.scheduledTime > 0 \? controller\.scheduledTime : Date\.now\(\)/);
  assert.doesNotMatch(worker, /Promise\.allSettled/);
  assert.match(funding, /refundLimit\?: number/);
  assert.match(funding, /refundFundingCampaign\([\s\S]*refundLimit/);
});

test("월급과 펀딩 환불은 Free-plan D1 한도 안에서 나누어 이어 처리한다", async () => {
  const [payroll, payrollPanel, fundingRules, overview] = await Promise.all([
    readFile(new URL("../lib/finance-payroll.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/finance/FinancePayrollPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-funding-rules.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-overview.ts", import.meta.url), "utf8"),
  ]);
  assert.match(payroll, /FINANCE_PAYROLL_POST_BATCH_SIZE = 3/);
  assert.match(payroll, /ORDER BY student_number, student_id[\s\S]*LIMIT \?/);
  assert.match(payroll, /export async function processPendingFinancePayroll/);
  assert.match(payrollPanel, /result\.payroll\.status === "completed"/);
  assert.match(payrollPanel, /const maxAttempts = 40/);
  assert.match(payroll, /postImmediately: false/);
  assert.match(fundingRules, /FINANCE_FUNDING_PROCESS_BATCH_SIZE = 4/);
  assert.match(payroll, /closures\.results\.slice\(index, index \+ 4\)/);
  assert.match(overview, /independent overview groups in two bounded waves/);
});

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

test("교사 비상 예금 정산은 약정 금액·소유권·사유·재확인을 함께 강제한다", async () => {
  const [
    migration,
    runtime,
    service,
    route,
    panel,
    audit,
    auditPanel,
    teacherPortal,
    clientApi,
    css,
  ] = await Promise.all([
    readFile(new URL("../drizzle/0017_teacher_deposit_emergency.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-deposits.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/finance/deposits/contracts/[contractId]/emergency-settle/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/finance/FinanceDepositsPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-audit.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/finance/FinanceAuditPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/teacher/TeacherPortal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/client-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  for (const source of [migration, runtime]) {
    assert.match(source, /DROP TRIGGER IF EXISTS [`]?finance_deposit_settlements_insert_guard/);
    assert.match(source, /transaction_row\.actor_type = 'teacher'/);
    assert.match(source, /classroom\.teacher_id = transaction_row\.actor_teacher_id/);
    assert.match(source, /\$\.interventionReason/);
    assert.match(source, /BETWEEN 2 AND 300/);
    assert.match(source, /contract_terms_at_settlement/);
  }
  assert.match(service, /emergencySettleFinanceDepositForRequest/);
  assert.match(service, /assertTeacher\(context\)/);
  assert.match(service, /expectedClassId: context\.classroom\.id/);
  assert.match(service, /financeDepositSettlementPreview/);
  assert.match(service, /FINANCE_DEPOSIT_SETTLEMENT_PREVIEW_STALE/);
  assert.match(service, /existing\.idempotency_key === input\.idempotencyKey/);
  assert.match(service, /legacySettlementPayloadHash/);
  assert.match(service, /financeDepositSettlementReplayMatches/);
  assert.match(service, /actor_teacher_id,[\s\S]*input\.transaction\.actor\.teacherId/);
  assert.match(route, /private, no-store/);
  assert.match(route, /readJson/);
  assert.match(panel, /교사 비상 정산/);
  assert.match(panel, /정산 후 되돌릴 수 없습니다/);
  assert.match(panel, /expectedSettlementRevision/);
  assert.match(panel, /expectedSettlementType/);
  assert.match(panel, /expectedPayout/);
  assert.match(panel, /confirmed: false/);
  assert.match(panel, /reasonLength < 2/);
  assert.match(panel, /drafts: Record<string, EmergencySettlementDraft>/);
  assert.match(panel, /current\.drafts\[contract\.id\]/);
  assert.match(panel, /className="finance-confirm-check"/);
  assert.match(panel, /focusedActiveCount/);
  assert.match(panel, /finance-deposit-contracts-title/);
  assert.match(panel, /scrollIntoView\(\{ block: "start" \}\)/);
  assert.match(panel, /contract\.student\?\.id !== focusStudentId/);
  assert.match(panel, /#students/);
  assert.match(audit, /예금 교사 비상 정산/);
  assert.match(audit, /'deposit_settlement' THEN 'deposit'/);
  assert.match(audit, /\$\.interventionReason/);
  assert.match(auditPanel, /value: "deposit", label: "예금"/);
  assert.match(teacherPortal, /FINANCE_DEPOSIT_ACTIVE_STUDENT/);
  assert.match(teacherPortal, /depositOrigin=student_exclusion/);
  assert.match(teacherPortal, /student-finance-guidance-row/);
  assert.match(teacherPortal, /#finance-deposit-contracts/);
  assert.match(clientApi, /class ClientApiError/);
  assert.match(clientApi, /data\.code/);
  assert.match(css, /finance-action-notice\.warning/);
  assert.match(css, /student-finance-guidance-row td::before \{ content: none; display: none; \}/);
});

test("교사 주식 비상 청산은 확인한 시세에 묶이고 처리 사유를 감사 기록에 보여 준다", async () => {
  const [migration, runtime, service, panel, audit] = await Promise.all([
    readFile(new URL("../drizzle/0018_stock-emergency-liquidation.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-stocks.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/finance/FinanceStocksPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-audit.ts", import.meta.url), "utf8"),
  ]);

  for (const source of [migration, runtime]) {
    assert.match(source, /finance_stock_trades_teacher_insert_guard/);
    assert.match(source, /classroom\.teacher_id = transaction_row\.actor_teacher_id/);
    assert.match(source, /current_market_terms_at_liquidation/);
    assert.match(source, /financeSettingsRevision/);
    assert.match(source, /BETWEEN 2 AND 300/);
  }
  assert.match(service, /expectedFinanceSettingsRevision/);
  assert.match(service, /FINANCE_STOCK_IDEMPOTENCY_CONFLICT/);
  assert.match(service, /studentStatusSnapshot/);
  assert.match(service, /담임교사 비상 청산/);
  assert.doesNotMatch(service, /담임교사 비상 청산 ·/);
  assert.match(panel, /confirmedSnapshot === snapshot/);
  assert.match(panel, /event\.target\.checked \? snapshot : null/);
  assert.match(panel, /expectedFinanceSettingsRevision: data\.settingsRevision/);
  assert.match(audit, /'deposit_settlement', 'stock_trade'/);
  assert.match(audit, /\$\.interventionReason/);
});

test("매수와 가격 상승은 학생별 평가액 10억 안전선을 함께 지킨다", async () => {
  const [migration, runtime, rules, service] = await Promise.all([
    readFile(new URL("../drizzle/0019_stock-position-value-limit.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-stock-rules.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-stocks.ts", import.meta.url), "utf8"),
  ]);

  for (const source of [migration, runtime]) {
    assert.match(source, /DROP TRIGGER IF EXISTS finance_stocks_management_update_guard/);
    assert.match(source, /DROP TRIGGER IF EXISTS finance_stock_trades_insert_guard/);
    assert.match(source, /holding\.quantity > CAST\(1000000000 \/ NEW\.current_price AS INTEGER\)/);
    assert.match(source, /NEW\.side = 'buy'[\s\S]*NEW\.holding_quantity_after[\s\S]*1000000000 \/ stock\.current_price[\s\S]*RAISE\(ABORT, 'FINANCE_STOCK_POSITION_VALUE_LIMIT'\)/);
    assert.match(source, /FINANCE_STOCK_POSITION_VALUE_LIMIT/);
  }
  assert.match(rules, /BigInt\(quantity\) \* BigInt\(currentPrice\)/);
  assert.match(rules, /limitFinanceStockPriceIncrease/);
  assert.match(service, /maximumHoldingQuantity/);
  assert.match(service, /assertFinanceStockPositionMarketValue/);
  assert.match(service, /limitFinanceStockPriceIncrease/);
  assert.match(service, /const skipped = effectivePrice === Number\(input\.stock\.current_price\)/);
  assert.match(service, /effectivePrice,\s*nextStock\.previous_price,/);
  assert.match(service, /skipped: stockTickEventWasSkipped\(duplicate\)/);
  assert.match(service, /skipped: stockTickEventWasSkipped\(concurrent\)/);
  assert.match(service, /return \{ stock: nextStock, deduplicated: false, skipped \}/);
});

test("unresolved cash requests block roster lifecycle changes without auto-cancellation", async () => {
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  const migrationNames = (await readdir(migrationDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  const [
    migrationSources,
    runtime,
    lifecycle,
    classRoute,
    studentRoute,
    overview,
    operationsPanel,
  ] =
    await Promise.all([
      Promise.all(migrationNames.map((name) => (
        readFile(new URL(name, migrationDirectory), "utf8")
      ))),
      readFile(new URL("../lib/finance-schema.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../lib/finance-deposit-lifecycle.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../app/api/classes/[classId]/route.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../app/api/students/[studentId]/route.ts", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../lib/finance-overview.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../app/finance/FinanceOperations.tsx", import.meta.url),
        "utf8",
      ),
    ]);
  const migrations = migrationSources.join("\n");

  for (const source of [migrations, runtime]) {
    assert.match(source, /finance_cash_requests_classes_archive_guard/);
    assert.match(source, /finance_cash_requests_students_exclude_guard/);
    assert.match(
      source,
      /NEW\.status = 'archived'[\s\S]*finance_cash_requests[\s\S]*finance_request_resolutions[\s\S]*FINANCE_REQUEST_PENDING_CLASS/,
    );
    assert.match(
      source,
      /NEW\.status = 'excluded'[\s\S]*finance_cash_requests[\s\S]*requester_student_id = NEW\.id[\s\S]*finance_request_resolutions[\s\S]*FINANCE_REQUEST_PENDING_STUDENT/,
    );
  }
  assert.match(lifecycle, /pendingCashRequestCount/);
  assert.match(lifecycle, /FINANCE_REQUEST_PENDING_CLASS/);
  assert.match(lifecycle, /FINANCE_REQUEST_PENDING_STUDENT/);
  assert.match(lifecycle, /finance_cash_requests/);
  assert.match(lifecycle, /finance_request_resolutions/);
  assert.match(lifecycle, /NOT EXISTS/);
  assert.doesNotMatch(
    lifecycle,
    /INSERT INTO finance_request_resolutions/,
    "Roster lifecycle checks must not silently cancel student requests.",
  );
  assert.match(classRoute, /assertClassCanBeArchived\(classId\)/);
  assert.match(classRoute, /mapFinanceDepositLifecycleError\(error\)/);
  assert.match(
    classRoute,
    /UPDATE classes[\s\S]*DELETE FROM sessions[\s\S]*database\(\)\.batch\(statements\)/,
  );
  assert.match(
    studentRoute,
    /assertStudentCanBeExcluded\(String\(current\.class_id\), studentId\)/,
  );
  assert.match(studentRoute, /mapFinanceDepositLifecycleError\(error\)/);
  assert.match(studentRoute, /DELETE FROM sessions WHERE student_id = \?/);
  assert.match(studentRoute, /await database\(\)\.batch\(statements\)/);
  assert.doesNotMatch(studentRoute, /revokeActorSessions/);
  assert.match(
    overview,
    /const canApprove = pending[\s\S]*row\.wallet_status === "active"/,
  );
  assert.match(
    overview,
    /const canReject = pending[\s\S]*context\.financeRole === "teacher"/,
  );
  assert.match(overview, /const canDecide = canApprove \|\| canReject/);
  assert.match(
    operationsPanel,
    /const approveBlocked =[\s\S]*request\.canApprove === false/,
  );
  assert.match(
    operationsPanel,
    /const rejectBlocked =[\s\S]*request\.canReject === false/,
  );
  assert.match(
    operationsPanel,
    /disabled=\{approveBlocked \|\| busyId !== null\}[\s\S]*disabled=\{rejectBlocked \|\| busyId !== null\}/,
  );
});

test("new classes and roster entries commit their audit record atomically", async () => {
  const [classesRoute, rosterRoute, d1Test] = await Promise.all([
    readFile(new URL("../app/api/classes/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/classes/[classId]/students/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../tests/finance-operations-d1.test.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(
    classesRoute,
    /database\(\)\.batch\(\[[\s\S]*INSERT INTO classes[\s\S]*INSERT INTO audit_logs[\s\S]*'class_created'/,
  );
  assert.doesNotMatch(classesRoute, /await audit\(/);
  assert.match(
    rosterRoute,
    /INSERT INTO students[\s\S]*INSERT INTO registration_tokens[\s\S]*INSERT INTO audit_logs[\s\S]*'students_bulk_created'[\s\S]*database\(\)\.batch\(statements\)/,
  );
  assert.doesNotMatch(rosterRoute, /await audit\(/);
  assert.match(d1Test, /TEST_CLASS_CREATE_AUDIT_INSERT_FAILURE/);
  assert.match(d1Test, /TEST_ROSTER_CREATE_AUDIT_INSERT_FAILURE/);
  assert.match(d1Test, /registration_tokens/);
  assert.match(d1Test, /finance_accounts/);
});

test("calendar saves reject concurrent revisions and commit audits atomically", async () => {
  const [calendarService, calendarRoute, d1Test] = await Promise.all([
    readFile(new URL("../lib/class-calendar.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/classes/[classId]/calendar/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../tests/finance-operations-d1.test.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(calendarService, /registration_operation_guards/);
  assert.match(calendarService, /class_calendar_save/);
  assert.match(calendarService, /isOperationGuardFailure/);
  assert.match(calendarService, /CALENDAR_STALE/);
  assert.match(
    calendarService,
    /currentRevisionGuard[\s\S]*calendarStatement[\s\S]*INSERT INTO audit_logs[\s\S]*'class_calendar_saved'[\s\S]*DELETE FROM registration_operation_guards/,
  );
  assert.match(calendarRoute, /teacherId,[\s\S]*saveClassCalendar/);
  assert.doesNotMatch(calendarRoute, /await audit\(/);
  assert.match(d1Test, /TEST_CALENDAR_AUDIT_INSERT_FAILURE/);
  assert.match(d1Test, /x-test-calendar-after-read/);
  assert.match(d1Test, /CALENDAR_STALE/);
});

test("job setup drafts and completion stay atomic with their audit records", async () => {
  const [storage, draftRoute, completeRoute, d1Test] = await Promise.all([
    readFile(new URL("../lib/job-storage.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/classes/[classId]/job-setup/draft/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/classes/[classId]/job-setup/complete/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../tests/finance-operations-d1.test.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(storage, /INSERT OR IGNORE INTO class_job_setup/);
  assert.match(storage, /job_setup_draft_save/);
  assert.match(storage, /job_setup_complete/);
  assert.match(storage, /isOperationGuardFailure/);
  assert.match(
    storage,
    /currentRevisionGuard|registration_operation_guards[\s\S]*UPDATE class_job_setup[\s\S]*INSERT INTO audit_logs[\s\S]*job_setup_draft_saved/,
  );
  assert.match(
    storage,
    /UPDATE class_job_setup[\s\S]*UPDATE class_job_assignment_periods[\s\S]*UPDATE class_jobs[\s\S]*job_setup_completed[\s\S]*DELETE FROM registration_operation_guards/,
  );
  assert.match(storage, /status = 'confirmed'/);
  for (const route of [draftRoute, completeRoute]) {
    assert.match(route, /teacherId,/);
    assert.doesNotMatch(route, /await audit\(/);
  }
  assert.match(d1Test, /TEST_JOB_DRAFT_AUDIT_INSERT_FAILURE/);
  assert.match(d1Test, /TEST_JOB_COMPLETE_AUDIT_INSERT_FAILURE/);
  assert.match(d1Test, /JOB_SETUP_STALE/);
});

test("stock news publication and closure remain append-only audit events", async () => {
  const [schema, migration, runtime, service, audit] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../drizzle/0028_stock_news_events.sql", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/finance-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-stocks.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-audit.ts", import.meta.url), "utf8"),
  ]);

  for (const source of [schema, migration, runtime]) {
    assert.match(source, /finance_stock_news_events/);
    assert.match(source, /published/);
    assert.match(source, /cancelled/);
    assert.match(source, /expired/);
  }
  for (const source of [migration, runtime]) {
    assert.match(source, /finance_stock_news_events_insert_guard/);
    assert.match(source, /finance_stock_news_events_update_guard/);
    assert.match(source, /finance_stock_news_events_delete_guard/);
    assert.match(source, /finance_stock_news_capture_publish_event/);
    assert.match(source, /finance_stock_news_capture_transition_event/);
    assert.match(source, /INSERT OR IGNORE INTO `?finance_stock_news_events`?/);
    assert.match(source, /FINANCE_STOCK_NEWS_EVENT_IMMUTABLE/);
    assert.match(
      source,
      /NEW\.`?id`? != 'finance:stock-news-event:'[\s\S]*NEW\.`?news_id`?[\s\S]*NEW\.`?revision`?/,
    );
  }
  assert.match(service, /Number\(update\.meta\.changes \?\? 0\) === 1/);
  assert.match(
    service,
    /UPDATE finance_stock_news[\s\S]*WHERE status = 'active' AND id IN \([\s\S]*return Number\(update\.meta\.changes \?\? 0\)/,
    "Expiration must remain one guarded atomic update and report only rows it changed.",
  );
  assert.match(audit, /FROM finance_stock_news_events news_event/);
  assert.match(audit, /'stock-news-event:' \|\| news_event\.id/);
  assert.match(audit, /news_event\.reason/);
  assert.doesNotMatch(audit, /FROM finance_stock_news news\b/);
});

test("stock ticks link the exact immutable news set instead of inferring by time", async () => {
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  const migrationName = (await readdir(migrationDirectory))
    .find((name) => /^0030_.+\.sql$/u.test(name));
  assert.ok(migrationName, "The stock-news application migration must exist.");
  const [schema, migration, runtime, service, audit, d1Test] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL(migrationName, migrationDirectory), "utf8"),
    readFile(new URL("../lib/finance-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-stocks.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-audit.ts", import.meta.url), "utf8"),
    readFile(new URL("../tests/finance-stocks-d1.test.mjs", import.meta.url), "utf8"),
  ]);

  for (const source of [schema, migration, runtime]) {
    assert.match(source, /finance_stock_news_applications/);
    assert.match(source, /legacy_inferred/);
    assert.match(source, /stock_event_id/);
    assert.match(source, /news_payload_hash/);
  }
  for (const source of [migration, runtime]) {
    assert.match(source, /finance_stock_news_applications_insert_guard/);
    assert.match(source, /finance_stock_news_applications_update_guard/);
    assert.match(source, /finance_stock_news_applications_delete_guard/);
    assert.match(source, /FINANCE_STOCK_NEWS_APPLICATION_IMMUTABLE/);
    assert.match(source, /INSERT OR IGNORE INTO `?finance_stock_news_applications`?/);
    assert.match(source, /finance-stock-news-applications-v1/);
  }
  assert.match(service, /stockTickNewsFingerprint/);
  assert.match(service, /newsAppliedToStockEvent/);
  assert.match(service, /unappliedNewsForStockTick/);
  assert.match(service, /NOT EXISTS \([\s\S]*finance_stock_news_applications application/);
  assert.doesNotMatch(service, /created_at > COALESCE\(\(\s*SELECT MAX\(event\.created_at\)/);
  assert.match(audit, /FROM finance_stock_news_applications application/);
  assert.match(audit, /stock_news_application_legacy_inferred/);
  assert.match(d1Test, /TEST_STOCK_NEWS_APPLICATION_FAILURE/);
  assert.match(d1Test, /applicationLinkStatus/);
  assert.match(d1Test, /INSERT OR REPLACE INTO finance_stock_news_applications/);
});

test("deposit product publication and availability changes are captured by D1", async () => {
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  const migrationName = (await readdir(migrationDirectory))
    .find((name) => /^0031_.+\.sql$/u.test(name));
  assert.ok(migrationName, "The deposit-product lifecycle migration must exist.");
  const [schema, migration, runtime, audit, d1Test, migrationTest] =
    await Promise.all([
      readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
      readFile(new URL(migrationName, migrationDirectory), "utf8"),
      readFile(new URL("../lib/finance-schema.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/finance-audit.ts", import.meta.url), "utf8"),
      readFile(new URL("../tests/finance-deposits-d1.test.mjs", import.meta.url), "utf8"),
      readFile(
        new URL(
          "../tests/finance-deposit-product-lifecycle-migration-d1.test.mjs",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);

  for (const source of [schema, migration, runtime]) {
    assert.match(source, /finance_deposit_product_lifecycle_events/);
    assert.match(source, /legacy_event/);
    assert.match(source, /legacy_current_only/);
    assert.match(source, /product_snapshot_json/);
  }
  for (const source of [migration, runtime]) {
    assert.match(source, /finance_deposit_product_lifecycle_insert_guard/);
    assert.match(source, /finance_deposit_product_lifecycle_update_guard/);
    assert.match(source, /finance_deposit_product_lifecycle_delete_guard/);
    assert.match(source, /finance_deposit_product_capture_issued_lifecycle/);
    assert.match(source, /finance_deposit_product_capture_state_lifecycle/);
    assert.match(source, /FINANCE_DEPOSIT_PRODUCT_LIFECYCLE_IMMUTABLE/);
    assert.match(source, /INSERT OR IGNORE INTO `?finance_deposit_product_lifecycle_events`?/);
    assert.match(source, /FROM `?finance_deposit_product_events`? source_event/);
    assert.match(source, /FROM `?finance_deposit_products`? product/);
  }
  assert.match(audit, /FROM finance_deposit_product_lifecycle_events product_event/);
  assert.match(audit, /product_event\.product_snapshot_json/);
  assert.match(audit, /product_event\.capture_status/);
  assert.doesNotMatch(audit, /FROM finance_deposit_product_events product_event/);
  assert.match(d1Test, /TEST_DEPOSIT_PRODUCT_LIFECYCLE_FAILURE/);
  assert.match(d1Test, /INSERT OR REPLACE INTO finance_deposit_product_lifecycle_events/);
  assert.match(migrationTest, /legacy_current_only/);
  assert.match(migrationTest, /PRAGMA foreign_key_check/);
});

test("deposit maturity failures remain immutable after retry success", async () => {
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  const migrationName = (await readdir(migrationDirectory))
    .find((name) => /^0032_.+\.sql$/u.test(name));
  assert.ok(migrationName, "The maturity-attempt migration must exist.");
  const [schema, migration, runtime, service, audit, d1Test, migrationTest] =
    await Promise.all([
      readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
      readFile(new URL(migrationName, migrationDirectory), "utf8"),
      readFile(new URL("../lib/finance-schema.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/finance-deposits.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/finance-audit.ts", import.meta.url), "utf8"),
      readFile(new URL("../tests/finance-deposits-d1.test.mjs", import.meta.url), "utf8"),
      readFile(
        new URL(
          "../tests/finance-deposit-maturity-attempts-migration-d1.test.mjs",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);

  for (const source of [schema, migration, runtime]) {
    assert.match(source, /finance_deposit_maturity_attempts/);
    assert.match(source, /legacy_latest/);
    assert.match(source, /error_code/);
    assert.match(source, /next_attempt_at/);
  }
  for (const source of [migration, runtime]) {
    assert.match(source, /finance_deposit_maturity_attempts_insert_guard/);
    assert.match(source, /finance_deposit_maturity_attempts_update_guard/);
    assert.match(source, /finance_deposit_maturity_attempts_delete_guard/);
    assert.match(source, /finance_deposit_maturity_capture_first_attempt/);
    assert.match(source, /finance_deposit_maturity_capture_later_attempt/);
    assert.match(source, /FINANCE_DEPOSIT_MATURITY_ATTEMPT_IMMUTABLE/);
    assert.match(source, /INSERT OR IGNORE INTO `?finance_deposit_maturity_attempts`?/);
  }
  assert.match(service, /deferFailedDepositMaturity/);
  assert.match(service, /ON CONFLICT\(contract_id\) DO UPDATE SET/);
  assert.match(audit, /FROM finance_deposit_maturity_attempts attempt/);
  assert.match(audit, /deposit_maturity_retry_scheduled/);
  assert.match(audit, /attempt\.capture_status/);
  assert.match(d1Test, /TEST_DEPOSIT_MATURITY_ATTEMPT_FAILURE/);
  assert.match(d1Test, /FINANCE_DEPOSIT_MATURITY_ATTEMPT_INVALID/);
  assert.match(migrationTest, /legacy_latest/);
  assert.match(migrationTest, /PRAGMA foreign_key_check/);
});

test("stock tick failures remain immutable after automatic recovery", async () => {
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  const migrationName = (await readdir(migrationDirectory))
    .find((name) => /^0033_.+\.sql$/u.test(name));
  assert.ok(migrationName, "The stock-tick attempt migration must exist.");
  const [schema, migration, runtime, service, audit, d1Test, migrationTest] =
    await Promise.all([
      readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
      readFile(new URL(migrationName, migrationDirectory), "utf8"),
      readFile(new URL("../lib/finance-schema.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/finance-stocks.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/finance-audit.ts", import.meta.url), "utf8"),
      readFile(new URL("../tests/finance-stocks-d1.test.mjs", import.meta.url), "utf8"),
      readFile(
        new URL(
          "../tests/finance-stock-tick-attempts-migration-d1.test.mjs",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);

  for (const source of [schema, migration, runtime]) {
    assert.match(source, /finance_stock_tick_attempts/);
    assert.match(source, /legacy_latest/);
    assert.match(source, /stock_price_snapshot/);
    assert.match(source, /scheduled_tick_at/);
  }
  for (const source of [migration, runtime]) {
    assert.match(source, /finance_stock_tick_attempts_insert_guard/);
    assert.match(source, /finance_stock_tick_attempts_update_guard/);
    assert.match(source, /finance_stock_tick_attempts_delete_guard/);
    assert.match(source, /finance_stock_tick_capture_first_attempt/);
    assert.match(source, /finance_stock_tick_capture_later_attempt/);
    assert.match(source, /FINANCE_STOCK_TICK_ATTEMPT_IMMUTABLE/);
    assert.match(source, /INSERT OR IGNORE INTO `?finance_stock_tick_attempts`?/);
  }
  assert.match(service, /deferFailedFinanceStockTick/);
  assert.match(service, /ON CONFLICT\([\s\S]*scheduled_tick_at[\s\S]*\) DO UPDATE SET/);
  assert.match(audit, /FROM finance_stock_tick_attempts attempt/);
  assert.match(audit, /stock_tick_retry_scheduled/);
  assert.match(audit, /attempt\.stock_price_snapshot AS amount/);
  assert.match(d1Test, /TEST_STOCK_TICK_ATTEMPT_FAILURE/);
  assert.match(d1Test, /FINANCE_STOCK_TICK_ATTEMPT_INVALID/);
  assert.match(migrationTest, /legacy_latest/);
  assert.match(migrationTest, /PRAGMA foreign_key_check/);
});

test("teacher liquidation progress and cancellation remain searchable audit events", async () => {
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  const migrationName = (await readdir(migrationDirectory))
    .find((name) => /^0029_.+\.sql$/u.test(name));
  assert.ok(migrationName, "The liquidation event migration must exist.");
  const [schema, migration, runtime, audit, d1Test] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL(migrationName, migrationDirectory), "utf8"),
    readFile(new URL("../lib/finance-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-audit.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../tests/finance-stock-liquidation-chunks-d1.test.mjs", import.meta.url),
      "utf8",
    ),
  ]);

  for (const source of [schema, migration, runtime]) {
    assert.match(source, /finance_stock_liquidation_events/);
    assert.match(source, /started/);
    assert.match(source, /chunk_completed/);
    assert.match(source, /completed/);
    assert.match(source, /cancelled/);
  }
  for (const source of [migration, runtime]) {
    assert.match(source, /finance_stock_liquidation_events_insert_guard/);
    assert.match(source, /finance_stock_liquidation_events_update_guard/);
    assert.match(source, /finance_stock_liquidation_events_delete_guard/);
    assert.match(source, /finance_stock_liquidation_capture_started_event/);
    assert.match(source, /finance_stock_liquidation_capture_progress_events/);
    assert.match(source, /finance_stock_liquidation_capture_cancelled_event/);
    assert.match(source, /INSERT OR IGNORE INTO `?finance_stock_liquidation_events`?/);
    assert.match(source, /FINANCE_STOCK_LIQUIDATION_EVENT_IMMUTABLE/);
    assert.match(
      source,
      /NEW\.`?id`? != 'finance:stock-liquidation-event:'[\s\S]*NEW\.`?action`?/,
    );
  }
  assert.match(audit, /FROM finance_stock_liquidation_events liquidation_event/);
  assert.match(audit, /'stock_liquidation_' \|\| liquidation_event\.action/);
  assert.match(audit, /liquidation_event\.reason/);
  assert.match(audit, /student\.official_name AS student_name/);
  assert.match(d1Test, /TEST_COMPLETED_LIQUIDATION_EVENT_FAILURE/);
  assert.match(d1Test, /TEST_CANCELLED_LIQUIDATION_EVENT_FAILURE/);
  assert.match(d1Test, /INSERT OR REPLACE INTO finance_stock_liquidation_events/);
});
