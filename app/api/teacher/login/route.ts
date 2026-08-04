import { createGuardedTeacherSession } from "@/lib/auth";
import { database, ensureSchema } from "@/lib/database";
import { verifyPassword } from "@/lib/crypto";
import { normalizeEmail } from "@/lib/identity";
import { consumeRateLimit, subjectThrottleKey, throttleKey } from "@/lib/rate-limit";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";
import { activateOpenTeacherRegistration, isOpenTeacherRegistration } from "@/lib/open-registration";
import { teacherAccountIssue } from "@/lib/teacher-access-rules";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ email?: string; password?: string }>(request);
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "");
    const ipKey = await throttleKey(request, "teacher-login-ip", "all");
    const key = await subjectThrottleKey("teacher-login", email);
    await consumeRateLimit(ipKey, { maxAttempts: 60 });
    await consumeRateLimit(key, { maxAttempts: 7 });
    await ensureSchema();
    const teacher = await database().prepare(
      `SELECT id, email, password_hash, status, email_verified_at, teacher_access_status,
              teacher_access_verified_at, school_id, manual_school_request_id, credential_revision
       FROM teachers WHERE email = ?`,
    ).bind(email).first<{
      id: string;
      email: string;
      password_hash: string;
      status: string;
      email_verified_at: number | null;
      teacher_access_status: string;
      teacher_access_verified_at: number | null;
      school_id: string | null;
      manual_school_request_id: string | null;
      credential_revision: number;
    }>();
    const accountIssue = teacher
      ? teacherAccountIssue(teacher.status, teacher.teacher_access_status)
      : "ACCOUNT_DISABLED";
    if (!teacher || accountIssue === "ACCOUNT_DISABLED" || !(await verifyPassword(password, teacher.password_hash))) {
      throw new ApiError(401, "이메일 또는 비밀번호를 다시 확인해 주세요.", "LOGIN_FAILED");
    }
    await activateOpenTeacherRegistration(teacher.id);
    if (isOpenTeacherRegistration() && teacher.teacher_access_status !== "revoked") {
      const now = Date.now();
      teacher.email_verified_at ??= now;
      teacher.teacher_access_status = "invite_verified";
      teacher.teacher_access_verified_at ??= now;
    }
    const session = await createGuardedTeacherSession({
      teacherId: teacher.id,
      passwordHash: teacher.password_hash,
      credentialRevision: teacher.credential_revision,
      request,
      clearThrottleKeys: [key],
    });
    return json({
      teacher: {
        id: teacher.id,
        email: teacher.email,
        email_verified_at: teacher.email_verified_at,
        teacher_access_status: teacher.teacher_access_status,
        teacher_access_verified_at: teacher.teacher_access_verified_at,
        school_id: teacher.school_id,
        manual_school_request_id: teacher.manual_school_request_id,
        registration_mode: isOpenTeacherRegistration() ? "open" : "verified",
      },
    }, 200, { "Set-Cookie": session.cookie });
  } catch (error) {
    return apiFailure(error);
  }
}
