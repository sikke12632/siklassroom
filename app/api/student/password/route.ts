import {
  prepareSession,
  requireStudentPasswordReset,
  SESSION_COOKIE,
} from "@/lib/auth";
import { requestCookie } from "@/lib/cookies";
import { hashPassword, sha256 } from "@/lib/crypto";
import { database, isOperationGuardFailure } from "@/lib/database";
import { subjectThrottleKey } from "@/lib/rate-limit";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";
import {
  isSafeNewStudentPassword,
  STUDENT_TEMPORARY_PASSWORD,
} from "@/lib/student-password";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ password?: string }>(request);
    const password = String(body.password ?? "");
    if (!isSafeNewStudentPassword(password)) {
      throw new ApiError(
        400,
        "새 비밀번호는 영문 또는 숫자 4~32자로 만들어 주세요.",
        "INVALID_STUDENT_PASSWORD",
      );
    }
    if (password === STUDENT_TEMPORARY_PASSWORD) {
      throw new ApiError(
        400,
        "임시 비밀번호와 다른 새 비밀번호를 만들어 주세요.",
        "TEMPORARY_PASSWORD_REUSE",
      );
    }

    const { studentId } = await requireStudentPasswordReset(request);
    const rawToken = requestCookie(request, SESSION_COOKIE);
    if (!rawToken) {
      throw new ApiError(401, "임시 비밀번호로 다시 로그인해 주세요.", "STUDENT_PASSWORD_RESET_REQUIRED");
    }
    const current = await database().prepare(
      `SELECT s.password_hash, s.credential_revision, s.qr_generation, s.class_id
       FROM students s JOIN classes c ON c.id = s.class_id
       WHERE s.id = ? AND s.status = 'reset_required' AND c.status = 'active'`,
    ).bind(studentId).first<{
      password_hash: string | null;
      credential_revision: number;
      qr_generation: number;
      class_id: string;
    }>();
    if (!current?.password_hash) {
      throw new ApiError(410, "비밀번호 상태가 바뀌었어요. 다시 로그인해 주세요.", "PASSWORD_RESET_STATE_CHANGED");
    }

    const currentTokenHash = await sha256(rawToken);
    const nextPasswordHash = await hashPassword(password);
    const nextSession = await prepareSession({ actorType: "student", studentId }, request);
    const registrationThrottle = await subjectThrottleKey("registration-complete", studentId);
    const now = Date.now();
    const guardId = crypto.randomUUID();
    try {
      await database().batch([
        database().prepare(
          `INSERT INTO registration_operation_guards (id, operation, created_at)
           SELECT CASE WHEN EXISTS (
             SELECT 1 FROM sessions session
             JOIN students student ON student.id = session.student_id
             JOIN classes classroom ON classroom.id = student.class_id
             WHERE session.token_hash = ?
               AND session.actor_type = 'student_password_reset'
               AND session.student_id = ? AND session.expires_at > ?
               AND student.status = 'reset_required'
               AND student.password_hash = ? AND student.credential_revision = ?
               AND student.qr_generation = ? AND classroom.status = 'active'
           ) THEN ? ELSE NULL END, 'student_forced_password_change', ?`,
        ).bind(
          currentTokenHash,
          studentId,
          now,
          current.password_hash,
          current.credential_revision,
          current.qr_generation,
          guardId,
          now,
        ),
        database().prepare(
          `UPDATE students
           SET password_hash = ?, status = 'active',
               credential_revision = credential_revision + 1, updated_at = ?
           WHERE id = ? AND status = 'reset_required'
             AND password_hash = ? AND credential_revision = ? AND qr_generation = ?`,
        ).bind(
          nextPasswordHash,
          now,
          studentId,
          current.password_hash,
          current.credential_revision,
          current.qr_generation,
        ),
        database().prepare(
          `UPDATE registration_challenges SET revoked_at = ?
           WHERE student_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
        ).bind(now, studentId),
        database().prepare(
          `UPDATE student_qr_reset_grants SET revoked_at = ?
           WHERE student_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
        ).bind(now, studentId),
        database().prepare(`DELETE FROM sessions WHERE student_id = ?`).bind(studentId),
        database().prepare(
          `INSERT INTO sessions
           (id, token_hash, actor_type, teacher_id, student_id, expires_at, created_at, last_seen_at)
           VALUES (?, ?, 'student', NULL, ?, ?, ?, ?)`,
        ).bind(
          nextSession.id,
          nextSession.tokenHash,
          studentId,
          nextSession.expiresAt,
          nextSession.createdAt,
          nextSession.createdAt,
        ),
        database().prepare(
          `INSERT INTO audit_logs (id, class_id, student_id, action, detail, created_at)
           VALUES (?, ?, ?, 'student_forced_password_change_completed', ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          current.class_id,
          studentId,
          JSON.stringify({ credentialRevision: current.credential_revision + 1 }),
          now,
        ),
        database().prepare(`DELETE FROM login_throttles WHERE key = ?`).bind(registrationThrottle),
        database().prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
      ]);
    } catch (error) {
      if (isOperationGuardFailure(error)) {
        throw new ApiError(
          410,
          "비밀번호 상태가 바뀌었어요. 임시 비밀번호로 다시 로그인해 주세요.",
          "PASSWORD_RESET_STATE_CHANGED",
        );
      }
      throw error;
    }
    return json({ ok: true }, 200, { "Set-Cookie": nextSession.cookie });
  } catch (error) {
    return apiFailure(error);
  }
}
