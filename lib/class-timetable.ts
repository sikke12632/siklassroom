import { database, ensureSchema, isOperationGuardFailure } from "./database";
import { integerInRange } from "./identity";
import { ApiError } from "./responses";

export type ClassTimetableSlot = {
  id: string;
  weekday: number;
  period: number;
  subject: string;
};

type TimetableRow = {
  class_id: string;
  period_count: number;
  revision: number;
  created_at: number;
  updated_at: number;
};

type TimetableSnapshotRow = TimetableRow & {
  slot_id: string | null;
  slot_weekday: number | null;
  slot_period_number: number | null;
  slot_subject_name: string | null;
};

const DEFAULT_PERIOD_COUNT = 6;
const MAX_TIMETABLE_SLOTS = 50;

function timetableStale(): never {
  throw new ApiError(
    409,
    "다른 화면에서 시간표를 먼저 저장했어요. 최신 시간표를 불러온 뒤 다시 저장해 주세요.",
    "TIMETABLE_STALE",
  );
}

function stableSlotId(classId: string, weekday: number, periodNumber: number) {
  return `${classId}:timetable:${weekday}:${periodNumber}`;
}

function subjectName(value: unknown) {
  if (typeof value !== "string") {
    throw new ApiError(400, "과목 이름을 입력해 주세요.", "INVALID_TIMETABLE_SUBJECT");
  }
  const normalized = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (normalized.length < 1 || normalized.length > 40) {
    throw new ApiError(
      400,
      "과목 이름은 1자 이상 40자 이하로 입력해 주세요.",
      "INVALID_TIMETABLE_SUBJECT",
    );
  }
  return normalized;
}

function normalizeSlots(classId: string, periodCount: number, value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_TIMETABLE_SLOTS) {
    throw new ApiError(
      400,
      "시간표 칸은 최대 50개까지 저장할 수 있어요.",
      "INVALID_TIMETABLE_SLOTS",
    );
  }

  const seen = new Set<string>();
  const slots = value.map((raw) => {
    const item = (raw ?? {}) as {
      weekday?: unknown;
      period?: unknown;
      subject?: unknown;
    };
    const weekday = integerInRange(item.weekday, 1, 5);
    const period = integerInRange(item.period, 1, 10);
    if (!weekday || !period) {
      throw new ApiError(
        400,
        "요일과 교시를 다시 확인해 주세요.",
        "INVALID_TIMETABLE_SLOT",
      );
    }
    if (period > periodCount) {
      throw new ApiError(
        422,
        `${periodCount}교시보다 뒤의 시간표 칸은 저장할 수 없어요.`,
        "TIMETABLE_SLOT_OUTSIDE_PERIOD_COUNT",
      );
    }
    const position = `${weekday}:${period}`;
    if (seen.has(position)) {
      throw new ApiError(
        400,
        "같은 요일과 교시를 두 번 저장할 수 없어요.",
        "DUPLICATE_TIMETABLE_SLOT",
      );
    }
    seen.add(position);
    return {
      id: stableSlotId(classId, weekday, period),
      weekday,
      period,
      subject: subjectName(item.subject),
    };
  });

  return slots.sort((left, right) => (
    left.weekday - right.weekday || left.period - right.period
  ));
}

async function timetableRow(classId: string) {
  await ensureSchema();
  return database().prepare(
    `SELECT class_id, period_count, revision, created_at, updated_at
     FROM class_timetables WHERE class_id = ?`,
  ).bind(classId).first<TimetableRow>();
}

export async function loadClassTimetable(classId: string) {
  await ensureSchema();
  const result = await database().prepare(
    `SELECT timetable.class_id, timetable.period_count, timetable.revision,
            timetable.created_at, timetable.updated_at,
            slot.id AS slot_id, slot.weekday AS slot_weekday,
            slot.period_number AS slot_period_number,
            slot.subject_name AS slot_subject_name
     FROM class_timetables timetable
     LEFT JOIN class_timetable_slots slot ON slot.class_id = timetable.class_id
     WHERE timetable.class_id = ?
     ORDER BY slot.weekday, slot.period_number`,
  ).bind(classId).all<TimetableSnapshotRow>();
  const current = result.results[0] ?? null;

  return {
    saved: Boolean(current),
    periodCount: Number(current?.period_count ?? DEFAULT_PERIOD_COUNT),
    revision: Number(current?.revision ?? 0),
    createdAt: current ? Number(current.created_at) : null,
    updatedAt: current ? Number(current.updated_at) : null,
    slots: result.results.flatMap((slot): ClassTimetableSlot[] => (
      slot.slot_id && slot.slot_weekday !== null
        && slot.slot_period_number !== null && slot.slot_subject_name !== null
        ? [{
            id: slot.slot_id,
            weekday: Number(slot.slot_weekday),
            period: Number(slot.slot_period_number),
            subject: slot.slot_subject_name,
          }]
        : []
    )),
  };
}

export async function saveClassTimetable(input: {
  classId: string;
  teacherId: string;
  expectedRevision: unknown;
  periodCount: unknown;
  slots: unknown;
}) {
  await ensureSchema();
  const expectedRevision = Number(input.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new ApiError(
      400,
      "시간표 저장 버전을 다시 확인해 주세요.",
      "INVALID_TIMETABLE_REVISION",
    );
  }
  const periodCount = integerInRange(input.periodCount, 1, 10);
  if (!periodCount) {
    throw new ApiError(
      400,
      "하루 교시 수는 1교시부터 10교시 사이로 정해 주세요.",
      "INVALID_TIMETABLE_PERIOD_COUNT",
    );
  }
  const slots = normalizeSlots(input.classId, periodCount, input.slots);
  const current = await timetableRow(input.classId);
  if (Number(current?.revision ?? 0) !== expectedRevision) timetableStale();

  const now = Date.now();
  const nextRevision = expectedRevision + 1;
  const guardId = crypto.randomUUID();
  const db = database();
  const revisionGuard = current
    ? db.prepare(
      `INSERT INTO registration_operation_guards (id, operation, created_at)
       SELECT CASE WHEN EXISTS (
         SELECT 1 FROM class_timetables WHERE class_id = ? AND revision = ?
       ) AND EXISTS (
         SELECT 1 FROM classes
         WHERE id = ? AND teacher_id = ? AND status = 'active'
       ) THEN ? ELSE NULL END, 'class_timetable_save', ?`,
    ).bind(
      input.classId,
      expectedRevision,
      input.classId,
      input.teacherId,
      guardId,
      now,
    )
    : db.prepare(
      `INSERT INTO registration_operation_guards (id, operation, created_at)
       SELECT CASE WHEN NOT EXISTS (
         SELECT 1 FROM class_timetables WHERE class_id = ?
       ) AND EXISTS (
         SELECT 1 FROM classes
         WHERE id = ? AND teacher_id = ? AND status = 'active'
       ) THEN ? ELSE NULL END, 'class_timetable_save', ?`,
    ).bind(input.classId, input.classId, input.teacherId, guardId, now);
  const timetableStatement = current
    ? db.prepare(
      `UPDATE class_timetables
       SET period_count = ?, revision = ?, updated_at = ?
       WHERE class_id = ? AND revision = ?`,
    ).bind(periodCount, nextRevision, now, input.classId, expectedRevision)
    : db.prepare(
      `INSERT INTO class_timetables (
         class_id, period_count, revision, created_at, updated_at
       ) VALUES (?, ?, 1, ?, ?)`,
    ).bind(input.classId, periodCount, now, now);

  try {
    await db.batch([
      revisionGuard,
      timetableStatement,
      db.prepare(`DELETE FROM class_timetable_slots WHERE class_id = ?`).bind(input.classId),
      ...slots.map((slot) => db.prepare(
        `INSERT INTO class_timetable_slots (
           id, class_id, weekday, period_number, subject_name, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        slot.id,
        input.classId,
        slot.weekday,
        slot.period,
        slot.subject,
        now,
        now,
      )),
      db.prepare(
        `INSERT INTO audit_logs (
           id, teacher_id, class_id, student_id, action, detail, created_at
         ) VALUES (?, ?, ?, NULL, 'class_timetable_saved', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        input.teacherId,
        input.classId,
        JSON.stringify({
          revision: nextRevision,
          periodCount,
          slotCount: slots.length,
        }),
        now,
      ),
      db.prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
    ]);
  } catch (error) {
    if (isOperationGuardFailure(error)) timetableStale();
    throw error;
  }

  return loadClassTimetable(input.classId);
}
