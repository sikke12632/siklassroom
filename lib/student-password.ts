const STUDENT_PASSWORD_PATTERN = /^[A-Za-z0-9]{4,32}$/u;

export const STUDENT_TEMPORARY_PASSWORD = "123456";

export function isValidExistingStudentPassword(password: string) {
  return STUDENT_PASSWORD_PATTERN.test(password);
}

export function isSafeNewStudentPassword(password: string) {
  return STUDENT_PASSWORD_PATTERN.test(password);
}
