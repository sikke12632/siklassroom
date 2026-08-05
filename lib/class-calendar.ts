import { database, ensureSchema, isOperationGuardFailure } from "./database";
import { cleanDisplayText, integerInRange } from "./identity";
import { ApiError } from "./responses";
import { SEOUL_TIME_ZONE, seoulServerTime } from "./seoul-time";

export type CalendarDayType = "class" | "off";

export type ClassCalendarDay = {
  date: string;
  dayType: CalendarDayType;
  memo: string;
  isWeekend: boolean;
};

type CalendarRow = {
  class_id: string;
  school_year: number;
  time_zone: string;
  class_start_date: string;
  first_job_start_date: string;
  first_job_end_date: string;
  revision: number;
  saved_at: number;
  updated_at: number;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

function assertDate(value: unknown, label: string) {
  const date = cleanDisplayText(value, 10);
  if (!DATE_PATTERN.test(date)) {
    throw new ApiError(400, `${label}을 다시 확인해 주세요.`, "INVALID_CALENDAR_DATE");
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new ApiError(400, `${label}을 다시 확인해 주세요.`, "INVALID_CALENDAR_DATE");
  }
  return date;
}

function addUtcDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function isWeekend(date: string) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function daysInMonth(monthValue: string) {
  if (!MONTH_PATTERN.test(monthValue)) {
    throw new ApiError(400, "달력의 연도와 월을 다시 확인해 주세요.", "INVALID_CALENDAR_MONTH");
  }
  const [year, month] = monthValue.split("-").map(Number);
  if (year < 2020 || year > 2100 || month < 1 || month > 12) {
    throw new ApiError(400, "달력의 연도와 월을 다시 확인해 주세요.", "INVALID_CALENDAR_MONTH");
  }
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function defaultCalendarDates(epochMs = Date.now()) {
  const serverTime = seoulServerTime(epochMs);
  return {
    classStartDate: serverTime.date,
    firstJobStartDate: serverTime.date,
    firstJobEndDate: addUtcDays(serverTime.date, 27),
  };
}

async function calendarRow(classId: string) {
  await ensureSchema();
  return database().prepare(
    `SELECT class_id, school_year, time_zone, class_start_date,
            first_job_start_date, first_job_end_date, revision, saved_at, updated_at
     FROM class_calendars WHERE class_id = ?`,
  ).bind(classId).first<CalendarRow>();
}

async function calendarDays(classId: string, monthValue: string): Promise<ClassCalendarDay[]> {
  const count = daysInMonth(monthValue);
  const stored = await database().prepare(
    `SELECT calendar_date, day_type, memo
     FROM class_calendar_days
     WHERE class_id = ? AND calendar_date >= ? AND calendar_date <= ?
     ORDER BY calendar_date`,
  ).bind(classId, `${monthValue}-01`, `${monthValue}-${String(count).padStart(2, "0")}`)
    .all<{ calendar_date: string; day_type: CalendarDayType; memo: string | null }>();
  const byDate = new Map(stored.results.map((row) => [row.calendar_date, row]));
  return Array.from({ length: count }, (_, index) => {
    const date = `${monthValue}-${String(index + 1).padStart(2, "0")}`;
    const saved = byDate.get(date);
    const weekend = isWeekend(date);
    return {
      date,
      dayType: saved?.day_type === "off" || saved?.day_type === "class"
        ? saved.day_type
        : weekend ? "off" : "class",
      memo: saved?.memo ?? "",
      isWeekend: weekend,
    };
  });
}

export async function loadClassCalendar(
  classId: string,
  options: { monthValue?: string | null; epochMs?: number } = {},
) {
  const serverTime = seoulServerTime(options.epochMs);
  const current = await calendarRow(classId);
  const defaults = defaultCalendarDates(serverTime.epochMs);
  const monthValue = options.monthValue || current?.first_job_start_date.slice(0, 7) || serverTime.monthValue;
  const days = await calendarDays(classId, monthValue);
  return {
    saved: Boolean(current),
    schoolYear: Number(current?.school_year ?? serverTime.year),
    timeZone: current?.time_zone ?? SEOUL_TIME_ZONE,
    timeZoneLabel: "대한민국 표준시",
    classStartDate: current?.class_start_date ?? defaults.classStartDate,
    firstJobStartDate: current?.first_job_start_date ?? defaults.firstJobStartDate,
    firstJobEndDate: current?.first_job_end_date ?? defaults.firstJobEndDate,
    revision: Number(current?.revision ?? 0),
    savedAt: current?.saved_at ? Number(current.saved_at) : null,
    updatedAt: current?.updated_at ? Number(current.updated_at) : null,
    monthValue,
    days,
    serverTime,
  };
}

export async function requireSavedClassCalendar(classId: string) {
  const current = await calendarRow(classId);
  if (!current) {
    throw new ApiError(409, "달력을 먼저 저장한 뒤 첫 직업 배정을 시작해 주세요.", "CALENDAR_REQUIRED");
  }
  return {
    classId: current.class_id,
    schoolYear: Number(current.school_year),
    timeZone: current.time_zone,
    classStartDate: current.class_start_date,
    firstJobStartDate: current.first_job_start_date,
    firstJobEndDate: current.first_job_end_date,
    revision: Number(current.revision),
  };
}

export async function saveClassCalendar(input: {
  classId: string;
  teacherId: string;
  expectedRevision: unknown;
  schoolYear: unknown;
  classStartDate: unknown;
  firstJobStartDate: unknown;
  firstJobEndDate: unknown;
  days: unknown;
}) {
  await ensureSchema();
  const expectedRevision = Number(input.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new ApiError(400, "달력 저장 버전을 다시 확인해 주세요.", "INVALID_CALENDAR_REVISION");
  }
  const schoolYear = integerInRange(input.schoolYear, 2020, 2100);
  if (!schoolYear) throw new ApiError(400, "학년도를 다시 확인해 주세요.", "INVALID_SCHOOL_YEAR");
  const classStartDate = assertDate(input.classStartDate, "학급 운영 시작일");
  const firstJobStartDate = assertDate(input.firstJobStartDate, "첫 직업 시작일");
  const firstJobEndDate = assertDate(input.firstJobEndDate, "첫 직업 종료일");
  if (classStartDate > firstJobStartDate) {
    throw new ApiError(422, "첫 직업 시작일은 학급 운영 시작일보다 빠를 수 없어요.", "INVALID_JOB_PERIOD");
  }
  if (firstJobStartDate > firstJobEndDate) {
    throw new ApiError(422, "첫 직업 종료일은 시작일보다 빠를 수 없어요.", "INVALID_JOB_PERIOD");
  }
  if (!Array.isArray(input.days) || input.days.length < 1 || input.days.length > 62) {
    throw new ApiError(400, "날짜별 수업일 설정을 다시 확인해 주세요.", "INVALID_CALENDAR_DAYS");
  }
  const seen = new Set<string>();
  const days = input.days.map((raw) => {
    const item = (raw ?? {}) as { date?: unknown; dayType?: unknown; memo?: unknown };
    const date = assertDate(item.date, "달력 날짜");
    if (seen.has(date)) throw new ApiError(400, "같은 날짜를 두 번 저장할 수 없어요.", "DUPLICATE_CALENDAR_DATE");
    seen.add(date);
    const dayType = item.dayType === "off" ? "off" : item.dayType === "class" ? "class" : null;
    if (!dayType) throw new ApiError(400, "수업일 또는 쉬는 날을 선택해 주세요.", "INVALID_DAY_TYPE");
    return { date, dayType, memo: cleanDisplayText(item.memo, 80) || null };
  });

  const current = await calendarRow(input.classId);
  if (Number(current?.revision ?? 0) !== expectedRevision) {
    throw new ApiError(
      409,
      "다른 화면에서 달력을 먼저 저장했어요. 최신 달력을 불러온 뒤 다시 저장해 주세요.",
      "CALENDAR_STALE",
    );
  }
  const now = Date.now();
  const nextRevision = expectedRevision + 1;
  const guardId = crypto.randomUUID();
  const db = database();
  const calendarStatement = current
    ? db.prepare(
      `UPDATE class_calendars SET school_year = ?, time_zone = ?,
         class_start_date = ?, first_job_start_date = ?, first_job_end_date = ?,
         revision = ?, updated_at = ?
       WHERE class_id = ? AND revision = ?`,
    ).bind(
      schoolYear, SEOUL_TIME_ZONE, classStartDate, firstJobStartDate, firstJobEndDate,
      nextRevision, now, input.classId, expectedRevision,
    )
    : db.prepare(
      `INSERT INTO class_calendars (
         class_id, school_year, time_zone, class_start_date, first_job_start_date,
         first_job_end_date, revision, saved_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(
      input.classId, schoolYear, SEOUL_TIME_ZONE, classStartDate,
      firstJobStartDate, firstJobEndDate, now, now,
    );
  const currentRevisionGuard = current
    ? db.prepare(
      `INSERT INTO registration_operation_guards (id, operation, created_at)
       SELECT CASE WHEN EXISTS (
         SELECT 1 FROM class_calendars WHERE class_id = ? AND revision = ?
       ) THEN ? ELSE NULL END, 'class_calendar_save', ?`,
    ).bind(input.classId, expectedRevision, guardId, now)
    : db.prepare(
      `INSERT INTO registration_operation_guards (id, operation, created_at)
       SELECT CASE WHEN NOT EXISTS (
         SELECT 1 FROM class_calendars WHERE class_id = ?
       ) THEN ? ELSE NULL END, 'class_calendar_save', ?`,
    ).bind(input.classId, guardId, now);
  try {
    await db.batch([
      currentRevisionGuard,
      calendarStatement,
      db.prepare(
        `UPDATE classes SET school_year = ?, time_zone = ?, setup_stage =
           CASE WHEN setup_stage IN ('roster', 'jobs') THEN 'calendar' ELSE setup_stage END,
           updated_at = ? WHERE id = ?`,
      ).bind(schoolYear, SEOUL_TIME_ZONE, now, input.classId),
      ...days.map((day) => db.prepare(
        `INSERT INTO class_calendar_days (
           id, class_id, calendar_date, day_type, memo, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(class_id, calendar_date) DO UPDATE SET
           day_type = excluded.day_type, memo = excluded.memo, updated_at = excluded.updated_at`,
      ).bind(crypto.randomUUID(), input.classId, day.date, day.dayType, day.memo, now, now)),
      db.prepare(
        `INSERT INTO audit_logs (
           id, teacher_id, class_id, student_id, action, detail, created_at
         ) VALUES (?, ?, ?, NULL, 'class_calendar_saved', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        input.teacherId,
        input.classId,
        JSON.stringify({
          revision: nextRevision,
          classStartDate,
          firstJobStartDate,
          firstJobEndDate,
        }),
        now,
      ),
      db.prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
    ]);
  } catch (error) {
    if (isOperationGuardFailure(error)) {
      throw new ApiError(
        409,
        "다른 화면에서 달력을 먼저 저장했어요. 최신 달력을 불러온 뒤 다시 저장해 주세요.",
        "CALENDAR_STALE",
      );
    }
    throw error;
  }
  return loadClassCalendar(input.classId, { monthValue: days[0].date.slice(0, 7), epochMs: now });
}
