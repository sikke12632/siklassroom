import { createSession } from "@/lib/auth";
import { audit, database, ensureSchema } from "@/lib/database";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { normalizeEmail } from "@/lib/identity";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";
import { issueEmailVerification } from "@/lib/teacher-verification";
import { assertNotBlocked, recordFailure, throttleKey } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ email?: string; password?: string }>(request);
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "");
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 160) throw new ApiError(400, "사용할 이메일을 정확히 입력해 주세요.", "INVALID_EMAIL");
    if (password.length < 8 || password.length > 72) throw new ApiError(400, "비밀번호는 8~72자로 만들어 주세요.", "WEAK_PASSWORD");
    const throttle = await throttleKey(request, "teacher-signup", email);
    await assertNotBlocked(throttle);
    await ensureSchema();
    const existing = await database().prepare(
      `SELECT id, password_hash, email_verified_at FROM teachers WHERE email = ?`,
    ).bind(email).first<{ id: string; password_hash: string; email_verified_at: number | null }>();
    if (existing) {
      if (!existing.email_verified_at && await verifyPassword(password, existing.password_hash)) {
        const session = await createSession({ actorType: "teacher", teacherId: existing.id }, request);
        const verification = await issueEmailVerification({ teacherId: existing.id, email, request });
        await recordFailure(throttle);
        return json({
          teacher: {
            id: existing.id,
            email,
            email_verified_at: null,
            teacher_access_status: "pending",
            school_id: null,
            manual_school_request_id: null,
          },
          verification,
        }, 200, { "Set-Cookie": session.cookie });
      }
      throw new ApiError(409, "이미 가입한 이메일이에요. 로그인하거나 비밀번호를 다시 설정해 주세요.", "EMAIL_EXISTS");
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    await database().prepare(
      `INSERT INTO teachers
       (id, email, password_hash, status, teacher_access_status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'pending', ?, ?)`,
    ).bind(id, email, await hashPassword(password), now, now).run();
    await audit({ action: "teacher_signup", teacherId: id });
    const session = await createSession({ actorType: "teacher", teacherId: id }, request);
    const verification = await issueEmailVerification({ teacherId: id, email, request });
    await recordFailure(throttle);
    return json({
      teacher: {
        id,
        email,
        email_verified_at: null,
        teacher_access_status: "pending",
        school_id: null,
        manual_school_request_id: null,
      },
      verification,
    }, 201, { "Set-Cookie": session.cookie });
  } catch (error) {
    return apiFailure(error);
  }
}
