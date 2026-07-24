import { requireEmailVerified } from "@/lib/auth";
import { audit, database } from "@/lib/database";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";
import { manualSchoolInput } from "@/lib/schools";

export async function POST(request: Request) {
  try {
    const { teacherId, teacherAccessStatus } = await requireEmailVerified(request);
    if (teacherAccessStatus === "revoked") {
      throw new ApiError(403, "교사 이용 권한이 회수되어 학교를 변경할 수 없습니다.", "TEACHER_ACCESS_REVOKED");
    }
    const body = await readJson<Record<string, unknown>>(request);
    const input = manualSchoolInput({
      enteredName: body.enteredName,
      provinceName: body.provinceName,
      schoolLevel: body.schoolLevel,
      districtOrAddress: body.districtOrAddress,
      note: body.note,
    });
    const duplicateOfficial = await database().prepare(
      `SELECT id, official_name, province_name, school_level, road_address
       FROM schools WHERE normalized_name = ? AND province_name = ? AND status = 'active' LIMIT 1`,
    ).bind(input.normalizedName, input.provinceName).first();
    const duplicateRequest = await database().prepare(
      `SELECT id FROM school_manual_requests
       WHERE normalized_name = ? AND province_name = ? AND status = 'pending' LIMIT 1`,
    ).bind(input.normalizedName, input.provinceName).first();
    if (duplicateOfficial) {
      throw new ApiError(409, "같은 이름의 공식 학교가 있어요. 검색 결과에서 다시 선택해 주세요.", "OFFICIAL_SCHOOL_EXISTS");
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    await database().batch([
      database().prepare(
        `INSERT INTO school_manual_requests
         (id, submitted_by_teacher_id, entered_name, normalized_name, province_name,
          school_level, district_or_address, note, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      ).bind(
        id, teacherId, input.enteredName, input.normalizedName, input.provinceName,
        input.schoolLevel, input.districtOrAddress, input.note, now,
      ),
      database().prepare(
        `UPDATE teachers SET school_id = NULL, manual_school_request_id = ?, updated_at = ? WHERE id = ?`,
      ).bind(id, now, teacherId),
    ]);
    await audit({
      action: "teacher_manual_school_requested",
      teacherId,
      detail: { requestId: id, duplicateRequest: Boolean(duplicateRequest) },
    });
    return json({
      request: { id, ...input, status: "pending" },
      duplicateRequest: Boolean(duplicateRequest),
    }, 201);
  } catch (error) {
    return apiFailure(error);
  }
}
