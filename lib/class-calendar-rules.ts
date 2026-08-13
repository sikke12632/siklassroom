export function classCalendarBounds(schoolYear: number) {
  const nextYear = schoolYear + 1;
  const februaryDays = new Date(Date.UTC(nextYear, 2, 0)).getUTCDate();
  return {
    start: `${schoolYear}-01-01`,
    end: `${nextYear}-02-${String(februaryDays).padStart(2, "0")}`,
  };
}
