import { prepareTeacherSessionRotation, requireEmailVerified } from "@/lib/auth";
import { database, isOperationGuardFailure } from "@/lib/database";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request) {
  try {
    const { teacherId, teacherAccessStatus } = await requireEmailVerified(request);
    if (teacherAccessStatus === "revoked") {
      throw new ApiError(403, "교사 이용 권한이 회수되어 학교를 변경할 수 없습니다.", "TEACHER_ACCESS_REVOKED");
    }
    const body = await readJson<{ schoolId?: string }>(request);
    const schoolId = String(body.schoolId ?? "");
    const school = await database().prepare(
      `SELECT id, official_name, province_name, school_level FROM schools
       WHERE id = ? AND status = 'active'`,
    ).bind(schoolId).first<Record<string, string>>();
    if (!school) throw new ApiError(404, "선택한 학교를 찾을 수 없습니다.", "SCHOOL_NOT_FOUND");
    const now = Date.now();
    const rotation = await prepareTeacherSessionRotation(teacherId, request);
    try {
      await database().batch([
        rotation.guard,
        database().prepare(
          `UPDATE teachers SET school_id = ?, manual_school_request_id = NULL, updated_at = ? WHERE id = ?`,
        ).bind(schoolId, now, teacherId),
        rotation.revoke,
        rotation.create,
        database().prepare(
          `INSERT INTO audit_logs (id, teacher_id, action, detail, created_at)
           VALUES (?, ?, 'teacher_school_selected', ?, ?)`,
        ).bind(crypto.randomUUID(), teacherId, JSON.stringify({ schoolId }), now),
        rotation.cleanup,
      ]);
    } catch (error) {
      if (isOperationGuardFailure(error)) {
        throw new ApiError(409, "로그인 상태가 바뀌었습니다. 다시 로그인해 주세요.", "TEACHER_SESSION_CHANGED");
      }
      throw error;
    }
    return json({ school }, 200, { "Set-Cookie": rotation.cookie });
  } catch (error) {
    return apiFailure(error);
  }
}
