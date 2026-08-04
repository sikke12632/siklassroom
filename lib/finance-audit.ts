import { database } from "./database";
import { financeContextForRequest } from "./finance-access";
import { ApiError } from "./responses";

const AUDIT_CATEGORIES = new Set([
  "request",
  "decision",
  "transaction",
  "setting",
  "deposit",
  "stock",
]);

type AuditRow = {
  id: string;
  category: string;
  action: string;
  title: string;
  detail: string;
  actor_label: string;
  student_name: string | null;
  amount: number | null;
  occurred_at: number;
  outcome: string;
  related_id: string | null;
  previous_settings_json: string | null;
  settings_json: string | null;
};

type StoredSettings = {
  currencyName?: unknown;
  currencyUnit?: unknown;
  denominations?: unknown;
  bankOpen?: unknown;
  depositEnabled?: unknown;
  withdrawalEnabled?: unknown;
  bankerProcessingEnabled?: unknown;
  maxRequestAmount?: unknown;
};

function parseStoredSettings(value: string | null): StoredSettings | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? parsed as StoredSettings
      : null;
  } catch {
    return null;
  }
}

function settingValueText(key: keyof StoredSettings, value: unknown) {
  if (
    key === "bankOpen"
    || key === "depositEnabled"
    || key === "withdrawalEnabled"
    || key === "bankerProcessingEnabled"
  ) {
    return value === true ? "켬" : "끔";
  }
  if (key === "denominations" && Array.isArray(value)) {
    return value.map(Number)
      .filter(Number.isFinite)
      .map((amount) => amount.toLocaleString("ko-KR"))
      .join("·");
  }
  if (key === "maxRequestAmount" && Number.isFinite(Number(value))) {
    return Number(value).toLocaleString("ko-KR");
  }
  return String(value ?? "");
}

function settingAuditDetail(row: AuditRow) {
  if (row.category !== "setting") return row.detail;
  const previous = parseStoredSettings(row.previous_settings_json);
  const next = parseStoredSettings(row.settings_json);
  if (!previous || !next) return row.detail;

  const labels: Array<[keyof StoredSettings, string]> = [
    ["currencyName", "화폐 이름"],
    ["currencyUnit", "금액 단위"],
    ["denominations", "권종"],
    ["bankOpen", "은행"],
    ["depositEnabled", "입금"],
    ["withdrawalEnabled", "출금"],
    ["bankerProcessingEnabled", "은행원 처리"],
    ["maxRequestAmount", "최대 신청액"],
  ];
  const changes = labels.flatMap(([key, label]) => {
    if (JSON.stringify(previous[key]) === JSON.stringify(next[key])) return [];
    return [
      `${label} ${settingValueText(key, previous[key])}→${settingValueText(key, next[key])}`,
    ];
  });
  return changes.length > 0
    ? `${row.detail} · 변경: ${changes.join(", ")}`
    : row.detail;
}

function limitValue(value: string | null) {
  const parsed = Number(value || 50);
  if (!Number.isSafeInteger(parsed)) return 50;
  return Math.min(50, Math.max(1, parsed));
}

function queryValue(value: string | null) {
  return (value || "").trim().slice(0, 80);
}

function likeSearchValue(value: string) {
  return `%${value
    .toLocaleLowerCase("ko-KR")
    .replaceAll("!", "!!")
    .replaceAll("%", "!%")
    .replaceAll("_", "!_")}%`;
}

function categoryValue(value: string | null) {
  const normalized = (value || "").trim();
  if (!normalized) return "";
  if (!AUDIT_CATEGORIES.has(normalized)) {
    throw new ApiError(
      400,
      "기록 종류를 다시 선택해 주세요.",
      "FINANCE_AUDIT_INVALID_CATEGORY",
    );
  }
  return normalized;
}

function decodeCursor(value: string | null) {
  if (!value) return { time: Number.MAX_SAFE_INTEGER, id: "\uffff" };
  try {
    const [time, id] = JSON.parse(atob(value)) as [unknown, unknown];
    if (
      !Number.isSafeInteger(time)
      || Number(time) < 0
      || typeof id !== "string"
      || !id
      || id.length > 240
    ) {
      throw new Error("invalid cursor");
    }
    return { time: Number(time), id };
  } catch {
    throw new ApiError(
      400,
      "기록 목록 위치를 다시 확인해 주세요.",
      "FINANCE_AUDIT_INVALID_CURSOR",
    );
  }
}

function encodeCursor(row: AuditRow) {
  return btoa(JSON.stringify([Number(row.occurred_at), row.id]));
}

export async function financeAuditForRequest(request: Request) {
  const context = await financeContextForRequest(request);
  if (context.financeRole !== "teacher") {
    throw new ApiError(
      403,
      "전체 금융 기록은 담임 선생님만 볼 수 있습니다.",
      "FINANCE_AUDIT_TEACHER_REQUIRED",
    );
  }
  const url = new URL(request.url);
  const limit = limitValue(url.searchParams.get("limit"));
  const category = categoryValue(url.searchParams.get("category"));
  const query = queryValue(url.searchParams.get("query"));
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const search = likeSearchValue(query);

  const result = await database().prepare(
    `WITH finance_events AS (
       SELECT
         'request:' || request_row.id AS id,
         request_row.class_id AS class_id,
         'request' AS category,
         request_row.request_type || '_requested' AS action,
         CASE request_row.request_type
           WHEN 'deposit' THEN '입금 신청'
           ELSE '출금 신청'
         END AS title,
         COALESCE(request_row.memo, '학생이 은행 업무를 신청했습니다.') AS detail,
         request_row.student_name_snapshot AS actor_label,
         request_row.student_name_snapshot AS student_name,
         request_row.amount AS amount,
         request_row.created_at AS occurred_at,
         COALESCE(resolution.decision, 'pending') AS outcome,
         request_row.id AS related_id,
         NULL AS previous_settings_json,
         NULL AS settings_json
       FROM finance_cash_requests request_row
       LEFT JOIN finance_request_resolutions resolution
         ON resolution.request_id = request_row.id
        AND resolution.class_id = request_row.class_id

       UNION ALL

       SELECT
         'decision:' || resolution.id AS id,
         resolution.class_id AS class_id,
         'decision' AS category,
         'request_' || resolution.decision AS action,
         CASE resolution.decision
           WHEN 'approved' THEN '신청 승인'
           WHEN 'rejected' THEN '신청 거절'
           ELSE '신청 취소'
         END AS title,
         COALESCE(
           resolution.intervention_reason,
           resolution.reason_note,
           resolution.reason_code,
           '신청 처리 결과가 기록되었습니다.'
         ) AS detail,
         resolution.actor_label AS actor_label,
         request_row.student_name_snapshot AS student_name,
         request_row.amount AS amount,
         resolution.resolved_at AS occurred_at,
         resolution.decision AS outcome,
         request_row.id AS related_id,
         NULL AS previous_settings_json,
         NULL AS settings_json
       FROM finance_request_resolutions resolution
       JOIN finance_cash_requests request_row
         ON request_row.id = resolution.request_id
        AND request_row.class_id = resolution.class_id

       UNION ALL

       SELECT
         'transaction:' || transaction_row.id || ':' || entry.id AS id,
         transaction_row.class_id AS class_id,
         CASE transaction_row.source_type
           WHEN 'stock_trade' THEN 'stock'
           WHEN 'deposit_contract' THEN 'deposit'
           WHEN 'deposit_settlement' THEN 'deposit'
           ELSE 'transaction'
         END AS category,
         transaction_row.transaction_type AS action,
         CASE transaction_row.transaction_type
           WHEN 'reversal' THEN '거래 정정'
           WHEN 'cash_deposit' THEN '입금 반영'
           WHEN 'cash_withdrawal' THEN '출금 반영'
           WHEN 'manual_credit' THEN '교사 지급'
           WHEN 'manual_debit' THEN '교사 차감'
           WHEN 'salary' THEN '직업 월급'
           WHEN 'deposit_open' THEN '예금 가입'
           WHEN 'deposit_maturity' THEN CASE transaction_row.actor_type
             WHEN 'teacher' THEN '예금 교사 비상 정산'
             ELSE '예금 만기 자동 지급' END
           WHEN 'deposit_early_termination' THEN CASE transaction_row.actor_type
             WHEN 'teacher' THEN '예금 교사 비상 정산'
             ELSE '예금 중도해지' END
           WHEN 'stock_buy' THEN '주식 매수'
           WHEN 'stock_sell' THEN '주식 매도'
           ELSE '금융 거래'
         END AS title,
         CASE
           WHEN transaction_row.source_type IN ('deposit_settlement', 'stock_trade')
             AND transaction_row.actor_type = 'teacher'
             AND json_valid(transaction_row.metadata_json) = 1
             AND json_extract(transaction_row.metadata_json, '$.isEmergency') = 1
           THEN transaction_row.description || ' · 사유: ' || COALESCE(
             json_extract(transaction_row.metadata_json, '$.interventionReason'),
             '기록 확인 필요'
           )
           ELSE transaction_row.description
         END AS detail,
         transaction_row.actor_label AS actor_label,
         student.official_name AS student_name,
         entry.amount AS amount,
         transaction_row.posted_at AS occurred_at,
         'completed' AS outcome,
         transaction_row.id AS related_id,
         NULL AS previous_settings_json,
         NULL AS settings_json
       FROM finance_transactions transaction_row
       JOIN finance_ledger_entries entry
         ON entry.transaction_id = transaction_row.id
        AND entry.class_id = transaction_row.class_id
       JOIN finance_accounts account
         ON account.id = entry.account_id
        AND account.class_id = entry.class_id
        AND account.account_type = 'student_wallet'
       LEFT JOIN students student
         ON student.id = account.student_id
        AND student.class_id = account.class_id
       WHERE transaction_row.status = 'posted'

       UNION ALL

       SELECT
         'setting:' || setting_revision.id AS id,
         setting_revision.class_id AS class_id,
         'setting' AS category,
         'settings_updated' AS action,
         '화폐·은행 설정 변경' AS title,
         setting_revision.change_reason AS detail,
         setting_revision.actor_label AS actor_label,
         NULL AS student_name,
         NULL AS amount,
         setting_revision.created_at AS occurred_at,
         'completed' AS outcome,
         setting_revision.id AS related_id,
         setting_revision.previous_settings_json AS previous_settings_json,
         setting_revision.settings_json AS settings_json
       FROM finance_setting_revisions setting_revision

       UNION ALL

       SELECT
         'deposit-product:' || product_event.id AS id,
         product_event.class_id AS class_id,
         'deposit' AS category,
         'deposit_product_' || product_event.action AS action,
         CASE product_event.action
           WHEN 'issued' THEN '예금상품 발행'
           WHEN 'opened' THEN '예금상품 판매 재개'
           ELSE '예금상품 판매 중지'
         END AS title,
         product.name || ' · ' || product.term_weeks || '주 · 만기 이자 '
           || printf('%.2f', product.maturity_interest_bps / 100.0) || '%' AS detail,
         '담임교사' AS actor_label,
         NULL AS student_name,
         NULL AS amount,
         product_event.created_at AS occurred_at,
         'completed' AS outcome,
         product.id AS related_id,
         NULL AS previous_settings_json,
         NULL AS settings_json
       FROM finance_deposit_product_events product_event
       JOIN finance_deposit_products product
         ON product.id = product_event.product_id
        AND product.class_id = product_event.class_id

       UNION ALL

       SELECT
         'stock-market:' || market_event.id AS id,
         market_event.class_id AS class_id,
         'stock' AS category,
         'stock_market_' || market_event.action AS action,
         CASE market_event.action
           WHEN 'opened' THEN '주식시장 개장'
           WHEN 'closed' THEN '주식시장 마감'
           WHEN 'configured' THEN '주식시장 첫 설정'
           ELSE '주식시장 설정 변경'
         END AS title,
         '장세 ' || COALESCE(
           json_extract(market_event.market_snapshot_json, '$.mood'),
           'mixed'
         ) || ' · 매수 수수료 ' || printf(
           '%.2f',
           COALESCE(json_extract(market_event.market_snapshot_json, '$.buyFeeBps'), 0) / 100.0
         ) || '%' AS detail,
         '담임교사' AS actor_label,
         NULL AS student_name,
         NULL AS amount,
         market_event.created_at AS occurred_at,
         'completed' AS outcome,
         market_event.class_id AS related_id,
         NULL AS previous_settings_json,
         NULL AS settings_json
       FROM finance_stock_market_events market_event

       UNION ALL

       SELECT
         'stock-event:' || stock_event.id AS id,
         stock_event.class_id AS class_id,
         'stock' AS category,
         'stock_' || stock_event.action AS action,
         CASE stock_event.action
           WHEN 'issued' THEN '우리 반 주식 발행'
           WHEN 'automatic_tick' THEN '주가 자동 갱신'
           WHEN 'news_tick' THEN '뉴스 반영 주가 갱신'
           WHEN 'price_changed' THEN '주가 변경'
           ELSE '주식 거래 상태 변경'
         END AS title,
         stock_event.reason AS detail,
         CASE stock_event.actor_type
           WHEN 'teacher' THEN '담임교사'
           ELSE '주식 자동 시스템'
         END AS actor_label,
         NULL AS student_name,
         CAST(json_extract(stock_event.stock_snapshot_json, '$.currentPrice') AS INTEGER) AS amount,
         stock_event.created_at AS occurred_at,
         'completed' AS outcome,
         stock_event.stock_id AS related_id,
         NULL AS previous_settings_json,
         NULL AS settings_json
       FROM finance_stock_events stock_event

       UNION ALL

       SELECT
         'stock-news:' || news.id || ':' || news.revision AS id,
         news.class_id AS class_id,
         'stock' AS category,
         'stock_news_' || news.status AS action,
         CASE news.status
           WHEN 'active' THEN '주식 뉴스 등록'
           WHEN 'cancelled' THEN '주식 뉴스 취소'
           ELSE '주식 뉴스 종료'
         END AS title,
         news.title || ' · ' || news.content AS detail,
         CASE news.updated_by_actor_type
           WHEN 'teacher' THEN '담임교사'
           ELSE '주식 자동 시스템'
         END AS actor_label,
         NULL AS student_name,
         NULL AS amount,
         CASE news.status
           WHEN 'active' THEN news.created_at
           ELSE news.updated_at
         END AS occurred_at,
         CASE news.status
           WHEN 'cancelled' THEN 'cancelled'
           ELSE 'completed'
         END AS outcome,
         news.id AS related_id,
         NULL AS previous_settings_json,
         NULL AS settings_json
       FROM finance_stock_news news
     )
     SELECT id, category, action, title, detail, actor_label, student_name,
            amount, occurred_at, outcome, related_id,
            previous_settings_json, settings_json
     FROM finance_events
     WHERE class_id = ?
       AND (? = '' OR category = ?)
       AND (
         ? = ''
         OR LOWER(title) LIKE ? ESCAPE '!'
         OR LOWER(detail) LIKE ? ESCAPE '!'
         OR LOWER(actor_label) LIKE ? ESCAPE '!'
         OR LOWER(COALESCE(student_name, '')) LIKE ? ESCAPE '!'
       )
       AND (
         occurred_at < ?
         OR (occurred_at = ? AND id < ?)
       )
     ORDER BY occurred_at DESC, id DESC
     LIMIT ?`,
  ).bind(
    context.classroom.id,
    category,
    category,
    query,
    search,
    search,
    search,
    search,
    cursor.time,
    cursor.time,
    cursor.id,
    limit + 1,
  ).all<AuditRow>();

  const hasMore = result.results.length > limit;
  const rows = result.results.slice(0, limit);
  const last = rows.at(-1) ?? null;
  return {
    events: rows.map((row) => ({
      id: row.id,
      category: row.category,
      action: row.action,
      title: row.title,
      detail: settingAuditDetail(row),
      actorLabel: row.category === "setting" && row.actor_label === "교사"
        ? "담임교사"
        : row.actor_label,
      studentName: row.student_name,
      amount: row.amount === null ? null : Number(row.amount),
      occurredAt: new Date(Number(row.occurred_at)).toISOString(),
      outcome: row.outcome,
      relatedId: row.related_id,
    })),
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  };
}
