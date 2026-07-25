import { audit, database, runtimeEnv } from "./database";

export function isOpenTeacherRegistration() {
  const value = runtimeEnv().OPEN_TEACHER_REGISTRATION?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "on";
}

export async function activateOpenTeacherRegistration(teacherId: string) {
  if (!isOpenTeacherRegistration()) return false;

  const now = Date.now();
  const result = await database().prepare(
    `UPDATE teachers
     SET email_verified_at = COALESCE(email_verified_at, ?),
         teacher_access_status = 'invite_verified',
         teacher_access_verified_at = COALESCE(teacher_access_verified_at, ?),
         updated_at = ?
     WHERE id = ? AND status = 'active' AND teacher_access_status != 'revoked'
       AND (email_verified_at IS NULL OR teacher_access_status != 'invite_verified')`,
  ).bind(now, now, now, teacherId).run();

  if (Number(result.meta.changes ?? 0) > 0) {
    await audit({
      action: "teacher_open_registration_activated",
      teacherId,
      detail: { mode: "temporary_open_registration" },
    });
    return true;
  }
  return false;
}
