export const LIFE_CHECK_MIN_YEAR = 2020;
export const LIFE_CHECK_MAX_YEAR = 2100;

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function parseLifeCheckMonth(value: string): { year: number; month: number } | null {
  const match = MONTH_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < LIFE_CHECK_MIN_YEAR || year > LIFE_CHECK_MAX_YEAR) return null;
  return { year, month };
}

export function lifeCheckMonthForYear(value: string, requestedYear: number): string {
  const current = parseLifeCheckMonth(value);
  const requested = Number.isFinite(requestedYear)
    ? Math.trunc(requestedYear)
    : current?.year ?? LIFE_CHECK_MIN_YEAR;
  const safeYear = Math.min(
    LIFE_CHECK_MAX_YEAR,
    Math.max(LIFE_CHECK_MIN_YEAR, requested),
  );
  const month = current?.month ?? 1;
  return `${safeYear}-${String(month).padStart(2, "0")}`;
}

export function lifeCheckYears(): number[] {
  return Array.from(
    { length: LIFE_CHECK_MAX_YEAR - LIFE_CHECK_MIN_YEAR + 1 },
    (_, index) => LIFE_CHECK_MAX_YEAR - index,
  );
}
