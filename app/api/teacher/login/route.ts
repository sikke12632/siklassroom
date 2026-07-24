import { createSession } from "@/lib/auth";
import { database, ensureSchema } from "@/lib/database";
import { verifyPassword } from "@/lib/crypto";
import { normalizeEmail } from "@/lib/identity";
import { assertNotBlocked, clearFailures, recordFailure, throttleKey } from "@/lib/rate-limit";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ email?: string; password?: string }>(request);
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "");
    const key = await throttleKey(request, "teacher-login", email);
    await assertNotBlocked(key);
    await ensureSchema();
    const teacher = await database().prepare(
      `SELECT id, email, password_hash, status, email_verified_at, teacher_access_status,
              teacher_access_verified_at, school_id, manual_school_request_id
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
    }>();
    if (!teacher || teacher.status !== "active" || !(await verifyPassword(password, teacher.password_hash))) {
      await recordFailure(key);
      throw new ApiError(401, "이메일 또는 비밀번호를 다시 확인해 주세요.", "LOGIN_FAILED");
    }
    await clearFailures(key);
    const session = await createSession({ actorType: "teacher", teacherId: teacher.id }, request);
    return json({
      teacher: {
        id: teacher.id,
        email: teacher.email,
        email_verified_at: teacher.email_verified_at,
        teacher_access_status: teacher.teacher_access_status,
        teacher_access_verified_at: teacher.teacher_access_verified_at,
        school_id: teacher.school_id,
        manual_school_request_id: teacher.manual_school_request_id,
      },
    }, 200, { "Set-Cookie": session.cookie });
  } catch (error) {
    return apiFailure(error);
  }
}
