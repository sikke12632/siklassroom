import { loadClassCalendar } from "./class-calendar";
import {
  lifeCheckActorColumns,
  lifeCheckContextForRequest,
  requireLifeCheckWrite,
  type LifeCheckContext,
} from "./life-check-access";
import { database, isOperationGuardFailure } from "./database";
import {
  LIFE_CHECK_INFO,
  LifeCheckRuleError,
  calculateLifeCheckReward,
  parseLifeCheckPeriod,
  parseLifeCheckType,
  rewardReason,
  splitSchoolDays,
  type LifeCheckPeriod,
  type LifeCheckType,
} from "./life-check-rules";
import { ApiError } from "./responses";
import { seoulServerTime } from "./seoul-time";
import {
  encodeAuditHistoryCursor,
  parseAuditHistoryQuery,
} from "./audit-history";

type StudentRow = {
  id: string;
  student_number: number;
  official_name: string;
};

type RecordRow = {
  student_id: string;
  check_date: string;
  passed: number;
  revision: number;
  updated_at: number;
};

type PayoutRow = {
  id: string;
  check_type: LifeCheckType;
  payout_year: number;
  payout_month: number;
  payout_period: LifeCheckPeriod;
  status: "prepared" | "completed" | "cancelled";
  items_json: string;
  recipient_count: number;
  total_amount: number;
  source_series_revision: number;
  source_calendar_revision: number;
  revision: number;
  completed_at: number | null;
  cancelled_at: number | null;
  created_at: number;
  updated_at: number;
};

type PayoutItem = {
  studentId: string;
  studentNumber: number;
  studentName: string;
  passedCount: number;
  totalCount: number;
  baseAmount: number;
  bonusAmount: number;
  amount: number;
  reason: string;
};

export type LifeCheckAuditEvent = {
  id: string;
  kind: "record" | "payout";
  type: LifeCheckType;
  date: string | null;
  studentId: string | null;
  studentNumber: number | null;
  studentName: string | null;
  passed: boolean | null;
  reason: string | null;
  action: "prepared" | "refreshed" | "completed" | "cancelled" | "reopened" | null;
  year: number | null;
  month: number | null;
  period: LifeCheckPeriod | null;
  actorType: string;
  actorName: string;
  createdAt: number;
};

type LifeCheckAuditRow = {
  id: string;
  kind: "record" | "payout";
  sort_key: string;
  check_type: LifeCheckType;
  check_date: string | null;
  student_id: string | null;
  student_number: number | null;
  student_name: string | null;
  passed: number | null;
  reason: string | null;
  action: "prepared" | "refreshed" | "completed" | "cancelled" | "reopened" | null;
  payout_year: number | null;
  payout_month: number | null;
  payout_period: LifeCheckPeriod | null;
  actor_type: string;
  actor_student_name: string | null;
  detail: string | null;
  created_at: number;
};

type LifeCheckActor = ReturnType<typeof lifeCheckActorColumns>;

type RecordReplayRow = {
  check_type: LifeCheckType;
  check_date: string;
  student_id: string;
  passed: number;
  reason: string | null;
  actor_type: "teacher" | "checker";
  actor_teacher_id: string | null;
  actor_student_id: string | null;
  series_revision: number;
};

type PayoutReplayRow = {
  payout_id: string;
  action: "prepared" | "refreshed" | "completed" | "cancelled" | "reopened";
  actor_type: "teacher" | "checker";
  actor_teacher_id: string | null;
  actor_student_id: string | null;
  detail: string | null;
  check_type: LifeCheckType;
  payout_year: number;
  payout_month: number;
  payout_period: LifeCheckPeriod;
  revision: number;
};

const MONTH_PATTERN = /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^(20\d{2}|2100)-(0[1-9]|1[0-2])-([0-3]\d)$/;

function ruleError(error: unknown): never {
  if (error instanceof LifeCheckRuleError) {
    throw new ApiError(400, error.message, error.code);
  }
  throw error;
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, maxLength);
}

function requestId(value: unknown) {
  const normalized = cleanText(value, 100);
  if (!normalized) {
    throw new ApiError(400, "요청 번호가 필요합니다. 화면을 새로고침해 주세요.", "LIFE_CHECK_REQUEST_ID_REQUIRED");
  }
  return normalized;
}

function expectedRevision(value: unknown, label = "기록") {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new ApiError(400, `${label} 버전을 다시 확인해 주세요.`, "LIFE_CHECK_REVISION_INVALID");
  }
  return revision;
}

function monthValue(value: unknown, fallback: string) {
  const normalized = typeof value === "string" && value ? value : fallback;
  if (!MONTH_PATTERN.test(normalized)) {
    throw new ApiError(400, "조회할 연도와 월을 다시 확인해 주세요.", "LIFE_CHECK_MONTH_INVALID");
  }
  return normalized;
}

function safeJsonItems(value: string): PayoutItem[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PayoutItem => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Partial<PayoutItem>;
      return typeof candidate.studentId === "string"
        && Number.isInteger(candidate.studentNumber)
        && typeof candidate.studentName === "string"
        && Number.isInteger(candidate.passedCount)
        && Number.isInteger(candidate.totalCount)
        && Number.isInteger(candidate.baseAmount)
        && Number.isInteger(candidate.bonusAmount)
        && Number.isInteger(candidate.amount)
        && typeof candidate.reason === "string";
    });
  } catch {
    return [];
  }
}

function serializePayout(row: PayoutRow | null, visibleStudentId?: string) {
  if (!row) return null;
  const items = safeJsonItems(row.items_json).filter((item) => (
    !visibleStudentId || item.studentId === visibleStudentId
  ));
  return {
    id: row.id,
    type: row.check_type,
    year: Number(row.payout_year),
    month: Number(row.payout_month),
    period: row.payout_period,
    status: row.status,
    items,
    recipientCount: visibleStudentId ? items.length : Number(row.recipient_count),
    totalAmount: visibleStudentId
      ? items.reduce((sum, item) => sum + Number(item.amount || 0), 0)
      : Number(row.total_amount),
    sourceSeriesRevision: Number(row.source_series_revision),
    sourceCalendarRevision: Number(row.source_calendar_revision),
    revision: Number(row.revision),
    completedAt: row.completed_at === null ? null : Number(row.completed_at),
    cancelledAt: row.cancelled_at === null ? null : Number(row.cancelled_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function sameActor(row: {
  actor_type: "teacher" | "checker";
  actor_teacher_id: string | null;
  actor_student_id: string | null;
}, actor: LifeCheckActor) {
  return row.actor_type === actor.actorType
    && row.actor_teacher_id === actor.teacherId
    && row.actor_student_id === actor.studentId;
}

function idempotencyConflict(): never {
  throw new ApiError(
    409,
    "같은 요청 번호가 다른 생활확인 작업에 이미 사용됐어요.",
    "LIFE_CHECK_IDEMPOTENCY_CONFLICT",
  );
}

async function recordReplay(classId: string, idempotencyKey: string) {
  return database().prepare(
    `SELECT check_type, check_date, student_id, passed, reason,
            actor_type, actor_teacher_id, actor_student_id, series_revision
     FROM life_check_events
     WHERE class_id = ? AND request_id = ?
     LIMIT 1`,
  ).bind(classId, idempotencyKey).first<RecordReplayRow>();
}

async function payoutReplay(classId: string, idempotencyKey: string) {
  return database().prepare(
    `SELECT event.payout_id, event.action, event.actor_type,
            event.actor_teacher_id, event.actor_student_id, event.detail,
            payout.check_type, payout.payout_year, payout.payout_month,
            payout.payout_period, payout.revision
     FROM life_check_payout_events event
     JOIN life_check_payouts payout
       ON payout.id = event.payout_id AND payout.class_id = event.class_id
     WHERE event.class_id = ? AND event.request_id = ?
     LIMIT 1`,
  ).bind(classId, idempotencyKey).first<PayoutReplayRow>();
}

function payoutEventDetail(detail: string | null) {
  type Detail = {
    reason?: unknown;
    revision?: unknown;
    expectedRevision?: unknown;
    expectedSeriesRevision?: unknown;
    expectedCalendarRevision?: unknown;
    expectedPayoutRevision?: unknown;
  };
  if (!detail) return {} as Detail;
  try {
    return JSON.parse(detail) as Detail;
  } catch {
    return {} as Detail;
  }
}

function lifeCheckAuditScope(context: LifeCheckContext, type: LifeCheckType) {
  return `${context.classroom.id}:${context.role}:${context.actor.type}:${context.actor.id}:${type}`;
}

async function lifeCheckAuditPage(
  context: LifeCheckContext,
  type: LifeCheckType,
  url: URL,
) {
  const query = parseAuditHistoryQuery(url, lifeCheckAuditScope(context, type));
  const conditions: string[] = [];
  const bindings: Array<string | number> = [
    context.classroom.id,
    type,
    context.classroom.id,
    type,
  ];
  if (query.fromEpochMs !== null) {
    conditions.push("audit_event.created_at >= ?");
    bindings.push(query.fromEpochMs);
  }
  if (query.toEpochMsExclusive !== null) {
    conditions.push("audit_event.created_at < ?");
    bindings.push(query.toEpochMsExclusive);
  }
  if (query.cursor) {
    conditions.push("(audit_event.created_at < ? OR (audit_event.created_at = ? AND audit_event.sort_key < ?))");
    bindings.push(query.cursor.createdAt, query.cursor.createdAt, query.cursor.sortKey);
  }
  bindings.push(query.limit + 1);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await database().prepare(
    `SELECT *
     FROM (
       SELECT event.id, 'record' AS kind, 'record:' || event.id AS sort_key,
              event.check_type, event.check_date, event.student_id,
              student.student_number, student.official_name AS student_name,
              event.passed, event.reason, NULL AS action,
              NULL AS payout_year, NULL AS payout_month, NULL AS payout_period,
              event.actor_type,
              actor_student.official_name AS actor_student_name,
              NULL AS detail, event.created_at
       FROM life_check_events event
       JOIN students student
         ON student.id = event.student_id AND student.class_id = event.class_id
       LEFT JOIN students actor_student
         ON actor_student.id = event.actor_student_id AND actor_student.class_id = event.class_id
       WHERE event.class_id = ? AND event.check_type = ?
       UNION ALL
       SELECT event.id, 'payout' AS kind, 'payout:' || event.id AS sort_key,
              payout.check_type, NULL AS check_date, NULL AS student_id,
              NULL AS student_number, NULL AS student_name,
              NULL AS passed, NULL AS reason, event.action,
              payout.payout_year, payout.payout_month, payout.payout_period,
              event.actor_type,
              actor_student.official_name AS actor_student_name,
              event.detail, event.created_at
       FROM life_check_payout_events event
       JOIN life_check_payouts payout
         ON payout.id = event.payout_id AND payout.class_id = event.class_id
       LEFT JOIN students actor_student
         ON actor_student.id = event.actor_student_id AND actor_student.class_id = event.class_id
       WHERE event.class_id = ? AND payout.check_type = ?
     ) audit_event
     ${where}
     ORDER BY audit_event.created_at DESC, audit_event.sort_key DESC
     LIMIT ?`,
  ).bind(...bindings).all<LifeCheckAuditRow>();
  const hasMore = rows.results.length > query.limit;
  const pageRows = rows.results.slice(0, query.limit);
  const events: LifeCheckAuditEvent[] = pageRows.map((event) => ({
    id: event.id,
    kind: event.kind,
    type: event.check_type,
    date: event.check_date,
    studentId: event.student_id,
    studentNumber: event.student_number === null ? null : Number(event.student_number),
    studentName: event.student_name,
    passed: event.passed === null ? null : Boolean(event.passed),
    reason: event.kind === "payout"
      ? (() => {
        const detail = payoutEventDetail(event.detail);
        return typeof detail.reason === "string" ? detail.reason : null;
      })()
      : event.reason,
    action: event.action,
    year: event.payout_year === null ? null : Number(event.payout_year),
    month: event.payout_month === null ? null : Number(event.payout_month),
    period: event.payout_period,
    actorType: event.actor_type,
    actorName: event.actor_type === "teacher" ? "교사" : event.actor_student_name || "담당 학생",
    createdAt: Number(event.created_at),
  }));
  const last = pageRows.at(-1);
  return {
    events,
    nextCursor: hasMore && last
      ? encodeAuditHistoryCursor({
        createdAt: Number(last.created_at),
        sortKey: last.sort_key,
      }, query)
      : null,
    hasMore,
  };
}

export async function lifeCheckAuditForRequest(request: Request) {
  const context = await lifeCheckContextForRequest(request);
  let type: LifeCheckType;
  try {
    type = parseLifeCheckType(new URL(request.url).searchParams.get("type"));
  } catch (error) {
    ruleError(error);
  }
  if (
    !context.permissions.canViewClass
    || (context.actor.type !== "teacher" && !context.allowedWriteTypes.includes(type))
  ) {
    throw new ApiError(
      403,
      "이 생활확인 변경 기록을 볼 권한이 없어요.",
      "LIFE_CHECK_AUDIT_FORBIDDEN",
    );
  }
  return lifeCheckAuditPage(context, type, new URL(request.url));
}

async function ensureSeries(classId: string, type: LifeCheckType) {
  const now = Date.now();
  await database().prepare(
    `INSERT OR IGNORE INTO life_check_series (class_id, check_type, revision, updated_at)
     VALUES (?, ?, 0, ?)`,
  ).bind(classId, type, now).run();
  const row = await database().prepare(
    `SELECT revision, updated_at FROM life_check_series WHERE class_id = ? AND check_type = ?`,
  ).bind(classId, type).first<{ revision: number; updated_at: number }>();
  return {
    revision: Number(row?.revision ?? 0),
    updatedAt: Number(row?.updated_at ?? now),
  };
}

async function currentCalendarRevision(classId: string) {
  const row = await database().prepare(
    `SELECT revision FROM class_calendars WHERE class_id = ?`,
  ).bind(classId).first<{ revision: number }>();
  return Number(row?.revision ?? 0);
}

async function assertLifeCheckPeriodEnded(input: {
  classId: string;
  year: number;
  month: number;
  period: LifeCheckPeriod;
}) {
  const month = `${input.year}-${String(input.month).padStart(2, "0")}`;
  const calendar = await loadClassCalendar(input.classId, { monthValue: month });
  const schoolDays = calendar.days
    .filter((day) => day.dayType === "class")
    .map((day) => day.date);
  const selectedDates = splitSchoolDays(schoolDays)[input.period];
  if (selectedDates.some((date) => date > calendar.serverTime.date)) {
    throw new ApiError(
      422,
      "이 기간의 수업일이 아직 끝나지 않아 지급 명단을 확정할 수 없어요.",
      "LIFE_CHECK_PERIOD_IN_PROGRESS",
    );
  }
  return calendar;
}

async function monthData(input: {
  context: LifeCheckContext;
  type: LifeCheckType;
  monthValue: string;
  period: LifeCheckPeriod;
}) {
  const { context, type, period } = input;
  const calendar = await loadClassCalendar(context.classroom.id, { monthValue: input.monthValue });
  const schoolDays = calendar.days.filter((day) => day.dayType === "class").map((day) => day.date);
  const periods = splitSchoolDays(schoolDays);
  const selectedDates = [...periods[period]];
  const [year, month] = input.monthValue.split("-").map(Number);
  const studentScope = context.permissions.canViewClass ? "" : " AND id = ?";
  const studentStatement = database().prepare(
    `SELECT id, student_number, official_name
     FROM students
     WHERE class_id = ? AND status <> 'excluded'${studentScope}
     ORDER BY student_number, id`,
  );
  const students = context.permissions.canViewClass
    ? await studentStatement.bind(context.classroom.id).all<StudentRow>()
    : await studentStatement.bind(context.classroom.id, context.actor.id).all<StudentRow>();
  const records = await database().prepare(
    `SELECT student_id, check_date, passed, revision, updated_at
     FROM life_check_records
     WHERE class_id = ? AND check_type = ? AND check_date >= ? AND check_date <= ?
     ORDER BY check_date, student_id`,
  ).bind(
    context.classroom.id,
    type,
    `${input.monthValue}-01`,
    `${input.monthValue}-31`,
  ).all<RecordRow>();
  const passed = new Set(
    records.results.filter((row) => Boolean(row.passed)).map((row) => `${row.student_id}:${row.check_date}`),
  );
  const items = students.results.map((student) => {
    const countFor = (dates: readonly string[]) => dates.filter((date) => passed.has(`${student.id}:${date}`)).length;
    const passedCount = countFor(selectedDates);
    const firstPassedCount = countFor(periods.first);
    const secondPassedCount = countFor(periods.second);
    const reward = calculateLifeCheckReward({
      type,
      period,
      passedCount,
      periodTotal: selectedDates.length,
      firstPassedCount,
      firstTotal: periods.first.length,
      secondPassedCount,
      secondTotal: periods.second.length,
    });
    return {
      studentId: student.id,
      studentNumber: Number(student.student_number),
      studentName: student.official_name,
      passedCount,
      totalCount: selectedDates.length,
      ...reward,
      amount: reward.amount,
      reason: rewardReason({
        type,
        year,
        month,
        period,
        passedCount,
        totalCount: selectedDates.length,
        bonusAmount: reward.bonusAmount,
      }),
    } satisfies PayoutItem;
  });
  return {
    calendar,
    year,
    month,
    schoolDays,
    periods,
    selectedDates,
    students: students.results,
    records: records.results,
    items,
  };
}

export async function lifeCheckOverviewForRequest(request: Request) {
  const context = await lifeCheckContextForRequest(request);
  const query = new URL(request.url).searchParams;
  const serverTime = seoulServerTime();
  let type: LifeCheckType;
  let period: LifeCheckPeriod;
  try {
    type = parseLifeCheckType(query.get("type") || context.allowedWriteTypes[0] || "tooth");
    period = parseLifeCheckPeriod(query.get("period") || (serverTime.day <= 15 ? "first" : "second"));
  } catch (error) {
    ruleError(error);
  }
  const selectedMonth = monthValue(query.get("month"), serverTime.monthValue);
  const canViewSelectedClass = context.actor.type === "teacher"
    || context.allowedWriteTypes.includes(type);
  const selectedContext: LifeCheckContext = {
    ...context,
    permissions: {
      ...context.permissions,
      canViewClass: canViewSelectedClass,
      canRecord: context.permissions.canRecord && (
        context.actor.type === "teacher" || context.allowedWriteTypes.includes(type)
      ),
      canManagePayouts: context.permissions.canManagePayouts && (
        context.actor.type === "teacher" || context.allowedWriteTypes.includes(type)
      ),
    },
  };
  const series = await ensureSeries(context.classroom.id, type);
  const data = await monthData({ context: selectedContext, type, monthValue: selectedMonth, period });
  const payout = await database().prepare(
    `SELECT id, check_type, payout_year, payout_month, payout_period, status,
            items_json, recipient_count, total_amount, source_series_revision,
            source_calendar_revision, revision, completed_at, cancelled_at, created_at, updated_at
     FROM life_check_payouts
     WHERE class_id = ? AND check_type = ? AND payout_year = ?
       AND payout_month = ? AND payout_period = ?`,
  ).bind(
    context.classroom.id,
    type,
    data.year,
    data.month,
    period,
  ).first<PayoutRow>();
  const currency = await database().prepare(
    `SELECT currency_unit FROM finance_settings WHERE class_id = ?`,
  ).bind(context.classroom.id).first<{ currency_unit: string }>();
  const visibleStudentIds = new Set(data.students.map((student) => student.id));
  const recordMap: Record<string, Record<string, boolean>> = {};
  for (const student of data.students) recordMap[student.id] = {};
  for (const record of data.records) {
    if (visibleStudentIds.has(record.student_id)) {
      recordMap[record.student_id][record.check_date] = Boolean(record.passed);
    }
  }
  const rewardItems = data.items.filter((item) => item.amount > 0);
  const auditUrl = new URL(request.url);
  for (const parameter of ["cursor", "from", "to", "limit"]) {
    auditUrl.searchParams.delete(parameter);
  }
  const recentPage = canViewSelectedClass
    ? await lifeCheckAuditPage(context, type, auditUrl)
    : { events: [] as LifeCheckAuditEvent[], nextCursor: null, hasMore: false };
  return {
    context: selectedContext,
    selection: {
      type,
      typeLabel: LIFE_CHECK_INFO[type].label,
      month: selectedMonth,
      year: data.year,
      monthNumber: data.month,
      period,
      periodLabel: period === "first" ? "상반기" : "하반기",
    },
    serverTime,
    calendar: {
      saved: data.calendar.saved,
      revision: data.calendar.revision,
      dates: data.selectedDates,
      firstDates: data.periods.first,
      secondDates: data.periods.second,
    },
    series,
    students: data.students.map((student) => ({
      id: student.id,
      number: Number(student.student_number),
      name: student.official_name,
      passedCount: data.items.find((item) => item.studentId === student.id)?.passedCount ?? 0,
      totalCount: data.selectedDates.length,
      expectedReward: data.items.find((item) => item.studentId === student.id)?.amount ?? 0,
    })),
    records: recordMap,
    preview: {
      items: rewardItems,
      recipientCount: rewardItems.length,
      totalAmount: rewardItems.reduce((sum, item) => sum + item.amount, 0),
      currencyUnit: currency?.currency_unit || "학급화폐",
    },
    payout: serializePayout(
      payout ?? null,
      canViewSelectedClass ? undefined : context.actor.id,
    ),
    recentEvents: recentPage.events,
    recentEventsNextCursor: recentPage.nextCursor,
  };
}

export async function setLifeCheckRecord(request: Request, body: {
  type?: unknown;
  date?: unknown;
  studentId?: unknown;
  passed?: unknown;
  reason?: unknown;
  expectedRevision?: unknown;
  requestId?: unknown;
}) {
  const context = await lifeCheckContextForRequest(request);
  let type: LifeCheckType;
  try {
    type = parseLifeCheckType(body.type);
  } catch (error) {
    ruleError(error);
  }
  requireLifeCheckWrite(context, type);
  const date = cleanText(body.date, 10);
  if (!DATE_PATTERN.test(date)) {
    throw new ApiError(400, "확인 날짜를 다시 선택해 주세요.", "LIFE_CHECK_DATE_INVALID");
  }
  if (date > seoulServerTime().date) {
    throw new ApiError(422, "미래 수업일은 아직 기록할 수 없어요.", "LIFE_CHECK_FUTURE_DATE");
  }
  if (typeof body.passed !== "boolean") {
    throw new ApiError(400, "확인 결과를 다시 선택해 주세요.", "LIFE_CHECK_VALUE_INVALID");
  }
  const studentId = cleanText(body.studentId, 100);
  const idempotencyKey = requestId(body.requestId);
  const expected = expectedRevision(body.expectedRevision);
  const reason = cleanText(body.reason, 160) || null;
  const actor = lifeCheckActorColumns(context);
  const duplicate = await recordReplay(context.classroom.id, idempotencyKey);
  if (duplicate) {
    if (
      duplicate.check_type !== type
      || duplicate.check_date !== date
      || duplicate.student_id !== studentId
      || Boolean(duplicate.passed) !== body.passed
      || duplicate.reason !== reason
      || Number(duplicate.series_revision) - 1 !== expected
      || !sameActor(duplicate, actor)
    ) idempotencyConflict();
    return { duplicate: true, revision: Number(duplicate.series_revision) };
  }

  const calendar = await loadClassCalendar(context.classroom.id, { monthValue: date.slice(0, 7) });
  const day = calendar.days.find((item) => item.date === date);
  if (!day || day.dayType !== "class") {
    throw new ApiError(422, "수업일에만 확인 결과를 기록할 수 있어요.", "LIFE_CHECK_NOT_CLASS_DAY");
  }
  const student = await database().prepare(
    `SELECT id FROM students WHERE id = ? AND class_id = ? AND status <> 'excluded'`,
  ).bind(studentId, context.classroom.id).first<{ id: string }>();
  if (!student) throw new ApiError(404, "학생을 찾을 수 없습니다.", "STUDENT_NOT_FOUND");
  const series = await ensureSeries(context.classroom.id, type);
  if (series.revision !== expected) {
    throw new ApiError(409, "다른 화면에서 기록이 먼저 바뀌었어요. 최신 내용을 불러왔습니다.", "LIFE_CHECK_STALE");
  }
  const now = Date.now();
  const nextRevision = expected + 1;
  const guardId = crypto.randomUUID();
  const db = database();
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO registration_operation_guards (id, operation, created_at)
         SELECT CASE WHEN EXISTS (
           SELECT 1 FROM life_check_series WHERE class_id = ? AND check_type = ? AND revision = ?
         ) THEN ? ELSE NULL END, 'life_check_record', ?`,
      ).bind(context.classroom.id, type, expected, guardId, now),
      db.prepare(
        `INSERT INTO life_check_records (
           id, class_id, check_type, check_date, student_id, passed, revision,
           last_actor_type, last_actor_teacher_id, last_actor_student_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
         ON CONFLICT(class_id, check_type, check_date, student_id) DO UPDATE SET
           passed = excluded.passed,
           revision = life_check_records.revision + 1,
           last_actor_type = excluded.last_actor_type,
           last_actor_teacher_id = excluded.last_actor_teacher_id,
           last_actor_student_id = excluded.last_actor_student_id,
           updated_at = excluded.updated_at`,
      ).bind(
        crypto.randomUUID(), context.classroom.id, type, date, studentId,
        body.passed ? 1 : 0, actor.actorType, actor.teacherId, actor.studentId, now, now,
      ),
      db.prepare(
        `UPDATE life_check_series SET revision = ?, updated_at = ?
         WHERE class_id = ? AND check_type = ? AND revision = ?`,
      ).bind(nextRevision, now, context.classroom.id, type, expected),
      db.prepare(
        `INSERT INTO life_check_events (
           id, request_id, class_id, check_type, check_date, student_id, passed, reason,
           actor_type, actor_teacher_id, actor_student_id, series_revision, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(), idempotencyKey, context.classroom.id, type, date, studentId,
        body.passed ? 1 : 0, reason, actor.actorType, actor.teacherId, actor.studentId,
        nextRevision, now,
      ),
      db.prepare(
        `INSERT INTO audit_logs (id, teacher_id, class_id, student_id, action, detail, created_at)
         VALUES (?, ?, ?, ?, 'life_check_recorded', ?, ?)`,
      ).bind(
        crypto.randomUUID(), actor.teacherId, context.classroom.id, actor.studentId,
        JSON.stringify({ type, date, targetStudentId: studentId, passed: body.passed, reason, revision: nextRevision }),
        now,
      ),
      db.prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
    ]);
  } catch (error) {
    const repeated = await recordReplay(context.classroom.id, idempotencyKey);
    if (repeated) {
      if (
        repeated.check_type !== type
        || repeated.check_date !== date
        || repeated.student_id !== studentId
        || Boolean(repeated.passed) !== body.passed
        || repeated.reason !== reason
        || Number(repeated.series_revision) - 1 !== expected
        || !sameActor(repeated, actor)
      ) idempotencyConflict();
      return { duplicate: true, revision: Number(repeated.series_revision) };
    }
    if (isOperationGuardFailure(error)) {
      throw new ApiError(409, "다른 화면에서 기록이 먼저 바뀌었어요. 최신 내용을 불러와 주세요.", "LIFE_CHECK_STALE");
    }
    throw error;
  }
  return { duplicate: false, revision: nextRevision };
}

export async function prepareLifeCheckPayout(request: Request, body: {
  type?: unknown;
  month?: unknown;
  period?: unknown;
  expectedSeriesRevision?: unknown;
  expectedCalendarRevision?: unknown;
  expectedPayoutRevision?: unknown;
  requestId?: unknown;
}) {
  const context = await lifeCheckContextForRequest(request);
  let type: LifeCheckType;
  let period: LifeCheckPeriod;
  try {
    type = parseLifeCheckType(body.type);
    period = parseLifeCheckPeriod(body.period);
  } catch (error) {
    ruleError(error);
  }
  requireLifeCheckWrite(context, type);
  if (!context.permissions.canManagePayouts) {
    throw new ApiError(403, "지급 명단을 만들 권한이 없어요.", "LIFE_CHECK_PAYOUT_FORBIDDEN");
  }
  const selectedMonth = monthValue(body.month, seoulServerTime().monthValue);
  const expectedSeries = expectedRevision(body.expectedSeriesRevision, "확인 기록");
  const expectedCalendar = expectedRevision(body.expectedCalendarRevision, "학급 달력");
  const expectedPayout = expectedRevision(body.expectedPayoutRevision ?? 0, "지급 명단");
  const idempotencyKey = requestId(body.requestId);
  const [selectedYear, selectedMonthNumber] = selectedMonth.split("-").map(Number);
  const actor = lifeCheckActorColumns(context);
  const duplicate = await payoutReplay(context.classroom.id, idempotencyKey);
  if (duplicate) {
    const detail = payoutEventDetail(duplicate.detail);
    if (
      (duplicate.action !== "prepared" && duplicate.action !== "refreshed")
      || duplicate.check_type !== type
      || Number(duplicate.payout_year) !== selectedYear
      || Number(duplicate.payout_month) !== selectedMonthNumber
      || duplicate.payout_period !== period
      || Number(detail.expectedSeriesRevision) !== expectedSeries
      || Number(detail.expectedCalendarRevision) !== expectedCalendar
      || Number(detail.expectedPayoutRevision) !== expectedPayout
      || !sameActor(duplicate, actor)
    ) idempotencyConflict();
    return { duplicate: true, payoutId: duplicate.payout_id };
  }
  const series = await ensureSeries(context.classroom.id, type);
  if (series.revision !== expectedSeries) {
    throw new ApiError(409, "확인 기록이 달라졌어요. 최신 계산 결과를 확인해 주세요.", "LIFE_CHECK_STALE");
  }
  const data = await monthData({ context: { ...context, permissions: { ...context.permissions, canViewClass: true } }, type, monthValue: selectedMonth, period });
  if (Number(data.calendar.revision) !== expectedCalendar) {
    throw new ApiError(409, "학급 달력이 바뀌었어요. 최신 지급 계산을 다시 확인해 주세요.", "LIFE_CHECK_CALENDAR_STALE");
  }
  if (data.selectedDates.some((date) => date > data.calendar.serverTime.date)) {
    throw new ApiError(
      422,
      "이 기간의 수업일이 아직 끝나지 않아 지급 명단을 만들 수 없어요.",
      "LIFE_CHECK_PERIOD_IN_PROGRESS",
    );
  }
  const items = data.items.filter((item) => item.amount > 0);
  if (!items.length) {
    throw new ApiError(422, "현재 기준으로 지급할 학생이 없어요.", "LIFE_CHECK_PAYOUT_EMPTY");
  }
  const current = await database().prepare(
    `SELECT id, status, revision FROM life_check_payouts
     WHERE class_id = ? AND check_type = ? AND payout_year = ? AND payout_month = ? AND payout_period = ?`,
  ).bind(context.classroom.id, type, data.year, data.month, period).first<{
    id: string;
    status: string;
    revision: number;
  }>();
  if (current?.status === "completed") {
    throw new ApiError(409, "이미 지급 완료한 명단입니다. 교사가 기록을 다시 열어야 해요.", "LIFE_CHECK_PAYOUT_COMPLETED");
  }
  if (current?.status === "cancelled") {
    throw new ApiError(409, "취소한 지급 명단은 교사가 먼저 다시 열어야 해요.", "LIFE_CHECK_PAYOUT_CANCELLED");
  }
  if (Number(current?.revision ?? 0) !== expectedPayout) {
    throw new ApiError(409, "지급 명단이 다른 화면에서 바뀌었어요.", "LIFE_CHECK_PAYOUT_STALE");
  }
  const now = Date.now();
  const payoutId = current?.id ?? crypto.randomUUID();
  const nextPayoutRevision = expectedPayout + 1;
  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
  const action = current ? "refreshed" : "prepared";
  const db = database();
  const guardId = crypto.randomUUID();
  try {
    const prepareGuard = current
      ? db.prepare(
        `INSERT INTO registration_operation_guards (id, operation, created_at)
         SELECT CASE WHEN EXISTS (
           SELECT 1 FROM life_check_series
           WHERE class_id = ? AND check_type = ? AND revision = ?
         ) AND COALESCE((
           SELECT revision FROM class_calendars WHERE class_id = ?
         ), 0) = ?
         AND EXISTS (
           SELECT 1 FROM life_check_payouts
           WHERE id = ? AND class_id = ? AND revision = ? AND status = 'prepared'
         ) THEN ? ELSE NULL END, 'life_check_payout_prepare', ?`,
      ).bind(
        context.classroom.id, type, expectedSeries,
        context.classroom.id, expectedCalendar,
        payoutId, context.classroom.id, expectedPayout,
        guardId, now,
      )
      : db.prepare(
        `INSERT INTO registration_operation_guards (id, operation, created_at)
         SELECT CASE WHEN EXISTS (
           SELECT 1 FROM life_check_series
           WHERE class_id = ? AND check_type = ? AND revision = ?
         ) AND COALESCE((
           SELECT revision FROM class_calendars WHERE class_id = ?
         ), 0) = ?
         AND NOT EXISTS (
           SELECT 1 FROM life_check_payouts
           WHERE class_id = ? AND check_type = ? AND payout_year = ?
             AND payout_month = ? AND payout_period = ?
         ) THEN ? ELSE NULL END, 'life_check_payout_prepare', ?`,
      ).bind(
        context.classroom.id, type, expectedSeries,
        context.classroom.id, expectedCalendar,
        context.classroom.id, type, data.year, data.month, period,
        guardId, now,
      );
    const writePayout = current
      ? db.prepare(
         `UPDATE life_check_payouts
         SET status = 'prepared', items_json = ?, recipient_count = ?, total_amount = ?,
             source_series_revision = ?, source_calendar_revision = ?, revision = ?,
             last_actor_type = ?, last_actor_teacher_id = ?, last_actor_student_id = ?,
             cancelled_at = NULL, updated_at = ?
         WHERE id = ? AND class_id = ? AND revision = ? AND status = 'prepared'`,
      ).bind(
        JSON.stringify(items), items.length, totalAmount, expectedSeries, expectedCalendar,
        nextPayoutRevision, actor.actorType, actor.teacherId, actor.studentId,
        now, payoutId, context.classroom.id, expectedPayout,
      )
      : db.prepare(
        `INSERT INTO life_check_payouts (
           id, class_id, check_type, payout_year, payout_month, payout_period, status,
           items_json, recipient_count, total_amount, source_series_revision, revision,
           source_calendar_revision,
           created_by_actor_type, created_by_teacher_id, created_by_student_id,
           last_actor_type, last_actor_teacher_id, last_actor_student_id,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        payoutId, context.classroom.id, type, data.year, data.month, period,
        JSON.stringify(items), items.length, totalAmount, expectedSeries,
        expectedCalendar,
        actor.actorType, actor.teacherId, actor.studentId,
        actor.actorType, actor.teacherId, actor.studentId,
        now, now,
      );
    await db.batch([
      prepareGuard,
      writePayout,
      db.prepare(
        `INSERT INTO life_check_payout_events (
           id, request_id, payout_id, class_id, action, actor_type,
           actor_teacher_id, actor_student_id, detail, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(), idempotencyKey, payoutId, context.classroom.id, action,
        actor.actorType, actor.teacherId, actor.studentId,
        JSON.stringify({
          type,
          month: selectedMonth,
          period,
          recipientCount: items.length,
          totalAmount,
          items,
          sourceSeriesRevision: expectedSeries,
          expectedSeriesRevision: expectedSeries,
          expectedCalendarRevision: expectedCalendar,
          expectedPayoutRevision: expectedPayout,
          revision: nextPayoutRevision,
        }),
        now,
      ),
      db.prepare(
        `INSERT INTO audit_logs (id, teacher_id, class_id, student_id, action, detail, created_at)
         VALUES (?, ?, ?, ?, 'life_check_payout_prepared', ?, ?)`,
      ).bind(
        crypto.randomUUID(), actor.teacherId, context.classroom.id, actor.studentId,
        JSON.stringify({ payoutId, type, month: selectedMonth, period, recipientCount: items.length, totalAmount }),
        now,
      ),
      db.prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
    ]);
  } catch (error) {
    const repeated = await payoutReplay(context.classroom.id, idempotencyKey);
    if (repeated) {
      const detail = payoutEventDetail(repeated.detail);
      if (
        (repeated.action !== "prepared" && repeated.action !== "refreshed")
        || repeated.check_type !== type
        || Number(repeated.payout_year) !== selectedYear
        || Number(repeated.payout_month) !== selectedMonthNumber
        || repeated.payout_period !== period
        || Number(detail.expectedSeriesRevision) !== expectedSeries
        || Number(detail.expectedCalendarRevision) !== expectedCalendar
        || Number(detail.expectedPayoutRevision) !== expectedPayout
        || !sameActor(repeated, actor)
      ) idempotencyConflict();
      return { duplicate: true, payoutId: repeated.payout_id };
    }
    if (isOperationGuardFailure(error)) {
      const latestSeries = await ensureSeries(context.classroom.id, type);
      if (latestSeries.revision !== expectedSeries) {
        throw new ApiError(409, "확인 기록이 달라졌어요. 최신 계산 결과를 확인해 주세요.", "LIFE_CHECK_STALE");
      }
      if (await currentCalendarRevision(context.classroom.id) !== expectedCalendar) {
        throw new ApiError(409, "학급 달력이 바뀌었어요. 최신 지급 계산을 다시 확인해 주세요.", "LIFE_CHECK_CALENDAR_STALE");
      }
      throw new ApiError(409, "지급 명단이 다른 화면에서 먼저 바뀌었어요.", "LIFE_CHECK_PAYOUT_STALE");
    }
    throw error;
  }
  return {
    duplicate: false,
    payoutId,
    revision: nextPayoutRevision,
    recipientCount: items.length,
    totalAmount,
  };
}

export async function updateLifeCheckPayout(
  request: Request,
  payoutId: string,
  body: {
    action?: unknown;
    expectedRevision?: unknown;
    requestId?: unknown;
    reason?: unknown;
  },
) {
  const context = await lifeCheckContextForRequest(request);
  const action = body.action === "complete" || body.action === "cancel" || body.action === "reopen"
    ? body.action
    : null;
  if (!action) throw new ApiError(400, "처리 방법을 다시 선택해 주세요.", "LIFE_CHECK_PAYOUT_ACTION_INVALID");
  const expected = expectedRevision(body.expectedRevision, "지급 명단");
  const idempotencyKey = requestId(body.requestId);
  const reason = cleanText(body.reason, 200);
  if ((action === "cancel" || action === "reopen") && !reason) {
    throw new ApiError(400, "취소하거나 다시 여는 이유를 적어 주세요.", "LIFE_CHECK_PAYOUT_REASON_REQUIRED");
  }
  const current = await database().prepare(
    `SELECT id, class_id, check_type, payout_year, payout_month, payout_period,
            status, items_json, source_series_revision, source_calendar_revision, revision
     FROM life_check_payouts WHERE id = ?`,
  ).bind(payoutId).first<{
    id: string;
    class_id: string;
    check_type: LifeCheckType;
    payout_year: number;
    payout_month: number;
    payout_period: LifeCheckPeriod;
    status: "prepared" | "completed" | "cancelled";
    items_json: string;
    source_series_revision: number;
    source_calendar_revision: number;
    revision: number;
  }>();
  if (!current || current.class_id !== context.classroom.id) {
    throw new ApiError(404, "지급 명단을 찾을 수 없습니다.", "LIFE_CHECK_PAYOUT_NOT_FOUND");
  }
  requireLifeCheckWrite(context, current.check_type);
  if (action === "reopen" && !context.permissions.canOverride) {
    throw new ApiError(403, "완료된 지급 기록은 선생님만 다시 열 수 있어요.", "LIFE_CHECK_OVERRIDE_REQUIRED");
  }
  const actor = lifeCheckActorColumns(context);
  const eventAction = action === "complete" ? "completed" : action === "cancel" ? "cancelled" : "reopened";
  const duplicate = await payoutReplay(context.classroom.id, idempotencyKey);
  if (duplicate) {
    const detail = payoutEventDetail(duplicate.detail);
    if (
      duplicate.payout_id !== payoutId
      || duplicate.action !== eventAction
      || (typeof detail.reason === "string" ? detail.reason : "") !== reason
      || Number(detail.expectedRevision) !== expected
      || !sameActor(duplicate, actor)
    ) idempotencyConflict();
    return {
      duplicate: true,
      payoutId,
      revision: Number.isInteger(detail.revision) ? Number(detail.revision) : Number(duplicate.revision),
    };
  }
  if (Number(current.revision) !== expected) {
    throw new ApiError(409, "지급 기록이 다른 화면에서 먼저 바뀌었어요.", "LIFE_CHECK_PAYOUT_STALE");
  }
  if (action === "complete" && current.status !== "prepared") {
    throw new ApiError(409, "준비된 지급 명단만 완료할 수 있어요.", "LIFE_CHECK_PAYOUT_STATE_INVALID");
  }
  if (action === "cancel" && current.status !== "prepared") {
    throw new ApiError(409, "준비된 지급 명단만 취소할 수 있어요.", "LIFE_CHECK_PAYOUT_STATE_INVALID");
  }
  if (action === "reopen" && current.status === "prepared") {
    throw new ApiError(409, "이미 다시 확인할 수 있는 지급 명단입니다.", "LIFE_CHECK_PAYOUT_STATE_INVALID");
  }
  if (action === "complete") {
    await assertLifeCheckPeriodEnded({
      classId: context.classroom.id,
      year: Number(current.payout_year),
      month: Number(current.payout_month),
      period: current.payout_period,
    });
    const series = await ensureSeries(context.classroom.id, current.check_type);
    const calendarRevision = await currentCalendarRevision(context.classroom.id);
    if (
      series.revision !== Number(current.source_series_revision)
      || calendarRevision !== Number(current.source_calendar_revision)
    ) {
      throw new ApiError(409, "확인 기록이 바뀌어 지급 명단을 다시 만들어야 해요.", "LIFE_CHECK_PAYOUT_OUTDATED");
    }
  }
  const now = Date.now();
  const nextRevision = expected + 1;
  const nextStatus = action === "complete" ? "completed" : action === "cancel" ? "cancelled" : "prepared";
  const db = database();
  const guardId = crypto.randomUUID();
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO registration_operation_guards (id, operation, created_at)
         SELECT CASE WHEN EXISTS (
           SELECT 1 FROM life_check_payouts payout
           WHERE payout.id = ? AND payout.class_id = ? AND payout.revision = ?
             AND (? <> 'complete' OR EXISTS (
               SELECT 1 FROM life_check_series series
               WHERE series.class_id = payout.class_id
                 AND series.check_type = payout.check_type
                 AND series.revision = payout.source_series_revision
             ) AND COALESCE((
               SELECT revision FROM class_calendars
               WHERE class_id = payout.class_id
             ), 0) = payout.source_calendar_revision)
         ) THEN ? ELSE NULL END, 'life_check_payout_update', ?`,
      ).bind(payoutId, context.classroom.id, expected, action, guardId, now),
      db.prepare(
         `UPDATE life_check_payouts
         SET status = ?, revision = ?,
             last_actor_type = ?, last_actor_teacher_id = ?, last_actor_student_id = ?,
             completed_by_actor_type = CASE WHEN ? = 'completed' THEN ? ELSE NULL END,
             completed_by_teacher_id = CASE WHEN ? = 'completed' THEN ? ELSE NULL END,
             completed_by_student_id = CASE WHEN ? = 'completed' THEN ? ELSE NULL END,
             completed_at = CASE WHEN ? = 'completed' THEN ? ELSE NULL END,
             cancelled_at = CASE WHEN ? = 'cancelled' THEN ? ELSE NULL END,
             updated_at = ?
         WHERE id = ? AND class_id = ? AND revision = ?`,
      ).bind(
        nextStatus, nextRevision,
        actor.actorType, actor.teacherId, actor.studentId,
        nextStatus, actor.actorType,
        nextStatus, actor.teacherId,
        nextStatus, actor.studentId,
        nextStatus, now,
        nextStatus, now,
        now, payoutId, context.classroom.id, expected,
      ),
      db.prepare(
        `INSERT INTO life_check_payout_events (
           id, request_id, payout_id, class_id, action, actor_type,
           actor_teacher_id, actor_student_id, detail, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(), idempotencyKey, payoutId, context.classroom.id, eventAction,
        actor.actorType, actor.teacherId, actor.studentId,
        JSON.stringify({
          reason: reason || null,
          from: current.status,
          to: nextStatus,
          expectedRevision: expected,
          revision: nextRevision,
          items: safeJsonItems(current.items_json),
        }),
        now,
      ),
      db.prepare(
        `INSERT INTO audit_logs (id, teacher_id, class_id, student_id, action, detail, created_at)
         VALUES (?, ?, ?, ?, 'life_check_payout_updated', ?, ?)`,
      ).bind(
        crypto.randomUUID(), actor.teacherId, context.classroom.id, actor.studentId,
        JSON.stringify({ payoutId, action, reason: reason || null, revision: nextRevision }), now,
      ),
      db.prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
    ]);
  } catch (error) {
    const repeated = await payoutReplay(context.classroom.id, idempotencyKey);
    if (repeated) {
      const detail = payoutEventDetail(repeated.detail);
      if (
        repeated.payout_id !== payoutId
        || repeated.action !== eventAction
        || (typeof detail.reason === "string" ? detail.reason : "") !== reason
        || Number(detail.expectedRevision) !== expected
        || !sameActor(repeated, actor)
      ) idempotencyConflict();
      return {
        duplicate: true,
        payoutId,
        revision: Number.isInteger(detail.revision) ? Number(detail.revision) : Number(repeated.revision),
      };
    }
    if (isOperationGuardFailure(error)) {
      if (action === "complete") {
        const series = await ensureSeries(context.classroom.id, current.check_type);
        const calendarRevision = await currentCalendarRevision(context.classroom.id);
        if (
          series.revision !== Number(current.source_series_revision)
          || calendarRevision !== Number(current.source_calendar_revision)
        ) {
          throw new ApiError(409, "확인 기록이 바뀌어 지급 명단을 다시 만들어야 해요.", "LIFE_CHECK_PAYOUT_OUTDATED");
        }
      }
      throw new ApiError(409, "지급 기록이 다른 화면에서 먼저 바뀌었어요.", "LIFE_CHECK_PAYOUT_STALE");
    }
    throw error;
  }
  return { duplicate: false, payoutId, status: nextStatus, revision: nextRevision };
}
