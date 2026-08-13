import { database, ensureSchema, runtimeEnv } from "@/lib/database";
import { randomToken, sha256 } from "@/lib/crypto";
import { sendTeacherPasswordReset } from "@/lib/email";
import { normalizeEmail } from "@/lib/identity";
import { consumeRateLimit, subjectThrottleKey, throttleKey } from "@/lib/rate-limit";
import { apiFailure, json, readJson } from "@/lib/responses";
import { getRequestExecutionContext } from "vinext/shims/request-context";

function resetOrigin(request: Request) {
  const requestUrl = new URL(request.url);
  if (requestUrl.hostname === "localhost" || requestUrl.hostname === "127.0.0.1") {
    return requestUrl.origin;
  }
  const configured = runtimeEnv().APP_ORIGIN?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1") {
        return url.origin;
      }
    } catch {
      // A bad optional deployment value must not break password recovery.
    }
  }
  return requestUrl.origin;
}

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
    const teacher = await database().prepare(
      `SELECT id FROM teachers
       WHERE email = ? AND status = 'active' AND teacher_access_status != 'revoked'`,
    ).bind(email).first<{ id: string }>();
    const rawToken = randomToken(32);
    const tokenHash = await sha256(rawToken);
    const now = Date.now();
    const teacherId = teacher?.id ?? `missing:${crypto.randomUUID()}`;
    await database().batch([
      database().prepare(
        `UPDATE teacher_password_resets SET used_at = ?
         WHERE teacher_id = ? AND used_at IS NULL`,
      ).bind(now, teacherId),
      database().prepare(
        `INSERT INTO teacher_password_resets (id, teacher_id, token_hash, expires_at, created_at)
         SELECT ?, id, ?, ?, ? FROM teachers
         WHERE id = ? AND status = 'active' AND teacher_access_status != 'revoked'`,
      ).bind(crypto.randomUUID(), tokenHash, now + 30 * 60 * 1000, now, teacherId),
      database().prepare(
        `INSERT INTO audit_logs (id, teacher_id, action, detail, created_at)
         VALUES (?, ?, 'teacher_password_reset_requested', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        teacher?.id ?? null,
        JSON.stringify({ accountMatched: Boolean(teacher) }),
        now,
      ),
    ]);
    const resetUrl = new URL("/teacher/reset", resetOrigin(request));
    resetUrl.hash = new URLSearchParams({ token: rawToken }).toString();
    const url = resetUrl.toString();
    // Keep the public response indistinguishable, but never use the service as
    // an email relay for addresses that do not belong to an eligible account.
    if (teacher) {
      const delivery = sendTeacherPasswordReset(email, url).catch(() => ({ sent: false }));
      const executionContext = getRequestExecutionContext();
      if (executionContext) executionContext.waitUntil(delivery);
      else await delivery;
    }
    const hostname = new URL(request.url).hostname;
    const developmentResetUrl = hostname === "localhost" || hostname === "127.0.0.1" ? url : undefined;
    return json({
      ok: true,
      message: "가입된 이메일이라면 비밀번호 재설정 안내를 보냈습니다.",
      ...(developmentResetUrl ? { developmentResetUrl } : {}),
    }, 200, { "Cache-Control": "no-store" });
  } catch (error) {
    return apiFailure(error);
  }
}
