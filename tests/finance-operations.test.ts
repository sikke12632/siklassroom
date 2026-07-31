import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  FinanceRequestRuleError,
  normalizeFinanceCashRequest,
  normalizeFinanceRequestCancel,
  normalizeFinanceRequestDecision,
  normalizeFinanceReversal,
} from "../lib/finance-request-rules";

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
