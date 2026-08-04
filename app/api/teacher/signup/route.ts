import { database, ensureSchema } from "@/lib/database";
import { hashPassword } from "@/lib/crypto";
import { normalizeEmail } from "@/lib/identity";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";
import { consumeRateLimit, subjectThrottleKey, throttleKey } from "@/lib/rate-limit";
import { isOpenTeacherRegistration } from "@/lib/open-registration";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ email?: string; password?: string }>(request);
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "");
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 160) throw new ApiError(400, "사용할 이메일을 정확히 입력해 주세요.", "INVALID_EMAIL");
    if (password.length < 8 || password.length > 72) throw new ApiError(400, "비밀번호는 8~72자로 만들어 주세요.", "WEAK_PASSWORD");
    const ipThrottle = await throttleKey(request, "teacher-signup-ip", "all");
    const emailThrottle = await subjectThrottleKey("teacher-signup", email);
    await consumeRateLimit(ipThrottle, {
      maxAttempts: 20,
      windowMs: 60 * 60 * 1000,
      blockMs: 60 * 60 * 1000,
    });
    await consumeRateLimit(emailThrottle, { maxAttempts: 5 });
    await ensureSchema();
    const openRegistration = isOpenTeacherRegistration();
    const id = crypto.randomUUID();
    const now = Date.now();
    const passwordHash = await hashPassword(password);
    await database().prepare(
      `INSERT OR IGNORE INTO teachers
       (id, email, password_hash, status, email_verified_at, teacher_access_status,
        teacher_access_verified_at, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      email,
      passwordHash,
      openRegistration ? now : null,
      openRegistration ? "invite_verified" : "pending",
      openRegistration ? now : null,
      now,
      now,
    ).run();
    return json({
      accepted: true,
      message: "가입 요청을 처리했어요. 같은 이메일과 비밀번호로 로그인해 주세요.",
    }, 202);
  } catch (error) {
    return apiFailure(error);
  }
}
