export const DEFAULT_STUDENT_SCHOOL_CODE = "01";

export function normalizeStudentSchoolCode(value: unknown): string {
  const code = String(value ?? "").normalize("NFKC").trim();
  return /^\d{2,6}$/u.test(code) ? code : "";
}
