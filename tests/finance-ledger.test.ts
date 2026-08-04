import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  FINANCE_MAX_ABSOLUTE_AMOUNT,
  FinanceRuleError,
  financeTransactionPayload,
  normalizeFinanceTransaction,
  stableFinanceJson,
} from "../lib/finance-ledger-rules";

function validInput() {
  return {
    classId: "class-a",
    idempotencyKey: "request:finance:0001",
    transactionType: "manual_credit",
    description: "첫 금융 활동 준비금",
    actor: {
      type: "teacher" as const,
      teacherId: "teacher-a",
      label: "담임 선생님",
    },
    sourceType: "teacher_manual",
    sourceId: "manual:0001",
    lines: [
      {
        accountId: "finance:student:student-a:wallet",
        amount: 100,
        memo: "학생 지갑",
      },
      {
        accountId: "finance:class:class-a:issuance",
        amount: -100,
        memo: "학급 발행 계정",
      },
    ],
    metadata: {
      reasonCode: "opening",
      tags: ["first", "teacher"],
    },
  };
}

test("금융 거래는 두 개 이상의 원장 항목과 합계 0을 요구한다", () => {
  const normalized = normalizeFinanceTransaction(validInput());
  assert.equal(normalized.lines.length, 2);
  assert.equal(
    normalized.lines.reduce((total, line) => total + line.amount, 0),
    0,
  );

  assert.throws(
    () => normalizeFinanceTransaction({
      ...validInput(),
      lines: [validInput().lines[0]],
    }),
    (error) => (
      error instanceof FinanceRuleError
      && error.code === "FINANCE_UNBALANCED_TRANSACTION"
    ),
  );
  assert.throws(
    () => normalizeFinanceTransaction({
      ...validInput(),
      lines: [
        validInput().lines[0],
        { ...validInput().lines[1], amount: -90 },
      ],
    }),
    (error) => (
      error instanceof FinanceRuleError
      && error.code === "FINANCE_UNBALANCED_TRANSACTION"
    ),
  );
});

test("금액은 0이 아닌 안전한 범위의 정수만 허용한다", () => {
  for (const amount of [0, 1.5, Number.NaN, FINANCE_MAX_ABSOLUTE_AMOUNT + 1]) {
    assert.throws(
      () => normalizeFinanceTransaction({
        ...validInput(),
        lines: [
          { ...validInput().lines[0], amount },
          { ...validInput().lines[1], amount: -amount },
        ],
      }),
      (error) => (
        error instanceof FinanceRuleError
        && error.code === "FINANCE_INVALID_AMOUNT"
      ),
    );
  }
});

test("한 거래에서 같은 계좌를 두 번 사용하지 못한다", () => {
  assert.throws(
    () => normalizeFinanceTransaction({
      ...validInput(),
      lines: [
        validInput().lines[0],
        {
          accountId: validInput().lines[0].accountId,
          amount: -100,
        },
      ],
    }),
    (error) => (
      error instanceof FinanceRuleError
      && error.code === "FINANCE_DUPLICATE_ACCOUNT"
    ),
  );
});

test("처리자 역할마다 서버에 남길 신원 정보가 분리된다", () => {
  assert.equal(
    normalizeFinanceTransaction(validInput()).actor.type,
    "teacher",
  );
  assert.equal(
    normalizeFinanceTransaction({
      ...validInput(),
      actor: {
        type: "banker",
        studentId: "student-banker",
        bankerPeriodId: "period-july",
        label: "은행원 김학생",
      },
    }).actor.type,
    "banker",
  );
  assert.throws(
    () => normalizeFinanceTransaction({
      ...validInput(),
      actor: {
        type: "banker",
        studentId: "student-banker",
        label: "은행원 김학생",
      },
    }),
    (error) => (
      error instanceof FinanceRuleError
      && error.code === "FINANCE_INVALID_ACTOR"
    ),
  );
});

test("정정 거래는 원거래 ID와 정확히 함께 사용한다", () => {
  assert.equal(
    normalizeFinanceTransaction({
      ...validInput(),
      transactionType: "reversal",
      reversalOfTransactionId: "transaction-original",
    }).reversalOfTransactionId,
    "transaction-original",
  );
  assert.throws(
    () => normalizeFinanceTransaction({
      ...validInput(),
      transactionType: "reversal",
    }),
    (error) => (
      error instanceof FinanceRuleError
      && error.code === "FINANCE_INVALID_REVERSAL"
    ),
  );
});

test("같은 거래 내용은 입력 순서와 메타데이터 키 순서가 달라도 같은 표준값을 만든다", () => {
  const first = normalizeFinanceTransaction(validInput());
  const second = normalizeFinanceTransaction({
    ...validInput(),
    lines: [...validInput().lines].reverse(),
    metadata: {
      tags: ["first", "teacher"],
      reasonCode: "opening",
    },
  });
  assert.equal(financeTransactionPayload(first), financeTransactionPayload(second));
  assert.equal(
    stableFinanceJson({ b: 2, a: 1 }),
    stableFinanceJson({ a: 1, b: 2 }),
  );
});

test("D1 스키마는 이중 원장, 불변 기록, 잔액 투영과 원자적 확정을 강제한다", async () => {
  const [schema, migration, runtime, ledger] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0009_wakeful_sersi.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-ledger.ts", import.meta.url), "utf8"),
  ]);

  for (const source of [schema, migration, runtime]) {
    assert.match(source, /finance_accounts/);
    assert.match(source, /finance_transactions/);
    assert.match(source, /finance_ledger_entries/);
  }
  for (const source of [migration, runtime]) {
    assert.match(source, /FINANCE_TRANSACTION_UNBALANCED/);
    assert.match(source, /FINANCE_INSUFFICIENT_FUNDS/);
    assert.match(source, /FINANCE_LEDGER_IMMUTABLE/);
    assert.match(source, /FINANCE_ACCOUNT_LEDGER_MISMATCH/);
    assert.match(source, /FINANCE_BANKER_ACCESS_DENIED/);
    assert.match(source, /FINANCE_BANKER_WRITES_NOT_ENABLED/);
    assert.match(source, /finance_transactions_apply_posted_balances/);
    assert.doesNotMatch(source, /finance_ledger_entries_apply_balance/);
    assert.match(source, /transaction_row\.status = 'posted'/);
    assert.match(source, /finance_accounts_class_issuance_uq/);
    assert.match(source, /FINANCE_ACCOUNT_STUDENT_CLASS_MISMATCH/);
    assert.match(
      source,
      /student\.status = 'excluded' AND class_row\.status = 'active' THEN 'frozen'/,
    );
    assert.match(source, /SUM\(amount\)/);
    assert.match(source, /INSERT OR IGNORE INTO finance_accounts/);
  }
  assert.match(ledger, /await db\.batch\(statements\)/);
  assert.match(ledger, /payloadHash/);
  assert.match(ledger, /sourceType/);
  assert.match(ledger, /currentStudentJob/);
});

test("조회 API는 일반 학생의 본인 범위와 교사·은행원의 학급 범위를 서버에서 나눈다", async () => {
  const [overview, route] = await Promise.all([
    readFile(new URL("../lib/finance-overview.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/finance/overview/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(overview, /financeContextForRequest\(request\)/);
  assert.match(overview, /context\.financeRole === "teacher"/);
  assert.match(overview, /context\.financeRole === "banker"/);
  assert.match(overview, /studentSummary\(context\.classroom\.id, context\.actor\.id\)/);
  assert.match(overview, /classWallets\(context\.classroom\.id, true\)/);
  assert.match(overview, /classWallets\(context\.classroom\.id, false\)/);
  assert.match(overview, /account\.student_id = \?/);
  assert.match(overview, /account\.class_id = \?/);
  assert.match(route, /private, no-store/);
  assert.match(route, /financeOverviewForRequest\(request\)/);
});

test("교사·학생 감사 기록은 생성 후 수정하거나 삭제할 수 없다", async () => {
  const [migration, runtime] = await Promise.all([
    readFile(
      new URL("../drizzle/0026_audit_logs_append_only.sql", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/database.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [migration, runtime]) {
    assert.match(source, /audit_logs_update_guard/);
    assert.match(source, /audit_logs_delete_guard/);
    assert.match(source, /AUDIT_LOG_IMMUTABLE/);
  }
});
