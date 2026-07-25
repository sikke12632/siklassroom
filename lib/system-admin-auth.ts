import { database, ensureSchema, runtimeEnv } from "./database";
import { randomToken, secureStringEqual, sha256, verifyPassword } from "./crypto";
import { ApiError } from "./responses";

export const ADMIN_SESSION_COOKIE = "job_classroom_admin_session";
const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;

function requestCookie(request: Request, name: string) {
  const source = request.headers.get("cookie") ?? "";
  for (const part of source.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function secureSuffix(request: Request) {
  return new URL(request.url).protocol === "https:" ? "; Secure" : "";
}

function cookie(name: string, value: string, maxAge: number, request: Request, httpOnly = true) {
  return `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Strict; Max-Age=${maxAge}${httpOnly ? "; HttpOnly" : ""}${secureSuffix(request)}`;
}

export function clearSystemAdminCookie(request: Request) {
  return cookie(ADMIN_SESSION_COOKIE, "", 0, request);
}

export async function verifySystemAdminCredentials(username: string, password: string) {
  const { SYSTEM_ADMIN_USERNAME, SYSTEM_ADMIN_PASSWORD_HASH } = runtimeEnv();
  if (!SYSTEM_ADMIN_USERNAME || !SYSTEM_ADMIN_PASSWORD_HASH) return false;
  const [usernameMatches, passwordMatches] = await Promise.all([
    secureStringEqual(username, SYSTEM_ADMIN_USERNAME),
    verifyPassword(password, SYSTEM_ADMIN_PASSWORD_HASH),
  ]);
  return usernameMatches && passwordMatches;
}

export async function createSystemAdminSession(request: Request) {
  await ensureSchema();
  const rawToken = randomToken(32);
  const csrfToken = randomToken(24);
  const now = Date.now();
  await database().prepare(
    `INSERT INTO system_admin_sessions
     (id, token_hash, csrf_hash, admin_key, expires_at, created_at, last_seen_at)
     VALUES (?, ?, ?, 'primary', ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    await sha256(rawToken),
    await sha256(csrfToken),
    now + ADMIN_SESSION_MS,
    now,
    now,
  ).run();
  return {
    cookie: cookie(ADMIN_SESSION_COOKIE, rawToken, Math.floor(ADMIN_SESSION_MS / 1000), request),
    csrfToken,
  };
}

export async function requireSystemAdmin(request: Request, options: { csrf?: boolean } = {}) {
  await ensureSchema();
  const rawToken = requestCookie(request, ADMIN_SESSION_COOKIE);
  if (!rawToken) throw new ApiError(401, "관리자 로그인이 필요합니다.", "ADMIN_LOGIN_REQUIRED");
  const tokenHash = await sha256(rawToken);
  const row = await database().prepare(
    `SELECT id, admin_key, csrf_hash, expires_at, revoked_at
     FROM system_admin_sessions WHERE token_hash = ?`,
  ).bind(tokenHash).first<{
    id: string;
    admin_key: string;
    csrf_hash: string;
    expires_at: number;
    revoked_at: number | null;
  }>();
  if (!row || row.revoked_at || row.expires_at <= Date.now()) {
    if (row && !row.revoked_at) {
      await database().prepare(`UPDATE system_admin_sessions SET revoked_at = ? WHERE id = ?`)
        .bind(Date.now(), row.id).run();
    }
    throw new ApiError(401, "관리자 세션이 만료되었습니다.", "ADMIN_SESSION_EXPIRED");
  }
  if (options.csrf) {
    const provided = request.headers.get("x-admin-csrf") ?? "";
    if (!provided || !(await secureStringEqual(await sha256(provided), row.csrf_hash))) {
      throw new ApiError(403, "요청을 다시 확인해 주세요.", "ADMIN_CSRF_REJECTED");
    }
  }
  await database().prepare(`UPDATE system_admin_sessions SET last_seen_at = ? WHERE id = ?`)
    .bind(Date.now(), row.id).run();
  return { sessionId: row.id, adminKey: row.admin_key };
}

export async function rotateAdminCsrf(sessionId: string) {
  const csrfToken = randomToken(24);
  await database().prepare(`UPDATE system_admin_sessions SET csrf_hash = ? WHERE id = ?`)
    .bind(await sha256(csrfToken), sessionId).run();
  return csrfToken;
}

export async function endSystemAdminSession(request: Request) {
  const rawToken = requestCookie(request, ADMIN_SESSION_COOKIE);
  if (!rawToken) return;
  await database().prepare(
    `UPDATE system_admin_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`,
  ).bind(Date.now(), await sha256(rawToken)).run();
}

export async function isSystemAdminPath(value: string) {
  const configured = runtimeEnv().SYSTEM_ADMIN_PATH;
  return Boolean(configured && value && await secureStringEqual(configured, value));
}
