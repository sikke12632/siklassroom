import { prepareTeacherSessionRotation, requireEmailVerified } from "@/lib/auth";
import { database, isOperationGuardFailure } from "@/lib/database";
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
    const existingRequest = await database().prepare(
      `SELECT id, entered_name, normalized_name, province_name, school_level,
              district_or_address, note, status
       FROM school_manual_requests
       WHERE submitted_by_teacher_id = ? AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
    ).bind(teacherId).first<{
      id: string;
      entered_name: string;
      normalized_name: string;
      province_name: string;
      school_level: string;
      district_or_address: string | null;
      note: string | null;
      status: "pending";
    }>();
    if (existingRequest) {
      const sameRequest = existingRequest.normalized_name === input.normalizedName
        && existingRequest.province_name === input.provinceName
        && existingRequest.school_level === input.schoolLevel
        && existingRequest.district_or_address === input.districtOrAddress
        && existingRequest.note === input.note;
      if (!sameRequest) {
        throw new ApiError(409, "이미 검토 중인 학교 요청이 있어요. 처리된 뒤 다시 요청해 주세요.", "MANUAL_SCHOOL_REQUEST_PENDING");
      }
      return json({
        request: { id: existingRequest.id, ...input, status: existingRequest.status },
        duplicateRequest: true,
      });
    }
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
    if (duplicateRequest) {
      throw new ApiError(409, "같은 학교가 이미 검토 중이에요. 관리자 확인을 기다려 주세요.", "MANUAL_SCHOOL_REQUEST_EXISTS");
    }
    const id = crypto.randomUUID();
    const requestGuardId = crypto.randomUUID();
    const now = Date.now();
    const rotation = await prepareTeacherSessionRotation(teacherId, request);
    try {
      await database().batch([
        rotation.guard,
        database().prepare(
          `INSERT INTO registration_operation_guards (id, operation, created_at)
           SELECT CASE WHEN NOT EXISTS (
             SELECT 1 FROM school_manual_requests
             WHERE submitted_by_teacher_id = ? AND status = 'pending'
           ) THEN ? ELSE NULL END, 'manual_school_request', ?`,
        ).bind(teacherId, requestGuardId, now),
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
        rotation.revoke,
        rotation.create,
        database().prepare(
          `INSERT INTO audit_logs (id, teacher_id, action, detail, created_at)
           VALUES (?, ?, 'teacher_manual_school_requested', ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          teacherId,
          JSON.stringify({ requestId: id, duplicateRequest: Boolean(duplicateRequest) }),
          now,
        ),
        rotation.cleanup,
        database().prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(requestGuardId),
      ]);
    } catch (error) {
      if (isOperationGuardFailure(error)) {
        const pending = await database().prepare(
          `SELECT id FROM school_manual_requests
           WHERE submitted_by_teacher_id = ? AND status = 'pending' LIMIT 1`,
        ).bind(teacherId).first();
        if (pending) {
          throw new ApiError(409, "이미 검토 중인 학교 요청이 있어요.", "MANUAL_SCHOOL_REQUEST_PENDING");
        }
        throw new ApiError(409, "로그인 상태가 바뀌었습니다. 다시 로그인해 주세요.", "TEACHER_SESSION_CHANGED");
      }
      throw error;
    }
    return json({
      request: { id, ...input, status: "pending" },
      duplicateRequest: false,
    }, 201, { "Set-Cookie": rotation.cookie });
  } catch (error) {
    return apiFailure(error);
  }
}
