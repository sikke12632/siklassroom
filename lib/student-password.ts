const FORWARD_DIGITS = "012345678901234567890123456789";
const REVERSE_DIGITS = "987654321098765432109876543210";

export function isValidExistingStudentPassword(password: string) {
  return /^\d{4,12}$/u.test(password);
}

export function isSafeNewStudentPassword(password: string) {
  if (!/^\d{6,12}$/u.test(password)) return false;
  if (/^(\d)\1+$/u.test(password)) return false;
  if (FORWARD_DIGITS.includes(password) || REVERSE_DIGITS.includes(password)) return false;
  return true;
}
