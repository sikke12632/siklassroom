import { ApiError } from "./responses";

export const SEOUL_TIME_ZONE = "Asia/Seoul";

export type SeoulServerTime = {
  epochMs: number;
  iso: string;
  date: string;
  year: number;
  month: number;
  day: number;
  monthValue: string;
  label: string;
  weekday: string;
  fullLabel: string;
  timeZone: typeof SEOUL_TIME_ZONE;
};

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: SEOUL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const weekdayFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: SEOUL_TIME_ZONE,
  weekday: "long",
});

export function seoulServerTime(epochMs = Date.now()): SeoulServerTime {
  const parts = Object.fromEntries(
    dateFormatter
      .formatToParts(new Date(epochMs))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const monthValue = `${year}-${String(month).padStart(2, "0")}`;
  const weekday = weekdayFormatter.format(new Date(epochMs));
  return {
    epochMs,
    iso: new Date(epochMs).toISOString(),
    date: `${monthValue}-${String(day).padStart(2, "0")}`,
    year,
    month,
    day,
    monthValue,
    label: `${year}년 ${month}월 ${day}일`,
    weekday,
    fullLabel: `${year}년 ${month}월 ${day}일 ${weekday}`,
    timeZone: SEOUL_TIME_ZONE,
  };
}

export function assignmentPeriod(input: {
  year?: unknown;
  month?: unknown;
  epochMs?: number;
}) {
  const serverTime = seoulServerTime(input.epochMs);
  const year = input.year === undefined || input.year === null || input.year === ""
    ? serverTime.year
    : Number(input.year);
  const month = input.month === undefined || input.month === null || input.month === ""
    ? serverTime.month
    : Number(input.month);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new ApiError(400, "배정 연도를 다시 확인해 주세요.", "INVALID_ASSIGNMENT_YEAR");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new ApiError(400, "배정 월을 다시 확인해 주세요.", "INVALID_ASSIGNMENT_MONTH");
  }
  return {
    year,
    month,
    monthValue: `${year}-${String(month).padStart(2, "0")}`,
    label: `${year}년 ${month}월`,
    serverTime,
  };
}

function secureRandomUnit() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] / 0x1_0000_0000;
}

export function randomCandidate<T>(items: readonly T[], random = secureRandomUnit): T {
  if (!items.length) {
    throw new ApiError(422, "추첨할 희망 학생을 한 명 이상 선택해 주세요.", "NO_RANDOM_CANDIDATES");
  }
  const value = random();
  const index = Math.min(items.length - 1, Math.max(0, Math.floor(value * items.length)));
  return items[index];
}
