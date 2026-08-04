import { runtimeEnv } from "./database";

export function isOpenTeacherRegistration() {
  const value = runtimeEnv().OPEN_TEACHER_REGISTRATION?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "on";
}
