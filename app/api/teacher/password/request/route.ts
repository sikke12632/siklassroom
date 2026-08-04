import { audit, database, ensureSchema, runtimeEnv } from "@/lib/database";
import { randomToken, sha256 } from "@/lib/crypto";
import { sendTeacherPasswordReset } from "@/lib/email";
import { normalizeEmail } from "@/lib/identity";
import { consumeRateLimit, subjectThrottleKey, throttleKey } from "@/lib/rate-limit";
import { apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ email?: string }>(request);
    const email = normalizeEmail(body.email);
    const ipKey = await throttleKey(request, "teacher-password-reset-ip", "all");
    const key = await subjectThrottleKey("teacher-password-reset", email);
    await consumeRateLimit(ipKey, {
      maxAttempts: 20,
      windowMs: 60 * 60 * 1000,
      blockMs: 60 * 60 * 1000,
    });
    await consumeRateLimit(key, {
      maxAttempts: 5,
      windowMs: 60 * 60 * 1000,
      blockMs: 60 * 60 * 1000,
    });
    await ensureSchema();
    const teacher = await database().prepare(`SELECT id FROM teachers WHERE email = ? AND status = 'active'`).bind(email).first<{ id: string }>();
    let developmentResetUrl: string | undefined;
    const { RESEND_API_KEY, MAIL_FROM } = runtimeEnv();
    const emailConfigured = Boolean(RESEND_API_KEY && MAIL_FROM);
    if (teacher) {
      const rawToken = randomToken(32);
      const now = Date.now();
      await database().batch([
        database().prepare(`UPDATE teacher_password_resets SET used_at = ? WHERE teacher_id = ? AND used_at IS NULL`).bind(now, teacher.id),
        database().prepare(
          `INSERT INTO teacher_password_resets (id, teacher_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
        ).bind(crypto.randomUUID(), teacher.id, await sha256(rawToken), now + 30 * 60 * 1000, now),
      ]);
      const url = new URL(`/teacher/reset?token=${encodeURIComponent(rawToken)}`, request.url).toString();
      await sendTeacherPasswordReset(email, url);
      if (new URL(request.url).hostname === "localhost" || new URL(request.url).hostname === "127.0.0.1") developmentResetUrl = url;
      await audit({ action: "teacher_password_reset_requested", teacherId: teacher.id });
    }
    return json({
      ok: true,
      message: "가입된 이메일이라면 비밀번호 재설정 안내를 보냈습니다.",
      emailConfigured,
      ...(developmentResetUrl ? { developmentResetUrl } : {}),
    });
  } catch (error) {
    return apiFailure(error);
  }
}
