import { database, ensureSchema } from "./database";
import { randomToken, sha256 } from "./crypto";
import { consumeRateLimit, subjectThrottleKey } from "./rate-limit";
import { ApiError } from "./responses";

export const REGISTRATION_QR_LIFETIME_MS = 400 * 24 * 60 * 60 * 1000;
export const REGISTRATION_CHALLENGE_LIFETIME_MS = 10 * 60 * 1000;
export const QR_RESET_GRANT_LIFETIME_MS = 10 * 60 * 1000;
export const REGISTRATION_CHALLENGE_COOKIE = "job_classroom_registration_challenge";

export type RegistrationMode = "activate" | "login" | "reset";

export type RegistrationRecord = {
  token_id: string;
  student_id: string;
  purpose: string;
  generation: number;
  expires_at: number;
  used_at: number | null;
  revoked_at: number | null;
  official_name: string;
  student_number: number;
  password_hash: string | null;
  status: string;
  class_id: string;
  qr_generation: number;
  credential_revision: number;
  school_name: string;
  school_year: number;
  grade: number;
  class_number: number;
  display_name: string | null;
  class_status: string;
};

export type RegistrationChallenge = RegistrationRecord & {
  challenge_id: string;
  challenge_mode: RegistrationMode;
  challenge_expires_at: number;
  challenge_attempts: number;
  challenge_used_at: number | null;
  challenge_revoked_at: number | null;
  reset_grant_id: string | null;
  grant_generation: number | null;
  grant_expires_at: number | null;
  grant_used_at: number | null;
  grant_revoked_at: number | null;
};

function secureCookieSuffix(request: Request) {
  return new URL(request.url).protocol === "https:" ? "; Secure" : "";
}

function requestCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function challengeCookie(token: string, request: Request) {
  return `${REGISTRATION_CHALLENGE_COOKIE}=${encodeURIComponent(token)}; Path=/api/registration; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(REGISTRATION_CHALLENGE_LIFETIME_MS / 1000)}${secureCookieSuffix(request)}`;
}

export function clearRegistrationChallengeCookie(request: Request) {
  return `${REGISTRATION_CHALLENGE_COOKIE}=; Path=/api/registration; HttpOnly; SameSite=Strict; Max-Age=0${secureCookieSuffix(request)}`;
}

export function registrationResponseHeaders(setCookie?: string) {
  const headers = new Headers({
    "Cache-Control": "no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    Pragma: "no-cache",
  });
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return headers;
}

export function registrationActivationUrl(origin: string, rawToken: string) {
  const url = new URL("/activate", origin);
  url.hash = new URLSearchParams({ token: rawToken }).toString();
  return url.toString();
}

export function registrationClaimMarker() {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  return -value;
}

export async function issueRegistrationToken(input: {
  studentId: string;
  teacherId: string;
  classId: string;
}) {
  await ensureSchema();
  const student = await database().prepare(
    `SELECT qr_generation, status FROM students WHERE id = ? AND class_id = ?`,
  ).bind(input.studentId, input.classId).first<{ qr_generation: number; status: string }>();
  if (!student) throw new ApiError(404, "학생을 찾을 수 없습니다.", "STUDENT_NOT_FOUND");
  const now = Date.now();
  const generation = student.qr_generation + 1;
  const rawToken = randomToken(32);
  const tokenHash = await sha256(rawToken);
  const guardId = crypto.randomUUID();
  await database().batch([
    database().prepare(
      `INSERT INTO registration_operation_guards (id, operation, created_at)
       VALUES (
         CASE WHEN EXISTS (
           SELECT 1 FROM students
           WHERE id = ? AND class_id = ? AND qr_generation = ? AND status NOT IN ('locked', 'excluded')
         ) THEN ? ELSE NULL END,
         'issue_qr', ?
       )`,
    ).bind(input.studentId, input.classId, student.qr_generation, guardId, now),
    database().prepare(
      `UPDATE registration_tokens SET revoked_at = ? WHERE student_id = ? AND revoked_at IS NULL`,
    ).bind(now, input.studentId),
    database().prepare(
      `UPDATE registration_challenges SET revoked_at = ? WHERE student_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
    ).bind(now, input.studentId),
    database().prepare(
      `UPDATE student_qr_reset_grants SET revoked_at = ? WHERE student_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
    ).bind(now, input.studentId),
    database().prepare(`DELETE FROM sessions WHERE student_id = ?`).bind(input.studentId),
    database().prepare(`UPDATE students SET qr_generation = ?, updated_at = ? WHERE id = ? AND qr_generation = ?`).bind(
      generation, now, input.studentId, student.qr_generation,
    ),
    database().prepare(
      `INSERT INTO registration_tokens (id, student_id, token_hash, purpose, generation, expires_at, created_at)
       VALUES (?, ?, ?, 'activate', ?, ?, ?)`,
    ).bind(crypto.randomUUID(), input.studentId, tokenHash, generation, now + REGISTRATION_QR_LIFETIME_MS, now),
    database().prepare(
      `INSERT INTO audit_logs (id, teacher_id, class_id, student_id, action, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), input.teacherId, input.classId, input.studentId,
      "student_qr_issued", JSON.stringify({ generation, purpose: "identity" }), now,
    ),
    database().prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
  ]);
  return rawToken;
}

export async function issueStudentQrResetGrant(input: {
  studentId: string;
  teacherId: string;
  classId: string;
}) {
  await ensureSchema();
  const student = await database().prepare(
    `SELECT qr_generation, status FROM students WHERE id = ? AND class_id = ?`,
  ).bind(input.studentId, input.classId).first<{ qr_generation: number; status: string }>();
  if (!student) throw new ApiError(404, "학생을 찾을 수 없습니다.", "STUDENT_NOT_FOUND");
  if (student.status !== "active" && student.status !== "reset_required") {
    throw new ApiError(409, "비밀번호가 등록된 학생 계정에서만 QR 재설정을 허용할 수 있어요.", "QR_RESET_NOT_AVAILABLE");
  }
  const now = Date.now();
  const expiresAt = now + QR_RESET_GRANT_LIFETIME_MS;
  const grantId = crypto.randomUUID();
  const guardId = crypto.randomUUID();
  await database().batch([
    database().prepare(
      `INSERT INTO registration_operation_guards (id, operation, created_at)
       VALUES (
         CASE WHEN EXISTS (
           SELECT 1 FROM students
           WHERE id = ? AND class_id = ? AND status IN ('active', 'reset_required') AND qr_generation = ?
         ) THEN ? ELSE NULL END,
         'grant_qr_reset', ?
       )`,
    ).bind(input.studentId, input.classId, student.qr_generation, guardId, now),
    database().prepare(
      `UPDATE student_qr_reset_grants SET revoked_at = ?
       WHERE student_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
    ).bind(now, input.studentId),
    database().prepare(
      `UPDATE registration_challenges SET revoked_at = ?
       WHERE student_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
    ).bind(now, input.studentId),
    database().prepare(
      `INSERT INTO student_qr_reset_grants
       (id, student_id, qr_generation, issued_by_teacher_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(grantId, input.studentId, student.qr_generation, input.teacherId, expiresAt, now),
    database().prepare(
      `INSERT INTO audit_logs (id, teacher_id, class_id, student_id, action, detail, created_at)
       VALUES (?, ?, ?, ?, 'student_qr_reset_granted', ?, ?)`,
    ).bind(
      crypto.randomUUID(), input.teacherId, input.classId, input.studentId,
      JSON.stringify({ generation: student.qr_generation, expiresAt }), now,
    ),
    database().prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
  ]);
  return { expiresAt };
}

export async function registrationRecord(rawToken: string) {
  await ensureSchema();
  const tokenHash = await sha256(rawToken);
  return database().prepare(
    `SELECT rt.id AS token_id, rt.student_id, rt.purpose, rt.generation, rt.expires_at,
            rt.used_at, rt.revoked_at, s.official_name, s.student_number, s.password_hash, s.status,
            s.class_id, s.qr_generation, s.credential_revision,
            c.school_name, c.school_year, c.grade, c.class_number, c.display_name, c.status AS class_status
     FROM registration_tokens rt
     JOIN students s ON s.id = rt.student_id
     JOIN classes c ON c.id = s.class_id
     WHERE rt.token_hash = ?`,
  ).bind(tokenHash).first<RegistrationRecord>();
}

export function assertUsableRegistration(record: RegistrationRecord | null) {
  if (!record || record.revoked_at || Number(record.expires_at) <= Date.now() || Number(record.generation) !== Number(record.qr_generation)) {
    throw new ApiError(410, "이 QR은 만료되었거나 새 QR로 바뀌었어요. 선생님께 현재 QR을 확인해 주세요.", "QR_NOT_USABLE");
  }
  if (record.status === "locked" || record.status === "excluded") {
    throw new ApiError(403, "지금은 등록할 수 없는 계정이에요. 선생님께 알려 주세요.", "STUDENT_DISABLED");
  }
  if (record.class_status !== "active") {
    throw new ApiError(403, "지금은 사용할 수 없는 학급이에요. 선생님께 알려 주세요.", "CLASS_DISABLED");
  }
}

async function currentResetGrant(record: RegistrationRecord, now: number) {
  return database().prepare(
    `SELECT id, expires_at FROM student_qr_reset_grants
     WHERE student_id = ? AND qr_generation = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(record.student_id, record.generation, now).first<{ id: string; expires_at: number }>();
}

function exchangeMode(record: RegistrationRecord, grant: { id: string; expires_at: number } | null): RegistrationMode {
  if (record.status === "pending") {
    if (record.purpose !== "activate" || record.used_at) {
      throw new ApiError(410, "처음 등록에 이미 사용한 QR이에요. 학생 로그인 화면을 이용해 주세요.", "QR_ALREADY_ACTIVATED");
    }
    return "activate";
  }
  if (record.status === "reset_required") {
    if (grant) return "reset";
    if (record.purpose === "reset" && !record.used_at) return "reset";
    throw new ApiError(409, "비밀번호 재설정이 필요해요. 선생님께 10분 재설정 허용을 요청해 주세요.", "QR_RESET_GRANT_REQUIRED");
  }
  if (record.status === "active") return grant ? "reset" : "login";
  throw new ApiError(403, "지금은 사용할 수 없는 학생 계정이에요.", "STUDENT_DISABLED");
}

export async function exchangeRegistrationToken(rawToken: string, request: Request) {
  const record = await registrationRecord(rawToken);
  assertUsableRegistration(record);
  const exchangeKey = await subjectThrottleKey("registration-qr-exchange", record!.student_id);
  await consumeRateLimit(exchangeKey, { maxAttempts: 12 });
  const now = Date.now();
  const grant = await currentResetGrant(record!, now);
  const mode = exchangeMode(record!, grant);
  const rawChallenge = randomToken(32);
  const challengeHash = await sha256(rawChallenge);
  const challengeId = crypto.randomUUID();
  const expiresAt = now + REGISTRATION_CHALLENGE_LIFETIME_MS;
  await database().batch([
    database().prepare(
      `DELETE FROM registration_challenges
       WHERE id IN (
         SELECT id FROM registration_challenges
         WHERE created_at < ? AND (expires_at <= ? OR used_at IS NOT NULL OR revoked_at IS NOT NULL)
         LIMIT 100
       )`,
    ).bind(now - 24 * 60 * 60 * 1000, now),
    database().prepare(
      `DELETE FROM student_qr_reset_grants
       WHERE id IN (
         SELECT rg.id FROM student_qr_reset_grants rg
         WHERE rg.created_at < ? AND (rg.expires_at <= ? OR rg.used_at IS NOT NULL OR rg.revoked_at IS NOT NULL)
           AND NOT EXISTS (SELECT 1 FROM registration_challenges rc WHERE rc.reset_grant_id = rg.id)
         LIMIT 100
       )`,
    ).bind(now - 24 * 60 * 60 * 1000, now),
    database().prepare(
      `INSERT INTO registration_challenges
       (id, registration_token_id, student_id, qr_generation, credential_revision_snapshot,
        challenge_hash, mode, reset_grant_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      challengeId, record!.token_id, record!.student_id, record!.generation,
      record!.credential_revision, challengeHash, mode, grant?.id ?? null, expiresAt, now,
    ),
  ]);
  return {
    record: record!,
    mode,
    resetExpiresAt: grant?.expires_at ?? null,
    cookie: challengeCookie(rawChallenge, request),
  };
}

export async function registrationChallenge(request: Request) {
  await ensureSchema();
  const rawChallenge = requestCookie(request, REGISTRATION_CHALLENGE_COOKIE);
  if (!rawChallenge) {
    throw new ApiError(401, "QR을 다시 스캔해 주세요.", "REGISTRATION_CHALLENGE_REQUIRED");
  }
  const challengeHash = await sha256(rawChallenge);
  const record = await database().prepare(
    `SELECT rc.id AS challenge_id, rc.mode AS challenge_mode, rc.reset_grant_id,
            rc.expires_at AS challenge_expires_at, rc.attempts AS challenge_attempts,
            rc.used_at AS challenge_used_at,
            rc.revoked_at AS challenge_revoked_at,
            rt.id AS token_id, rt.student_id, rt.purpose, rt.generation, rt.expires_at,
            rt.used_at, rt.revoked_at,
            s.official_name, s.student_number, s.password_hash, s.status, s.class_id, s.qr_generation,
            s.credential_revision, c.school_name, c.school_year, c.grade, c.class_number, c.display_name,
            c.status AS class_status,
            rg.qr_generation AS grant_generation, rg.expires_at AS grant_expires_at,
            rg.used_at AS grant_used_at, rg.revoked_at AS grant_revoked_at
     FROM registration_challenges rc
     JOIN registration_tokens rt ON rt.id = rc.registration_token_id
     JOIN students s ON s.id = rc.student_id
     JOIN classes c ON c.id = s.class_id
     LEFT JOIN student_qr_reset_grants rg ON rg.id = rc.reset_grant_id
     WHERE rc.challenge_hash = ?`,
  ).bind(challengeHash).first<RegistrationChallenge>();
  const now = Date.now();
  if (!record || record.challenge_used_at || record.challenge_revoked_at || record.challenge_expires_at <= now || record.challenge_attempts >= 5) {
    throw new ApiError(410, "QR 확인 시간이 지났거나 이미 사용했어요. QR을 다시 스캔해 주세요.", "REGISTRATION_CHALLENGE_EXPIRED");
  }
  assertUsableRegistration(record);
  const challengeSnapshot = await database().prepare(
    `SELECT credential_revision_snapshot FROM registration_challenges WHERE id = ?`,
  ).bind(record.challenge_id).first<{ credential_revision_snapshot: number }>();
  if (!challengeSnapshot || challengeSnapshot.credential_revision_snapshot !== record.credential_revision) {
    throw new ApiError(410, "비밀번호 상태가 바뀌었어요. QR을 다시 스캔해 주세요.", "REGISTRATION_STATE_CHANGED");
  }
  if (record.challenge_mode === "activate") {
    if (record.status !== "pending" || record.purpose !== "activate" || record.used_at) {
      throw new ApiError(410, "계정 상태가 바뀌었어요. QR을 다시 스캔해 주세요.", "REGISTRATION_STATE_CHANGED");
    }
  } else if (record.challenge_mode === "reset") {
    const teacherIssuedQr = record.status === "reset_required" && record.purpose === "reset" && !record.used_at;
    const activeGrant = (record.status === "active" || record.status === "reset_required")
      && record.reset_grant_id
      && record.grant_generation === record.generation
      && !record.grant_used_at
      && !record.grant_revoked_at
      && Number(record.grant_expires_at) > now;
    if (!teacherIssuedQr && !activeGrant) {
      throw new ApiError(410, "재설정 허용 시간이 지났어요. 선생님께 다시 요청해 주세요.", "QR_RESET_GRANT_EXPIRED");
    }
  } else if (record.challenge_mode === "login") {
    if (record.status !== "active") {
      throw new ApiError(410, "계정 상태가 바뀌었어요. QR을 다시 스캔해 주세요.", "REGISTRATION_STATE_CHANGED");
    }
  } else {
    throw new ApiError(410, "QR 확인 정보가 올바르지 않아요.", "REGISTRATION_CHALLENGE_EXPIRED");
  }
  return record;
}
