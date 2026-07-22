import { database, ensureSchema } from "./database";
import { sha256 } from "./crypto";
import { ApiError } from "./responses";

const WINDOW_MS = 10 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 7;

function clientAddress(request: Request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export async function throttleKey(request: Request, scope: string, identifier: string) {
  return sha256(`${scope}|${identifier}|${clientAddress(request)}`);
}

export async function assertNotBlocked(key: string) {
  await ensureSchema();
  const row = await database().prepare(
    `SELECT attempts, window_started_at, blocked_until FROM login_throttles WHERE key = ?`,
  ).bind(key).first<{ attempts: number; window_started_at: number; blocked_until: number | null }>();
  if (row?.blocked_until && row.blocked_until > Date.now()) {
    throw new ApiError(429, "요청을 여러 번 보냈어요. 잠시 뒤에 다시 해 주세요.", "TOO_MANY_ATTEMPTS");
  }
}

export async function recordFailure(key: string) {
  await ensureSchema();
  const now = Date.now();
  const row = await database().prepare(
    `SELECT attempts, window_started_at FROM login_throttles WHERE key = ?`,
  ).bind(key).first<{ attempts: number; window_started_at: number }>();
  const attempts = !row || now - row.window_started_at > WINDOW_MS ? 1 : row.attempts + 1;
  const windowStartedAt = !row || now - row.window_started_at > WINDOW_MS ? now : row.window_started_at;
  const blockedUntil = attempts >= MAX_ATTEMPTS ? now + BLOCK_MS : null;
  await database().prepare(
    `INSERT INTO login_throttles (key, attempts, window_started_at, blocked_until) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET attempts = excluded.attempts, window_started_at = excluded.window_started_at, blocked_until = excluded.blocked_until`,
  ).bind(key, attempts, windowStartedAt, blockedUntil).run();
}

export async function clearFailures(key: string) {
  await ensureSchema();
  await database().prepare(`DELETE FROM login_throttles WHERE key = ?`).bind(key).run();
}
