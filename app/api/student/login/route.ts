import { createSession } from "@/lib/auth";
import { database, ensureSchema } from "@/lib/database";
import { verifyPassword } from "@/lib/crypto";
import { integerInRange, normalizeSchool } from "@/lib/identity";
import { assertNotBlocked, clearFailures, recordFailure, throttleKey } from "@/lib/rate-limit";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ schoolName?: string; grade?: number; classNumber?: number; studentNumber?: number; password?: string }>(request);
    const schoolNormalized = normalizeSchool(body.schoolName);
    const grade = integerInRange(body.grade, 1, 6);
    const classNumber = integerInRange(body.classNumber, 1, 30);
    const studentNumber = integerInRange(body.studentNumber, 1, 99);
    const password = String(body.password ?? "");
    if (!schoolNormalized || !grade || !classNumber || !studentNumber || !password) {
      throw new ApiError(400, "학교·학년·반·번호·비밀번호를 모두 입력해 주세요.", "MISSING_LOGIN_FIELDS");
    }
    const identifier = `${schoolNormalized}|${grade}|${classNumber}|${studentNumber}`;
    const key = await throttleKey(request, "student-login", identifier);
    await assertNotBlocked(key);
    await ensureSchema();
    const student = await database().prepare(
      `SELECT s.id, s.password_hash, s.status
       FROM students s JOIN classes c ON c.id = s.class_id
       WHERE c.school_normalized = ? AND c.grade = ? AND c.class_number = ? AND c.status = 'active'
         AND s.student_number = ?
       ORDER BY c.school_year DESC LIMIT 1`,
    ).bind(schoolNormalized, grade, classNumber, studentNumber).first<{ id: string; password_hash: string | null; status: string }>();
    if (!student || student.status !== "active" || !(await verifyPassword(password, student.password_hash))) {
      await recordFailure(key);
      throw new ApiError(401, "입력한 정보를 다시 확인해 주세요.", "LOGIN_FAILED");
    }
    await clearFailures(key);
    const session = await createSession({ actorType: "student", studentId: student.id }, request);
    return json({ ok: true }, 200, { "Set-Cookie": session.cookie });
  } catch (error) {
    return apiFailure(error);
  }
}
