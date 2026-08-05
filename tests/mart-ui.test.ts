import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MART_SALES_EXPORT_MAX_ROWS } from "../lib/mart-history";
import {
  MartApiError,
  adjustMartInventory,
  buildMartSalesCsv,
  buildMartSaleRequest,
  calculateMartCart,
  cancelMartSale,
  createMartSale,
  loadMartAuditPage,
  loadMartDashboard,
  loadMartSalesPage,
  martErrorMessage,
  martSalesCsvUrl,
  mergeMartAuditPages,
  mergeMartSalesPages,
  saveMartProduct,
  visibleMartSales,
  type MartContext,
  type MartInventory,
  type MartProduct,
  type MartSale,
} from "../app/mart/mart-api";
import {
  allowedMartSections,
  martNavigationKey,
  resolveMartSection,
} from "../app/mart/mart-navigation";
import {
  encodeMartSaleCursor,
  parseMartSaleListQuery,
} from "../lib/mart-history";
import {
  encodeAuditHistoryCursor,
  parseAuditHistoryQuery,
} from "../lib/audit-history";

const products: MartProduct[] = [
  {
    id: "product-pencil",
    name: "연필",
    category: "문구",
    description: "문구 상품",
    price: 300,
    isActive: true,
    lowStockThreshold: 1,
    revision: 2,
    updatedAt: 10,
  },
  {
    id: "product-note",
    name: "공책",
    category: "문구",
    description: "문구 상품",
    price: 500,
    isActive: true,
    lowStockThreshold: 1,
    revision: 3,
    updatedAt: 10,
  },
];

const inventory: MartInventory[] = [
  { productId: "product-pencil", onHand: 3, revision: 4, updatedAt: 11 },
  { productId: "product-note", onHand: 0, revision: 5, updatedAt: 11 },
];

const studentContext: MartContext = {
  actor: { type: "student", id: "student-1", name: "학생1" },
  classroom: {
    id: "class-1",
    name: "테스트반",
    schoolName: "테스트초",
    grade: 5,
    classNumber: 1,
    status: "active",
  },
  role: "student",
  permissions: {
    canOperate: false,
    canManageProducts: false,
    canAdjustInventory: false,
    canCancelSales: false,
    canViewStatistics: false,
    canEmergencyCorrect: false,
  },
  currency: { name: "별", unit: "별", denominations: [1, 5, 10] },
  students: [],
  activeJob: null,
  revision: 7,
};

test("마트 역할이나 학급 상태가 바뀌면 허용된 첫 화면으로 안전하게 돌아간다", () => {
  const teacherContext: MartContext = {
    ...studentContext,
    actor: { type: "teacher", id: "teacher-1", name: "담임교사" },
    role: "teacher",
    permissions: {
      canOperate: true,
      canManageProducts: true,
      canAdjustInventory: true,
      canCancelSales: true,
      canViewStatistics: true,
      canEmergencyCorrect: true,
    },
  };
  const activeSections = allowedMartSections(teacherContext);
  assert.deepEqual(activeSections, ["sale", "products", "inventory", "records", "statistics"]);

  const studentSections = allowedMartSections(studentContext);
  assert.deepEqual(studentSections, ["records"]);
  assert.equal(resolveMartSection("sale", studentSections), "records");

  const archivedContext: MartContext = {
    ...teacherContext,
    classroom: { ...teacherContext.classroom, status: "archived" },
  };
  const archivedSections = allowedMartSections(archivedContext);
  assert.deepEqual(archivedSections, ["records", "statistics"]);
  assert.equal(resolveMartSection("inventory", archivedSections), "records");
  assert.notEqual(martNavigationKey(teacherContext), martNavigationKey(archivedContext));
  assert.notEqual(martNavigationKey(teacherContext), martNavigationKey(studentContext));
});

test("마트 판매 기록 필터는 터치 크기와 모션 감소 설정을 지킨다", async () => {
  const source = await readFile(new URL("../app/mart/MartPortal.module.css", import.meta.url), "utf8");
  assert.match(source, /\.segmentedButtons button\s*\{[^}]*min-height:\s*44px;/);
  assert.match(source, /\.historyFilters input\s*\{[^}]*min-height:\s*44px;/);
  assert.match(source, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.spin,[\s\S]*\.buttonSpinner\s*\{\s*animation:\s*none;/);
});

function sale(id: string, buyerId: string): MartSale {
  return {
    id,
    receiptNumber: id,
    status: "completed",
    buyer: { id: buyerId, number: buyerId === "student-1" ? 1 : 2, name: buyerId },
    seller: { type: "student", id: "clerk-1", name: "마트직원" },
    items: [{
      productId: "product-pencil",
      productName: "연필",
      unitPrice: 300,
      quantity: 1,
      lineTotal: 300,
    }],
    totalAmount: 300,
    revision: 1,
    soldAt: 100,
    cancellation: null,
    intervention: null,
  };
}

test("장바구니는 서버 요청 없이 가격과 재고 부족을 즉시 계산한다", () => {
  const cart = calculateMartCart(products, inventory, {
    "product-pencil": 2,
    "product-note": 1,
  });
  assert.equal(cart.itemCount, 3);
  assert.equal(cart.totalAmount, 1_100);
  assert.equal(cart.hasShortage, true);
  assert.deepEqual(cart.lines.map((line) => ({
    id: line.productId,
    total: line.lineTotal,
    productRevision: line.productRevision,
    inventoryRevision: line.inventoryRevision,
    shortage: line.hasShortage,
  })), [
    { id: "product-pencil", total: 600, productRevision: 2, inventoryRevision: 4, shortage: false },
    { id: "product-note", total: 500, productRevision: 3, inventoryRevision: 5, shortage: true },
  ]);
});

test("판매 확정 요청에는 상품·수량·revision만 담고 디지털 금융 값은 보내지 않는다", () => {
  const cart = calculateMartCart(products, inventory, { "product-pencil": 2 });
  const request = buildMartSaleRequest({
    classId: "class-1",
    buyerStudentId: "student-1",
    idempotencyKey: "mart:sale:test",
    expectedContextRevision: 7,
    cart,
  });
  assert.deepEqual(request, {
    classId: "class-1",
    buyerStudentId: "student-1",
    idempotencyKey: "mart:sale:test",
    expectedContextRevision: 7,
    items: [{
      productId: "product-pencil",
      quantity: 2,
      expectedProductRevision: 2,
      expectedInventoryRevision: 4,
    }],
  });
  const serialized = JSON.stringify(request).toLowerCase();
  assert.equal(serialized.includes("balance"), false);
  assert.equal(serialized.includes("wallet"), false);
  assert.equal(serialized.includes("totalamount"), false);
  assert.throws(() => buildMartSaleRequest({
    classId: "class-1",
    buyerStudentId: "student-1",
    idempotencyKey: "mart:sale:short",
    expectedContextRevision: 7,
    cart: calculateMartCart(products, inventory, { "product-note": 1 }),
  }), /inventory shortage/);
});

test("일반 학생에게는 자신의 구매 기록만 남긴다", () => {
  const own = sale("sale-own", "student-1");
  const other = sale("sale-other", "student-2");
  assert.deepEqual(
    visibleMartSales(studentContext, [own, other]).map((row) => row.id),
    ["sale-own"],
  );
  assert.deepEqual(
    visibleMartSales({ ...studentContext, role: "teacher" }, [own, other]).map((row) => row.id),
    ["sale-own", "sale-other"],
  );
});

test("재고 부족·중복·오래된 화면 오류를 교실용 문구로 안내한다", () => {
  assert.match(martErrorMessage(new MartApiError(409, { code: "MART_INSUFFICIENT_STOCK" })), /재고가 부족/);
  assert.match(martErrorMessage(new MartApiError(409, { code: "MART_IDEMPOTENCY_CONFLICT" })), /이미 접수/);
  assert.match(martErrorMessage(new MartApiError(409, { code: "MART_INVENTORY_STALE" })), /입력은 그대로/);
});

test("교사용 판매 CSV는 UTF-8 BOM과 필수 기록 열을 포함한다", () => {
  assert.equal(MART_SALES_EXPORT_MAX_ROWS, 5_000);
  const csv = buildMartSalesCsv([sale("sale-csv", "student-1")]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /"학생명","상품","수량","금액","상태","취소사유","시간"/);
  assert.match(csv, /"1번 student-1","연필","1","300","판매 완료"/);
  assert.equal(csv.includes("wallet"), false);
  assert.equal(csv.includes("balance"), false);
});

test("판매 기록 커서는 학급·사용자 범위와 날짜·상태 조건에 묶인다", () => {
  const first = parseMartSaleListQuery(
    new URL("https://test.local/api/mart/sales?status=completed&from=2026-08-01&to=2026-08-05&limit=25"),
    "class-1:student:student-1",
  );
  assert.equal(first.limit, 25);
  assert.equal(first.fromEpochMs, Date.UTC(2026, 7, 1) - 9 * 60 * 60 * 1_000);
  assert.equal(first.toEpochMsExclusive, Date.UTC(2026, 7, 6) - 9 * 60 * 60 * 1_000);
  const cursor = encodeMartSaleCursor({ createdAt: 1_722_800_000_000, id: "sale-25" }, first);
  const next = parseMartSaleListQuery(
    new URL(`https://test.local/api/mart/sales?status=completed&from=2026-08-01&to=2026-08-05&limit=25&cursor=${encodeURIComponent(cursor)}`),
    "class-1:student:student-1",
  );
  assert.deepEqual(next.cursor, { createdAt: 1_722_800_000_000, id: "sale-25" });
  assert.throws(
    () => parseMartSaleListQuery(
      new URL(`https://test.local/api/mart/sales?status=cancelled&from=2026-08-01&to=2026-08-05&cursor=${encodeURIComponent(cursor)}`),
      "class-1:student:student-1",
    ),
    (error: unknown) => (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "MART_SALES_INVALID_CURSOR"
    ),
  );
  assert.throws(
    () => parseMartSaleListQuery(
      new URL(`https://test.local/api/mart/sales?status=completed&from=2026-08-01&to=2026-08-05&cursor=${encodeURIComponent(cursor)}`),
      "class-1:student:student-2",
    ),
    /판매 기록 목록 위치/,
  );
});

test("판매 기록 날짜·상태·페이지 크기는 서버가 엄격히 검증한다", () => {
  for (const url of [
    "https://test.local/api/mart/sales?status=unknown",
    "https://test.local/api/mart/sales?from=2026-02-30",
    "https://test.local/api/mart/sales?from=2026-08-05&to=2026-08-01",
    "https://test.local/api/mart/sales?limit=101",
    "https://test.local/api/mart/sales?cursor=not-a-valid-cursor",
  ]) {
    assert.throws(() => parseMartSaleListQuery(new URL(url), "class-1:class"));
  }
});

test("변경 기록 커서는 사용자·학급·기간에 묶이고 페이지 크기가 제한된다", () => {
  const first = parseAuditHistoryQuery(
    new URL("https://test.local/api/mart/audit?from=2026-08-01&to=2026-08-05&limit=25"),
    "class-1:teacher:teacher-1",
  );
  assert.equal(first.limit, 25);
  assert.equal(first.fromEpochMs, Date.UTC(2026, 7, 1) - 9 * 60 * 60 * 1_000);
  assert.equal(first.toEpochMsExclusive, Date.UTC(2026, 7, 6) - 9 * 60 * 60 * 1_000);
  const cursor = encodeAuditHistoryCursor(
    { createdAt: 1_722_800_000_000, sortKey: "record:event-25" },
    first,
  );
  const next = parseAuditHistoryQuery(
    new URL(`https://test.local/api/mart/audit?from=2026-08-01&to=2026-08-05&limit=25&cursor=${encodeURIComponent(cursor)}`),
    "class-1:teacher:teacher-1",
  );
  assert.deepEqual(next.cursor, {
    createdAt: 1_722_800_000_000,
    sortKey: "record:event-25",
  });
  assert.throws(
    () => parseAuditHistoryQuery(
      new URL(`https://test.local/api/mart/audit?from=2026-08-01&to=2026-08-05&cursor=${encodeURIComponent(cursor)}`),
      "class-2:teacher:teacher-1",
    ),
    /변경 기록 목록 위치/,
  );
  for (const url of [
    "https://test.local/api/mart/audit?from=2026-02-30",
    "https://test.local/api/mart/audit?from=2026-08-05&to=2026-08-01",
    "https://test.local/api/mart/audit?limit=101",
    "https://test.local/api/mart/audit?cursor=invalid!",
  ]) {
    assert.throws(() => parseAuditHistoryQuery(new URL(url), "class-1:teacher:teacher-1"));
  }
});

test("더 보기는 중복 판매를 하나로 합치고 최신순을 보존한다", () => {
  const first = { ...sale("sale-b", "student-1"), soldAt: 200 };
  const duplicate = { ...first, status: "cancelled" as const };
  const older = { ...sale("sale-a", "student-1"), soldAt: 100 };
  assert.deepEqual(
    mergeMartSalesPages([first], [duplicate, older]).map((row) => [row.id, row.status]),
    [["sale-b", "cancelled"], ["sale-a", "completed"]],
  );
});

test("변경 기록 더 보기는 중복을 제거하고 같은 시각에도 안정적인 순서를 보존한다", () => {
  const event = (id: string, createdAt: number) => ({
    id,
    operation: "inventory_inbound",
    resourceId: id,
    actor: { type: "teacher", label: "교사" },
    interventionReason: null,
    productName: "연필",
    movementProductId: "product-pencil",
    inventoryDelta: 1,
    buyerName: null,
    saleTotal: null,
    createdAt,
  });
  assert.deepEqual(
    mergeMartAuditPages(
      [event("event-b", 200), event("event-a", 200)],
      [event("event-b", 200), event("event-z", 100)],
    ).map((row) => row.id),
    ["event-b", "event-a", "event-z"],
  );
});

test("마트 변경 기록 페이지 요청은 불투명 커서와 학급 범위만 전달한다", async () => {
  const originalFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = (async (input: string | URL | Request) => {
    requested = String(input);
    return Response.json({ events: [], nextCursor: "next-audit", hasMore: true });
  }) as typeof fetch;
  try {
    const page = await loadMartAuditPage({
      classId: "class-1",
      cursor: "opaque-cursor",
      limit: 20,
      from: "2026-08-01",
      to: "2026-08-05",
    });
    assert.equal(
      requested,
      "/api/mart/audit?classId=class-1&cursor=opaque-cursor&limit=20&from=2026-08-01&to=2026-08-05",
    );
    assert.equal(page.nextCursor, "next-audit");
    assert.equal(page.hasMore, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("페이지 조회와 교사 CSV 주소는 선택한 조건만 안전하게 전달한다", async () => {
  const originalFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = (async (input: string | URL | Request) => {
    requested = String(input);
    return Response.json({ sales: [], nextCursor: "next-page", hasMore: true });
  }) as typeof fetch;
  try {
    const page = await loadMartSalesPage({
      classId: "class-1",
      cursor: "opaque-cursor",
      status: "cancelled",
      from: "2026-08-01",
      to: "2026-08-05",
      limit: 20,
    });
    assert.equal(
      requested,
      "/api/mart/sales?classId=class-1&cursor=opaque-cursor&limit=20&status=cancelled&from=2026-08-01&to=2026-08-05",
    );
    assert.equal(page.nextCursor, "next-page");
    assert.equal(page.hasMore, true);
    assert.equal(
      martSalesCsvUrl("class-1", { status: "completed", from: "2026-08-01", to: "2026-08-05" }),
      "/api/mart/sales/export?classId=class-1&status=completed&from=2026-08-01&to=2026-08-05",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("학생 대시보드는 context와 본인 sales만 요청하고 운영 API는 호출하지 않는다", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (url.startsWith("/api/mart/context")) {
      return Response.json({
        actor: studentContext.actor,
        classroom: {
          id: "class-1",
          name: "테스트반",
          schoolName: "테스트초",
          grade: 5,
          classNumber: 1,
          status: "active",
        },
        role: "student",
        activeJob: null,
        permissions: {
          canOperate: false,
          canEmergencyCorrect: false,
          canViewAllSales: false,
          canViewAudit: false,
          canViewStatistics: false,
        },
        currency: { name: "별", unit: "별", denominations: [1, 5, 10] },
        students: [],
        revision: 7,
        physicalCashOnly: true,
        digitalFinanceUnaffected: true,
      });
    }
    if (url.startsWith("/api/mart/sales")) {
      return Response.json({
        sales: [
          {
            id: "sale-own",
            buyer: { id: "student-1", number: 1, name: "학생1" },
            items: [{ productId: "product-pencil", productName: "연필", unitPrice: 300, quantity: 1, lineTotal: 300 }],
            totalAmount: 300,
            status: "posted",
            revision: 0,
            cancellation: null,
            createdAt: 100,
            updatedAt: 100,
          },
          {
            id: "sale-other",
            buyer: { id: "student-2", number: 2, name: "학생2" },
            items: [{ productId: "product-pencil", productName: "연필", unitPrice: 300, quantity: 1, lineTotal: 300 }],
            totalAmount: 300,
            status: "posted",
            revision: 0,
            cancellation: null,
            createdAt: 100,
            updatedAt: 100,
          },
        ],
      });
    }
    return Response.json({ error: "unexpected route" }, { status: 500 });
  }) as typeof fetch;
  try {
    const dashboard = await loadMartDashboard(null);
    assert.equal(dashboard.context.role, "student");
    assert.equal(dashboard.sales.length, 1);
    assert.equal(dashboard.sales[0].id, "sale-own");
    assert.deepEqual(requested, [
      "/api/mart/context",
      "/api/mart/sales?classId=class-1",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("교사 변경 요청은 모두 학급 범위를 보내고 판매 확정은 최신 revision을 포함한다", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const rawProduct = {
    id: "product-pencil",
    classId: "class-1",
    name: "연필",
    category: "문구",
    description: "문구 상품",
    price: 300,
    unitPrice: 300,
    lowStockThreshold: 1,
    isActive: true,
    revision: 2,
    inventory: { quantity: 3, revision: 4, updatedAt: 11 },
    createdAt: 10,
    updatedAt: 10,
  };
  const rawSale = {
    id: "sale-1",
    receiptNumber: "MART-TEST",
    buyer: { id: "student-1", number: 1, name: "학생1" },
    seller: { type: "teacher", id: "teacher-1", name: "담임교사" },
    items: [{ productId: "product-pencil", productName: "연필", unitPrice: 300, quantity: 1, lineTotal: 300 }],
    totalAmount: 300,
    status: "completed",
    revision: 0,
    cancellation: null,
    intervention: null,
    soldAt: 100,
    createdAt: 100,
    updatedAt: 100,
  };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    requests.push({ url, body });
    if (url.includes("/inventory/movements")) {
      return Response.json({
        product: rawProduct,
        inventory: { productId: "product-pencil", onHand: 4, revision: 5, updatedAt: 12 },
        movementId: "movement-1",
        deduplicated: false,
      });
    }
    if (url.includes("/cancel")) {
      return Response.json({ sale: { ...rawSale, status: "cancelled" }, deduplicated: false });
    }
    if (url.includes("/products")) {
      return Response.json({ product: rawProduct, deduplicated: false });
    }
    return Response.json({ sale: rawSale, deduplicated: false });
  }) as typeof fetch;

  try {
    await createMartSale({
      classId: "class-1",
      buyerStudentId: "student-1",
      idempotencyKey: "mart:sale:scope-test",
      expectedContextRevision: 7,
      items: [{ productId: "product-pencil", quantity: 1, expectedProductRevision: 2, expectedInventoryRevision: 4 }],
    });
    await saveMartProduct({
      classId: "class-1",
      name: "연필",
      category: "문구",
      description: "문구 상품",
      price: 300,
      lowStockThreshold: 1,
      isActive: true,
      idempotencyKey: "mart:product:scope-test",
    });
    await adjustMartInventory({
      classId: "class-1",
      productId: "product-pencil",
      operation: "outbound",
      quantity: 1,
      currentQuantity: 3,
      reason: "수업 사용",
      expectedRevision: 4,
      idempotencyKey: "mart:inventory:scope-test",
    });
    await cancelMartSale({
      classId: "class-1",
      saleId: "sale-1",
      reason: "잘못 선택",
      expectedRevision: 0,
      idempotencyKey: "mart:cancel:scope-test",
    });

    assert.equal(requests.length, 4);
    assert.equal(requests.every(({ url }) => url.includes("classId=class-1")), true);
    assert.equal(requests[0].body.expectedContextRevision, 7);
    assert.equal(requests[2].body.movementType, "outbound");
    assert.equal(requests[2].body.reason, "수업 사용");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
