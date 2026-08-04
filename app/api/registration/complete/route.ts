import { prepareSession } from "@/lib/auth";
import { database, isOperationGuardFailure } from "@/lib/database";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import {
  clearRegistrationChallengeCookie,
  registrationChallenge,
  registrationClaimMarker,
  registrationResponseHeaders,
} from "@/lib/registration";
import { consumeRateLimit, subjectThrottleKey } from "@/lib/rate-limit";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";

function guardCondition(mode: "activate" | "login" | "reset", hasGrant: boolean) {
  const common = `
    rc.id = ? AND rc.mode = ? AND rc.used_at IS NULL AND rc.revoked_at IS NULL
    AND rc.expires_at > ? AND rc.attempts < 5
    AND rt.id = rc.registration_token_id AND rt.student_id = rc.student_id
    AND rt.revoked_at IS NULL AND rt.expires_at > ?
    AND rt.generation = rc.qr_generation
    AND s.id = rc.student_id AND s.qr_generation = rc.qr_generation
    AND s.credential_revision = rc.credential_revision_snapshot
    AND s.status NOT IN ('locked', 'excluded') AND c.id = s.class_id AND c.status = 'active'`;
  if (mode === "activate") {
    return `${common}
      AND s.status = 'pending' AND s.password_hash IS NULL
      AND rt.purpose = 'activate' AND rt.used_at IS NULL`;
  }
  if (mode === "login") {
    return `${common}
      AND s.status = 'active' AND s.password_hash = ?`;
  }
  if (hasGrant) {
    return `${common}
      AND s.status IN ('active', 'reset_required') AND rc.reset_grant_id = rg.id
      AND rg.student_id = s.id AND rg.qr_generation = s.qr_generation
      AND rg.used_at IS NULL AND rg.revoked_at IS NULL AND rg.expires_at > ?`;
  }
  return `${common}
    AND s.status = 'reset_required' AND rc.reset_grant_id IS NULL
    AND rt.purpose = 'reset' AND rt.used_at IS NULL`;
}

export async function POST(request: Request) {
  let throttle = "";
  try {
    const body = await readJson<{ password?: string }>(request);
    const password = String(body.password ?? "");
    if (!/^\d{4,12}$/.test(password)) {
      throw new ApiError(400, "비밀번호는 기억하기 쉬운 숫자 4~12자리로 입력해 주세요.", "INVALID_STUDENT_PASSWORD");
    }
    const challenge = await registrationChallenge(request);
    if (challenge.challenge_mode === "login") {
      throttle = await subjectThrottleKey("registration-complete", challenge.student_id);
      await consumeRateLimit(throttle, { maxAttempts: 7 });
    }

    if (challenge.challenge_mode === "login" && !(await verifyPassword(password, challenge.password_hash))) {
      await database().prepare(
        `UPDATE registration_challenges SET attempts = attempts + 1
         WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ? AND attempts < 5`,
      ).bind(challenge.challenge_id, Date.now()).run();
      throw new ApiError(401, "비밀번호를 다시 확인해 주세요.", "LOGIN_FAILED");
    }

    const newPasswordHash = challenge.challenge_mode === "login" ? null : await hashPassword(password);
    const session = await prepareSession({ actorType: "student", studentId: challenge.student_id }, request);
    const now = Date.now();
    const marker = registrationClaimMarker();
    const guardId = crypto.randomUUID();
    const hasGrant = challenge.challenge_mode === "reset" && Boolean(challenge.reset_grant_id);
    const condition = guardCondition(challenge.challenge_mode, hasGrant);
    const guardBindings: unknown[] = [
      challenge.challenge_id,
      challenge.challenge_mode,
      now,
      now,
    ];
    if (challenge.challenge_mode === "login") guardBindings.push(challenge.password_hash);
    if (hasGrant) guardBindings.push(now);

    const statements: D1PreparedStatement[] = [
      database().prepare(
        `INSERT INTO registration_operation_guards (id, operation, created_at)
         SELECT CASE WHEN EXISTS (
           SELECT 1
           FROM registration_challenges rc
           JOIN registration_tokens rt ON rt.id = rc.registration_token_id
           JOIN students s ON s.id = rc.student_id
           JOIN classes c ON c.id = s.class_id
           LEFT JOIN student_qr_reset_grants rg ON rg.id = rc.reset_grant_id
           WHERE ${condition}
         ) THEN ? ELSE NULL END, ?, ?`,
      ).bind(...guardBindings, guardId, `registration_${challenge.challenge_mode}`, now),
      database().prepare(
        `UPDATE registration_challenges SET used_at = ? WHERE id = ?`,
      ).bind(marker, challenge.challenge_id),
    ];

    if (challenge.challenge_mode === "activate" || (challenge.challenge_mode === "reset" && !hasGrant)) {
      statements.push(database().prepare(
        `UPDATE registration_tokens SET used_at = ? WHERE id = ?`,
      ).bind(marker, challenge.token_id));
    }
    if (hasGrant) {
      statements.push(database().prepare(
        `UPDATE student_qr_reset_grants SET used_at = ? WHERE id = ?`,
      ).bind(marker, challenge.reset_grant_id));
    }
    if (challenge.challenge_mode !== "login") {
      statements.push(database().prepare(
        `UPDATE students
         SET password_hash = ?, status = 'active', credential_revision = credential_revision + 1,
             activated_at = COALESCE(activated_at, ?), updated_at = ?
         WHERE id = ?`,
      ).bind(newPasswordHash, now, now, challenge.student_id));
      statements.push(database().prepare(
        `UPDATE registration_challenges SET revoked_at = ?
         WHERE student_id = ? AND id != ? AND used_at IS NULL AND revoked_at IS NULL`,
      ).bind(now, challenge.student_id, challenge.challenge_id));
      statements.push(database().prepare(`DELETE FROM sessions WHERE student_id = ?`).bind(challenge.student_id));
    }

    statements.push(
      database().prepare(
        `INSERT INTO sessions
         (id, token_hash, actor_type, teacher_id, student_id, expires_at, created_at, last_seen_at)
         VALUES (?, ?, 'student', NULL, ?, ?, ?, ?)`,
      ).bind(
        session.id, session.tokenHash, challenge.student_id,
        session.expiresAt, session.createdAt, session.createdAt,
      ),
      database().prepare(
        `INSERT INTO audit_logs (id, class_id, student_id, action, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(), challenge.class_id, challenge.student_id,
        challenge.challenge_mode === "activate"
          ? "student_activated"
          : challenge.challenge_mode === "reset"
            ? "student_password_reset_completed"
            : "student_qr_login",
        JSON.stringify({ generation: challenge.generation }), now,
      ),
      database().prepare(
        `UPDATE registration_challenges SET used_at = ? WHERE id = ? AND used_at = ?`,
      ).bind(now, challenge.challenge_id, marker),
    );
    if (challenge.challenge_mode === "activate" || (challenge.challenge_mode === "reset" && !hasGrant)) {
      statements.push(database().prepare(
        `UPDATE registration_tokens SET used_at = ? WHERE id = ? AND used_at = ?`,
      ).bind(now, challenge.token_id, marker));
    }
    if (hasGrant) {
      statements.push(database().prepare(
        `UPDATE student_qr_reset_grants SET used_at = ? WHERE id = ? AND used_at = ?`,
      ).bind(now, challenge.reset_grant_id, marker));
    }
    if (throttle) {
      statements.push(database().prepare(`DELETE FROM login_throttles WHERE key = ?`).bind(throttle));
    }
    statements.push(database().prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId));

    try {
      await database().batch(statements);
    } catch (error) {
      if (isOperationGuardFailure(error)) {
        throw new ApiError(410, "계정 상태가 바뀌었어요. QR을 다시 스캔해 주세요.", "REGISTRATION_STATE_CHANGED");
      }
      throw error;
    }
    const headers = registrationResponseHeaders();
    headers.append("Set-Cookie", session.cookie);
    headers.append("Set-Cookie", clearRegistrationChallengeCookie(request));
    return json({ ok: true, mode: challenge.challenge_mode }, 200, headers);
  } catch (error) {
    const response = apiFailure(error);
    const headers = registrationResponseHeaders();
    if (error instanceof ApiError && (error.status === 410 || error.status === 403)) {
      headers.append("Set-Cookie", clearRegistrationChallengeCookie(request));
    }
    headers.set("Content-Type", response.headers.get("Content-Type") ?? "application/json");
    return new Response(response.body, { status: response.status, headers });
  }
}
