import { audit, database, ensureSchema, runtimeEnv } from "./database";
import { randomToken, secureStringEqual, sha256 } from "./crypto";
import { sendTeacherEmailVerification } from "./email";
import { ApiError } from "./responses";
import { generateInviteCode, normalizeInviteCode } from "./invite-code";

const EMAIL_TOKEN_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const RESEND_WINDOW_MS = 60 * 60 * 1000;
const RESEND_LIMIT = 5;

function isLocalRequest(request: Request) {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export async function issueEmailVerification(input: {
  teacherId: string;
  email: string;
  request: Request;
}) {
  await ensureSchema();
  const now = Date.now();
  const recent = await database().prepare(
    `SELECT created_at FROM teacher_email_verifications
     WHERE teacher_id = ? ORDER BY created_at DESC LIMIT 1`,
  ).bind(input.teacherId).first<{ created_at: number }>();
  if (recent && now - recent.created_at < RESEND_COOLDOWN_MS) {
    const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - (now - recent.created_at)) / 1000);
    throw new ApiError(429, `${retryAfter}초 뒤에 인증 메일을 다시 받을 수 있어요.`, "EMAIL_RESEND_COOLDOWN");
  }
  const hourly = await database().prepare(
    `SELECT COUNT(*) AS count FROM teacher_email_verifications
     WHERE teacher_id = ? AND created_at > ?`,
  ).bind(input.teacherId, now - RESEND_WINDOW_MS).first<{ count: number }>();
  if (Number(hourly?.count ?? 0) >= RESEND_LIMIT) {
    throw new ApiError(429, "인증 메일을 여러 번 보냈어요. 한 시간 뒤에 다시 시도해 주세요.", "EMAIL_RESEND_LIMIT");
  }

  const rawToken = randomToken(32);
  const tokenHash = await sha256(rawToken);
  await database().batch([
    database().prepare(
      `UPDATE teacher_email_verifications
       SET invalidated_at = ? WHERE teacher_id = ? AND used_at IS NULL AND invalidated_at IS NULL`,
    ).bind(now, input.teacherId),
    database().prepare(
      `INSERT INTO teacher_email_verifications
       (id, teacher_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), input.teacherId, tokenHash, now + EMAIL_TOKEN_MS, now),
  ]);

  const url = new URL("/teacher", input.request.url);
  url.searchParams.set("verifyEmailToken", rawToken);
  let sent = false;
  try {
    sent = (await sendTeacherEmailVerification(input.email, url.toString())).sent;
  } catch {
    sent = false;
  }
  await audit({ action: "teacher_email_verification_requested", teacherId: input.teacherId });
  return {
    sent,
    retryAfterSeconds: 60,
    developmentUrl: !sent && isLocalRequest(input.request) ? url.toString() : undefined,
  };
}

export async function confirmEmailVerification(rawToken: string) {
  if (rawToken.length < 32 || rawToken.length > 128) {
    throw new ApiError(410, "이 인증 링크는 만료되었거나 사용할 수 없습니다.", "EMAIL_TOKEN_NOT_USABLE");
  }
  await ensureSchema();
  const now = Date.now();
  const tokenHash = await sha256(rawToken);
  const result = await database().prepare(
    `UPDATE teacher_email_verifications
     SET used_at = ?
     WHERE token_hash = ? AND used_at IS NULL AND invalidated_at IS NULL AND expires_at > ?
     RETURNING teacher_id`,
  ).bind(now, tokenHash, now).first<{ teacher_id: string }>();
  if (!result) {
    throw new ApiError(410, "이 인증 링크는 만료되었거나 이미 사용되었습니다. 새 인증 메일을 받아 주세요.", "EMAIL_TOKEN_NOT_USABLE");
  }
  await audit({ action: "teacher_email_verified", teacherId: result.teacher_id });
  return result.teacher_id;
}

export async function redeemInviteCode(teacherId: string, value: unknown) {
  const code = normalizeInviteCode(value);
  if (code.length !== 20) {
    throw new ApiError(400, "초대코드를 다시 확인해 주세요.", "INVALID_INVITE_CODE");
  }
  await ensureSchema();
  const now = Date.now();
  const codeHash = await sha256(code);
  const result = await database().prepare(
    `UPDATE teacher_invite_codes
     SET status = 'used', used_at = ?, used_by_teacher_id = ?
     WHERE code_hash = ? AND status = 'active' AND used_at IS NULL
       AND revoked_at IS NULL AND expires_at > ?
     RETURNING id`,
  ).bind(now, teacherId, codeHash, now).first<{ id: string }>();
  if (!result) {
    await database().prepare(
      `UPDATE teacher_invite_codes SET status = 'expired'
       WHERE code_hash = ? AND status = 'active' AND expires_at <= ?`,
    ).bind(codeHash, now).run();
    throw new ApiError(410, "만료되었거나 이미 사용된 초대코드예요. 새 코드를 요청해 주세요.", "INVITE_CODE_NOT_USABLE");
  }
  await audit({ action: "teacher_invite_verified", teacherId, detail: { inviteCodeId: result.id } });
}

export async function requireAdmin(request: Request) {
  const configured = runtimeEnv().ADMIN_API_TOKEN;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!configured || !provided || !(await secureStringEqual(configured, provided))) {
    throw new ApiError(403, "관리자 권한이 필요합니다.", "ADMIN_REQUIRED");
  }
}

export async function createInviteCode(input: { expiresAt: number; issuedBy?: string }) {
  const now = Date.now();
  if (!Number.isFinite(input.expiresAt) || input.expiresAt <= now + 60_000 || input.expiresAt > now + 365 * 24 * 60 * 60 * 1000) {
    throw new ApiError(400, "초대코드 만료일을 다시 확인해 주세요.", "INVALID_INVITE_EXPIRY");
  }
  const rawCode = generateInviteCode();
  await database().prepare(
    `INSERT INTO teacher_invite_codes
     (id, code_hash, status, issued_by, expires_at, created_at)
     VALUES (?, ?, 'active', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), await sha256(normalizeInviteCode(rawCode)), input.issuedBy ?? "admin-api", input.expiresAt, now).run();
  return rawCode;
}
