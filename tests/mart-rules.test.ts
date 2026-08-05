import assert from "node:assert/strict";
import test from "node:test";
import {
  MART_MAX_AMOUNT,
  MartRuleError,
  checkedMartTotal,
  martOperationPayload,
  normalizeMartCancellation,
  normalizeMartInventoryMovement,
  normalizeMartProduct,
  normalizeMartSaleItems,
  resolveMartRole,
  stableMartJson,
} from "../lib/mart-rules";

function martError(code: string) {
  return (error: unknown) => error instanceof MartRuleError && error.code === code;
}

test("product values are normalized without allowing free or negative prices", () => {
  assert.deepEqual(normalizeMartProduct({
    name: "  딸기   우유  ",
    description: "  차갑게 보관  ",
    unitPrice: 500,
    isActive: true,
  }), {
    name: "딸기 우유",
    category: "차갑게 보관",
    description: "차갑게 보관",
    unitPrice: 500,
    lowStockThreshold: 2,
    isActive: true,
  });
  for (const unitPrice of [0, -1, 1.5, MART_MAX_AMOUNT + 1]) {
    assert.throws(
      () => normalizeMartProduct({ name: "상품", category: "간식", unitPrice, isActive: true }),
      martError("MART_INVALID_NUMBER"),
    );
  }
});

test("stock movement rules map inbound and outbound while correction needs a reason", () => {
  assert.deepEqual(normalizeMartInventoryMovement({
    movementType: "inbound",
    quantity: 12,
    reason: "새 물품",
  }), { movementType: "inbound", targetQuantity: null, delta: 12, reason: "새 물품" });
  assert.deepEqual(normalizeMartInventoryMovement({
    movementType: "outbound",
    quantity: 3,
    reason: "폐기 처리",
  }), { movementType: "outbound", targetQuantity: null, delta: -3, reason: "폐기 처리" });
  assert.deepEqual(normalizeMartInventoryMovement({
    movementType: "correction",
    delta: -2,
    reason: "실물 재고 재확인",
  }), {
    movementType: "correction",
    targetQuantity: null,
    delta: -2,
    reason: "실물 재고 재확인",
  });
  assert.throws(
    () => normalizeMartInventoryMovement({ movementType: "correction", delta: 1 }),
    martError("MART_INPUT_REQUIRED"),
  );
});

test("sales reject duplicate products and keep both product and inventory revisions", () => {
  assert.deepEqual(normalizeMartSaleItems([
    {
      productId: "product-b",
      quantity: 2,
      expectedProductRevision: 4,
      expectedInventoryRevision: 7,
    },
    {
      productId: "product-a",
      quantity: 1,
      expectedProductRevision: 1,
      expectedInventoryRevision: 3,
    },
  ]), [
    {
      productId: "product-a",
      quantity: 1,
      expectedProductRevision: 1,
      expectedInventoryRevision: 3,
    },
    {
      productId: "product-b",
      quantity: 2,
      expectedProductRevision: 4,
      expectedInventoryRevision: 7,
    },
  ]);
  assert.throws(
    () => normalizeMartSaleItems([
      {
        productId: "same",
        quantity: 1,
        expectedProductRevision: 0,
        expectedInventoryRevision: 0,
      },
      {
        productId: "same",
        quantity: 2,
        expectedProductRevision: 0,
        expectedInventoryRevision: 0,
      },
    ]),
    martError("MART_DUPLICATE_SALE_ITEM"),
  );
});

test("sale totals are exact safe integers and never exceed the record limit", () => {
  assert.deepEqual(checkedMartTotal([
    { unitPrice: 500, quantity: 2 },
    { unitPrice: 1_000, quantity: 3 },
  ]), { totalAmount: 4_000, totalQuantity: 5 });
  assert.throws(
    () => checkedMartTotal([{ unitPrice: MART_MAX_AMOUNT, quantity: 2 }]),
    martError("MART_TOTAL_LIMIT"),
  );
});

test("only the effective market-clerk template grants the student operator role", () => {
  assert.equal(resolveMartRole("teacher", null), "teacher");
  assert.equal(resolveMartRole("student", "market-clerk"), "market_clerk");
  assert.equal(resolveMartRole("student", "banker"), "student");
  assert.equal(resolveMartRole("student", null), "student");
});

test("canonical operation payloads and cancellation inputs support safe retries", () => {
  const payload = martOperationPayload({
    operation: "sale_cancel",
    classId: "class-one",
    resourceId: "sale-one",
    actorType: "market_clerk",
    actorId: "student-one",
    request: normalizeMartCancellation({
      expectedRevision: 0,
      reason: "잘못 선택한 상품",
    }),
  });
  assert.equal(stableMartJson(payload), stableMartJson({
    request: { reason: "잘못 선택한 상품", expectedRevision: 0 },
    resourceId: "sale-one",
    operation: "sale_cancel",
    classId: "class-one",
    actor: { type: "market_clerk", id: "student-one" },
  }));
});
