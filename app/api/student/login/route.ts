import { prepareSession } from "@/lib/auth";
import { database, ensureSchema, isOperationGuardFailure } from "@/lib/database";
import { verifyPasswordOrDummy } from "@/lib/crypto";
import { integerInRange } from "@/lib/identity";
import {
  consumeRateLimit,
  credentialThrottleKey,
  subjectThrottleKey,
  throttleKey,
} from "@/lib/rate-limit";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";
import { normalizeStudentSchoolCode, resolveStudentLogin } from "@/lib/student-login";

export async function POST(request: Request) {
  try {
    const body = await readJson<{
      schoolCode?: string;
      grade?: number;
      classNumber?: number;
      studentNumber?: number;
      password?: string;
    }>(request);
    const schoolCode = normalizeStudentSchoolCode(body.schoolCode);
    const grade = integerInRange(body.grade, 1, 6);
    const classNumber = integerInRange(body.classNumber, 1, 30);
    const studentNumber = integerInRange(body.studentNumber, 1, 99);
    const password = String(body.password ?? "");
    if (!schoolCode || !grade || !classNumber || !studentNumber || !password) {
      throw new ApiError(400, "학교코드·학년·반·번호·비밀번호를 모두 입력해 주세요.", "MISSING_LOGIN_FIELDS");
    }
    const ipKey = await throttleKey(request, "student-login-ip", "all");
    await consumeRateLimit(ipKey, { maxAttempts: 500 });
    await ensureSchema();
    const resolution = await resolveStudentLogin({ schoolCode, grade, classNumber, studentNumber });
    const student = resolution.candidate;
    const visibleIdentifier = `${schoolCode}|${grade}|${classNumber}|${studentNumber}`;
    const credentialIdentifier = student
      ? `${student.id}|${student.credential_revision}`
      : visibleIdentifier;
    const key = await credentialThrottleKey(request, "student-login", credentialIdentifier);
    const subjectKey = await subjectThrottleKey("student-login", credentialIdentifier);
    // Reserve one of this account's seven direct-PIN attempts atomically before
    // PBKDF2. Concurrent or distributed guesses therefore cannot all slip past
    // a separate "is blocked" read. A locked student can still prove possession
    // of the reusable personal QR card and sign in through that flow.
    await consumeRateLimit(subjectKey, {
      maxAttempts: 7,
      windowMs: 60 * 60 * 1_000,
      blockMs: 60 * 60 * 1_000,
    });
    await consumeRateLimit(key, {
      maxAttempts: 7,
      windowMs: 60 * 60 * 1_000,
      blockMs: 15 * 60 * 1_000,
    });
    const passwordMatches = await verifyPasswordOrDummy(password, student?.password_hash);
    if (
      !student
      || resolution.ambiguous
      || (student.status !== "active" && student.status !== "reset_required")
      || !passwordMatches
    ) {
      throw new ApiError(401, "입력한 정보를 다시 확인해 주세요.", "LOGIN_FAILED");
    }
    const passwordResetRequired = student.status === "reset_required";
    const session = await prepareSession({
      actorType: passwordResetRequired ? "student_password_reset" : "student",
      studentId: student.id,
    }, request);
    const guardId = crypto.randomUUID();
    const now = Date.now();
    try {
      const statements: D1PreparedStatement[] = [
        database().prepare(
          `INSERT INTO registration_operation_guards (id, operation, created_at)
           SELECT CASE WHEN EXISTS (
             SELECT 1 FROM students s
             JOIN classes c ON c.id = s.class_id
             WHERE s.id = ? AND s.class_id = ? AND s.status = ? AND s.password_hash = ?
               AND s.credential_revision = ? AND s.qr_generation = ? AND c.status = 'active'
           ) THEN ? ELSE NULL END, 'student_password_login', ?`,
        ).bind(
          student.id, student.class_id, student.status, student.password_hash, student.credential_revision,
          student.qr_generation, guardId, now,
        ),
      ];
      if (passwordResetRequired) {
        statements.push(database().prepare(`DELETE FROM sessions WHERE student_id = ?`).bind(student.id));
      }
      statements.push(
        database().prepare(
          `INSERT INTO sessions
           (id, token_hash, actor_type, teacher_id, student_id, expires_at, created_at, last_seen_at)
           VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
        ).bind(
          session.id, session.tokenHash, session.actorType, student.id,
          session.expiresAt, session.createdAt, session.createdAt,
        ),
        database().prepare(`DELETE FROM login_throttles WHERE key = ?`).bind(key),
        database().prepare(`DELETE FROM login_throttles WHERE key = ?`).bind(subjectKey),
        database().prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
      );
      await database().batch(statements);
    } catch (error) {
      if (isOperationGuardFailure(error)) {
        throw new ApiError(401, "입력한 정보를 다시 확인해 주세요.", "LOGIN_FAILED");
      }
      throw error;
    }
    return json({ ok: true, passwordResetRequired }, 200, { "Set-Cookie": session.cookie });
  } catch (error) {
    return apiFailure(error);
  }
}
