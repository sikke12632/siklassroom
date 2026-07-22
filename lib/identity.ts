export function normalizeEmail(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase();
}

export function normalizeSchool(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, "").toLowerCase();
}

export function cleanDisplayText(value: unknown, maxLength: number): string {
  return String(value ?? "").normalize("NFC").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

export function integerInRange(value: unknown, min: number, max: number): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

export function currentSchoolYear(date = new Date()): number {
  return date.getFullYear();
}

export function classLabel(input: { schoolName: string; schoolYear: number; grade: number; classNumber: number; displayName?: string | null }) {
  return input.displayName?.trim() || `${input.schoolName} ${input.schoolYear}학년도 ${input.grade}학년 ${input.classNumber}반`;
}
