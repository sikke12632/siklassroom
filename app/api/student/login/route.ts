import { prepareSession } from "@/lib/auth";
import { database, ensureSchema, isOperationGuardFailure } from "@/lib/database";
import { verifyPassword } from "@/lib/crypto";
import { integerInRange, normalizeSchool } from "@/lib/identity";
import { consumeRateLimit, throttleKey } from "@/lib/rate-limit";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request) {
  try {
    const body = await readJson<{
      schoolName?: string;
      schoolYear?: number;
      grade?: number;
      classNumber?: number;
      studentNumber?: number;
      password?: string;
    }>(request);
    const schoolNormalized = normalizeSchool(body.schoolName);
    const schoolYear = integerInRange(body.schoolYear, 2020, 2100);
    const grade = integerInRange(body.grade, 1, 6);
    const classNumber = integerInRange(body.classNumber, 1, 30);
    const studentNumber = integerInRange(body.studentNumber, 1, 99);
    const password = String(body.password ?? "");
    if (!schoolNormalized || !schoolYear || !grade || !classNumber || !studentNumber || !password) {
      throw new ApiError(400, "학교·학년도·학년·반·번호·비밀번호를 모두 입력해 주세요.", "MISSING_LOGIN_FIELDS");
    }
    const identifier = `${schoolNormalized}|${schoolYear}|${grade}|${classNumber}|${studentNumber}`;
    const key = await throttleKey(request, "student-login", identifier);
    await consumeRateLimit(key, { maxAttempts: 7 });
    await ensureSchema();
    const studentRows = await database().prepare(
      `SELECT s.id, s.password_hash, s.status, s.credential_revision, s.qr_generation
       FROM students s JOIN classes c ON c.id = s.class_id
       WHERE c.school_normalized = ? AND c.school_year = ? AND c.grade = ? AND c.class_number = ? AND c.status = 'active'
         AND s.student_number = ?
       LIMIT 2`,
    ).bind(schoolNormalized, schoolYear, grade, classNumber, studentNumber).all<{
      id: string;
      password_hash: string | null;
      status: string;
      credential_revision: number;
      qr_generation: number;
    }>();
    const student = studentRows.results.length === 1 ? studentRows.results[0] : null;
    if (!student || student.status !== "active" || !(await verifyPassword(password, student.password_hash))) {
      throw new ApiError(401, "입력한 정보를 다시 확인해 주세요.", "LOGIN_FAILED");
    }
    const session = await prepareSession({ actorType: "student", studentId: student.id }, request);
    const guardId = crypto.randomUUID();
    const now = Date.now();
    try {
      await database().batch([
        database().prepare(
          `INSERT INTO registration_operation_guards (id, operation, created_at)
           SELECT CASE WHEN EXISTS (
             SELECT 1 FROM students s
             JOIN classes c ON c.id = s.class_id
             WHERE s.id = ? AND s.status = 'active' AND s.password_hash = ?
               AND s.credential_revision = ? AND s.qr_generation = ? AND c.status = 'active'
           ) THEN ? ELSE NULL END, 'student_password_login', ?`,
        ).bind(
          student.id, student.password_hash, student.credential_revision,
          student.qr_generation, guardId, now,
        ),
        database().prepare(
          `INSERT INTO sessions
           (id, token_hash, actor_type, teacher_id, student_id, expires_at, created_at, last_seen_at)
           VALUES (?, ?, 'student', NULL, ?, ?, ?, ?)`,
        ).bind(
          session.id, session.tokenHash, student.id,
          session.expiresAt, session.createdAt, session.createdAt,
        ),
        database().prepare(`DELETE FROM login_throttles WHERE key = ?`).bind(key),
        database().prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
      ]);
    } catch (error) {
      if (isOperationGuardFailure(error)) {
        throw new ApiError(401, "입력한 정보를 다시 확인해 주세요.", "LOGIN_FAILED");
      }
      throw error;
    }
    return json({ ok: true }, 200, { "Set-Cookie": session.cookie });
  } catch (error) {
    return apiFailure(error);
  }
}
