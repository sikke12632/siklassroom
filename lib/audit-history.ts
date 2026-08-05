import { ApiError } from "./responses";

export const AUDIT_HISTORY_DEFAULT_LIMIT = 40;
export const AUDIT_HISTORY_MAX_LIMIT = 100;

export type AuditHistoryCursor = {
  createdAt: number;
  sortKey: string;
};

export type AuditHistoryQuery = {
  from: string | null;
  to: string | null;
  fromEpochMs: number | null;
  toEpochMsExclusive: number | null;
  limit: number;
  cursor: AuditHistoryCursor | null;
  scope: string;
};

type CursorPayload = {
  v: 1;
  t: number;
  k: string;
  f: string | null;
  u: string | null;
  o: string;
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
  if (!/^[A-Za-z0-9_-]{1,2048}$/u.test(value)) throw new Error("invalid cursor encoding");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder(undefined, { fatal: true }).decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}

function dateValue(value: string | null, label: string) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) {
    throw new ApiError(400, `${label} 날짜를 다시 확인해 주세요.`, "AUDIT_HISTORY_INVALID_DATE");
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
    throw new ApiError(400, `${label} 날짜를 다시 확인해 주세요.`, "AUDIT_HISTORY_INVALID_DATE");
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
  if (!value) return AUDIT_HISTORY_DEFAULT_LIMIT;
  if (!/^\d{1,3}$/u.test(value)) {
    throw new ApiError(400, "한 번에 볼 변경 기록 수를 다시 확인해 주세요.", "AUDIT_HISTORY_INVALID_LIMIT");
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > AUDIT_HISTORY_MAX_LIMIT) {
    throw new ApiError(
      400,
      `변경 기록은 한 번에 1~${AUDIT_HISTORY_MAX_LIMIT}건까지 볼 수 있습니다.`,
      "AUDIT_HISTORY_INVALID_LIMIT",
    );
  }
  return limit;
}

function decodeCursor(
  encoded: string | null,
  expected: Pick<AuditHistoryQuery, "scope" | "from" | "to">,
): AuditHistoryCursor | null {
  if (!encoded) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(encoded)) as Partial<CursorPayload>;
    if (
      payload.v !== 1
      || !Number.isSafeInteger(payload.t)
      || Number(payload.t) < 0
      || typeof payload.k !== "string"
      || !/^[A-Za-z0-9:_-]{1,240}$/u.test(payload.k)
      || payload.f !== expected.from
      || payload.u !== expected.to
      || payload.o !== expected.scope
    ) {
      throw new Error("invalid cursor payload");
    }
    return { createdAt: Number(payload.t), sortKey: payload.k };
  } catch {
    throw new ApiError(400, "변경 기록 목록 위치를 다시 확인해 주세요.", "AUDIT_HISTORY_INVALID_CURSOR");
  }
}

export function parseAuditHistoryQuery(url: URL, scope: string): AuditHistoryQuery {
  if (!scope || scope.length > 600) {
    throw new ApiError(400, "변경 기록 조회 범위를 확인할 수 없습니다.", "AUDIT_HISTORY_INVALID_SCOPE");
  }
  const fromDate = dateValue(url.searchParams.get("from"), "시작");
  const toDate = dateValue(url.searchParams.get("to"), "종료");
  const fromEpochMs = fromDate ? kstStartOfDay(fromDate) : null;
  const toEpochMsExclusive = toDate ? kstStartOfNextDay(toDate) : null;
  if (fromEpochMs !== null && toEpochMsExclusive !== null && fromEpochMs >= toEpochMsExclusive) {
    throw new ApiError(400, "시작 날짜는 종료 날짜보다 늦을 수 없습니다.", "AUDIT_HISTORY_INVALID_DATE_RANGE");
  }
  const query: AuditHistoryQuery = {
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

export function encodeAuditHistoryCursor(
  cursor: AuditHistoryCursor,
  query: Pick<AuditHistoryQuery, "scope" | "from" | "to">,
) {
  if (
    !Number.isSafeInteger(cursor.createdAt)
    || cursor.createdAt < 0
    || !/^[A-Za-z0-9:_-]{1,240}$/u.test(cursor.sortKey)
  ) {
    throw new Error("Cannot encode an invalid audit history cursor");
  }
  return base64UrlEncode(JSON.stringify({
    v: 1,
    t: cursor.createdAt,
    k: cursor.sortKey,
    f: query.from,
    u: query.to,
    o: query.scope,
  } satisfies CursorPayload));
}
