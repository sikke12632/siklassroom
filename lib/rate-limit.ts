import { database, ensureSchema } from "./database";
import { sha256 } from "./crypto";
import { ApiError } from "./responses";

const WINDOW_MS = 10 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 7;

type ConsumeRateLimitOptions = {
  maxAttempts?: number;
  windowMs?: number;
  blockMs?: number;
};

function clientAddress(request: Request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export async function throttleKey(request: Request, scope: string, identifier: string) {
  return sha256(`${scope}|${identifier}|${clientAddress(request)}`);
}
export async function subjectThrottleKey(scope: string, identifier: string) {
  return sha256(`subject|${scope}|${identifier}`);
}

export async function consumeRateLimit(key: string, options: ConsumeRateLimitOptions = {}) {
  await ensureSchema();
  const now = Date.now();
  const windowMs = options.windowMs ?? WINDOW_MS;
  const blockMs = options.blockMs ?? BLOCK_MS;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const row = await database().prepare(
    `INSERT INTO login_throttles (key, attempts, window_started_at, blocked_until)
     VALUES (?, 1, ?, NULL)
     ON CONFLICT(key) DO UPDATE SET
       attempts = CASE
         WHEN login_throttles.blocked_until IS NOT NULL AND login_throttles.blocked_until > ?
           THEN login_throttles.attempts
         WHEN login_throttles.blocked_until IS NOT NULL OR ? - login_throttles.window_started_at >= ?
           THEN 1
         ELSE login_throttles.attempts + 1
       END,
       window_started_at = CASE
         WHEN login_throttles.blocked_until IS NOT NULL AND login_throttles.blocked_until > ?
           THEN login_throttles.window_started_at
         WHEN login_throttles.blocked_until IS NOT NULL OR ? - login_throttles.window_started_at >= ?
           THEN ?
         ELSE login_throttles.window_started_at
       END,
       blocked_until = CASE
         WHEN login_throttles.blocked_until IS NOT NULL AND login_throttles.blocked_until > ?
           THEN login_throttles.blocked_until
         WHEN login_throttles.blocked_until IS NOT NULL OR ? - login_throttles.window_started_at >= ?
           THEN NULL
         WHEN login_throttles.attempts >= ? THEN ?
         ELSE NULL
       END
     RETURNING attempts, blocked_until`,
  ).bind(
    key, now,
    now, now, windowMs,
    now, now, windowMs, now,
    now, now, windowMs, maxAttempts, now + blockMs,
  ).first<{ attempts: number; blocked_until: number | null }>();

  const retentionCutoff = now - Math.max(windowMs, blockMs, 24 * 60 * 60 * 1000);
  await database().prepare(
    `DELETE FROM login_throttles
     WHERE key IN (
       SELECT key FROM login_throttles
       WHERE key != ? AND window_started_at < ?
         AND (blocked_until IS NULL OR blocked_until < ?)
       LIMIT 100
     )`,
  ).bind(key, retentionCutoff, now).run().catch(() => undefined);

  if (!row || (row.blocked_until && row.blocked_until > now)) {
    throw new ApiError(429, "요청을 여러 번 보냈어요. 잠시 뒤에 다시 해 주세요.", "TOO_MANY_ATTEMPTS");
  }
  return { attempts: row.attempts };
}
