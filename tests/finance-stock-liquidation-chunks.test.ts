import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  calculateFinanceStockLiquidationChunk,
  calculateFinanceStockLiquidationTotals,
} from "../lib/finance-stock-rules";

function liquidationProjection(result: ReturnType<typeof calculateFinanceStockLiquidationChunk>) {
  return {
    quantity: result.quantity,
    grossAmount: result.grossAmount,
    feeAmount: result.feeAmount,
    payoutAmount: result.payoutAmount,
    costBasisRemoved: result.costBasisRemoved,
    realizedGain: result.realizedGain,
    remainingQuantity: result.remainingQuantity,
    remainingCostBasis: result.remainingCostBasis,
  };
}

test("liquidation chunk planning calculates only the next bounded chunk", () => {
  const result = calculateFinanceStockLiquidationChunk({
    remainingQuantity: 1_000_000_000,
    remainingCostBasis: 1_000_000_000,
    unitPrice: 1_000_000_000,
    feeBps: 1_000,
    denominationStep: 1,
  });

  assert.deepEqual(liquidationProjection(result), {
    quantity: 1,
    grossAmount: 1_000_000_000,
    feeAmount: 100_000_000,
    payoutAmount: 900_000_000,
    costBasisRemoved: 1,
    realizedGain: 899_999_999,
    remainingQuantity: 999_999_999,
    remainingCostBasis: 999_999_999,
  });
  assert.equal(
    Object.values(result).some(Array.isArray),
    false,
    "The next-chunk planner must not allocate the remaining chunk list.",
  );

  const totals = calculateFinanceStockLiquidationTotals({
    quantity: 1_000_000_000,
    unitPrice: 1_000_000_000,
    feeBps: 1_000,
    denominationStep: 1,
  });
  assert.deepEqual(totals, {
    chunkCount: 1_000_000_000,
    maximumChunkQuantity: 1,
    grossAmount: BigInt("1000000000000000000"),
    feeAmount: BigInt("100000000000000000"),
    payoutAmount: BigInt("900000000000000000"),
  });
});

test("two liquidation chunks preserve the final proportional cost remainder", () => {
  const first = calculateFinanceStockLiquidationChunk({
    remainingQuantity: 4,
    remainingCostBasis: 413,
    unitPrice: 333_333_334,
    feeBps: 1,
    denominationStep: 1,
  });
  assert.deepEqual(liquidationProjection(first), {
    quantity: 2,
    grossAmount: 666_666_668,
    feeAmount: 66_666,
    payoutAmount: 666_600_002,
    costBasisRemoved: 206,
    realizedGain: 666_599_796,
    remainingQuantity: 2,
    remainingCostBasis: 207,
  });

  const second = calculateFinanceStockLiquidationChunk({
    remainingQuantity: first.remainingQuantity,
    remainingCostBasis: first.remainingCostBasis,
    unitPrice: 333_333_334,
    feeBps: 1,
    denominationStep: 1,
  });
  assert.deepEqual(liquidationProjection(second), {
    quantity: 2,
    grossAmount: 666_666_668,
    feeAmount: 66_666,
    payoutAmount: 666_600_002,
    costBasisRemoved: 207,
    realizedGain: 666_599_795,
    remainingQuantity: 0,
    remainingCostBasis: 0,
  });

  assert.equal(first.quantity + second.quantity, 4);
  assert.equal(first.costBasisRemoved + second.costBasisRemoved, 413);
  assert.equal(first.payoutAmount + second.payoutAmount, 1_333_200_004);
  assert.equal(first.realizedGain + second.realizedGain, 1_333_199_591);
});

test("a safe resumable two-chunk quote stays below the wallet payout ceiling", () => {
  const first = calculateFinanceStockLiquidationChunk({
    remainingQuantity: 11,
    remainingCostBasis: 413,
    unitPrice: 100_000_000,
    feeBps: 1_000,
    denominationStep: 1,
  });
  const second = calculateFinanceStockLiquidationChunk({
    remainingQuantity: first.remainingQuantity,
    remainingCostBasis: first.remainingCostBasis,
    unitPrice: 100_000_000,
    feeBps: 1_000,
    denominationStep: 1,
  });

  assert.deepEqual(liquidationProjection(first), {
    quantity: 10,
    grossAmount: 1_000_000_000,
    feeAmount: 100_000_000,
    payoutAmount: 900_000_000,
    costBasisRemoved: 375,
    realizedGain: 899_999_625,
    remainingQuantity: 1,
    remainingCostBasis: 38,
  });
  assert.deepEqual(liquidationProjection(second), {
    quantity: 1,
    grossAmount: 100_000_000,
    feeAmount: 10_000_000,
    payoutAmount: 90_000_000,
    costBasisRemoved: 38,
    realizedGain: 89_999_962,
    remainingQuantity: 0,
    remainingCostBasis: 0,
  });
  assert.equal(first.payoutAmount + second.payoutAmount, 990_000_000);
  assert.equal(first.costBasisRemoved + second.costBasisRemoved, 413);
});

test("teacher UI gates chunked liquidation by payout and recovers committed responses", () => {
  const source = readFileSync(
    new URL("../app/finance/FinanceStocksPanel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /const quoteWithinSystemLimit = payout <= BigInt\(MAX_AMOUNT\);/u,
  );
  assert.match(
    source,
    /refreshed\?\.trades\.find\([\s\S]*item\.idempotencyKey === idempotencyKey/u,
  );
  assert.match(
    source,
    /refreshedOperation\?\.status === "cancelled"[\s\S]*refreshedOperation\.cancellationIdempotencyKey === idempotencyKey/u,
  );
});

test("oversized legacy position values stay exact across the stock API and student UI", () => {
  const serviceSource = readFileSync(
    new URL("../lib/finance-stocks.ts", import.meta.url),
    "utf8",
  );
  const uiSource = readFileSync(
    new URL("../app/finance/FinanceStocksPanel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    serviceSource,
    /const marketValueExact = BigInt\(quantity\) \* BigInt\(currentPrice\);/u,
  );
  assert.match(serviceSource, /marketValueExact: marketValueExact\.toString\(\)/u);
  assert.match(
    uiSource,
    /value=\{exactMoneyText\(data\.holding\.marketValueExact, unit\)\}/u,
  );
  assert.match(
    uiSource,
    /value=\{signedExactMoneyText\(data\.holding\.evaluationProfitExact, unit\)\}/u,
  );
});

test("stock liquidation listing never truncates running operations", () => {
  const source = readFileSync(
    new URL("../lib/finance-stocks.ts", import.meta.url),
    "utf8",
  );
  const functionStart = source.indexOf(
    "async function recentStockLiquidationOperations",
  );
  const functionEnd = source.indexOf("\nasync function ", functionStart + 1);
  assert.notEqual(functionStart, -1);
  assert.notEqual(functionEnd, -1);
  const functionSource = source.slice(functionStart, functionEnd);
  const runningStart = functionSource.indexOf("operation.status = 'running'");
  const terminalStart = functionSource.indexOf("operation.status <> 'running'");
  assert.ok(runningStart >= 0 && terminalStart > runningStart);
  assert.doesNotMatch(
    functionSource.slice(runningStart, terminalStart),
    /LIMIT/u,
  );
  assert.match(functionSource.slice(terminalStart), /LIMIT \?/u);
});
