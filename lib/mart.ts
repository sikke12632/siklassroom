import { sha256 } from "./crypto";
import { database } from "./database";
import { financeSettingsForClass } from "./finance-settings";
import {
  type MartContext,
  assertMartAuditReader,
  assertMartOperator,
  assertMartTeacher,
  martContextForRequest,
  martOperationActor,
} from "./mart-access";
import {
  MartRuleError,
  type MartOperation,
  checkedMartTotal,
  martOperationPayload,
  normalizeMartCancellation,
  normalizeMartIdempotencyKey,
  normalizeMartInventoryMovement,
  normalizeMartProduct,
  normalizeMartResourceId,
  normalizeMartRevision,
  normalizeMartSaleItems,
  stableMartJson,
} from "./mart-rules";
import {
  MART_SALES_EXPORT_MAX_ROWS,
  buildMartSalesCsv,
  encodeMartSaleCursor,
  martSaleStatusSql,
  parseMartSaleListQuery,
  type MartSaleListQuery,
} from "./mart-history";
import { ApiError } from "./responses";
import {
  encodeAuditHistoryCursor,
  parseAuditHistoryQuery,
} from "./audit-history";

type OperationRow = {
  id: string;
  class_id: string;
  idempotency_key: string;
  operation: MartOperation;
  resource_id: string;
  payload_hash: string;
  actor_type: "teacher" | "market_clerk";
  actor_teacher_id: string | null;
  actor_student_id: string | null;
  actor_job_period_id: string | null;
  actor_label: string;
  intervention_reason: string | null;
  expected_class_revision: number;
  created_at: number;
};

type ProductRow = {
  id: string;
  class_id: string;
  name: string;
  category: string;
  description: string;
  unit_price: number;
  low_stock_threshold: number;
  is_active: number;
  revision: number;
  created_operation_id: string;
  created_at: number;
  updated_at: number;
  quantity: number;
  inventory_revision: number;
  inventory_updated_at: number;
};

type SaleRow = {
  id: string;
  class_id: string;
  buyer_student_id: string;
  buyer_student_number_snapshot: number;
  buyer_student_name_snapshot: string;
  total_amount: number;
  total_quantity: number;
  status: "building" | "posted" | "cancelled";
  revision: number;
  created_operation_id: string;
  cancelled_operation_id: string | null;
  cancelled_reason: string | null;
  seller_actor_type: "teacher" | "market_clerk";
  seller_actor_id: string;
  seller_actor_label: string;
  cancellation_actor_type: "teacher" | "market_clerk" | null;
  cancellation_actor_label: string | null;
  created_at: number;
  cancelled_at: number | null;
  updated_at: number;
};

type SaleItemRow = {
  id: string;
  sale_id: string;
  class_id: string;
  product_id: string;
  product_name_snapshot: string;
  unit_price_snapshot: number;
  quantity: number;
  line_total: number;
  created_at: number;
};

type StudentRow = {
  id: string;
  student_number: number;
  official_name: string;
  status: "pending" | "active" | "locked" | "reset_required" | "excluded";
};

const PRODUCT_SELECT = `SELECT product.id, product.class_id, product.name,
  product.category, product.description, product.unit_price,
  product.low_stock_threshold, product.is_active,
  product.revision, product.created_operation_id, product.created_at,
  product.updated_at, inventory.quantity,
  inventory.revision AS inventory_revision,
  inventory.updated_at AS inventory_updated_at
 FROM mart_products product
 JOIN mart_inventory inventory
   ON inventory.product_id = product.id
  AND inventory.class_id = product.class_id`;

const SALE_SELECT = `SELECT sale.id, sale.class_id, sale.buyer_student_id,
  sale.buyer_student_number_snapshot, sale.buyer_student_name_snapshot,
  sale.total_amount, sale.total_quantity, sale.status, sale.revision,
  sale.created_operation_id, sale.cancelled_operation_id,
  sale.cancelled_reason, sale.created_at, sale.cancelled_at, sale.updated_at,
  created_operation.actor_type AS seller_actor_type,
  COALESCE(created_operation.actor_teacher_id,
           created_operation.actor_student_id) AS seller_actor_id,
  created_operation.actor_label AS seller_actor_label,
  cancelled_operation.actor_type AS cancellation_actor_type,
  cancelled_operation.actor_label AS cancellation_actor_label
 FROM mart_sales sale
 JOIN mart_operations created_operation
   ON created_operation.id = sale.created_operation_id
  AND created_operation.class_id = sale.class_id
 LEFT JOIN mart_operations cancelled_operation
   ON cancelled_operation.id = sale.cancelled_operation_id
  AND cancelled_operation.class_id = sale.class_id`;

function ruleError(error: unknown): never {
  if (error instanceof MartRuleError) {
    throw new ApiError(400, error.message, error.code);
  }
  throw error;
}

function mapDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const mappings: Array<[string, number, string, string]> = [
    ["MART_INVENTORY_CORRECTION_TEACHER_REQUIRED", 403, "재고 비상 정정은 담임교사만 처리할 수 있습니다.", "MART_TEACHER_REQUIRED"],
    ["MART_CLASS_NOT_ACTIVE", 409, "운영 중인 학급에서만 마트를 변경할 수 있습니다.", "MART_CLASS_NOT_ACTIVE"],
    ["MART_CLASS_ACCESS_DENIED", 403, "다른 학급의 마트를 변경할 수 없습니다.", "MART_CLASS_ACCESS_DENIED"],
    ["MART_CLERK_ACCESS_DENIED", 403, "현재 마트 직원 권한을 확인할 수 없습니다.", "MART_CLERK_ACCESS_DENIED"],
    ["MART_PRODUCT_STALE", 409, "상품 정보가 먼저 변경되었습니다. 최신 내용을 확인해 주세요.", "MART_PRODUCT_STALE"],
    ["MART_PRODUCT_EVENT_INVALID", 409, "상품 정보가 먼저 변경되었습니다. 최신 내용을 확인해 주세요.", "MART_PRODUCT_STALE"],
    ["MART_INVENTORY_STALE", 409, "재고가 먼저 변경되었습니다. 최신 수량을 확인해 주세요.", "MART_INVENTORY_STALE"],
    ["MART_CONTEXT_STALE", 409, "마트 기록이 먼저 변경되었습니다. 최신 내용을 확인해 주세요.", "MART_STALE"],
    ["MART_SALE_STALE", 409, "판매 상태가 먼저 변경되었습니다. 최신 기록을 확인해 주세요.", "MART_SALE_STALE"],
    ["MART_SALE_CONTEXT_INVALID", 409, "구매 학생 또는 판매 정보를 다시 확인해 주세요.", "MART_SALE_CONTEXT_INVALID"],
    ["MART_SALE_ITEM_INVALID", 409, "상품명이나 가격이 변경되었습니다. 최신 상품을 확인해 주세요.", "MART_PRODUCT_STALE"],
  ];
  for (const [needle, status, userMessage, code] of mappings) {
    if (message.includes(needle)) throw new ApiError(status, userMessage, code);
  }
  if (
    message.includes("mart_operations_class_idempotency_uq")
    || message.includes("mart_operations.class_id, mart_operations.idempotency_key")
  ) {
    throw new ApiError(
      409,
      "같은 요청 번호가 다른 마트 작업에 사용되었습니다.",
      "MART_IDEMPOTENCY_CONFLICT",
    );
  }
  if (
    message.includes("mart_inventory.quantity")
    || message.includes("mart_inventory_movements.quantity_after")
  ) {
    throw new ApiError(
      409,
      "재고가 부족합니다.",
      "MART_INVENTORY_SHORT",
    );
  }
  throw error;
}

function assertManagerReader(context: MartContext) {
  if (!context.permissions.canViewAllSales) {
    throw new ApiError(
      403,
      "마트 운영 정보는 현재 마트 직원과 담임교사만 볼 수 있습니다.",
      "MART_OPERATOR_REQUIRED",
    );
  }
}

function serializeContext(context: MartContext) {
  return {
    actor: context.actor,
    classroom: {
      id: context.classroom.id,
      name: context.classroom.displayName,
      schoolName: context.classroom.schoolName,
      grade: context.classroom.grade,
      classNumber: context.classroom.classNumber,
      status: context.classroom.status,
    },
    role: context.role,
    activeJob: context.activeJob,
    permissions: context.permissions,
    physicalCashOnly: true,
    digitalFinanceUnaffected: true,
  };
}

function serializeProduct(row: ProductRow) {
  return {
    id: row.id,
    classId: row.class_id,
    name: row.name,
    category: row.category,
    description: row.description,
    price: Number(row.unit_price),
    unitPrice: Number(row.unit_price),
    lowStockThreshold: Number(row.low_stock_threshold),
    isActive: Boolean(row.is_active),
    revision: Number(row.revision),
    inventory: {
      quantity: Number(row.quantity),
      revision: Number(row.inventory_revision),
      updatedAt: Number(row.inventory_updated_at),
    },
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function serializeInventory(row: ProductRow) {
  return {
    productId: row.id,
    onHand: Number(row.quantity),
    revision: Number(row.inventory_revision),
    updatedAt: Number(row.inventory_updated_at),
  };
}

function productSnapshot(input: {
  id: string;
  classId: string;
  name: string;
  category: string;
  description: string;
  unitPrice: number;
  lowStockThreshold: number;
  isActive: boolean;
  revision: number;
}) {
  return stableMartJson(input);
}

async function operationByKey(db: D1Database, classId: string, key: string) {
  return db.prepare(
    `SELECT id, class_id, idempotency_key, operation, resource_id,
            payload_hash, actor_type, actor_teacher_id, actor_student_id,
            actor_job_period_id, actor_label, intervention_reason,
            expected_class_revision, created_at
     FROM mart_operations
     WHERE class_id = ? AND idempotency_key = ? LIMIT 1`,
  ).bind(classId, key).first<OperationRow>();
}

async function productById(db: D1Database, classId: string, productId: string) {
  return db.prepare(
    `${PRODUCT_SELECT}
     WHERE product.class_id = ? AND product.id = ? LIMIT 1`,
  ).bind(classId, productId).first<ProductRow>();
}

async function martClassRevision(db: D1Database, classId: string) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS revision FROM mart_operations WHERE class_id = ?`,
  ).bind(classId).first<{ revision: number }>();
  return Number(row?.revision ?? 0);
}

function operationStatement(
  db: D1Database,
  input: {
    operationId: string;
    classId: string;
    key: string;
    operation: MartOperation;
    resourceId: string;
    payloadHash: string;
    context: MartContext;
    expectedClassRevision: number;
    interventionReason?: string | null;
    now: number;
  },
) {
  const actor = martOperationActor(input.context);
  return db.prepare(
    `INSERT INTO mart_operations (
       id, class_id, idempotency_key, operation, resource_id, payload_hash,
       actor_type, actor_teacher_id, actor_student_id, actor_job_period_id,
       actor_label, intervention_reason, expected_class_revision, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.operationId,
    input.classId,
    input.key,
    input.operation,
    input.resourceId,
    input.payloadHash,
    actor.actorType,
    actor.actorTeacherId,
    actor.actorStudentId,
    actor.actorJobPeriodId,
    actor.actorLabel,
    input.interventionReason ?? null,
    input.expectedClassRevision,
    input.now,
  );
}

async function hashOperation(
  context: MartContext,
  operation: MartOperation,
  requestPayload: unknown,
  resourceId?: string | null,
) {
  if (context.role !== "teacher" && context.role !== "market_clerk") {
    throw new ApiError(403, "마트 운영 권한이 없습니다.", "MART_OPERATOR_REQUIRED");
  }
  return sha256(stableMartJson(martOperationPayload({
    operation,
    classId: context.classroom.id,
    resourceId,
    actorType: context.role,
    actorId: context.actor.id,
    request: requestPayload,
  })));
}

function assertReplay(
  operation: OperationRow,
  expectedOperation: MartOperation,
  expectedPayloadHash: string,
  expectedResourceId?: string,
) {
  if (
    operation.operation !== expectedOperation
    || operation.payload_hash !== expectedPayloadHash
    || (expectedResourceId !== undefined && operation.resource_id !== expectedResourceId)
  ) {
    throw new ApiError(
      409,
      "같은 요청 번호가 다른 마트 작업에 사용되었습니다.",
      "MART_IDEMPOTENCY_CONFLICT",
    );
  }
}

export async function martContextForApi(request: Request) {
  const context = await martContextForRequest(request);
  const db = database();
  const [settings, revision, students] = await Promise.all([
    financeSettingsForClass(context.classroom.id),
    martClassRevision(db, context.classroom.id),
    context.permissions.canOperate
      ? db.prepare(
        `SELECT id, student_number, official_name, status
         FROM students
         WHERE class_id = ? AND status <> 'excluded'
         ORDER BY student_number, id`,
      ).bind(context.classroom.id).all<StudentRow>()
      : Promise.resolve({ results: [] as StudentRow[] }),
  ]);
  return {
    ...serializeContext(context),
    currency: {
      name: settings.currencyName,
      unit: settings.currencyUnit,
      denominations: [...settings.denominations],
    },
    students: students.results.map((student) => ({
      id: student.id,
      number: Number(student.student_number),
      name: student.official_name,
      status: student.status,
    })),
    revision,
  };
}

export async function martProductsForRequest(request: Request) {
  const context = await martContextForRequest(request);
  assertManagerReader(context);
  const rows = await database().prepare(
    `${PRODUCT_SELECT}
     WHERE product.class_id = ?
     ORDER BY product.is_active DESC, product.name, product.id`,
  ).bind(context.classroom.id).all<ProductRow>();
  return { context: serializeContext(context), products: rows.results.map(serializeProduct) };
}

export async function createMartProduct(
  request: Request,
  input: {
    name?: unknown;
    category?: unknown;
    description?: unknown;
    price?: unknown;
    unitPrice?: unknown;
    lowStockThreshold?: unknown;
    isActive?: unknown;
    idempotencyKey?: unknown;
  },
) {
  const context = await martContextForRequest(request);
  assertMartOperator(context);
  let values: ReturnType<typeof normalizeMartProduct>;
  let key: string;
  try {
    values = normalizeMartProduct(input);
    key = normalizeMartIdempotencyKey(input.idempotencyKey);
  } catch (error) {
    ruleError(error);
  }
  const db = database();
  const payloadHash = await hashOperation(context, "product_create", values, null);
  const duplicate = await operationByKey(db, context.classroom.id, key);
  if (duplicate) {
    assertReplay(duplicate, "product_create", payloadHash);
    const saved = await productById(db, context.classroom.id, duplicate.resource_id);
    if (!saved) throw new ApiError(500, "생성된 상품을 확인할 수 없습니다.", "MART_PRODUCT_UNAVAILABLE");
    return { product: serializeProduct(saved), deduplicated: true };
  }
  const now = Date.now();
  const expectedClassRevision = await martClassRevision(db, context.classroom.id);
  const productId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const snapshot = productSnapshot({
    id: productId,
    classId: context.classroom.id,
    ...values,
    revision: 0,
  });
  try {
    await db.batch([
      operationStatement(db, {
        operationId,
        classId: context.classroom.id,
        key,
        operation: "product_create",
        resourceId: productId,
        payloadHash,
        context,
        expectedClassRevision,
        now,
      }),
      db.prepare(
        `INSERT INTO mart_products (
           id, class_id, name, category, description, unit_price,
           low_stock_threshold, is_active, revision,
           created_operation_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      ).bind(
        productId,
        context.classroom.id,
        values.name,
        values.category,
        values.description,
        values.unitPrice,
        values.lowStockThreshold,
        values.isActive ? 1 : 0,
        operationId,
        now,
        now,
      ),
      db.prepare(
        `INSERT INTO mart_inventory (
           product_id, class_id, quantity, revision, created_at, updated_at
         ) VALUES (?, ?, 0, 0, ?, ?)`,
      ).bind(productId, context.classroom.id, now, now),
      db.prepare(
        `INSERT INTO mart_product_events (
           id, class_id, product_id, operation_id, revision, action,
           product_snapshot_json, created_at
         ) VALUES (?, ?, ?, ?, 0, 'created', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        context.classroom.id,
        productId,
        operationId,
        snapshot,
        now,
      ),
    ]);
  } catch (error) {
    const concurrent = await operationByKey(db, context.classroom.id, key);
    if (concurrent) {
      assertReplay(concurrent, "product_create", payloadHash);
      const saved = await productById(db, context.classroom.id, concurrent.resource_id);
      if (saved) return { product: serializeProduct(saved), deduplicated: true };
    }
    mapDatabaseError(error);
  }
  const saved = await productById(db, context.classroom.id, productId);
  if (!saved) throw new ApiError(500, "생성된 상품을 확인할 수 없습니다.", "MART_PRODUCT_UNAVAILABLE");
  return { product: serializeProduct(saved), deduplicated: false };
}

export async function updateMartProduct(
  request: Request,
  productIdValue: unknown,
  input: {
    name?: unknown;
    category?: unknown;
    description?: unknown;
    price?: unknown;
    unitPrice?: unknown;
    lowStockThreshold?: unknown;
    isActive?: unknown;
    expectedRevision?: unknown;
    idempotencyKey?: unknown;
  },
) {
  const context = await martContextForRequest(request);
  assertMartOperator(context);
  let productId: string;
  let expectedRevision: number;
  let key: string;
  let values: ReturnType<typeof normalizeMartProduct>;
  try {
    productId = normalizeMartResourceId(productIdValue, "상품 ID");
    expectedRevision = normalizeMartRevision(input.expectedRevision, "상품 revision");
    key = normalizeMartIdempotencyKey(input.idempotencyKey);
    values = normalizeMartProduct(input);
  } catch (error) {
    ruleError(error);
  }
  const requestPayload = { expectedRevision, ...values };
  const payloadHash = await hashOperation(
    context,
    "product_update",
    requestPayload,
    productId,
  );
  const db = database();
  const duplicate = await operationByKey(db, context.classroom.id, key);
  if (duplicate) {
    assertReplay(duplicate, "product_update", payloadHash, productId);
    const saved = await productById(db, context.classroom.id, productId);
    if (!saved) throw new ApiError(500, "수정된 상품을 확인할 수 없습니다.", "MART_PRODUCT_UNAVAILABLE");
    return { product: serializeProduct(saved), deduplicated: true };
  }
  const current = await productById(db, context.classroom.id, productId);
  if (!current) throw new ApiError(404, "상품을 찾을 수 없습니다.", "MART_PRODUCT_NOT_FOUND");
  if (Number(current.revision) !== expectedRevision) {
    throw new ApiError(409, "상품 정보가 먼저 변경되었습니다.", "MART_PRODUCT_STALE");
  }
  const now = Date.now();
  const expectedClassRevision = await martClassRevision(db, context.classroom.id);
  const operationId = crypto.randomUUID();
  const nextRevision = expectedRevision + 1;
  const action = Boolean(current.is_active) === values.isActive
    ? "updated"
    : values.isActive ? "activated" : "deactivated";
  const snapshot = productSnapshot({
    id: productId,
    classId: context.classroom.id,
    ...values,
    revision: nextRevision,
  });
  try {
    await db.batch([
      operationStatement(db, {
        operationId,
        classId: context.classroom.id,
        key,
        operation: "product_update",
        resourceId: productId,
        payloadHash,
        context,
        expectedClassRevision,
        now,
      }),
      db.prepare(
        `INSERT INTO mart_product_events (
           id, class_id, product_id, operation_id, revision, action,
           product_snapshot_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        context.classroom.id,
        productId,
        operationId,
        nextRevision,
        action,
        snapshot,
        now,
      ),
      db.prepare(
        `UPDATE mart_products
         SET name = ?, category = ?, description = ?, unit_price = ?,
             low_stock_threshold = ?, is_active = ?,
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND class_id = ? AND revision = ?`,
      ).bind(
        values.name,
        values.category,
        values.description,
        values.unitPrice,
        values.lowStockThreshold,
        values.isActive ? 1 : 0,
        now,
        productId,
        context.classroom.id,
        expectedRevision,
      ),
    ]);
  } catch (error) {
    const concurrent = await operationByKey(db, context.classroom.id, key);
    if (concurrent) {
      assertReplay(concurrent, "product_update", payloadHash, productId);
      const saved = await productById(db, context.classroom.id, productId);
      if (saved) return { product: serializeProduct(saved), deduplicated: true };
    }
    mapDatabaseError(error);
  }
  const saved = await productById(db, context.classroom.id, productId);
  if (!saved) throw new ApiError(500, "수정된 상품을 확인할 수 없습니다.", "MART_PRODUCT_UNAVAILABLE");
  return { product: serializeProduct(saved), deduplicated: false };
}

export async function martInventoryForRequest(request: Request) {
  const context = await martContextForRequest(request);
  assertManagerReader(context);
  const rows = await database().prepare(
    `${PRODUCT_SELECT}
     WHERE product.class_id = ?
     ORDER BY product.is_active DESC, product.name, product.id`,
  ).bind(context.classroom.id).all<ProductRow>();
  return {
    context: serializeContext(context),
    inventory: rows.results.map(serializeInventory),
  };
}

export async function createMartInventoryMovement(
  request: Request,
  input: {
    productId?: unknown;
    movementType?: unknown;
    quantity?: unknown;
    delta?: unknown;
    targetQuantity?: unknown;
    reason?: unknown;
    expectedInventoryRevision?: unknown;
    idempotencyKey?: unknown;
  },
) {
  const context = await martContextForRequest(request);
  assertMartOperator(context);
  let productId: string;
  let expectedInventoryRevision: number;
  let key: string;
  let values: ReturnType<typeof normalizeMartInventoryMovement>;
  try {
    productId = normalizeMartResourceId(input.productId, "상품 ID");
    expectedInventoryRevision = normalizeMartRevision(
      input.expectedInventoryRevision,
      "재고 revision",
    );
    key = normalizeMartIdempotencyKey(input.idempotencyKey);
    values = normalizeMartInventoryMovement(input);
  } catch (error) {
    ruleError(error);
  }
  if (values.movementType === "correction") assertMartTeacher(context);
  const operation = `inventory_${values.movementType}` as MartOperation;
  const movementId = crypto.randomUUID();
  const requestPayload = {
    productId,
    expectedInventoryRevision,
    ...values,
  };
  const payloadHash = await hashOperation(context, operation, requestPayload, null);
  const db = database();
  const duplicate = await operationByKey(db, context.classroom.id, key);
  if (duplicate) {
    assertReplay(duplicate, operation, payloadHash);
    const saved = await productById(db, context.classroom.id, productId);
    if (!saved) throw new ApiError(500, "변경된 재고를 확인할 수 없습니다.", "MART_INVENTORY_UNAVAILABLE");
    return {
      product: serializeProduct(saved),
      inventory: serializeInventory(saved),
      movementId: duplicate.resource_id,
      deduplicated: true,
    };
  }
  const current = await productById(db, context.classroom.id, productId);
  if (!current) throw new ApiError(404, "상품을 찾을 수 없습니다.", "MART_PRODUCT_NOT_FOUND");
  if (Number(current.inventory_revision) !== expectedInventoryRevision) {
    throw new ApiError(409, "재고가 먼저 변경되었습니다.", "MART_INVENTORY_STALE");
  }
  const movementDelta = values.movementType === "correction" && values.targetQuantity !== null
    ? values.targetQuantity - Number(current.quantity)
    : Number(values.delta);
  if (movementDelta === 0) {
    throw new ApiError(400, "현재 재고와 다른 수량을 입력해 주세요.", "MART_CORRECTION_NO_CHANGE");
  }
  const quantityAfter = Number(current.quantity) + movementDelta;
  if (quantityAfter < 0) {
    throw new ApiError(409, "재고가 부족합니다.", "MART_INVENTORY_SHORT");
  }
  if (quantityAfter > 1_000_000_000) {
    throw new ApiError(409, "재고 수량 한도를 넘었습니다.", "MART_QUANTITY_LIMIT");
  }
  const now = Date.now();
  const expectedClassRevision = await martClassRevision(db, context.classroom.id);
  const operationId = crypto.randomUUID();
  try {
    await db.batch([
      operationStatement(db, {
        operationId,
        classId: context.classroom.id,
        key,
        operation,
        resourceId: movementId,
        payloadHash,
        context,
        expectedClassRevision,
        interventionReason: values.reason,
        now,
      }),
      db.prepare(
        `INSERT INTO mart_inventory_movements (
           id, class_id, product_id, operation_id, movement_type, delta,
           quantity_before, quantity_after, inventory_revision_before,
           inventory_revision_after, source_sale_id, source_sale_item_id,
           reason, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
      ).bind(
        movementId,
        context.classroom.id,
        productId,
        operationId,
        values.movementType,
        movementDelta,
        current.quantity,
        quantityAfter,
        expectedInventoryRevision,
        expectedInventoryRevision + 1,
        values.reason || null,
        now,
      ),
    ]);
  } catch (error) {
    const concurrent = await operationByKey(db, context.classroom.id, key);
    if (concurrent) {
      assertReplay(concurrent, operation, payloadHash);
      const saved = await productById(db, context.classroom.id, productId);
      if (saved) return {
        product: serializeProduct(saved),
        inventory: serializeInventory(saved),
        movementId: concurrent.resource_id,
        deduplicated: true,
      };
    }
    mapDatabaseError(error);
  }
  const saved = await productById(db, context.classroom.id, productId);
  if (!saved) throw new ApiError(500, "변경된 재고를 확인할 수 없습니다.", "MART_INVENTORY_UNAVAILABLE");
  return {
    product: serializeProduct(saved),
    inventory: serializeInventory(saved),
    movementId,
    deduplicated: false,
  };
}

async function saleItems(db: D1Database, saleId: string) {
  return db.prepare(
    `SELECT id, sale_id, class_id, product_id, product_name_snapshot,
            unit_price_snapshot, quantity, line_total, created_at
     FROM mart_sale_items WHERE sale_id = ? ORDER BY product_name_snapshot, id`,
  ).bind(saleId).all<SaleItemRow>();
}

async function saleItemsForPage(
  db: D1Database,
  saleIds: readonly string[],
) {
  const itemsBySaleId = new Map<string, SaleItemRow[]>();
  for (const saleId of saleIds) itemsBySaleId.set(saleId, []);
  if (!saleIds.length) return itemsBySaleId;
  const placeholders = saleIds.map(() => "?").join(", ");
  const rows = await db.prepare(
    `SELECT id, sale_id, class_id, product_id, product_name_snapshot,
            unit_price_snapshot, quantity, line_total, created_at
     FROM mart_sale_items
     WHERE sale_id IN (${placeholders})
     ORDER BY sale_id, product_name_snapshot, id`,
  ).bind(...saleIds).all<SaleItemRow>();
  for (const item of rows.results) itemsBySaleId.get(item.sale_id)?.push(item);
  return itemsBySaleId;
}

function serializeSale(row: SaleRow, items: readonly SaleItemRow[]) {
  const receiptDate = new Date(Number(row.created_at) + 9 * 60 * 60 * 1_000)
    .toISOString().slice(0, 10).replaceAll("-", "");
  return {
    id: row.id,
    receiptNumber: `MART-${receiptDate}-${row.id.slice(0, 6).toUpperCase()}`,
    classId: row.class_id,
    buyer: {
      id: row.buyer_student_id,
      number: Number(row.buyer_student_number_snapshot),
      name: row.buyer_student_name_snapshot,
    },
    items: items.map((item) => ({
      id: item.id,
      productId: item.product_id,
      productName: item.product_name_snapshot,
      unitPrice: Number(item.unit_price_snapshot),
      quantity: Number(item.quantity),
      lineTotal: Number(item.line_total),
    })),
    totalAmount: Number(row.total_amount),
    totalQuantity: Number(row.total_quantity),
    status: row.status === "posted" ? "completed" : row.status,
    seller: {
      type: row.seller_actor_type === "teacher" ? "teacher" : "student",
      id: row.seller_actor_id,
      name: row.seller_actor_label,
    },
    revision: Number(row.revision),
    cancellation: row.status === "cancelled" ? {
      reason: row.cancelled_reason,
      cancelledAt: row.cancelled_at === null ? null : Number(row.cancelled_at),
      actorName: row.cancellation_actor_label ?? "담임교사",
    } : null,
    intervention: row.status === "cancelled"
      && row.cancelled_reason
      && row.cancellation_actor_type === "teacher"
      ? {
        kind: "teacher_emergency_correction" as const,
        reason: row.cancelled_reason,
        actorName: row.cancellation_actor_label ?? "담임교사",
        createdAt: row.cancelled_at === null ? Number(row.updated_at) : Number(row.cancelled_at),
      }
      : null,
    soldAt: Number(row.created_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

async function saleById(
  db: D1Database,
  classId: string,
  saleId: string,
  buyerStudentId?: string,
) {
  const row = await db.prepare(
    `${SALE_SELECT}
     WHERE sale.id = ? AND sale.class_id = ?
       ${buyerStudentId ? "AND sale.buyer_student_id = ?" : ""}
       AND sale.status IN ('posted', 'cancelled')
     LIMIT 1`,
  ).bind(saleId, classId, ...(buyerStudentId ? [buyerStudentId] : [])).first<SaleRow>();
  if (!row) return null;
  const itemRows = await saleItems(db, row.id);
  return serializeSale(row, itemRows.results);
}

export async function martSalesForRequest(request: Request) {
  const context = await martContextForRequest(request);
  const db = database();
  const ownOnly = !context.permissions.canViewAllSales;
  const query = parseMartSaleListQuery(
    new URL(request.url),
    `${context.classroom.id}:${ownOnly ? `student:${context.actor.id}` : "class"}`,
  );
  const where = [
    "sale.class_id = ?",
    "sale.status IN ('posted', 'cancelled')",
  ];
  const bindings: Array<string | number> = [context.classroom.id];
  if (ownOnly) {
    where.push("sale.buyer_student_id = ?");
    bindings.push(context.actor.id);
  }
  const storedStatus = martSaleStatusSql(query.status);
  if (storedStatus) {
    where.push("sale.status = ?");
    bindings.push(storedStatus);
  }
  if (query.fromEpochMs !== null) {
    where.push("sale.created_at >= ?");
    bindings.push(query.fromEpochMs);
  }
  if (query.toEpochMsExclusive !== null) {
    where.push("sale.created_at < ?");
    bindings.push(query.toEpochMsExclusive);
  }
  if (query.cursor) {
    where.push("(sale.created_at < ? OR (sale.created_at = ? AND sale.id < ?))");
    bindings.push(query.cursor.createdAt, query.cursor.createdAt, query.cursor.id);
  }
  const rows = await db.prepare(
    `${SALE_SELECT}
     WHERE ${where.join(" AND ")}
     ORDER BY sale.created_at DESC, sale.id DESC LIMIT ?`,
  ).bind(...bindings, query.limit + 1).all<SaleRow>();
  const hasMore = rows.results.length > query.limit;
  const pageRows = rows.results.slice(0, query.limit);
  const itemsBySaleId = await saleItemsForPage(
    db,
    pageRows.map((row) => row.id),
  );
  const sales = pageRows.map((row) => serializeSale(row, itemsBySaleId.get(row.id) ?? []));
  const last = pageRows.at(-1);
  return {
    context: serializeContext(context),
    sales,
    nextCursor: hasMore && last
      ? encodeMartSaleCursor({ createdAt: Number(last.created_at), id: last.id }, query)
      : null,
    hasMore,
  };
}

type MartSaleExportRow = {
  sale_id: string;
  buyer_student_number_snapshot: number;
  buyer_student_name_snapshot: string;
  status: "posted" | "cancelled";
  cancelled_reason: string | null;
  created_at: number;
  product_name_snapshot: string;
  quantity: number;
  line_total: number;
};

function exportWhere(query: MartSaleListQuery, classId: string) {
  const where = [
    "sale.class_id = ?",
    "sale.status IN ('posted', 'cancelled')",
  ];
  const bindings: Array<string | number> = [classId];
  const storedStatus = martSaleStatusSql(query.status);
  if (storedStatus) {
    where.push("sale.status = ?");
    bindings.push(storedStatus);
  }
  if (query.fromEpochMs !== null) {
    where.push("sale.created_at >= ?");
    bindings.push(query.fromEpochMs);
  }
  if (query.toEpochMsExclusive !== null) {
    where.push("sale.created_at < ?");
    bindings.push(query.toEpochMsExclusive);
  }
  return { where, bindings };
}

export async function martSalesCsvForRequest(request: Request) {
  const context = await martContextForRequest(request);
  if (context.role !== "teacher") {
    throw new ApiError(
      403,
      "전체 판매 기록 파일은 담임 선생님만 받을 수 있습니다.",
      "MART_SALES_EXPORT_TEACHER_REQUIRED",
    );
  }
  const url = new URL(request.url);
  // Export always starts at the beginning and includes the entire selected range.
  url.searchParams.delete("cursor");
  url.searchParams.delete("limit");
  const query = parseMartSaleListQuery(url, `${context.classroom.id}:teacher-export`);
  const { where, bindings } = exportWhere(query, context.classroom.id);
  const result = await database().prepare(
    `SELECT sale.id AS sale_id,
            sale.buyer_student_number_snapshot,
            sale.buyer_student_name_snapshot,
            sale.status,
            sale.cancelled_reason,
            sale.created_at,
            item.product_name_snapshot,
            item.quantity,
            item.line_total
       FROM mart_sales sale
       JOIN mart_sale_items item
         ON item.sale_id = sale.id AND item.class_id = sale.class_id
      WHERE ${where.join(" AND ")}
      ORDER BY sale.created_at DESC, sale.id DESC,
               item.product_name_snapshot, item.id
      LIMIT ?`,
  ).bind(...bindings, MART_SALES_EXPORT_MAX_ROWS + 1).all<MartSaleExportRow>();
  if (result.results.length > MART_SALES_EXPORT_MAX_ROWS) {
    throw new ApiError(
      413,
      "내보낼 기록이 너무 많습니다. 시작일과 종료일을 나눠서 받아 주세요.",
      "MART_SALES_EXPORT_TOO_LARGE",
    );
  }
  const sales = [] as Array<{
    buyer: { number: number; name: string };
    items: Array<{ productName: string; quantity: number; lineTotal: number }>;
    status: "completed" | "cancelled";
    cancellation: null | { reason: string | null };
    soldAt: number;
  }>;
  let currentSaleId: string | null = null;
  for (const row of result.results) {
    let sale = sales.at(-1);
    if (!sale || currentSaleId !== row.sale_id) {
      sale = {
        buyer: {
          number: Number(row.buyer_student_number_snapshot),
          name: row.buyer_student_name_snapshot,
        },
        items: [],
        status: row.status === "posted" ? "completed" : "cancelled",
        cancellation: row.status === "cancelled"
          ? { reason: row.cancelled_reason }
          : null,
        soldAt: Number(row.created_at),
      };
      sales.push(sale);
      currentSaleId = row.sale_id;
    }
    sale.items.push({
      productName: row.product_name_snapshot,
      quantity: Number(row.quantity),
      lineTotal: Number(row.line_total),
    });
  }
  return buildMartSalesCsv(sales);
}

export async function createMartSale(
  request: Request,
  input: {
    buyerStudentId?: unknown;
    items?: unknown;
    expectedContextRevision?: unknown;
    idempotencyKey?: unknown;
  },
) {
  const context = await martContextForRequest(request);
  assertMartOperator(context);
  let buyerStudentId: string;
  let items: ReturnType<typeof normalizeMartSaleItems>;
  let expectedContextRevision: number;
  let key: string;
  try {
    buyerStudentId = normalizeMartResourceId(input.buyerStudentId, "구매 학생 ID");
    items = normalizeMartSaleItems(input.items);
    expectedContextRevision = normalizeMartRevision(
      input.expectedContextRevision,
      "마트 revision",
    );
    key = normalizeMartIdempotencyKey(input.idempotencyKey);
  } catch (error) {
    ruleError(error);
  }
  const requestPayload = { buyerStudentId, items, expectedContextRevision };
  const payloadHash = await hashOperation(context, "sale_create", requestPayload, null);
  const db = database();
  const duplicate = await operationByKey(db, context.classroom.id, key);
  if (duplicate) {
    assertReplay(duplicate, "sale_create", payloadHash);
    const saved = await saleById(db, context.classroom.id, duplicate.resource_id);
    if (!saved) throw new ApiError(500, "완료된 판매를 확인할 수 없습니다.", "MART_SALE_UNAVAILABLE");
    return { sale: saved, deduplicated: true };
  }
  const currentContextRevision = await martClassRevision(db, context.classroom.id);
  if (currentContextRevision !== expectedContextRevision) {
    throw new ApiError(
      409,
      "마트 기록이 먼저 변경되었습니다. 최신 내용을 확인해 주세요.",
      "MART_STALE",
    );
  }
  const buyer = await db.prepare(
    `SELECT id, student_number, official_name, status FROM students
     WHERE id = ? AND class_id = ? AND status <> 'excluded' LIMIT 1`,
  ).bind(buyerStudentId, context.classroom.id).first<StudentRow>();
  if (!buyer) {
    throw new ApiError(404, "우리 반 학생을 선택해 주세요.", "MART_BUYER_NOT_FOUND");
  }
  const placeholders = items.map(() => "?").join(", ");
  const productRows = await db.prepare(
    `${PRODUCT_SELECT}
     WHERE product.class_id = ? AND product.id IN (${placeholders})`,
  ).bind(context.classroom.id, ...items.map((item) => item.productId)).all<ProductRow>();
  const productMap = new Map(productRows.results.map((row) => [row.id, row]));
  const saleLines = items.map((item) => {
    const product = productMap.get(item.productId);
    if (!product) throw new ApiError(404, "판매할 상품을 찾을 수 없습니다.", "MART_PRODUCT_NOT_FOUND");
    if (!product.is_active) {
      throw new ApiError(409, `${product.name}은 현재 판매하지 않습니다.`, "MART_PRODUCT_INACTIVE");
    }
    if (Number(product.revision) !== item.expectedProductRevision) {
      throw new ApiError(409, `${product.name}의 가격이나 상태가 변경되었습니다.`, "MART_PRODUCT_STALE");
    }
    if (Number(product.inventory_revision) !== item.expectedInventoryRevision) {
      throw new ApiError(409, `${product.name}의 재고가 변경되었습니다.`, "MART_INVENTORY_STALE");
    }
    if (Number(product.quantity) < item.quantity) {
      throw new ApiError(409, `${product.name}의 재고가 부족합니다.`, "MART_INVENTORY_SHORT");
    }
    return { input: item, product, unitPrice: Number(product.unit_price) };
  });
  let totals: ReturnType<typeof checkedMartTotal>;
  try {
    totals = checkedMartTotal(saleLines.map((line) => ({
      unitPrice: line.unitPrice,
      quantity: line.input.quantity,
    })));
  } catch (error) {
    ruleError(error);
  }
  const now = Date.now();
  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    operationStatement(db, {
      operationId,
      classId: context.classroom.id,
      key,
      operation: "sale_create",
      resourceId: saleId,
      payloadHash,
      context,
      expectedClassRevision: expectedContextRevision,
      now,
    }),
    db.prepare(
      `INSERT INTO mart_sales (
         id, class_id, buyer_student_id, buyer_student_number_snapshot,
         buyer_student_name_snapshot, total_amount, total_quantity, status,
         revision, created_operation_id, cancelled_operation_id,
         cancelled_reason, created_at, cancelled_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'building', 0, ?, NULL, NULL, ?, NULL, ?)`,
    ).bind(
      saleId,
      context.classroom.id,
      buyer.id,
      buyer.student_number,
      buyer.official_name,
      totals.totalAmount,
      totals.totalQuantity,
      operationId,
      now,
      now,
    ),
  ];
  for (const line of saleLines) {
    const itemId = crypto.randomUUID();
    const movementId = crypto.randomUUID();
    const quantityAfter = Number(line.product.quantity) - line.input.quantity;
    statements.push(
      db.prepare(
        `INSERT INTO mart_sale_items (
           id, sale_id, class_id, product_id, product_name_snapshot,
           unit_price_snapshot, quantity, line_total, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        itemId,
        saleId,
        context.classroom.id,
        line.product.id,
        line.product.name,
        line.unitPrice,
        line.input.quantity,
        line.unitPrice * line.input.quantity,
        now,
      ),
      db.prepare(
        `INSERT INTO mart_inventory_movements (
           id, class_id, product_id, operation_id, movement_type, delta,
           quantity_before, quantity_after, inventory_revision_before,
           inventory_revision_after, source_sale_id, source_sale_item_id,
           reason, created_at
         ) VALUES (?, ?, ?, ?, 'sale', ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      ).bind(
        movementId,
        context.classroom.id,
        line.product.id,
        operationId,
        -line.input.quantity,
        line.product.quantity,
        quantityAfter,
        line.input.expectedInventoryRevision,
        line.input.expectedInventoryRevision + 1,
        saleId,
        itemId,
        now,
      ),
    );
  }
  statements.push(
    db.prepare(
      `UPDATE mart_sales SET status = 'posted', updated_at = ?
       WHERE id = ? AND class_id = ? AND status = 'building'`,
    ).bind(now, saleId, context.classroom.id),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    const concurrent = await operationByKey(db, context.classroom.id, key);
    if (concurrent) {
      assertReplay(concurrent, "sale_create", payloadHash);
      const saved = await saleById(db, context.classroom.id, concurrent.resource_id);
      if (saved) return { sale: saved, deduplicated: true };
    }
    mapDatabaseError(error);
  }
  const saved = await saleById(db, context.classroom.id, saleId);
  if (!saved) throw new ApiError(500, "완료된 판매를 확인할 수 없습니다.", "MART_SALE_UNAVAILABLE");
  return { sale: saved, deduplicated: false };
}

export async function cancelMartSale(
  request: Request,
  saleIdValue: unknown,
  input: {
    expectedRevision?: unknown;
    reason?: unknown;
    idempotencyKey?: unknown;
  },
) {
  const context = await martContextForRequest(request);
  assertMartOperator(context);
  let saleId: string;
  let values: ReturnType<typeof normalizeMartCancellation>;
  let key: string;
  try {
    saleId = normalizeMartResourceId(saleIdValue, "판매 ID");
    values = normalizeMartCancellation(input);
    key = normalizeMartIdempotencyKey(input.idempotencyKey);
  } catch (error) {
    ruleError(error);
  }
  const payloadHash = await hashOperation(
    context,
    "sale_cancel",
    values,
    saleId,
  );
  const db = database();
  const duplicate = await operationByKey(db, context.classroom.id, key);
  if (duplicate) {
    assertReplay(duplicate, "sale_cancel", payloadHash, saleId);
    const saved = await saleById(db, context.classroom.id, saleId);
    if (!saved) throw new ApiError(500, "취소된 판매를 확인할 수 없습니다.", "MART_SALE_UNAVAILABLE");
    return { sale: saved, deduplicated: true };
  }
  const saleRow = await db.prepare(
    `${SALE_SELECT}
     WHERE sale.id = ? AND sale.class_id = ? LIMIT 1`,
  ).bind(saleId, context.classroom.id).first<SaleRow>();
  if (!saleRow) throw new ApiError(404, "판매 기록을 찾을 수 없습니다.", "MART_SALE_NOT_FOUND");
  if (saleRow.status !== "posted") {
    throw new ApiError(409, "이미 취소된 판매입니다.", "MART_SALE_ALREADY_CANCELLED");
  }
  if (Number(saleRow.revision) !== values.expectedRevision) {
    throw new ApiError(409, "판매 상태가 먼저 변경되었습니다.", "MART_SALE_STALE");
  }
  const itemRows = await saleItems(db, saleId);
  if (!itemRows.results.length) {
    throw new ApiError(409, "판매 상품 기록을 확인할 수 없습니다.", "MART_SALE_INVALID");
  }
  const placeholders = itemRows.results.map(() => "?").join(", ");
  const inventoryRows = await db.prepare(
    `${PRODUCT_SELECT}
     WHERE product.class_id = ? AND product.id IN (${placeholders})`,
  ).bind(
    context.classroom.id,
    ...itemRows.results.map((item) => item.product_id),
  ).all<ProductRow>();
  const inventoryMap = new Map(inventoryRows.results.map((row) => [row.id, row]));
  const now = Date.now();
  const expectedClassRevision = await martClassRevision(db, context.classroom.id);
  const operationId = crypto.randomUUID();
  const cancellationId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    operationStatement(db, {
      operationId,
      classId: context.classroom.id,
      key,
      operation: "sale_cancel",
      resourceId: saleId,
      payloadHash,
      context,
      expectedClassRevision,
      interventionReason: values.reason,
      now,
    }),
    db.prepare(
      `INSERT INTO mart_sale_cancellations (
         id, class_id, sale_id, operation_id, expected_sale_revision,
         reason, cancelled_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      cancellationId,
      context.classroom.id,
      saleId,
      operationId,
      values.expectedRevision,
      values.reason,
      now,
      now,
    ),
  ];
  for (const item of itemRows.results) {
    const inventory = inventoryMap.get(item.product_id);
    if (!inventory) {
      throw new ApiError(409, "복구할 상품 재고를 찾을 수 없습니다.", "MART_INVENTORY_UNAVAILABLE");
    }
    const quantityAfter = Number(inventory.quantity) + Number(item.quantity);
    if (quantityAfter > 1_000_000_000) {
      throw new ApiError(409, "재고 수량 한도를 넘습니다.", "MART_QUANTITY_LIMIT");
    }
    statements.push(
      db.prepare(
        `INSERT INTO mart_inventory_movements (
           id, class_id, product_id, operation_id, movement_type, delta,
           quantity_before, quantity_after, inventory_revision_before,
           inventory_revision_after, source_sale_id, source_sale_item_id,
           reason, created_at
         ) VALUES (?, ?, ?, ?, 'sale_cancel', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        context.classroom.id,
        item.product_id,
        operationId,
        item.quantity,
        inventory.quantity,
        quantityAfter,
        inventory.inventory_revision,
        Number(inventory.inventory_revision) + 1,
        saleId,
        item.id,
        values.reason,
        now,
      ),
    );
  }
  statements.push(
    db.prepare(
      `UPDATE mart_sales
       SET status = 'cancelled', revision = revision + 1,
           cancelled_operation_id = ?, cancelled_reason = ?,
           cancelled_at = ?, updated_at = ?
       WHERE id = ? AND class_id = ? AND status = 'posted' AND revision = ?`,
    ).bind(
      operationId,
      values.reason,
      now,
      now,
      saleId,
      context.classroom.id,
      values.expectedRevision,
    ),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    const concurrent = await operationByKey(db, context.classroom.id, key);
    if (concurrent) {
      assertReplay(concurrent, "sale_cancel", payloadHash, saleId);
      const saved = await saleById(db, context.classroom.id, saleId);
      if (saved) return { sale: saved, deduplicated: true };
    }
    mapDatabaseError(error);
  }
  const saved = await saleById(db, context.classroom.id, saleId);
  if (!saved) throw new ApiError(500, "취소된 판매를 확인할 수 없습니다.", "MART_SALE_UNAVAILABLE");
  return { sale: saved, deduplicated: false };
}

export async function martStudentsForRequest(request: Request) {
  const context = await martContextForRequest(request);
  assertManagerReader(context);
  const rows = await database().prepare(
    `SELECT id, student_number, official_name, status FROM students
     WHERE class_id = ? AND status <> 'excluded'
     ORDER BY student_number, id`,
  ).bind(context.classroom.id).all<StudentRow>();
  return {
    context: serializeContext(context),
    students: rows.results.map((student) => ({
      id: student.id,
      number: Number(student.student_number),
      name: student.official_name,
      status: student.status,
    })),
  };
}

export async function martAuditForRequest(request: Request) {
  const context = await martContextForRequest(request);
  assertMartAuditReader(context);
  const url = new URL(request.url);
  const auditQuery = parseAuditHistoryQuery(
    url,
    `${context.classroom.id}:${context.role}:${context.actor.type}:${context.actor.id}`,
  );
  const conditions = ["operation.class_id = ?"];
  const bindings: Array<string | number> = [context.classroom.id];
  if (auditQuery.fromEpochMs !== null) {
    conditions.push("operation.created_at >= ?");
    bindings.push(auditQuery.fromEpochMs);
  }
  if (auditQuery.toEpochMsExclusive !== null) {
    conditions.push("operation.created_at < ?");
    bindings.push(auditQuery.toEpochMsExclusive);
  }
  if (auditQuery.cursor) {
    conditions.push("(operation.created_at < ? OR (operation.created_at = ? AND operation.id < ?))");
    bindings.push(
      auditQuery.cursor.createdAt,
      auditQuery.cursor.createdAt,
      auditQuery.cursor.sortKey,
    );
  }
  bindings.push(auditQuery.limit + 1);
  const rows = await database().prepare(
    `SELECT operation.id, operation.operation, operation.resource_id,
            operation.actor_type, operation.actor_label,
            operation.intervention_reason,
            operation.created_at,
            COALESCE(
              (SELECT product.name FROM mart_products product
               WHERE product.id = operation.resource_id
                 AND product.class_id = operation.class_id LIMIT 1),
              (SELECT product.name
               FROM mart_inventory_movements movement
               JOIN mart_products product
                 ON product.id = movement.product_id
                AND product.class_id = movement.class_id
               WHERE movement.operation_id = operation.id LIMIT 1)
            ) AS product_name,
            (SELECT movement.product_id FROM mart_inventory_movements movement
             WHERE movement.operation_id = operation.id LIMIT 1) AS movement_product_id,
            (SELECT COALESCE(SUM(movement.delta), 0)
             FROM mart_inventory_movements movement
             WHERE movement.operation_id = operation.id) AS inventory_delta,
            (SELECT sale.buyer_student_name_snapshot FROM mart_sales sale
             WHERE sale.id = operation.resource_id
               AND sale.class_id = operation.class_id LIMIT 1) AS buyer_name,
            (SELECT sale.total_amount FROM mart_sales sale
             WHERE sale.id = operation.resource_id
               AND sale.class_id = operation.class_id LIMIT 1) AS sale_total
     FROM mart_operations operation
     WHERE ${conditions.join(" AND ")}
     ORDER BY operation.created_at DESC, operation.id DESC LIMIT ?`,
  ).bind(...bindings).all<Record<string, string | number | null>>();
  const hasMore = rows.results.length > auditQuery.limit;
  const pageRows = rows.results.slice(0, auditQuery.limit);
  const last = pageRows.at(-1);
  return {
    context: serializeContext(context),
    events: pageRows.map((row) => ({
      id: String(row.id),
      operation: String(row.operation),
      resourceId: String(row.resource_id),
      actor: {
        type: String(row.actor_type),
        label: String(row.actor_label),
      },
      interventionReason: row.intervention_reason,
      productName: row.product_name,
      movementProductId: row.movement_product_id,
      inventoryDelta: Number(row.inventory_delta ?? 0),
      buyerName: row.buyer_name,
      saleTotal: row.sale_total === null ? null : Number(row.sale_total),
      createdAt: Number(row.created_at),
    })),
    nextCursor: hasMore && last
      ? encodeAuditHistoryCursor({
        createdAt: Number(last.created_at),
        sortKey: String(last.id),
      }, auditQuery)
      : null,
    hasMore,
  };
}

export async function martStatisticsForRequest(request: Request) {
  const context = await martContextForRequest(request);
  if (!context.permissions.canViewStatistics) {
    throw new ApiError(403, "마트 통계를 볼 권한이 없습니다.", "MART_STATISTICS_ACCESS_DENIED");
  }
  const db = database();
  const url = new URL(request.url);
  const seoulToday = new Date(Date.now() + 9 * 60 * 60 * 1_000)
    .toISOString().slice(0, 10);
  const date = url.searchParams.get("date")?.trim() || seoulToday;
  const start = Date.parse(`${date}T00:00:00+09:00`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !Number.isFinite(start)
    || new Date(start + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10) !== date
  ) {
    throw new ApiError(400, "통계를 볼 날짜를 다시 확인해 주세요.", "MART_INVALID_DATE");
  }
  const end = start + 24 * 60 * 60 * 1_000;
  const summary = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM mart_sales
        WHERE class_id = ? AND status = 'posted'
          AND created_at >= ? AND created_at < ?) AS posted_sales,
       (SELECT COALESCE(SUM(total_amount), 0) FROM mart_sales
        WHERE class_id = ? AND status = 'posted'
          AND created_at >= ? AND created_at < ?) AS posted_amount,
       (SELECT COALESCE(SUM(total_quantity), 0) FROM mart_sales
        WHERE class_id = ? AND status = 'posted'
          AND created_at >= ? AND created_at < ?) AS posted_units,
       (SELECT COUNT(*) FROM mart_sales
        WHERE class_id = ? AND status = 'cancelled'
          AND cancelled_at >= ? AND cancelled_at < ?) AS cancelled_sales,
       (SELECT COUNT(*)
        FROM mart_products product
        JOIN mart_inventory inventory ON inventory.product_id = product.id
        WHERE product.class_id = ? AND product.is_active = 1
          AND inventory.quantity <= product.low_stock_threshold) AS low_stock_count`,
  ).bind(
    context.classroom.id, start, end,
    context.classroom.id, start, end,
    context.classroom.id, start, end,
    context.classroom.id, start, end,
    context.classroom.id,
  ).first<Record<string, number>>();
  const products = await db.prepare(
    `SELECT product.id, product.name,
            SUM(item.quantity) AS sold_units,
            SUM(item.line_total) AS sold_amount
     FROM mart_products product
     JOIN mart_sale_items item ON item.product_id = product.id
     JOIN mart_sales sale ON sale.id = item.sale_id
     WHERE product.class_id = ? AND sale.class_id = product.class_id
       AND sale.status = 'posted'
       AND sale.created_at >= ? AND sale.created_at < ?
     GROUP BY product.id
     ORDER BY sold_units DESC, sold_amount DESC, product.name`,
  ).bind(context.classroom.id, start, end).all<Record<string, string | number>>();
  const completedSaleCount = Number(summary?.posted_sales ?? 0);
  const cancelledSaleCount = Number(summary?.cancelled_sales ?? 0);
  const itemsSold = Number(summary?.posted_units ?? 0);
  const salesAmount = Number(summary?.posted_amount ?? 0);
  const lowStockCount = Number(summary?.low_stock_count ?? 0);
  return {
    context: serializeContext(context),
    date,
    period: "today" as const,
    completedSaleCount,
    cancelledSaleCount,
    itemsSold,
    salesAmount,
    lowStockCount,
    summary: {
      postedSales: completedSaleCount,
      postedAmount: salesAmount,
      postedUnits: itemsSold,
      cancelledSales: cancelledSaleCount,
      lowStockCount,
    },
    products: products.results.map((product) => ({
      productId: String(product.id),
      productName: String(product.name),
      quantity: Number(product.sold_units),
      salesAmount: Number(product.sold_amount),
    })),
  };
}
