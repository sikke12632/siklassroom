export const MARKET_CLERK_JOB_TEMPLATE_ID = "market-clerk";
export const MART_MAX_AMOUNT = 1_000_000_000;
export const MART_MAX_QUANTITY = 1_000_000_000;
export const MART_MAX_SALE_ITEMS = 50;

export type MartRole = "teacher" | "market_clerk" | "student";
export type MartOperation =
  | "product_create"
  | "product_update"
  | "inventory_inbound"
  | "inventory_outbound"
  | "inventory_correction"
  | "sale_create"
  | "sale_cancel";
export type MartInventoryMovementType = "inbound" | "outbound" | "correction";

export class MartRuleError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "MartRuleError";
  }
}

function normalizedText(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/gu, " ")
    : "";
}

function requiredText(value: unknown, label: string, maxLength: number) {
  const normalized = normalizedText(value);
  if (!normalized) {
    throw new MartRuleError(`${label}을 입력해 주세요.`, "MART_INPUT_REQUIRED");
  }
  if (normalized.length > maxLength) {
    throw new MartRuleError(
      `${label}은 ${maxLength}자 이내로 입력해 주세요.`,
      "MART_INPUT_TOO_LONG",
    );
  }
  return normalized;
}

function optionalText(value: unknown, label: string, maxLength: number) {
  if (value === undefined || value === null) return "";
  const normalized = normalizedText(value);
  if (normalized.length > maxLength) {
    throw new MartRuleError(
      `${label}은 ${maxLength}자 이내로 입력해 주세요.`,
      "MART_INPUT_TOO_LONG",
    );
  }
  return normalized;
}

function positiveInteger(value: unknown, label: string, max: number) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > max) {
    throw new MartRuleError(
      `${label}은 0보다 크고 ${max.toLocaleString("ko-KR")} 이하인 정수여야 합니다.`,
      "MART_INVALID_NUMBER",
    );
  }
  return Number(value);
}

export function normalizeMartResourceId(value: unknown, label = "ID") {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 160 || !/^[A-Za-z0-9:_-]+$/.test(normalized)) {
    throw new MartRuleError(`${label}를 다시 확인해 주세요.`, "MART_INVALID_ID");
  }
  return normalized;
}

export function normalizeMartIdempotencyKey(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(normalized)) {
    throw new MartRuleError(
      "요청 번호를 다시 확인해 주세요.",
      "MART_INVALID_IDEMPOTENCY_KEY",
    );
  }
  return normalized;
}

export function normalizeMartRevision(value: unknown, label = "최신 revision") {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new MartRuleError(`${label}을 다시 확인해 주세요.`, "MART_INVALID_REVISION");
  }
  return Number(value);
}

export function normalizeMartProduct(input: {
  name?: unknown;
  category?: unknown;
  description?: unknown;
  price?: unknown;
  unitPrice?: unknown;
  lowStockThreshold?: unknown;
  isActive?: unknown;
}) {
  if (typeof input.isActive !== "boolean") {
    throw new MartRuleError(
      "판매 상태를 다시 선택해 주세요.",
      "MART_INVALID_ACTIVE_STATE",
    );
  }
  return {
    name: requiredText(input.name, "상품명", 60),
    category: requiredText(
      input.category,
      "상품 분류",
      40,
    ),
    description: optionalText(input.description, "상품 설명", 300),
    unitPrice: positiveInteger(input.price ?? input.unitPrice, "가격", MART_MAX_AMOUNT),
    lowStockThreshold: (() => {
      const value = input.lowStockThreshold ?? 2;
      if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > MART_MAX_QUANTITY) {
        throw new MartRuleError(
          "낮은 재고 기준은 0 이상인 안전한 정수여야 합니다.",
          "MART_INVALID_LOW_STOCK_THRESHOLD",
        );
      }
      return Number(value);
    })(),
    isActive: input.isActive,
  };
}

export function normalizeMartInventoryMovement(input: {
  movementType?: unknown;
  quantity?: unknown;
  delta?: unknown;
  targetQuantity?: unknown;
  reason?: unknown;
}) {
  const movementType = input.movementType;
  if (movementType !== "inbound" && movementType !== "outbound" && movementType !== "correction") {
    throw new MartRuleError(
      "재고 작업 종류를 다시 선택해 주세요.",
      "MART_INVALID_MOVEMENT_TYPE",
    );
  }
  const reason = requiredText(input.reason, "재고 변경 사유", 300);
  if (movementType === "correction") {
    if (input.targetQuantity !== undefined) {
      if (
        !Number.isSafeInteger(input.targetQuantity)
        || Number(input.targetQuantity) < 0
        || Number(input.targetQuantity) > MART_MAX_QUANTITY
      ) {
        throw new MartRuleError(
          "실제 재고는 0 이상인 안전한 정수여야 합니다.",
          "MART_INVALID_QUANTITY",
        );
      }
      return {
        movementType,
        targetQuantity: Number(input.targetQuantity),
        delta: null,
        reason,
      };
    }
    if (
      !Number.isSafeInteger(input.delta)
      || Number(input.delta) === 0
      || Math.abs(Number(input.delta)) > MART_MAX_QUANTITY
    ) {
      throw new MartRuleError(
        "정정 수량은 0이 아닌 안전한 정수여야 합니다.",
        "MART_INVALID_QUANTITY",
      );
    }
    return {
      movementType,
      targetQuantity: null,
      delta: Number(input.delta),
      reason,
    };
  }
  const quantity = positiveInteger(input.quantity, "수량", MART_MAX_QUANTITY);
  return {
    movementType,
    targetQuantity: null,
    delta: movementType === "inbound" ? quantity : -quantity,
    reason,
  };
}

export type NormalizedMartSaleItem = {
  productId: string;
  quantity: number;
  expectedProductRevision: number;
  expectedInventoryRevision: number;
};

export function normalizeMartSaleItems(value: unknown): NormalizedMartSaleItem[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MART_MAX_SALE_ITEMS) {
    throw new MartRuleError(
      `판매 상품은 1개 이상 ${MART_MAX_SALE_ITEMS}개 이하로 선택해 주세요.`,
      "MART_INVALID_SALE_ITEMS",
    );
  }
  const seen = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") {
      throw new MartRuleError("판매 상품 정보를 다시 확인해 주세요.", "MART_INVALID_SALE_ITEMS");
    }
    const item = raw as Record<string, unknown>;
    const productId = normalizeMartResourceId(item.productId, "상품 ID");
    if (seen.has(productId)) {
      throw new MartRuleError(
        "같은 상품은 한 번만 담아 주세요.",
        "MART_DUPLICATE_SALE_ITEM",
      );
    }
    seen.add(productId);
    return {
      productId,
      quantity: positiveInteger(item.quantity, "판매 수량", MART_MAX_QUANTITY),
      expectedProductRevision: normalizeMartRevision(
        item.expectedProductRevision,
        "상품 revision",
      ),
      expectedInventoryRevision: normalizeMartRevision(
        item.expectedInventoryRevision,
        "재고 revision",
      ),
    };
  }).sort((left, right) => left.productId.localeCompare(right.productId));
}

export function normalizeMartCancellation(input: {
  expectedRevision?: unknown;
  reason?: unknown;
}) {
  return {
    expectedRevision: normalizeMartRevision(input.expectedRevision, "판매 revision"),
    reason: requiredText(input.reason, "판매 취소 사유", 300),
  };
}

export function resolveMartRole(
  actorType: "teacher" | "student",
  activeJobTemplateId: string | null | undefined,
): MartRole {
  if (actorType === "teacher") return "teacher";
  return activeJobTemplateId === MARKET_CLERK_JOB_TEMPLATE_ID
    ? "market_clerk"
    : "student";
}

function stableValue(value: unknown, seen: WeakSet<object>): unknown {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new MartRuleError("저장할 수 없는 숫자입니다.", "MART_INVALID_PAYLOAD");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item) => stableValue(item, seen));
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (seen.has(object)) {
      throw new MartRuleError("반복되는 요청 구조입니다.", "MART_INVALID_PAYLOAD");
    }
    seen.add(object);
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(object).sort()) {
      if (object[key] !== undefined) normalized[key] = stableValue(object[key], seen);
    }
    seen.delete(object);
    return normalized;
  }
  throw new MartRuleError("저장할 수 없는 요청 형식입니다.", "MART_INVALID_PAYLOAD");
}

export function stableMartJson(value: unknown) {
  return JSON.stringify(stableValue(value, new WeakSet()));
}

export function martOperationPayload(input: {
  operation: MartOperation;
  classId: string;
  resourceId?: string | null;
  actorType: "teacher" | "market_clerk";
  actorId: string;
  request: unknown;
}) {
  return {
    actor: { id: input.actorId, type: input.actorType },
    classId: input.classId,
    operation: input.operation,
    request: input.request,
    resourceId: input.resourceId ?? null,
  };
}

export function checkedMartTotal(lines: readonly { unitPrice: number; quantity: number }[]) {
  let totalAmount = 0;
  let totalQuantity = 0;
  for (const line of lines) {
    const lineTotal = line.unitPrice * line.quantity;
    if (!Number.isSafeInteger(lineTotal) || lineTotal > MART_MAX_AMOUNT) {
      throw new MartRuleError(
        "판매 금액이 한도를 넘었습니다.",
        "MART_TOTAL_LIMIT",
      );
    }
    totalAmount += lineTotal;
    totalQuantity += line.quantity;
    if (
      !Number.isSafeInteger(totalAmount)
      || totalAmount > MART_MAX_AMOUNT
      || !Number.isSafeInteger(totalQuantity)
      || totalQuantity > MART_MAX_QUANTITY
    ) {
      throw new MartRuleError(
        "판매 합계가 한도를 넘었습니다.",
        "MART_TOTAL_LIMIT",
      );
    }
  }
  return { totalAmount, totalQuantity };
}
