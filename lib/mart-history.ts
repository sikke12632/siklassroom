import { ApiError } from "./responses";

export const MART_SALES_DEFAULT_LIMIT = 50;
export const MART_SALES_MAX_LIMIT = 100;
export const MART_SALES_EXPORT_MAX_ROWS = 50_000;

export type MartSaleStatusFilter = "all" | "completed" | "cancelled";

export type MartSaleCursor = {
  createdAt: number;
  id: string;
};

export type MartSaleListQuery = {
  status: MartSaleStatusFilter;
  from: string | null;
  to: string | null;
  fromEpochMs: number | null;
  toEpochMsExclusive: number | null;
  limit: number;
  cursor: MartSaleCursor | null;
  scope: string;
};

type CursorPayload = {
  v: 1;
  t: number;
  i: string;
  s: MartSaleStatusFilter;
  f: string | null;
  u: string | null;
  o: string;
};

export type MartCsvSale = {
  buyer: { number: number; name: string };
  items: Array<{
    productName: string;
    quantity: number;
    lineTotal: number;
  }>;
  status: "completed" | "cancelled";
  cancellation: null | { reason: string | null };
  soldAt: number;
};

function base64UrlEncode(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlDecode(value: string) {
  if (!/^[A-Za-z0-9_-]{1,1024}$/u.test(value)) throw new Error("invalid cursor encoding");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder(undefined, { fatal: true }).decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}

function statusValue(value: string | null): MartSaleStatusFilter {
  if (!value || value === "all") return "all";
  if (value === "completed" || value === "cancelled") return value;
  throw new ApiError(400, "판매 상태 조건을 다시 확인해 주세요.", "MART_SALES_INVALID_STATUS");
}

function dateValue(value: string | null, label: string) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) {
    throw new ApiError(400, `${label} 날짜를 다시 확인해 주세요.`, "MART_SALES_INVALID_DATE");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 2000
    || year > 2100
    || calendarDate.getUTCFullYear() !== year
    || calendarDate.getUTCMonth() !== month - 1
    || calendarDate.getUTCDate() !== day
  ) {
    throw new ApiError(400, `${label} 날짜를 다시 확인해 주세요.`, "MART_SALES_INVALID_DATE");
  }
  return { value, year, month, day };
}

function kstStartOfDay(date: NonNullable<ReturnType<typeof dateValue>>) {
  return Date.UTC(date.year, date.month - 1, date.day) - 9 * 60 * 60 * 1_000;
}

function kstStartOfNextDay(date: NonNullable<ReturnType<typeof dateValue>>) {
  return Date.UTC(date.year, date.month - 1, date.day + 1) - 9 * 60 * 60 * 1_000;
}

function limitValue(value: string | null) {
  if (!value) return MART_SALES_DEFAULT_LIMIT;
  if (!/^\d{1,3}$/u.test(value)) {
    throw new ApiError(400, "한 번에 볼 기록 수를 다시 확인해 주세요.", "MART_SALES_INVALID_LIMIT");
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MART_SALES_MAX_LIMIT) {
    throw new ApiError(400, `기록은 한 번에 1~${MART_SALES_MAX_LIMIT}건까지 볼 수 있습니다.`, "MART_SALES_INVALID_LIMIT");
  }
  return limit;
}

function decodeCursor(
  encoded: string | null,
  expected: Pick<MartSaleListQuery, "scope" | "status" | "from" | "to">,
): MartSaleCursor | null {
  if (!encoded) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(encoded)) as Partial<CursorPayload>;
    if (
      payload.v !== 1
      || !Number.isSafeInteger(payload.t)
      || Number(payload.t) < 0
      || typeof payload.i !== "string"
      || !/^[A-Za-z0-9:_-]{1,160}$/u.test(payload.i)
      || payload.s !== expected.status
      || payload.f !== expected.from
      || payload.u !== expected.to
      || payload.o !== expected.scope
    ) {
      throw new Error("invalid cursor payload");
    }
    return { createdAt: Number(payload.t), id: payload.i };
  } catch {
    throw new ApiError(400, "판매 기록 목록 위치를 다시 확인해 주세요.", "MART_SALES_INVALID_CURSOR");
  }
}

export function parseMartSaleListQuery(url: URL, scope: string): MartSaleListQuery {
  if (!scope || scope.length > 400) {
    throw new ApiError(400, "판매 기록 조회 범위를 확인할 수 없습니다.", "MART_SALES_INVALID_SCOPE");
  }
  const status = statusValue(url.searchParams.get("status"));
  const fromDate = dateValue(url.searchParams.get("from"), "시작");
  const toDate = dateValue(url.searchParams.get("to"), "종료");
  const fromEpochMs = fromDate ? kstStartOfDay(fromDate) : null;
  const toEpochMsExclusive = toDate ? kstStartOfNextDay(toDate) : null;
  if (fromEpochMs !== null && toEpochMsExclusive !== null && fromEpochMs >= toEpochMsExclusive) {
    throw new ApiError(400, "시작 날짜는 종료 날짜보다 늦을 수 없습니다.", "MART_SALES_INVALID_DATE_RANGE");
  }
  const query: MartSaleListQuery = {
    status,
    from: fromDate?.value ?? null,
    to: toDate?.value ?? null,
    fromEpochMs,
    toEpochMsExclusive,
    limit: limitValue(url.searchParams.get("limit")),
    cursor: null,
    scope,
  };
  query.cursor = decodeCursor(url.searchParams.get("cursor"), query);
  return query;
}

export function encodeMartSaleCursor(
  cursor: MartSaleCursor,
  query: Pick<MartSaleListQuery, "scope" | "status" | "from" | "to">,
) {
  if (
    !Number.isSafeInteger(cursor.createdAt)
    || cursor.createdAt < 0
    || !/^[A-Za-z0-9:_-]{1,160}$/u.test(cursor.id)
  ) {
    throw new Error("Cannot encode an invalid mart sale cursor");
  }
  return base64UrlEncode(JSON.stringify({
    v: 1,
    t: cursor.createdAt,
    i: cursor.id,
    s: query.status,
    f: query.from,
    u: query.to,
    o: query.scope,
  } satisfies CursorPayload));
}

export function martSaleStatusSql(status: MartSaleStatusFilter) {
  if (status === "completed") return "posted" as const;
  if (status === "cancelled") return "cancelled" as const;
  return null;
}

function csvCell(value: string | number) {
  let text = String(value);
  // Prevent spreadsheet programs from treating imported text as a formula.
  if (/^[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildMartSalesCsv(sales: readonly MartCsvSale[]) {
  const rows: Array<Array<string | number>> = [[
    "학생명",
    "상품",
    "수량",
    "금액",
    "상태",
    "취소사유",
    "시간",
  ]];
  const formatter = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  for (const sale of sales) {
    for (const item of sale.items) {
      rows.push([
        `${sale.buyer.number}번 ${sale.buyer.name}`,
        item.productName,
        item.quantity,
        item.lineTotal,
        sale.status === "completed" ? "판매 완료" : "판매 취소",
        sale.cancellation?.reason ?? "",
        formatter.format(new Date(sale.soldAt)),
      ]);
    }
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}
