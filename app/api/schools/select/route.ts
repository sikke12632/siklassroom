import { requireEmailVerified } from "@/lib/auth";
import { audit, database } from "@/lib/database";
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
    await database().prepare(
      `UPDATE teachers SET school_id = ?, manual_school_request_id = NULL, updated_at = ? WHERE id = ?`,
    ).bind(schoolId, now, teacherId).run();
    await audit({ action: "teacher_school_selected", teacherId, detail: { schoolId } });
    return json({ school });
  } catch (error) {
    return apiFailure(error);
  }
}
