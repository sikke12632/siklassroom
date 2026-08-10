export type TimetableSlot = {
  id: string;
  weekday: number;
  period: number;
  subject: string;
};

export type TimetableState = {
  saved: boolean;
  revision: number;
  periodCount: number;
  slots: TimetableSlot[];
};

export type TimetableDraft = {
  saved: boolean;
  revision: number;
  periodCount: number;
  subjects: Record<string, string>;
};

export type TimetableChange = {
  key: string;
  label: string;
  previous: string;
  latest: string;
  local: string;
  collision: boolean;
};

export const TIMETABLE_WEEKDAYS = [
  { value: 1, short: "월", label: "월요일" },
  { value: 2, short: "화", label: "화요일" },
  { value: 3, short: "수", label: "수요일" },
  { value: 4, short: "목", label: "목요일" },
  { value: 5, short: "금", label: "금요일" },
] as const;

export const MAX_TIMETABLE_PERIODS = 10;

export function timetableSlotKey(weekday: number, period: number) {
  return `${weekday}:${period}`;
}

function normalizedSubject(value: string | undefined) {
  return value?.normalize("NFC").trim().replace(/\s+/g, " ") ?? "";
}

export function createTimetableDraft(timetable: TimetableState): TimetableDraft {
  const periodCount = Math.max(
    1,
    Math.min(MAX_TIMETABLE_PERIODS, Number(timetable.periodCount) || 6),
  );
  return {
    saved: timetable.saved,
    revision: timetable.revision,
    periodCount,
    subjects: Object.fromEntries(
      timetable.slots
        .filter((slot) => (
          slot.weekday >= 1
          && slot.weekday <= 5
          && slot.period >= 1
          && slot.period <= MAX_TIMETABLE_PERIODS
        ))
        .map((slot) => [timetableSlotKey(slot.weekday, slot.period), slot.subject]),
    ),
  };
}

export function draftsEqual(left: TimetableDraft, right: TimetableDraft) {
  if (left.periodCount !== right.periodCount) return false;
  return TIMETABLE_WEEKDAYS.every((weekday) => (
    Array.from({ length: MAX_TIMETABLE_PERIODS }, (_, index) => index + 1)
      .every((period) => (
        normalizedSubject(left.subjects[timetableSlotKey(weekday.value, period)])
        === normalizedSubject(right.subjects[timetableSlotKey(weekday.value, period)])
      ))
  ));
}

export function changedFields(
  base: TimetableDraft,
  local: TimetableDraft,
  latest: TimetableDraft,
) {
  const changes = new Map<string, TimetableChange>();
  if (latest.periodCount !== base.periodCount) {
    changes.set("periodCount", {
      key: "periodCount",
      label: "하루 교시 수",
      previous: `${base.periodCount}교시`,
      latest: `${latest.periodCount}교시`,
      local: `${local.periodCount}교시`,
      collision: local.periodCount !== base.periodCount && local.periodCount !== latest.periodCount,
    });
  }

  let structuralCollision = false;
  for (const weekday of TIMETABLE_WEEKDAYS) {
    for (let period = 1; period <= MAX_TIMETABLE_PERIODS; period += 1) {
      const key = timetableSlotKey(weekday.value, period);
      const previous = normalizedSubject(base.subjects[key]);
      const latestValue = normalizedSubject(latest.subjects[key]);
      const localValue = normalizedSubject(local.subjects[key]);
      const localChanged = localValue !== previous;
      const latestChanged = latestValue !== previous;
      const localWouldBeCutByLatest = (
        localChanged
        && localValue !== latestValue
        && period > latest.periodCount
      );
      const latestWouldBeCutByLocal = (
        latestChanged
        && localValue !== latestValue
        && local.periodCount !== base.periodCount
        && period > local.periodCount
      );
      const rangeCollision = localWouldBeCutByLatest || latestWouldBeCutByLocal;
      if (!latestChanged && !rangeCollision) continue;
      structuralCollision ||= rangeCollision;
      changes.set(key, {
        key,
        label: `${weekday.label} ${period}교시`,
        previous: previous || "비어 있음",
        latest: latestValue || "비어 있음",
        local: localValue || "비어 있음",
        collision: rangeCollision || (localChanged && latestChanged && localValue !== latestValue),
      });
    }
  }

  if (structuralCollision) {
    const periodChange = changes.get("periodCount");
    changes.set("periodCount", periodChange ? { ...periodChange, collision: true } : {
      key: "periodCount",
      label: "하루 교시 수",
      previous: `${base.periodCount}교시`,
      latest: `${latest.periodCount}교시`,
      local: `${local.periodCount}교시`,
      collision: true,
    });
  }
  return [...changes.values()];
}

export function mergeDrafts(
  base: TimetableDraft,
  local: TimetableDraft,
  latest: TimetableDraft,
): TimetableDraft {
  let highestLocalChangedPeriod = 0;
  for (const weekday of TIMETABLE_WEEKDAYS) {
    for (let period = 1; period <= MAX_TIMETABLE_PERIODS; period += 1) {
      const key = timetableSlotKey(weekday.value, period);
      const previous = normalizedSubject(base.subjects[key]);
      const localValue = normalizedSubject(local.subjects[key]);
      if (localValue && localValue !== previous) {
        highestLocalChangedPeriod = Math.max(highestLocalChangedPeriod, period);
      }
    }
  }

  const periodCount = local.periodCount !== base.periodCount
    ? local.periodCount
    : Math.max(latest.periodCount, highestLocalChangedPeriod);
  const subjects: Record<string, string> = {};
  for (const weekday of TIMETABLE_WEEKDAYS) {
    for (let period = 1; period <= MAX_TIMETABLE_PERIODS; period += 1) {
      const key = timetableSlotKey(weekday.value, period);
      const previous = normalizedSubject(base.subjects[key]);
      const localValue = normalizedSubject(local.subjects[key]);
      const latestValue = normalizedSubject(latest.subjects[key]);
      subjects[key] = localValue !== previous ? localValue : latestValue;
    }
  }

  return {
    saved: latest.saved,
    revision: latest.revision,
    periodCount,
    subjects,
  };
}
