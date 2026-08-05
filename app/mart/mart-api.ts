export { buildMartSalesCsv } from "@/lib/mart-history";

export const MART_LOW_STOCK_THRESHOLD = 2;

export type MartRole = "teacher" | "market_clerk" | "student";

export type MartStudent = {
  id: string;
  number: number;
  name: string;
  status: "pending" | "active" | "locked" | "reset_required" | "excluded";
};

export type MartContext = {
  actor: {
    type: "teacher" | "student";
    id: string;
    name: string;
  };
  classroom: {
    id: string;
    name: string;
    schoolName: string;
    grade: number;
    classNumber: number;
    status: "active" | "archived";
  };
  role: MartRole;
  permissions: {
    canOperate: boolean;
    canManageProducts: boolean;
    canAdjustInventory: boolean;
    canCancelSales: boolean;
    canViewStatistics: boolean;
    canEmergencyCorrect: boolean;
  };
  currency: {
    name: string;
    unit: string;
    denominations: number[];
  };
  students: MartStudent[];
  activeJob: null | {
    id: string;
    name: string;
    assignmentYear: number;
    assignmentMonth: number;
  };
  revision: number;
};

export type MartProduct = {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number;
  isActive: boolean;
  lowStockThreshold: number;
  revision: number;
  updatedAt: number;
};

export type MartInventory = {
  productId: string;
  onHand: number;
  revision: number;
  updatedAt: number;
};

export type MartSaleStatus = "completed" | "cancelled";

export type MartSaleItem = {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type MartSale = {
  id: string;
  receiptNumber: string;
  status: MartSaleStatus;
  buyer: { id: string; number: number; name: string };
  seller: { type: "teacher" | "student"; id: string; name: string };
  items: MartSaleItem[];
  totalAmount: number;
  revision: number;
  soldAt: number;
  cancellation: null | {
    reason: string;
    cancelledAt: number;
    actorName: string;
  };
  intervention: null | {
    kind: "teacher_emergency_correction" | "inventory_correction";
    reason: string;
    actorName: string;
    createdAt: number;
  };
};

export type MartProductStatistic = {
  productId: string;
  productName: string;
  quantity: number;
  salesAmount: number;
};

export type MartStatistics = {
  date: string;
  period: "today" | "all";
  completedSaleCount: number;
  cancelledSaleCount: number;
  itemsSold: number;
  salesAmount: number;
  lowStockCount: number;
  products: MartProductStatistic[];
};

export type MartAuditEvent = {
  id: string;
  operation: string;
  resourceId: string;
  actor: {
    type: string;
    label: string;
  };
  interventionReason: string | null;
  productName: string | null;
  movementProductId: string | null;
  inventoryDelta: number;
  buyerName: string | null;
  saleTotal: number | null;
  createdAt: number;
};

export type MartDashboard = {
  context: MartContext;
  products: MartProduct[];
  inventory: MartInventory[];
  sales: MartSale[];
  salesNextCursor: string | null;
  statistics: MartStatistics | null;
  audit: MartAuditEvent[];
  auditNextCursor: string | null;
};

export type MartAuditPage = {
  events: MartAuditEvent[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type MartSalesFilters = {
  status?: "all" | "completed" | "cancelled";
  from?: string;
  to?: string;
};

export type MartSalesPage = {
  sales: MartSale[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type MartCartLine = {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  available: number;
  productRevision: number;
  inventoryRevision: number;
  hasShortage: boolean;
};

export type MartCartSummary = {
  lines: MartCartLine[];
  itemCount: number;
  totalAmount: number;
  hasShortage: boolean;
};

export type MartSaleRequest = {
  classId: string;
  buyerStudentId: string;
  idempotencyKey: string;
  expectedContextRevision: number;
  items: Array<{
    productId: string;
    quantity: number;
    expectedProductRevision: number;
    expectedInventoryRevision: number;
  }>;
};

export type MartProductInput = {
  classId: string;
  productId?: string;
  name: string;
  category: string;
  description: string;
  price: number;
  lowStockThreshold: number;
  isActive: boolean;
  expectedRevision?: number;
  idempotencyKey: string;
};

export type MartInventoryInput = {
  classId: string;
  productId: string;
  operation: "receive" | "outbound" | "correct";
  quantity: number;
  currentQuantity: number;
  reason: string;
  expectedRevision: number;
  idempotencyKey: string;
};

export type MartCancelSaleInput = {
  classId: string;
  saleId: string;
  reason: string;
  expectedRevision: number;
  idempotencyKey: string;
};

type ErrorPayload = {
  code?: string;
  error?: string;
  message?: string;
  details?: unknown;
};

export class MartApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, payload: ErrorPayload = {}) {
    super(payload.error || payload.message || "마트 요청을 처리하지 못했습니다.");
    this.name = "MartApiError";
    this.status = status;
    this.code = payload.code || "MART_REQUEST_FAILED";
    this.details = payload.details;
  }
}

function safeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function addMoney(left: number, right: number) {
  const total = left + right;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError("cart total exceeds the supported range");
  }
  return total;
}

export function calculateMartCart(
  products: readonly MartProduct[],
  inventory: readonly MartInventory[],
  quantities: Readonly<Record<string, number>>,
): MartCartSummary {
  const inventoryByProduct = new Map(inventory.map((row) => [row.productId, row]));
  const lines: MartCartLine[] = [];
  let itemCount = 0;
  let totalAmount = 0;

  for (const product of products) {
    const quantity = quantities[product.id] ?? 0;
    if (quantity === 0) continue;
    safeInteger(quantity, "cart quantity");
    safeInteger(product.price, "product price");
    const stock = inventoryByProduct.get(product.id);
    const available = safeInteger(stock?.onHand ?? 0, "inventory on hand");
    const lineTotal = product.price * quantity;
    if (!Number.isSafeInteger(lineTotal) || lineTotal < 0) {
      throw new RangeError("cart line total exceeds the supported range");
    }
    itemCount = addMoney(itemCount, quantity);
    totalAmount = addMoney(totalAmount, lineTotal);
    lines.push({
      productId: product.id,
      name: product.name,
      unitPrice: product.price,
      quantity,
      lineTotal,
      available,
      productRevision: product.revision,
      inventoryRevision: stock?.revision ?? 0,
      hasShortage: quantity > available,
    });
  }

  return {
    lines,
    itemCount,
    totalAmount,
    hasShortage: lines.some((line) => line.hasShortage),
  };
}

export function buildMartSaleRequest(input: {
  classId: string;
  buyerStudentId: string;
  idempotencyKey: string;
  expectedContextRevision: number;
  cart: MartCartSummary;
}): MartSaleRequest {
  if (!input.classId.trim() || !input.buyerStudentId.trim()) {
    throw new RangeError("class and buyer are required");
  }
  if (!input.idempotencyKey.trim() || input.cart.lines.length === 0) {
    throw new RangeError("idempotency key and cart lines are required");
  }
  if (input.cart.hasShortage) {
    throw new RangeError("cart contains an inventory shortage");
  }
  safeInteger(input.expectedContextRevision, "context revision");
  return {
    classId: input.classId,
    buyerStudentId: input.buyerStudentId,
    idempotencyKey: input.idempotencyKey,
    expectedContextRevision: input.expectedContextRevision,
    items: input.cart.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      expectedProductRevision: line.productRevision,
      expectedInventoryRevision: line.inventoryRevision,
    })),
  };
}

export function visibleMartSales(
  context: Pick<MartContext, "role" | "actor">,
  sales: readonly MartSale[],
) {
  return context.role === "student"
    ? sales.filter((sale) => sale.buyer.id === context.actor.id)
    : [...sales];
}

export function mergeMartSalesPages(
  current: readonly MartSale[],
  next: readonly MartSale[],
) {
  const salesById = new Map<string, MartSale>();
  for (const sale of current) salesById.set(sale.id, sale);
  for (const sale of next) salesById.set(sale.id, sale);
  return [...salesById.values()].sort((left, right) => (
    right.soldAt - left.soldAt || right.id.localeCompare(left.id)
  ));
}

export function mergeMartAuditPages(
  current: readonly MartAuditEvent[],
  next: readonly MartAuditEvent[],
) {
  const eventsById = new Map<string, MartAuditEvent>();
  for (const event of current) eventsById.set(event.id, event);
  for (const event of next) eventsById.set(event.id, event);
  return [...eventsById.values()].sort((left, right) => {
    const timeOrder = right.createdAt - left.createdAt;
    if (timeOrder) return timeOrder;
    return left.id === right.id ? 0 : left.id < right.id ? 1 : -1;
  });
}

export function martActionKey(prefix: string) {
  const randomPart = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `mart:${prefix}:${randomPart}`;
}

export function martErrorMessage(error: unknown) {
  if (!(error instanceof MartApiError)) {
    return error instanceof Error
      ? error.message
      : "저장하지 못했습니다. 연결을 확인한 뒤 같은 화면에서 다시 시도해 주세요.";
  }
  if (error.status === 401) return "로그인이 만료되었습니다. 다시 로그인해 주세요.";
  if (error.status === 403) return "현재는 이 작업을 맡은 선생님이나 마트 직원만 처리할 수 있어요.";
  if (error.code === "MART_INVENTORY_SHORT" || error.code === "MART_INSUFFICIENT_STOCK") {
    return "그 사이 재고가 부족해졌습니다. 최신 재고를 확인한 뒤 수량을 다시 정해 주세요.";
  }
  if (
    error.code === "MART_SALE_DUPLICATE"
    || error.code === "MART_DUPLICATE"
    || error.code === "MART_SALE_ALREADY_CANCELLED"
    || error.code === "MART_IDEMPOTENCY_CONFLICT"
  ) {
    return "같은 판매가 이미 접수되었습니다. 기록을 새로고침해 중복 여부를 확인해 주세요.";
  }
  if (
    error.code === "MART_STALE"
    || error.code === "MART_REVISION_STALE"
    || error.code.endsWith("_STALE")
  ) {
    return "다른 사람이 먼저 내용을 바꿨습니다. 입력은 그대로 두었으니 최신 정보를 확인해 주세요.";
  }
  return error.message || "저장하지 못했습니다. 입력은 유지되므로 잠시 뒤 다시 시도해 주세요.";
}

function query(classId: string) {
  return `?classId=${encodeURIComponent(classId)}`;
}

async function requestJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const data = await response.json().catch(() => ({})) as T & ErrorPayload;
  if (!response.ok) throw new MartApiError(response.status, data);
  return data;
}

type RawMartContext = {
  actor: MartContext["actor"];
  classroom: {
    id: string;
    name: string | null;
    schoolName: string;
    grade: number;
    classNumber: number;
    status: "active" | "archived";
  };
  role: MartRole;
  activeJob: MartContext["activeJob"];
  permissions: {
    canOperate: boolean;
    canEmergencyCorrect: boolean;
    canViewAllSales: boolean;
    canViewAudit: boolean;
    canViewStatistics: boolean;
  };
  currency: MartContext["currency"];
  students: Array<{
    id: string;
    number: number;
    name: string;
    status: string;
  }>;
  revision: number;
  physicalCashOnly: true;
  digitalFinanceUnaffected: true;
};

type RawMartProduct = {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number;
  unitPrice: number;
  lowStockThreshold: number;
  isActive: boolean;
  revision: number;
  inventory: {
    quantity: number;
    revision: number;
    updatedAt: number;
  };
  updatedAt: number;
};

type RawMartInventory = {
  productId: string;
  onHand: number;
  revision: number;
  updatedAt: number;
};

type RawMartSale = {
  id: string;
  receiptNumber?: string;
  buyer: MartSale["buyer"];
  seller?: MartSale["seller"];
  items: Array<MartSaleItem & { id?: string }>;
  totalAmount: number;
  status: "posted" | "completed" | "cancelled";
  revision: number;
  cancellation: null | {
    reason: string;
    cancelledAt: number | null;
    actorName?: string;
  };
  intervention?: MartSale["intervention"];
  soldAt?: number;
  createdAt: number;
  updatedAt: number;
};

type RawMartStatistics = MartStatistics & {
  summary?: Record<string, number>;
};

type RawMartAuditEvent = {
  id: string;
  operation: string;
  resourceId: string;
  actor: { type: string; label: string };
  interventionReason: string | null;
  productName: string | null;
  movementProductId: string | null;
  inventoryDelta: number;
  buyerName: string | null;
  saleTotal: number | null;
  createdAt: number;
};

function normalizeStudentStatus(status: string): MartStudent["status"] {
  return status === "pending"
    || status === "active"
    || status === "locked"
    || status === "reset_required"
    || status === "excluded"
    ? status
    : "pending";
}

function normalizeContext(raw: RawMartContext): MartContext {
  const className = raw.classroom.name
    || `${raw.classroom.grade}학년 ${raw.classroom.classNumber}반`;
  return {
    actor: raw.actor,
    classroom: {
      id: raw.classroom.id,
      name: className,
      schoolName: raw.classroom.schoolName,
      grade: raw.classroom.grade,
      classNumber: raw.classroom.classNumber,
      status: raw.classroom.status,
    },
    role: raw.role,
    permissions: {
      canOperate: raw.permissions.canOperate,
      canManageProducts: raw.permissions.canOperate,
      canAdjustInventory: raw.permissions.canOperate,
      canCancelSales: raw.permissions.canOperate,
      canViewStatistics: raw.permissions.canViewStatistics,
      canEmergencyCorrect: raw.permissions.canEmergencyCorrect,
    },
    currency: {
      name: raw.currency.name,
      unit: raw.currency.unit,
      denominations: [...raw.currency.denominations],
    },
    students: raw.students.map((student) => ({
      ...student,
      status: normalizeStudentStatus(student.status),
    })),
    activeJob: raw.activeJob,
    revision: Number(raw.revision),
  };
}

function normalizeProduct(raw: RawMartProduct): MartProduct {
  return {
    id: raw.id,
    name: raw.name,
    category: raw.category,
    description: raw.description,
    price: Number(raw.price ?? raw.unitPrice),
    isActive: Boolean(raw.isActive),
    lowStockThreshold: Number(raw.lowStockThreshold),
    revision: Number(raw.revision),
    updatedAt: Number(raw.updatedAt),
  };
}

function normalizeInventory(raw: RawMartInventory): MartInventory {
  return {
    productId: raw.productId,
    onHand: Number(raw.onHand),
    revision: Number(raw.revision),
    updatedAt: Number(raw.updatedAt),
  };
}

function normalizeSale(raw: RawMartSale): MartSale {
  return {
    id: raw.id,
    receiptNumber: raw.receiptNumber || `판매 ${raw.id.slice(0, 8)}`,
    status: raw.status === "cancelled" ? "cancelled" : "completed",
    buyer: raw.buyer,
    seller: raw.seller || { type: "student", id: "mart-operator", name: "마트 운영자" },
    items: raw.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      unitPrice: Number(item.unitPrice),
      quantity: Number(item.quantity),
      lineTotal: Number(item.lineTotal),
    })),
    totalAmount: Number(raw.totalAmount),
    revision: Number(raw.revision),
    soldAt: Number(raw.soldAt ?? raw.createdAt),
    cancellation: raw.cancellation ? {
      reason: raw.cancellation.reason,
      cancelledAt: Number(raw.cancellation.cancelledAt ?? raw.updatedAt),
      actorName: raw.cancellation.actorName || "마트 운영자",
    } : null,
    intervention: raw.intervention ?? null,
  };
}

async function context(classId: string | null, signal?: AbortSignal) {
  const suffix = classId ? query(classId) : "";
  return requestJson<RawMartContext>(`/api/mart/context${suffix}`, { signal });
}

async function products(classId: string, signal?: AbortSignal) {
  const payload = await requestJson<{ products: RawMartProduct[] }>(
    `/api/mart/products${query(classId)}`,
    { signal },
  );
  return payload.products;
}

async function inventory(classId: string, signal?: AbortSignal) {
  const payload = await requestJson<{ inventory: RawMartInventory[] }>(
    `/api/mart/inventory${query(classId)}`,
    { signal },
  );
  return payload.inventory;
}

export async function loadMartSalesPage(
  input: { classId: string; cursor?: string | null; limit?: number } & MartSalesFilters,
  signal?: AbortSignal,
): Promise<MartSalesPage> {
  const parameters = new URLSearchParams({ classId: input.classId });
  if (input.cursor) parameters.set("cursor", input.cursor);
  if (input.limit !== undefined) parameters.set("limit", String(input.limit));
  if (input.status && input.status !== "all") parameters.set("status", input.status);
  if (input.from) parameters.set("from", input.from);
  if (input.to) parameters.set("to", input.to);
  const payload = await requestJson<{
    sales: RawMartSale[];
    nextCursor?: string | null;
    hasMore?: boolean;
  }>(
    `/api/mart/sales?${parameters.toString()}`,
    { signal },
  );
  return {
    sales: payload.sales.map(normalizeSale),
    nextCursor: payload.nextCursor ?? null,
    hasMore: Boolean(payload.hasMore ?? payload.nextCursor),
  };
}

export function martSalesCsvUrl(classId: string, filters: MartSalesFilters = {}) {
  const parameters = new URLSearchParams({ classId });
  if (filters.status && filters.status !== "all") parameters.set("status", filters.status);
  if (filters.from) parameters.set("from", filters.from);
  if (filters.to) parameters.set("to", filters.to);
  return `/api/mart/sales/export?${parameters.toString()}`;
}

async function statistics(classId: string, signal?: AbortSignal) {
  const payload = await requestJson<RawMartStatistics>(
    `/api/mart/statistics${query(classId)}`,
    { signal },
  );
  return {
    date: payload.date,
    period: payload.period,
    completedSaleCount: Number(payload.completedSaleCount),
    cancelledSaleCount: Number(payload.cancelledSaleCount),
    itemsSold: Number(payload.itemsSold),
    salesAmount: Number(payload.salesAmount),
    lowStockCount: Number(payload.lowStockCount),
    products: payload.products.map((product) => ({
      productId: product.productId,
      productName: product.productName,
      quantity: Number(product.quantity),
      salesAmount: Number(product.salesAmount),
    })),
  } satisfies MartStatistics;
}

export async function loadMartAuditPage(
  input: {
    classId: string;
    cursor?: string | null;
    limit?: number;
    from?: string;
    to?: string;
  },
  signal?: AbortSignal,
): Promise<MartAuditPage> {
  const parameters = new URLSearchParams({ classId: input.classId });
  if (input.cursor) parameters.set("cursor", input.cursor);
  if (input.limit !== undefined) parameters.set("limit", String(input.limit));
  if (input.from) parameters.set("from", input.from);
  if (input.to) parameters.set("to", input.to);
  const payload = await requestJson<{
    events: RawMartAuditEvent[];
    nextCursor?: string | null;
    hasMore?: boolean;
  }>(
    `/api/mart/audit?${parameters.toString()}`,
    { signal },
  );
  return {
    events: payload.events.map((event): MartAuditEvent => ({ ...event })),
    nextCursor: payload.nextCursor ?? null,
    hasMore: Boolean(payload.hasMore ?? payload.nextCursor),
  };
}

export async function loadMartDashboard(
  requestedClassId: string | null,
  signal?: AbortSignal,
): Promise<MartDashboard> {
  const rawContext = await context(requestedClassId, signal);
  const classId = rawContext.classroom.id;
  if (rawContext.role === "student") {
    const martContext = normalizeContext(rawContext);
    const ownSalesPage = await loadMartSalesPage({ classId }, signal);
    return {
      context: martContext,
      products: [],
      inventory: [],
      sales: visibleMartSales(martContext, ownSalesPage.sales),
      salesNextCursor: ownSalesPage.nextCursor,
      statistics: null,
      audit: [],
      auditNextCursor: null,
    };
  }
  const [productRows, inventoryRows, salePage, statisticRows, auditPage] = await Promise.all([
    products(classId, signal),
    inventory(classId, signal),
    loadMartSalesPage({ classId }, signal),
    statistics(classId, signal),
    loadMartAuditPage({ classId }, signal),
  ]);
  const martContext = normalizeContext(rawContext);
  return {
    context: martContext,
    products: productRows.map(normalizeProduct),
    inventory: inventoryRows.map(normalizeInventory),
    sales: salePage.sales,
    salesNextCursor: salePage.nextCursor,
    statistics: statisticRows,
    audit: auditPage.events,
    auditNextCursor: auditPage.nextCursor,
  };
}

export async function createMartSale(input: MartSaleRequest) {
  const result = await requestJson<{ sale: RawMartSale; deduplicated: boolean }>(
    `/api/mart/sales${query(input.classId)}`,
    {
    method: "POST",
      body: JSON.stringify({
        buyerStudentId: input.buyerStudentId,
        expectedContextRevision: input.expectedContextRevision,
        idempotencyKey: input.idempotencyKey,
        items: input.items,
      }),
    },
  );
  return { sale: normalizeSale(result.sale), deduplicated: result.deduplicated };
}

export async function saveMartProduct(input: MartProductInput) {
  const endpoint = input.productId
    ? `/api/mart/products/${encodeURIComponent(input.productId)}${query(input.classId)}`
    : `/api/mart/products${query(input.classId)}`;
  const result = await requestJson<{ product: RawMartProduct; deduplicated: boolean }>(endpoint, {
    method: input.productId ? "PATCH" : "POST",
    body: JSON.stringify({
      name: input.name,
      category: input.category,
      description: input.description,
      unitPrice: input.price,
      lowStockThreshold: input.lowStockThreshold,
      isActive: input.isActive,
      ...(input.productId ? { expectedRevision: input.expectedRevision } : {}),
      idempotencyKey: input.idempotencyKey,
    }),
  });
  return { product: normalizeProduct(result.product), deduplicated: result.deduplicated };
}

export async function adjustMartInventory(input: MartInventoryInput) {
  const delta = input.quantity - input.currentQuantity;
  const result = await requestJson<{
    product: RawMartProduct;
    inventory: RawMartInventory;
    movementId: string;
    deduplicated: boolean;
  }>(`/api/mart/inventory/movements${query(input.classId)}`, {
    method: "POST",
    body: JSON.stringify({
      productId: input.productId,
      movementType: input.operation === "receive"
        ? "inbound"
        : input.operation === "outbound" ? "outbound" : "correction",
      ...(input.operation === "correct" ? { delta } : { quantity: input.quantity }),
      reason: input.reason,
      expectedInventoryRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
    }),
  });
  return {
    inventory: normalizeInventory(result.inventory),
    movementId: result.movementId,
    deduplicated: result.deduplicated,
  };
}

export async function cancelMartSale(input: MartCancelSaleInput) {
  const result = await requestJson<{ sale: RawMartSale; deduplicated: boolean }>(
    `/api/mart/sales/${encodeURIComponent(input.saleId)}/cancel${query(input.classId)}`,
    {
      method: "POST",
      body: JSON.stringify({
        expectedRevision: input.expectedRevision,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      }),
    },
  );
  return { sale: normalizeSale(result.sale), deduplicated: result.deduplicated };
}
