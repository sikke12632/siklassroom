import { FINANCE_MAX_ABSOLUTE_AMOUNT } from "./finance-ledger-rules";

export const FINANCE_STOCK_MAX_FEE_BPS = 1_000;
export const FINANCE_STOCK_MAX_QUANTITY = 1_000_000_000;
export const FINANCE_STOCK_MAX_SUPPLY = 1_000_000_000;
export const FINANCE_STOCK_MAX_SPREAD = 1_000_000_000;
export const FINANCE_STOCK_MAX_TICK_INTERVAL_MINUTES = 1_440;

export const FINANCE_STOCK_MARKET_MOODS = [
  "surge",
  "bull",
  "mixed",
  "bear",
  "crash",
] as const;

const ZERO_BIGINT = BigInt(0);
const BASIS_POINTS = BigInt(10_000);
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_FINANCE_AMOUNT_BIGINT = BigInt(FINANCE_MAX_ABSOLUTE_AMOUNT);

export type FinanceStockTradeSide = "buy" | "sell";
export type FinanceStockMarketMood = typeof FINANCE_STOCK_MARKET_MOODS[number];

export type FinanceStockRuleErrorCode =
  | "FINANCE_STOCK_INPUT_REQUIRED"
  | "FINANCE_STOCK_INPUT_TOO_LONG"
  | "FINANCE_STOCK_INVALID_SYMBOL"
  | "FINANCE_STOCK_INVALID_PRICE"
  | "FINANCE_STOCK_INVALID_QUANTITY"
  | "FINANCE_STOCK_INVALID_SUPPLY"
  | "FINANCE_STOCK_INVALID_FEE_RATE"
  | "FINANCE_STOCK_INVALID_SPREAD"
  | "FINANCE_STOCK_INVALID_MOOD"
  | "FINANCE_STOCK_INVALID_TICK_INTERVAL"
  | "FINANCE_STOCK_INVALID_DENOMINATION_STEP"
  | "FINANCE_STOCK_DENOMINATION_MISMATCH"
  | "FINANCE_STOCK_EXECUTION_PRICE_LIMIT"
  | "FINANCE_STOCK_INVALID_SIDE"
  | "FINANCE_STOCK_INVALID_BOOLEAN"
  | "FINANCE_STOCK_INVALID_REVISION"
  | "FINANCE_STOCK_INVALID_IDEMPOTENCY_KEY"
  | "FINANCE_STOCK_TRADE_LIMIT"
  | "FINANCE_STOCK_INVALID_POSITION"
  | "FINANCE_STOCK_INVALID_MAX_SHARES"
  | "FINANCE_STOCK_POSITION_LIMIT"
  | "FINANCE_STOCK_POSITION_VALUE_LIMIT"
  | "FINANCE_STOCK_INSUFFICIENT_HOLDINGS";

export class FinanceStockRuleError extends Error {
  constructor(
    message: string,
    public code: FinanceStockRuleErrorCode,
  ) {
    super(message);
    this.name = "FinanceStockRuleError";
  }
}

export type FinanceStockDefinitionInput = {
  symbol?: unknown;
  name?: unknown;
  description?: unknown;
  currentPrice?: unknown;
  initialPrice?: unknown;
  totalSupply?: unknown;
  maxSharesPerStudent?: unknown;
  perStudentLimit?: unknown;
  denominationStep?: unknown;
};

export type FinanceStockDefinitionValues = {
  symbol: string;
  name: string;
  description: string | null;
  currentPrice: number;
  initialPrice: number;
  totalSupply: number;
  maxSharesPerStudent: number;
  denominationStep: number;
};

export type FinanceStockMarketSettingsInput = {
  isOpen?: unknown;
  feeBps?: unknown;
  buyFeeBps?: unknown;
  sellFeeBps?: unknown;
  buySpread?: unknown;
  sellSpread?: unknown;
  mood?: unknown;
  tickIntervalMinutes?: unknown;
  expectedRevision?: unknown;
  idempotencyKey?: unknown;
};

export type FinanceStockMarketSettingsValues = {
  isOpen: boolean;
  buyFeeBps: number;
  sellFeeBps: number;
  buySpread: number;
  sellSpread: number;
  mood: FinanceStockMarketMood;
  tickIntervalMinutes: number;
  expectedRevision: number;
  idempotencyKey: string;
};

export type FinanceStockTradeRequestInput = {
  side?: unknown;
  quantity?: unknown;
  expectedStockRevision?: unknown;
  expectedMarketRevision?: unknown;
  expectedFinanceSettingsRevision?: unknown;
  expectedHoldingRevision?: unknown;
  expectedWalletRevision?: unknown;
  idempotencyKey?: unknown;
};

export type FinanceStockTradeRequestValues = {
  side: FinanceStockTradeSide;
  quantity: number;
  expectedStockRevision: number;
  expectedMarketRevision: number;
  expectedFinanceSettingsRevision: number;
  expectedHoldingRevision: number;
  expectedWalletRevision: number;
  idempotencyKey: string;
};

export type FinanceStockTradeQuoteInput = {
  side: unknown;
  unitPrice: unknown;
  quantity: unknown;
  feeBps: unknown;
  denominationStep: unknown;
};

export type FinanceStockTradeQuote = {
  side: FinanceStockTradeSide;
  unitPrice: number;
  quantity: number;
  feeBps: number;
  denominationStep: number;
  grossAmount: number;
  feeAmount: number;
  cashAmount: number;
  walletChange: number;
  issuanceChange: number;
};

export type FinanceStockExecutionPrice = {
  side: FinanceStockTradeSide;
  currentPrice: number;
  buySpread: number;
  sellSpread: number;
  denominationStep: number;
  unitPrice: number;
};

export type FinanceStockPositionAfterTrade = {
  quote: FinanceStockTradeQuote;
  quantityBefore: number;
  totalCostBefore: number;
  quantityAfter: number;
  totalCostAfter: number;
  costBasisRemoved: number;
  realizedProfit: number;
};

function normalizedText(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/gu, " ")
    : "";
}

function requiredText(value: unknown, field: string, maxLength: number) {
  const normalized = normalizedText(value);
  if (!normalized) {
    throw new FinanceStockRuleError(
      `${field}을(를) 입력해 주세요.`,
      "FINANCE_STOCK_INPUT_REQUIRED",
    );
  }
  if (normalized.length > maxLength) {
    throw new FinanceStockRuleError(
      `${field}은(는) ${maxLength}자 이내로 입력해 주세요.`,
      "FINANCE_STOCK_INPUT_TOO_LONG",
    );
  }
  return normalized;
}

function optionalText(value: unknown, field: string, maxLength: number) {
  if (value === undefined || value === null) return null;
  const normalized = normalizedText(value);
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new FinanceStockRuleError(
      `${field}은(는) ${maxLength}자 이내로 입력해 주세요.`,
      "FINANCE_STOCK_INPUT_TOO_LONG",
    );
  }
  return normalized;
}

function side(value: unknown): FinanceStockTradeSide {
  if (value !== "buy" && value !== "sell") {
    throw new FinanceStockRuleError(
      "매수 또는 매도를 다시 선택해 주세요.",
      "FINANCE_STOCK_INVALID_SIDE",
    );
  }
  return value;
}

function revision(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new FinanceStockRuleError(
      `${field}의 최신 정보를 다시 불러와 주세요.`,
      "FINANCE_STOCK_INVALID_REVISION",
    );
  }
  return Number(value);
}

function idempotencyKey(value: unknown) {
  const normalized = requiredText(value, "저장 요청 번호", 160);
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(normalized)) {
    throw new FinanceStockRuleError(
      "저장 요청 번호 형식이 올바르지 않습니다.",
      "FINANCE_STOCK_INVALID_IDEMPOTENCY_KEY",
    );
  }
  return normalized;
}

export function normalizeFinanceStockDenominationStep(value: unknown) {
  if (
    !Number.isSafeInteger(value)
    || Number(value) <= 0
    || Number(value) > FINANCE_MAX_ABSOLUTE_AMOUNT
  ) {
    throw new FinanceStockRuleError(
      "최소 권종은 0보다 큰 정수여야 합니다.",
      "FINANCE_STOCK_INVALID_DENOMINATION_STEP",
    );
  }
  return Number(value);
}

export function normalizeFinanceStockPrice(
  value: unknown,
  denominationStep: unknown,
) {
  const step = normalizeFinanceStockDenominationStep(denominationStep);
  if (
    !Number.isSafeInteger(value)
    || Number(value) <= 0
    || Number(value) > FINANCE_MAX_ABSOLUTE_AMOUNT
  ) {
    throw new FinanceStockRuleError(
      `주가는 ${FINANCE_MAX_ABSOLUTE_AMOUNT.toLocaleString("ko-KR")} 이하의 0보다 큰 정수여야 합니다.`,
      "FINANCE_STOCK_INVALID_PRICE",
    );
  }
  const price = Number(value);
  if (price % step !== 0) {
    throw new FinanceStockRuleError(
      `주가는 ${step.toLocaleString("ko-KR")} 단위로 정해 주세요.`,
      "FINANCE_STOCK_DENOMINATION_MISMATCH",
    );
  }
  return price;
}

export function normalizeFinanceStockQuantity(value: unknown) {
  if (
    !Number.isSafeInteger(value)
    || Number(value) <= 0
    || Number(value) > FINANCE_STOCK_MAX_QUANTITY
  ) {
    throw new FinanceStockRuleError(
      `수량은 ${FINANCE_STOCK_MAX_QUANTITY.toLocaleString("ko-KR")} 이하의 0보다 큰 정수여야 합니다.`,
      "FINANCE_STOCK_INVALID_QUANTITY",
    );
  }
  return Number(value);
}

function nonnegativeFinanceStockQuantity(value: unknown) {
  if (
    !Number.isSafeInteger(value)
    || Number(value) < 0
    || Number(value) > FINANCE_STOCK_MAX_QUANTITY
  ) {
    throw new FinanceStockRuleError(
      "현재 주식 보유 수량을 안전하게 계산할 수 없습니다.",
      "FINANCE_STOCK_INVALID_POSITION",
    );
  }
  return Number(value);
}

export function assertFinanceStockPositionMarketValue(input: {
  quantity: unknown;
  currentPrice: unknown;
}) {
  const quantity = nonnegativeFinanceStockQuantity(input.quantity);
  const currentPrice = normalizeFinanceStockPrice(input.currentPrice, 1);
  const marketValue = BigInt(quantity) * BigInt(currentPrice);
  if (marketValue > MAX_FINANCE_AMOUNT_BIGINT) {
    throw new FinanceStockRuleError(
      `학생 한 명의 주식 평가액은 ${FINANCE_MAX_ABSOLUTE_AMOUNT.toLocaleString("ko-KR")}을 넘을 수 없습니다.`,
      "FINANCE_STOCK_POSITION_VALUE_LIMIT",
    );
  }
  return Number(marketValue);
}

export function limitFinanceStockPriceIncrease(input: {
  currentPrice: unknown;
  candidatePrice: unknown;
  maximumHoldingQuantity: unknown;
  denominationStep: unknown;
}) {
  const step = normalizeFinanceStockDenominationStep(input.denominationStep);
  const currentPrice = normalizeFinanceStockPrice(input.currentPrice, step);
  const candidatePrice = normalizeFinanceStockPrice(input.candidatePrice, step);
  const maximumHoldingQuantity = nonnegativeFinanceStockQuantity(
    input.maximumHoldingQuantity,
  );
  if (candidatePrice <= currentPrice || maximumHoldingQuantity === 0) {
    return candidatePrice;
  }
  const rawMaximum = MAX_FINANCE_AMOUNT_BIGINT / BigInt(maximumHoldingQuantity);
  const maximumPrice = Number(
    (rawMaximum / BigInt(step)) * BigInt(step),
  );
  return Math.max(currentPrice, Math.min(candidatePrice, maximumPrice));
}

export function normalizeFinanceStockFeeBps(value: unknown) {
  if (
    !Number.isSafeInteger(value)
    || Number(value) < 0
    || Number(value) > FINANCE_STOCK_MAX_FEE_BPS
  ) {
    throw new FinanceStockRuleError(
      "수수료율은 0%부터 10% 사이로 입력해 주세요.",
      "FINANCE_STOCK_INVALID_FEE_RATE",
    );
  }
  return Number(value);
}

export function normalizeFinanceStockSpread(value: unknown) {
  if (
    !Number.isSafeInteger(value)
    || Number(value) < 0
    || Number(value) > FINANCE_STOCK_MAX_SPREAD
  ) {
    throw new FinanceStockRuleError(
      `매수·매도 가격 차이는 ${FINANCE_STOCK_MAX_SPREAD.toLocaleString("ko-KR")} 이하의 0 이상 정수여야 합니다.`,
      "FINANCE_STOCK_INVALID_SPREAD",
    );
  }
  return Number(value);
}

function marketMood(value: unknown): FinanceStockMarketMood {
  if (
    typeof value !== "string"
    || !FINANCE_STOCK_MARKET_MOODS.includes(value as FinanceStockMarketMood)
  ) {
    throw new FinanceStockRuleError(
      "시장 분위기를 다시 선택해 주세요.",
      "FINANCE_STOCK_INVALID_MOOD",
    );
  }
  return value as FinanceStockMarketMood;
}

function tickIntervalMinutes(value: unknown) {
  if (
    !Number.isSafeInteger(value)
    || Number(value) < 1
    || Number(value) > FINANCE_STOCK_MAX_TICK_INTERVAL_MINUTES
  ) {
    throw new FinanceStockRuleError(
      `가격 변경 간격은 1분부터 ${FINANCE_STOCK_MAX_TICK_INTERVAL_MINUTES.toLocaleString("ko-KR")}분 사이의 정수여야 합니다.`,
      "FINANCE_STOCK_INVALID_TICK_INTERVAL",
    );
  }
  return Number(value);
}

/** Calculates the student-facing buy or sell price around the current price. */
export function calculateFinanceStockExecutionPrice(input: {
  side: unknown;
  currentPrice: unknown;
  buySpread: unknown;
  sellSpread: unknown;
  denominationStep: unknown;
}): FinanceStockExecutionPrice {
  const normalizedSide = side(input.side);
  const denominationStep = normalizeFinanceStockDenominationStep(
    input.denominationStep,
  );
  const currentPrice = normalizeFinanceStockPrice(
    input.currentPrice,
    denominationStep,
  );
  const buySpread = normalizeFinanceStockSpread(input.buySpread);
  const sellSpread = normalizeFinanceStockSpread(input.sellSpread);
  const unitPriceBigInt = normalizedSide === "buy"
    ? BigInt(currentPrice) + BigInt(buySpread)
    : BigInt(currentPrice) - BigInt(sellSpread);
  if (
    unitPriceBigInt <= ZERO_BIGINT
    || unitPriceBigInt > MAX_FINANCE_AMOUNT_BIGINT
  ) {
    throw new FinanceStockRuleError(
      "가격 차이를 반영한 실제 거래 단가가 허용 범위를 벗어났습니다.",
      "FINANCE_STOCK_EXECUTION_PRICE_LIMIT",
    );
  }
  const unitPrice = Number(unitPriceBigInt);
  if (unitPrice % denominationStep !== 0) {
    throw new FinanceStockRuleError(
      `실제 거래 단가는 ${denominationStep.toLocaleString("ko-KR")} 단위여야 합니다.`,
      "FINANCE_STOCK_DENOMINATION_MISMATCH",
    );
  }
  return {
    side: normalizedSide,
    currentPrice,
    buySpread,
    sellSpread,
    denominationStep,
    unitPrice,
  };
}

function totalSupply(value: unknown) {
  if (
    !Number.isSafeInteger(value)
    || Number(value) <= 0
    || Number(value) > FINANCE_STOCK_MAX_SUPPLY
  ) {
    throw new FinanceStockRuleError(
      `발행 주식 수는 ${FINANCE_STOCK_MAX_SUPPLY.toLocaleString("ko-KR")} 이하의 0보다 큰 정수여야 합니다.`,
      "FINANCE_STOCK_INVALID_SUPPLY",
    );
  }
  return Number(value);
}

function maxSharesPerStudent(value: unknown) {
  if (
    !Number.isSafeInteger(value)
    || Number(value) <= 0
    || Number(value) > FINANCE_STOCK_MAX_QUANTITY
  ) {
    throw new FinanceStockRuleError(
      `학생 한 명의 보유 한도는 ${FINANCE_STOCK_MAX_QUANTITY.toLocaleString("ko-KR")} 이하의 0보다 큰 정수여야 합니다.`,
      "FINANCE_STOCK_INVALID_MAX_SHARES",
    );
  }
  return Number(value);
}

function safeBigIntNumber(
  value: bigint,
  code: Extract<FinanceStockRuleErrorCode, "FINANCE_STOCK_TRADE_LIMIT" | "FINANCE_STOCK_POSITION_LIMIT">,
  message: string,
) {
  if (value < ZERO_BIGINT || value > MAX_SAFE_INTEGER_BIGINT) {
    throw new FinanceStockRuleError(message, code);
  }
  return Number(value);
}

/**
 * Calculates an immediate market trade using integer classroom currency.
 *
 * Prices and cash changes use the smallest configured denomination. A fee is
 * first calculated in basis points (100 bps = 1%) and then rounded down to a
 * whole denomination step, so a trade can never create unusable change.
 */
export function calculateFinanceStockTradeQuote(
  input: FinanceStockTradeQuoteInput,
): FinanceStockTradeQuote {
  const normalizedSide = side(input.side);
  const denominationStep = normalizeFinanceStockDenominationStep(
    input.denominationStep,
  );
  const unitPrice = normalizeFinanceStockPrice(
    input.unitPrice,
    denominationStep,
  );
  const quantity = normalizeFinanceStockQuantity(input.quantity);
  const feeBps = normalizeFinanceStockFeeBps(input.feeBps);

  const grossBigInt = BigInt(unitPrice) * BigInt(quantity);
  if (grossBigInt > MAX_FINANCE_AMOUNT_BIGINT) {
    throw new FinanceStockRuleError(
      "한 번의 주식 거래 총액이 허용 범위를 넘었습니다.",
      "FINANCE_STOCK_TRADE_LIMIT",
    );
  }

  const stepBigInt = BigInt(denominationStep);
  const feeBigInt = (
    ((grossBigInt * BigInt(feeBps)) / BASIS_POINTS) / stepBigInt
  ) * stepBigInt;
  const cashBigInt = normalizedSide === "buy"
    ? grossBigInt + feeBigInt
    : grossBigInt - feeBigInt;
  if (cashBigInt <= ZERO_BIGINT || cashBigInt > MAX_FINANCE_AMOUNT_BIGINT) {
    throw new FinanceStockRuleError(
      "수수료를 포함한 한 번의 주식 거래 금액이 허용 범위를 넘었습니다.",
      "FINANCE_STOCK_TRADE_LIMIT",
    );
  }

  const grossAmount = Number(grossBigInt);
  const feeAmount = Number(feeBigInt);
  const cashAmount = Number(cashBigInt);
  const walletChange = normalizedSide === "buy" ? -cashAmount : cashAmount;

  return {
    side: normalizedSide,
    unitPrice,
    quantity,
    feeBps,
    denominationStep,
    grossAmount,
    feeAmount,
    cashAmount,
    walletChange,
    issuanceChange: -walletChange,
  };
}

function positionValues(quantityValue: unknown, totalCostValue: unknown) {
  if (
    !Number.isSafeInteger(quantityValue)
    || Number(quantityValue) < 0
    || Number(quantityValue) > FINANCE_STOCK_MAX_QUANTITY
    || !Number.isSafeInteger(totalCostValue)
    || Number(totalCostValue) < 0
    || (Number(quantityValue) === 0) !== (Number(totalCostValue) === 0)
  ) {
    throw new FinanceStockRuleError(
      "현재 주식 보유 기록이 올바르지 않습니다.",
      "FINANCE_STOCK_INVALID_POSITION",
    );
  }
  return {
    quantity: Number(quantityValue),
    totalCost: Number(totalCostValue),
  };
}

/**
 * Applies a quoted trade to the average-cost position projection.
 *
 * Buy fees are included in cost basis. A partial sale removes the exact
 * floor-rounded proportional cost; selling every remaining share consumes
 * the full residual cost so no rounding remainder is stranded.
 */
export function calculateFinanceStockPositionAfterTrade(
  input: FinanceStockTradeQuoteInput & {
    quantityBefore: unknown;
    totalCostBefore: unknown;
  },
): FinanceStockPositionAfterTrade {
  const quote = calculateFinanceStockTradeQuote(input);
  const before = positionValues(input.quantityBefore, input.totalCostBefore);

  if (quote.side === "buy") {
    const quantityAfterBigInt = BigInt(before.quantity) + BigInt(quote.quantity);
    const totalCostAfterBigInt = BigInt(before.totalCost) + BigInt(quote.cashAmount);
    if (quantityAfterBigInt > BigInt(FINANCE_STOCK_MAX_QUANTITY)) {
      throw new FinanceStockRuleError(
        "거래 후 보유 수량이 허용 범위를 넘습니다.",
        "FINANCE_STOCK_POSITION_LIMIT",
      );
    }
    if (totalCostAfterBigInt > MAX_FINANCE_AMOUNT_BIGINT) {
      throw new FinanceStockRuleError(
        `한 학생의 누적 주식 매입금액은 ${FINANCE_MAX_ABSOLUTE_AMOUNT.toLocaleString("ko-KR")}을 넘을 수 없습니다.`,
        "FINANCE_STOCK_POSITION_LIMIT",
      );
    }
    return {
      quote,
      quantityBefore: before.quantity,
      totalCostBefore: before.totalCost,
      quantityAfter: Number(quantityAfterBigInt),
      totalCostAfter: safeBigIntNumber(
        totalCostAfterBigInt,
        "FINANCE_STOCK_POSITION_LIMIT",
        "거래 후 매입 원가를 안전하게 계산할 수 없습니다.",
      ),
      costBasisRemoved: 0,
      realizedProfit: 0,
    };
  }

  if (quote.quantity > before.quantity) {
    throw new FinanceStockRuleError(
      "보유한 수량보다 많이 매도할 수 없습니다.",
      "FINANCE_STOCK_INSUFFICIENT_HOLDINGS",
    );
  }

  const quantityAfter = before.quantity - quote.quantity;
  const costBasisRemovedBigInt = quote.quantity === before.quantity
    ? BigInt(before.totalCost)
    : (
      BigInt(before.totalCost) * BigInt(quote.quantity)
    ) / BigInt(before.quantity);
  const costBasisRemoved = safeBigIntNumber(
    costBasisRemovedBigInt,
    "FINANCE_STOCK_POSITION_LIMIT",
    "매도 주식의 매입 원가를 안전하게 계산할 수 없습니다.",
  );
  const totalCostAfter = before.totalCost - costBasisRemoved;

  return {
    quote,
    quantityBefore: before.quantity,
    totalCostBefore: before.totalCost,
    quantityAfter,
    totalCostAfter: quantityAfter === 0 ? 0 : totalCostAfter,
    costBasisRemoved,
    realizedProfit: quote.cashAmount - costBasisRemoved,
  };
}

export function normalizeFinanceStockDefinition(
  input: FinanceStockDefinitionInput,
): FinanceStockDefinitionValues {
  const denominationStep = normalizeFinanceStockDenominationStep(
    input.denominationStep,
  );
  const symbol = requiredText(input.symbol, "종목 코드", 12).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,11}$/.test(symbol)) {
    throw new FinanceStockRuleError(
      "종목 코드는 영문 대문자, 숫자, 밑줄, 붙임표로 입력해 주세요.",
      "FINANCE_STOCK_INVALID_SYMBOL",
    );
  }

  const priceInput = input.initialPrice ?? input.currentPrice;
  if (
    input.initialPrice !== undefined
    && input.currentPrice !== undefined
    && input.initialPrice !== input.currentPrice
  ) {
    throw new FinanceStockRuleError(
      "최초 주가가 서로 다르게 입력되었습니다.",
      "FINANCE_STOCK_INVALID_PRICE",
    );
  }
  const initialPrice = normalizeFinanceStockPrice(
    priceInput,
    denominationStep,
  );
  const normalizedTotalSupply = totalSupply(input.totalSupply);
  const normalizedMaxSharesPerStudent = maxSharesPerStudent(
    input.maxSharesPerStudent ?? input.perStudentLimit,
  );
  if (normalizedMaxSharesPerStudent > normalizedTotalSupply) {
    throw new FinanceStockRuleError(
      "학생 한 명의 보유 한도는 전체 발행 주식 수보다 클 수 없습니다.",
      "FINANCE_STOCK_INVALID_MAX_SHARES",
    );
  }

  return {
    symbol,
    name: requiredText(input.name, "종목 이름", 40),
    description: optionalText(input.description, "종목 설명", 200),
    currentPrice: initialPrice,
    initialPrice,
    totalSupply: normalizedTotalSupply,
    maxSharesPerStudent: normalizedMaxSharesPerStudent,
    denominationStep,
  };
}

export function normalizeFinanceStockMarketSettings(
  input: FinanceStockMarketSettingsInput,
): FinanceStockMarketSettingsValues {
  if (typeof input.isOpen !== "boolean") {
    throw new FinanceStockRuleError(
      "주식시장 운영 상태를 다시 선택해 주세요.",
      "FINANCE_STOCK_INVALID_BOOLEAN",
    );
  }
  const sharedFee = input.feeBps;
  return {
    isOpen: input.isOpen,
    buyFeeBps: normalizeFinanceStockFeeBps(input.buyFeeBps ?? sharedFee),
    sellFeeBps: normalizeFinanceStockFeeBps(input.sellFeeBps ?? sharedFee),
    buySpread: normalizeFinanceStockSpread(input.buySpread),
    sellSpread: normalizeFinanceStockSpread(input.sellSpread),
    mood: marketMood(input.mood),
    tickIntervalMinutes: tickIntervalMinutes(input.tickIntervalMinutes),
    expectedRevision: revision(input.expectedRevision, "주식시장"),
    idempotencyKey: idempotencyKey(input.idempotencyKey),
  };
}

export function normalizeFinanceStockTradeRequest(
  input: FinanceStockTradeRequestInput,
): FinanceStockTradeRequestValues {
  return {
    side: side(input.side),
    quantity: normalizeFinanceStockQuantity(input.quantity),
    expectedStockRevision: revision(input.expectedStockRevision, "종목"),
    expectedMarketRevision: revision(input.expectedMarketRevision, "주식시장"),
    expectedFinanceSettingsRevision: revision(
      input.expectedFinanceSettingsRevision,
      "금융 설정",
    ),
    expectedHoldingRevision: revision(input.expectedHoldingRevision, "보유 주식"),
    expectedWalletRevision: revision(input.expectedWalletRevision, "지갑"),
    idempotencyKey: idempotencyKey(input.idempotencyKey),
  };
}
