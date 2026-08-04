import assert from "node:assert/strict";
import test from "node:test";
import {
  FINANCE_DEPOSIT_MAX_TERM_WEEKS,
  FINANCE_DEPOSIT_WEEK_MS,
  FinanceDepositRuleError,
  calculateFinanceDepositQuote,
  financeDepositMaturityAt,
  financeDepositSettlementReplayMatches,
  financeDepositSettlementPreview,
  normalizeFinanceDepositPrincipal,
  normalizeFinanceDepositProduct,
} from "../lib/finance-deposit-rules";

function depositError(code: string) {
  return (error: unknown) => (
    error instanceof FinanceDepositRuleError
    && error.code === code
  );
}

function validProduct() {
  return {
    name: "  꿈을 키우는   4주 예금  ",
    description: "  원금을 맡기고\n만기에 이자를 받아요.  ",
    termWeeks: 4,
    maturityInterestBps: 500,
    earlyInterestShareBps: 2_500,
    minAmount: 100,
    maxAmount: 100_000,
  };
}

test("예금 이자는 단계마다 버림하여 정수 금액으로 계산한다", () => {
  assert.deepEqual(
    calculateFinanceDepositQuote({
      principal: 999,
      maturityInterestBps: 333,
      earlyInterestShareBps: 2_500,
    }),
    {
      principal: 999,
      maturityInterestBps: 333,
      earlyInterestShareBps: 2_500,
      maturityInterest: 33,
      earlyInterest: 8,
      maturityPayout: 1_032,
      earlyPayout: 1_007,
    },
  );
});

test("이자율이 0이면 만기와 중도해지 모두 원금만 지급한다", () => {
  assert.deepEqual(
    calculateFinanceDepositQuote({
      principal: 50_000,
      maturityInterestBps: 0,
      earlyInterestShareBps: 0,
    }),
    {
      principal: 50_000,
      maturityInterestBps: 0,
      earlyInterestShareBps: 0,
      maturityInterest: 0,
      earlyInterest: 0,
      maturityPayout: 50_000,
      earlyPayout: 50_000,
    },
  );
});

test("상품 입력을 공백과 관계없이 같은 값으로 정규화한다", () => {
  assert.deepEqual(
    normalizeFinanceDepositProduct(validProduct()),
    {
      name: "꿈을 키우는 4주 예금",
      description: "원금을 맡기고 만기에 이자를 받아요.",
      termWeeks: 4,
      maturityInterestBps: 500,
      earlyInterestShareBps: 2_500,
      minAmount: 100,
      maxAmount: 100_000,
    },
  );
});

test("가입 금액은 양의 안전한 정수이고 상품 범위 안이어야 한다", () => {
  for (const principal of [0, -1, 1.5, Number.NaN, 1_000_000_001]) {
    assert.throws(
      () => calculateFinanceDepositQuote({
        principal,
        maturityInterestBps: 0,
        earlyInterestShareBps: 0,
      }),
      depositError("FINANCE_DEPOSIT_INVALID_AMOUNT"),
    );
  }

  assert.equal(
    normalizeFinanceDepositPrincipal(100, { minAmount: 100, maxAmount: 500 }),
    100,
  );
  assert.equal(
    normalizeFinanceDepositPrincipal(500, { minAmount: 100, maxAmount: 500 }),
    500,
  );
  assert.throws(
    () => normalizeFinanceDepositPrincipal(99, {
      minAmount: 100,
      maxAmount: 500,
    }),
    depositError("FINANCE_DEPOSIT_AMOUNT_OUT_OF_RANGE"),
  );
  assert.throws(
    () => normalizeFinanceDepositProduct({
      ...validProduct(),
      minAmount: 1_001,
      maxAmount: 1_000,
    }),
    depositError("FINANCE_DEPOSIT_INVALID_AMOUNT_RANGE"),
  );
});

test("기간은 1주부터 52주, 비율은 0%부터 100%까지만 허용한다", () => {
  for (const termWeeks of [0, 1.5, FINANCE_DEPOSIT_MAX_TERM_WEEKS + 1]) {
    assert.throws(
      () => normalizeFinanceDepositProduct({ ...validProduct(), termWeeks }),
      depositError("FINANCE_DEPOSIT_INVALID_TERM"),
    );
  }

  for (const maturityInterestBps of [-1, 1.5, 10_001]) {
    assert.throws(
      () => normalizeFinanceDepositProduct({
        ...validProduct(),
        maturityInterestBps,
      }),
      depositError("FINANCE_DEPOSIT_INVALID_RATE"),
    );
  }

  assert.equal(
    normalizeFinanceDepositProduct({
      ...validProduct(),
      termWeeks: 1,
      maturityInterestBps: 10_000,
      earlyInterestShareBps: 10_000,
      maxAmount: 500_000_000,
    }).termWeeks,
    1,
  );
  assert.equal(
    normalizeFinanceDepositProduct({
      ...validProduct(),
      termWeeks: 52,
    }).termWeeks,
    52,
  );
});

test("만기는 시간대나 일광절약시간과 관계없이 정확한 주 단위 UTC 시각이다", () => {
  const openedAt = Date.UTC(2026, 2, 8, 1, 30, 0, 0);
  assert.equal(
    financeDepositMaturityAt(openedAt, 4),
    openedAt + (4 * FINANCE_DEPOSIT_WEEK_MS),
  );
  assert.equal(
    new Date(financeDepositMaturityAt(openedAt, 4)).toISOString(),
    "2026-04-05T01:30:00.000Z",
  );
  assert.throws(
    () => financeDepositMaturityAt(-1, 4),
    depositError("FINANCE_DEPOSIT_INVALID_TIME"),
  );
});

test("비상 정산은 만기 경계 전후에 계약에 약속된 금액만 선택한다", () => {
  const contract = {
    maturesAt: 5_000,
    principal: 2_000,
    maturityInterest: 200,
    earlyInterest: 100,
    maturityPayout: 2_200,
    earlyPayout: 2_100,
  };
  assert.deepEqual(
    financeDepositSettlementPreview({ ...contract, now: 4_999 }),
    {
      settlementType: "early_termination",
      principal: 2_000,
      interest: 100,
      payout: 2_100,
    },
  );
  assert.deepEqual(
    financeDepositSettlementPreview({ ...contract, now: 5_000 }),
    {
      settlementType: "maturity",
      principal: 2_000,
      interest: 200,
      payout: 2_200,
    },
  );
  assert.throws(
    () => financeDepositSettlementPreview({
      ...contract,
      now: 4_999,
      earlyPayout: 2_101,
    }),
    depositError("FINANCE_DEPOSIT_INVALID_AMOUNT"),
  );
});

test("원금과 이자를 합친 지급액은 원장 한도를 넘을 수 없다", () => {
  assert.equal(
    calculateFinanceDepositQuote({
      principal: 500_000_000,
      maturityInterestBps: 10_000,
      earlyInterestShareBps: 10_000,
    }).maturityPayout,
    1_000_000_000,
  );

  assert.throws(
    () => calculateFinanceDepositQuote({
      principal: 500_000_001,
      maturityInterestBps: 10_000,
      earlyInterestShareBps: 0,
    }),
    depositError("FINANCE_DEPOSIT_PAYOUT_LIMIT"),
  );
  assert.throws(
    () => normalizeFinanceDepositProduct({
      ...validProduct(),
      maturityInterestBps: 10_000,
      maxAmount: 500_000_001,
    }),
    depositError("FINANCE_DEPOSIT_PAYOUT_LIMIT"),
  );
});

test("legacy settlement hashes remain retryable only for system settlements", () => {
  const replay = {
    storedPayloadHash: "legacy-hash",
    currentPayloadHash: "current-hash",
    legacyPayloadHash: "legacy-hash",
  };
  assert.equal(
    financeDepositSettlementReplayMatches({ ...replay, actorType: "system" }),
    true,
  );
  assert.equal(
    financeDepositSettlementReplayMatches({ ...replay, actorType: "teacher" }),
    false,
  );
  assert.equal(
    financeDepositSettlementReplayMatches({
      ...replay,
      actorType: "teacher",
      storedPayloadHash: "current-hash",
    }),
    true,
  );
});
