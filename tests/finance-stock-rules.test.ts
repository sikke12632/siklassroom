import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  FINANCE_STOCK_MAX_FEE_BPS,
  FINANCE_STOCK_MAX_QUANTITY,
  FinanceStockRuleError,
  assertFinanceStockPositionMarketValue,
  calculateFinanceStockExecutionPrice,
  calculateFinanceStockPositionAfterTrade,
  calculateFinanceStockTradeQuote,
  limitFinanceStockPriceIncrease,
  normalizeFinanceStockAdditionalIssuance,
  normalizeFinanceStockDefinition,
  normalizeFinanceStockMarketSettings,
  normalizeFinanceStockTradeRequest,
} from "../lib/finance-stock-rules";

function stockError(code: string) {
  return (error: unknown) => (
    error instanceof FinanceStockRuleError
    && error.code === code
  );
}

function validQuote() {
  return {
    side: "buy" as const,
    unitPrice: 4_100,
    quantity: 3,
    feeBps: 175,
    denominationStep: 100,
  };
}

test("teacher market updates compare the schedule changed by automatic ticks", async () => {
  const source = await readFile(
    new URL("../lib/finance-stocks.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("export async function updateFinanceStockMarket");
  const end = source.indexOf("export async function updateFinanceStock(", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const updateMarketSource = source.slice(start, end);
  assert.match(
    updateMarketSource,
    /WHERE class_id = \? AND revision = \? AND next_tick_at IS \?/,
  );
  assert.match(
    updateMarketSource,
    /context\.classroom\.id,\s*values\.expectedRevision,\s*market\.next_tick_at,\s*\)/,
  );
});

test("매수 수수료는 최소 권종 단위로 내리고 실제 지갑 출금액을 계산한다", () => {
  assert.deepEqual(
    calculateFinanceStockTradeQuote(validQuote()),
    {
      side: "buy",
      unitPrice: 4_100,
      quantity: 3,
      feeBps: 175,
      denominationStep: 100,
      grossAmount: 12_300,
      feeAmount: 200,
      cashAmount: 12_500,
      walletChange: -12_500,
      issuanceChange: 12_500,
    },
  );
});

test("매도는 수수료를 뺀 금액을 지갑에 넣고 반대 원장 금액을 만든다", () => {
  assert.deepEqual(
    calculateFinanceStockTradeQuote({ ...validQuote(), side: "sell" }),
    {
      side: "sell",
      unitPrice: 4_100,
      quantity: 3,
      feeBps: 175,
      denominationStep: 100,
      grossAmount: 12_300,
      feeAmount: 200,
      cashAmount: 12_100,
      walletChange: 12_100,
      issuanceChange: -12_100,
    },
  );
});

test("최소 권종보다 작은 계산 수수료는 0으로 내리고 최대 10%를 허용한다", () => {
  assert.equal(
    calculateFinanceStockTradeQuote({
      side: "buy",
      unitPrice: 1_000,
      quantity: 1,
      feeBps: 100,
      denominationStep: 100,
    }).feeAmount,
    0,
  );
  assert.deepEqual(
    calculateFinanceStockTradeQuote({
      side: "sell",
      unitPrice: 1_000,
      quantity: 10,
      feeBps: FINANCE_STOCK_MAX_FEE_BPS,
      denominationStep: 100,
    }),
    {
      side: "sell",
      unitPrice: 1_000,
      quantity: 10,
      feeBps: 1_000,
      denominationStep: 100,
      grossAmount: 10_000,
      feeAmount: 1_000,
      cashAmount: 9_000,
      walletChange: 9_000,
      issuanceChange: -9_000,
    },
  );
});

test("주가와 수량은 허용 범위의 안전한 정수여야 한다", () => {
  for (const unitPrice of [0, -1, 1.5, Number.NaN, 1_000_000_001]) {
    assert.throws(
      () => calculateFinanceStockTradeQuote({ ...validQuote(), unitPrice }),
      stockError("FINANCE_STOCK_INVALID_PRICE"),
    );
  }
  for (const quantity of [0, -1, 1.5, Number.NaN, FINANCE_STOCK_MAX_QUANTITY + 1]) {
    assert.throws(
      () => calculateFinanceStockTradeQuote({ ...validQuote(), quantity }),
      stockError("FINANCE_STOCK_INVALID_QUANTITY"),
    );
  }
});

test("주가와 계산된 수수료 및 현금 변화는 최소 권종 배수를 유지한다", () => {
  assert.throws(
    () => calculateFinanceStockTradeQuote({
      ...validQuote(),
      unitPrice: 4_150,
    }),
    stockError("FINANCE_STOCK_DENOMINATION_MISMATCH"),
  );
  for (const denominationStep of [0, -100, 1.5, Number.NaN]) {
    assert.throws(
      () => calculateFinanceStockTradeQuote({
        ...validQuote(),
        denominationStep,
      }),
      stockError("FINANCE_STOCK_INVALID_DENOMINATION_STEP"),
    );
  }

  const quote = calculateFinanceStockTradeQuote({
    side: "buy",
    unitPrice: 12_300,
    quantity: 7,
    feeBps: 333,
    denominationStep: 100,
  });
  assert.equal(quote.grossAmount % 100, 0);
  assert.equal(quote.feeAmount % 100, 0);
  assert.equal(quote.cashAmount % 100, 0);
});

test("현재가에 매수·매도 차이를 반영한 실제 단가도 최소 권종 배수여야 한다", () => {
  assert.equal(
    calculateFinanceStockExecutionPrice({
      side: "buy",
      currentPrice: 4_000,
      buySpread: 200,
      sellSpread: 100,
      denominationStep: 100,
    }).unitPrice,
    4_200,
  );
  assert.equal(
    calculateFinanceStockExecutionPrice({
      side: "sell",
      currentPrice: 4_000,
      buySpread: 200,
      sellSpread: 100,
      denominationStep: 100,
    }).unitPrice,
    3_900,
  );
  assert.throws(
    () => calculateFinanceStockExecutionPrice({
      side: "buy",
      currentPrice: 4_000,
      buySpread: 50,
      sellSpread: 100,
      denominationStep: 100,
    }),
    stockError("FINANCE_STOCK_DENOMINATION_MISMATCH"),
  );
  assert.throws(
    () => calculateFinanceStockExecutionPrice({
      side: "sell",
      currentPrice: 100,
      buySpread: 0,
      sellSpread: 100,
      denominationStep: 100,
    }),
    stockError("FINANCE_STOCK_EXECUTION_PRICE_LIMIT"),
  );
});

test("수수료율과 거래 종류가 올바르지 않으면 명확히 거절한다", () => {
  for (const feeBps of [-1, 1.5, FINANCE_STOCK_MAX_FEE_BPS + 1]) {
    assert.throws(
      () => calculateFinanceStockTradeQuote({ ...validQuote(), feeBps }),
      stockError("FINANCE_STOCK_INVALID_FEE_RATE"),
    );
  }
  assert.throws(
    () => calculateFinanceStockTradeQuote({ ...validQuote(), side: "hold" }),
    stockError("FINANCE_STOCK_INVALID_SIDE"),
  );
});

test("총액이나 수수료 포함 매수액이 원장 한도를 넘으면 거래를 막는다", () => {
  assert.throws(
    () => calculateFinanceStockTradeQuote({
      side: "buy",
      unitPrice: 1_000_000_000,
      quantity: 2,
      feeBps: 0,
      denominationStep: 1,
    }),
    stockError("FINANCE_STOCK_TRADE_LIMIT"),
  );
  assert.throws(
    () => calculateFinanceStockTradeQuote({
      side: "buy",
      unitPrice: 1_000_000_000,
      quantity: 1,
      feeBps: 1,
      denominationStep: 1,
    }),
    stockError("FINANCE_STOCK_TRADE_LIMIT"),
  );
});

test("매수 금액과 수수료를 평균 매입원가에 포함한다", () => {
  const result = calculateFinanceStockPositionAfterTrade({
    side: "buy",
    unitPrice: 2_000,
    quantity: 2,
    feeBps: 500,
    denominationStep: 100,
    quantityBefore: 10,
    totalCostBefore: 12_500,
  });
  assert.deepEqual(
    {
      quantityAfter: result.quantityAfter,
      totalCostAfter: result.totalCostAfter,
      costBasisRemoved: result.costBasisRemoved,
      realizedProfit: result.realizedProfit,
    },
    {
      quantityAfter: 12,
      totalCostAfter: 16_700,
      costBasisRemoved: 0,
      realizedProfit: 0,
    },
  );
});

test("일부 매도는 비례 평균원가를 내림하고 잔여 원가를 보존한다", () => {
  const result = calculateFinanceStockPositionAfterTrade({
    side: "sell",
    unitPrice: 2_000,
    quantity: 3,
    feeBps: 500,
    denominationStep: 100,
    quantityBefore: 10,
    totalCostBefore: 12_500,
  });
  assert.deepEqual(
    {
      quantityAfter: result.quantityAfter,
      totalCostAfter: result.totalCostAfter,
      costBasisRemoved: result.costBasisRemoved,
      realizedProfit: result.realizedProfit,
    },
    {
      quantityAfter: 7,
      totalCostAfter: 8_750,
      costBasisRemoved: 3_750,
      realizedProfit: 1_950,
    },
  );

  const rounding = calculateFinanceStockPositionAfterTrade({
    side: "sell",
    unitPrice: 100,
    quantity: 2,
    feeBps: 0,
    denominationStep: 1,
    quantityBefore: 3,
    totalCostBefore: 1_001,
  });
  assert.equal(rounding.costBasisRemoved, 667);
  assert.equal(rounding.totalCostAfter, 334);
});

test("전량 매도는 반올림 잔여 없이 전체 원가를 제거한다", () => {
  const result = calculateFinanceStockPositionAfterTrade({
    side: "sell",
    unitPrice: 2_000,
    quantity: 7,
    feeBps: 500,
    denominationStep: 100,
    quantityBefore: 7,
    totalCostBefore: 8_750,
  });
  assert.equal(result.quantityAfter, 0);
  assert.equal(result.totalCostAfter, 0);
  assert.equal(result.costBasisRemoved, 8_750);
  assert.equal(result.realizedProfit, 4_550);
});

test("보유량을 넘는 매도와 모순된 보유 기록을 거절한다", () => {
  assert.throws(
    () => calculateFinanceStockPositionAfterTrade({
      side: "sell",
      unitPrice: 1_000,
      quantity: 3,
      feeBps: 0,
      denominationStep: 100,
      quantityBefore: 2,
      totalCostBefore: 2_000,
    }),
    stockError("FINANCE_STOCK_INSUFFICIENT_HOLDINGS"),
  );
  for (const position of [
    { quantityBefore: -1, totalCostBefore: 0 },
    { quantityBefore: 0, totalCostBefore: 100 },
    { quantityBefore: 1, totalCostBefore: 0 },
    { quantityBefore: 1.5, totalCostBefore: 100 },
  ]) {
    assert.throws(
      () => calculateFinanceStockPositionAfterTrade({
        ...validQuote(),
        ...position,
      }),
      stockError("FINANCE_STOCK_INVALID_POSITION"),
    );
  }
});

test("거래 후 보유 수량이나 원가가 안전 범위를 넘으면 막는다", () => {
  assert.throws(
    () => calculateFinanceStockPositionAfterTrade({
      side: "buy",
      unitPrice: 100,
      quantity: 1,
      feeBps: 0,
      denominationStep: 100,
      quantityBefore: 1,
      totalCostBefore: 1_000_000_000,
    }),
    stockError("FINANCE_STOCK_POSITION_LIMIT"),
  );
  assert.throws(
    () => calculateFinanceStockPositionAfterTrade({
      side: "buy",
      unitPrice: 100,
      quantity: 1,
      feeBps: 0,
      denominationStep: 100,
      quantityBefore: FINANCE_STOCK_MAX_QUANTITY,
      totalCostBefore: 100,
    }),
    stockError("FINANCE_STOCK_POSITION_LIMIT"),
  );
  assert.throws(
    () => calculateFinanceStockPositionAfterTrade({
      side: "buy",
      unitPrice: 100,
      quantity: 1,
      feeBps: 0,
      denominationStep: 100,
      quantityBefore: 1,
      totalCostBefore: Number.MAX_SAFE_INTEGER,
    }),
    stockError("FINANCE_STOCK_POSITION_LIMIT"),
  );
});

test("종목 입력은 공백과 코드를 정리하고 가격을 권종 단위로 검증한다", () => {
  assert.deepEqual(
    normalizeFinanceStockDefinition({
      symbol: "  bear-1 ",
      name: "  곰돌이   문구  ",
      description: "  학급에서 쓰는   문구를 만들어요. ",
      initialPrice: 1_500,
      totalSupply: 1_000,
      maxSharesPerStudent: 20,
      denominationStep: 100,
    }),
    {
      symbol: "BEAR-1",
      name: "곰돌이 문구",
      description: "학급에서 쓰는 문구를 만들어요.",
      currentPrice: 1_500,
      initialPrice: 1_500,
      totalSupply: 1_000,
      maxSharesPerStudent: 20,
      denominationStep: 100,
    },
  );
  assert.throws(
    () => normalizeFinanceStockDefinition({
      symbol: "곰돌이 주식",
      name: "곰돌이 문구",
      currentPrice: 1_500,
      totalSupply: 100,
      maxSharesPerStudent: 20,
      denominationStep: 100,
    }),
    stockError("FINANCE_STOCK_INVALID_SYMBOL"),
  );
});

test("종목 기호와 회사 소개 없이도 최소 권종에 맞는 낮은 시작가를 쓸 수 있다", () => {
  assert.deepEqual(
    normalizeFinanceStockDefinition({
      name: "작은 회사",
      initialPrice: 1,
      totalSupply: 20,
      maxSharesPerStudent: 5,
      denominationStep: 1,
    }),
    {
      symbol: "CLASS",
      name: "작은 회사",
      description: null,
      currentPrice: 1,
      initialPrice: 1,
      totalSupply: 20,
      maxSharesPerStudent: 5,
      denominationStep: 1,
    },
  );
});

test("추가 발행은 주식·재고 revision과 전체 안전 한도를 함께 검증한다", () => {
  assert.deepEqual(
    normalizeFinanceStockAdditionalIssuance({
      quantity: 25,
      expectedRevision: 3,
      expectedInventoryRevision: 7,
      idempotencyKey: "stock-supply:test:0001",
    }),
    {
      quantity: 25,
      expectedRevision: 3,
      expectedInventoryRevision: 7,
      idempotencyKey: "stock-supply:test:0001",
      reason: "학급 운영을 위해 주식을 추가 발행했습니다.",
    },
  );
  assert.throws(
    () => normalizeFinanceStockAdditionalIssuance({
      quantity: 1_000_000_001,
      expectedRevision: 3,
      expectedInventoryRevision: 7,
      idempotencyKey: "stock-supply:test:0002",
    }),
    stockError("FINANCE_STOCK_INVALID_SUPPLY"),
  );
});

test("교사 화면은 종목 기호를 요구하지 않고 선택 소개와 안전한 추가 발행을 제공한다", async () => {
  const [panel, service, schema, migration, route, audit] = await Promise.all([
    readFile(new URL("../app/finance/FinanceStocksPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-stocks.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0043_stock_additional_issuance.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/finance/stocks/assets/[stockId]/issuance/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance-audit.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(panel, /createDraft\.symbol/);
  assert.match(panel, /내부 종목 기호는 자동으로 만들어집니다/);
  assert.match(panel, /필요하지 않으면 비워 두어도 됩니다/);
  assert.match(panel, /onIssueAdditionalShares/);
  assert.match(panel, /expectedInventoryRevision: data\.stock\.inventoryRevision/);
  assert.match(service, /symbol: "CLASS"/);
  assert.match(service, /export async function issueAdditionalFinanceStock/);
  assert.match(service, /total_shares = total_shares \+ \?/);
  assert.match(service, /available_shares = available_shares \+ \?/);
  assert.match(service, /revision = revision \+ 1/);
  assert.match(service, /inventory_revision = inventory_revision \+ 1/);
  for (const source of [schema, migration]) {
    assert.match(source, /finance_stock_supply_events/);
    assert.match(source, /total_shares_before[\s\S]*available_shares_before/);
    assert.match(source, /FINANCE_STOCK_SUPPLY_EVENT_IMMUTABLE/);
  }
  assert.match(route, /issueAdditionalFinanceStock/);
  assert.match(audit, /stock_supply_increased/);
  assert.match(audit, /주식 추가 발행/);
});

test("시장 설정과 학생 거래 요청은 revision과 중복 방지 키를 정규화한다", () => {
  assert.deepEqual(
    normalizeFinanceStockMarketSettings({
      isOpen: true,
      buyFeeBps: 125,
      sellFeeBps: 250,
      buySpread: 200,
      sellSpread: 100,
      mood: "bull",
      tickIntervalMinutes: 15,
      expectedRevision: 3,
      idempotencyKey: "stock-market:update:0001",
    }),
    {
      isOpen: true,
      buyFeeBps: 125,
      sellFeeBps: 250,
      buySpread: 200,
      sellSpread: 100,
      mood: "bull",
      tickIntervalMinutes: 15,
      expectedRevision: 3,
      idempotencyKey: "stock-market:update:0001",
    },
  );
  assert.deepEqual(
    normalizeFinanceStockTradeRequest({
      side: "sell",
      quantity: 4,
      expectedStockRevision: 5,
      expectedMarketRevision: 2,
      expectedFinanceSettingsRevision: 7,
      expectedHoldingRevision: 3,
      expectedWalletRevision: 11,
      idempotencyKey: "stock-trade:sell:0001",
    }),
    {
      side: "sell",
      quantity: 4,
      expectedStockRevision: 5,
      expectedMarketRevision: 2,
      expectedFinanceSettingsRevision: 7,
      expectedHoldingRevision: 3,
      expectedWalletRevision: 11,
      idempotencyKey: "stock-trade:sell:0001",
    },
  );

  for (const expectedRevision of [-1, 1.5, "2"]) {
    assert.throws(
      () => normalizeFinanceStockMarketSettings({
        isOpen: true,
        buyFeeBps: 0,
        sellFeeBps: 0,
        buySpread: 0,
        sellSpread: 0,
        mood: "mixed",
        tickIntervalMinutes: 15,
        expectedRevision,
        idempotencyKey: "stock-market:update:0002",
      }),
      stockError("FINANCE_STOCK_INVALID_REVISION"),
    );
  }
  assert.throws(
    () => normalizeFinanceStockTradeRequest({
      side: "buy",
      quantity: 1,
      expectedStockRevision: 0,
      expectedMarketRevision: 0,
      expectedFinanceSettingsRevision: 0,
      expectedHoldingRevision: 0,
      expectedWalletRevision: 0,
      idempotencyKey: "short",
    }),
    stockError("FINANCE_STOCK_INVALID_IDEMPOTENCY_KEY"),
  );
});

test("시장 분위기·갱신 간격·매수/매도 수수료와 스프레드를 각각 검증한다", () => {
  for (const mood of ["normal", "BULL", "", null]) {
    assert.throws(
      () => normalizeFinanceStockMarketSettings({
        isOpen: true,
        buyFeeBps: 0,
        sellFeeBps: 0,
        buySpread: 0,
        sellSpread: 0,
        mood,
        tickIntervalMinutes: 15,
        expectedRevision: 0,
        idempotencyKey: "stock-market:mood:0001",
      }),
      stockError("FINANCE_STOCK_INVALID_MOOD"),
    );
  }
  for (const tickIntervalMinutes of [0, 1.5, 1_441]) {
    assert.throws(
      () => normalizeFinanceStockMarketSettings({
        isOpen: true,
        buyFeeBps: 0,
        sellFeeBps: 0,
        buySpread: 0,
        sellSpread: 0,
        mood: "mixed",
        tickIntervalMinutes,
        expectedRevision: 0,
        idempotencyKey: "stock-market:tick:0001",
      }),
      stockError("FINANCE_STOCK_INVALID_TICK_INTERVAL"),
    );
  }
  for (const buySpread of [-1, 1.5, 1_000_000_001]) {
    assert.throws(
      () => normalizeFinanceStockMarketSettings({
        isOpen: true,
        buyFeeBps: 0,
        sellFeeBps: 0,
        buySpread,
        sellSpread: 0,
        mood: "mixed",
        tickIntervalMinutes: 15,
        expectedRevision: 0,
        idempotencyKey: "stock-market:spread:0001",
      }),
      stockError("FINANCE_STOCK_INVALID_SPREAD"),
    );
  }
});

test("종목별 학생 보유 한도는 전체 발행량을 넘지 않는다", () => {
  assert.throws(
    () => normalizeFinanceStockDefinition({
      symbol: "BEAR",
      name: "곰돌이 문구",
      initialPrice: 1_000,
      totalSupply: 10,
      maxSharesPerStudent: 11,
      denominationStep: 100,
    }),
    stockError("FINANCE_STOCK_INVALID_MAX_SHARES"),
  );

  const aliases = normalizeFinanceStockDefinition({
    symbol: "CLASS",
    name: "학급 회사",
    currentPrice: 2_000,
    totalSupply: 100,
    perStudentLimit: 10,
    denominationStep: 100,
  });
  assert.equal(aliases.initialPrice, 2_000);
  assert.equal(aliases.maxSharesPerStudent, 10);
});

test("학생별 평가액은 10억 경계까지 허용하고 그 이상은 막는다", () => {
  assert.equal(
    assertFinanceStockPositionMarketValue({
      quantity: 1_000_000,
      currentPrice: 1_000,
    }),
    1_000_000_000,
  );
  assert.throws(
    () => assertFinanceStockPositionMarketValue({
      quantity: 1_000_000,
      currentPrice: 1_001,
    }),
    stockError("FINANCE_STOCK_POSITION_VALUE_LIMIT"),
  );
});

test("자동 시세는 안전 상한에서 멈추고 기존 초과 상태의 가격 인하는 허용한다", () => {
  assert.equal(limitFinanceStockPriceIncrease({
    currentPrice: 1_000,
    candidatePrice: 1_200,
    maximumHoldingQuantity: 1_000_000,
    denominationStep: 100,
  }), 1_000);
  assert.equal(limitFinanceStockPriceIncrease({
    currentPrice: 1_000,
    candidatePrice: 1_200,
    maximumHoldingQuantity: 500_000,
    denominationStep: 100,
  }), 1_200);
  assert.equal(limitFinanceStockPriceIncrease({
    currentPrice: 2_000,
    candidatePrice: 2_200,
    maximumHoldingQuantity: 1_000_000,
    denominationStep: 100,
  }), 2_000);
  assert.equal(limitFinanceStockPriceIncrease({
    currentPrice: 2_000,
    candidatePrice: 1_900,
    maximumHoldingQuantity: 1_000_000,
    denominationStep: 100,
  }), 1_900);
});

test("보유 기록과 지갑 revision도 오래된 거래 요청을 막을 수 있게 검증한다", () => {
  for (const revisions of [
    { expectedHoldingRevision: -1, expectedWalletRevision: 0 },
    { expectedHoldingRevision: 0, expectedWalletRevision: "1" },
  ]) {
    assert.throws(
      () => normalizeFinanceStockTradeRequest({
        side: "buy",
        quantity: 1,
        expectedStockRevision: 0,
        expectedMarketRevision: 0,
        expectedFinanceSettingsRevision: 0,
        ...revisions,
        idempotencyKey: "stock-trade:revision:0001",
      }),
      stockError("FINANCE_STOCK_INVALID_REVISION"),
    );
  }
});
