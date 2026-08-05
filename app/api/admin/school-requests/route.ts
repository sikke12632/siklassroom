import { database, isOperationGuardFailure } from "@/lib/database";
import { cleanDisplayText, normalizeSchool } from "@/lib/identity";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";
import { normalizeSchoolSearch } from "@/lib/schools";
import { systemAdminAuditStatement } from "@/lib/system-admin-audit";
import { requireSystemAdmin } from "@/lib/system-admin-auth";

export async function GET(request: Request) {
  try {
    await requireSystemAdmin(request);
    const [requests, schools] = await database().batch([
      database().prepare(
        `SELECT r.id, r.entered_name, r.normalized_name, r.province_name, r.school_level,
                r.district_or_address, r.note, r.status, r.linked_school_id, r.created_at,
                r.reviewed_at, r.reviewed_by, r.review_note, t.email AS teacher_email
         FROM school_manual_requests r
         JOIN teachers t ON t.id = r.submitted_by_teacher_id
         ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC LIMIT 200`,
      ),
      database().prepare(
        `SELECT id, official_name, province_name, school_level, district_name, road_address
         FROM schools WHERE status = 'active' ORDER BY official_name LIMIT 500`,
      ),
    ]);
    return json({ requests: requests.results, schools: schools.results });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireSystemAdmin(request, { csrf: true });
    const body = await readJson<{ id?: string; action?: string; schoolId?: string; note?: string }>(request);
    const id = String(body.id ?? "");
    const action = String(body.action ?? "");
    const note = cleanDisplayText(body.note, 240) || null;
    if (!id || !["link", "approve_new", "reject"].includes(action)) {
      throw new ApiError(400, "학교 요청과 처리 내용을 확인해 주세요.", "INVALID_SCHOOL_REVIEW");
    }
    const current = await database().prepare(
      `SELECT id, submitted_by_teacher_id, entered_name, normalized_name, province_name,
              school_level, district_or_address, status, linked_school_id
       FROM school_manual_requests WHERE id = ?`,
    ).bind(id).first<{
      id: string;
      submitted_by_teacher_id: string;
      entered_name: string;
      normalized_name: string;
      province_name: string;
      school_level: string;
      district_or_address: string | null;
      status: string;
      linked_school_id: string | null;
    }>();
    if (!current) throw new ApiError(404, "학교 확인 요청을 찾을 수 없습니다.", "SCHOOL_REQUEST_NOT_FOUND");
    if (current.status !== "pending") throw new ApiError(409, "이미 처리된 학교 확인 요청입니다.", "SCHOOL_REQUEST_ALREADY_REVIEWED");

    const now = Date.now();
    let linkedSchoolId: string | null = null;
    let nextStatus = "rejected";
    let createSchool: D1PreparedStatement | null = null;
    if (action === "link") {
      linkedSchoolId = String(body.schoolId ?? "");
      if (!linkedSchoolId) throw new ApiError(400, "연결할 공식 학교를 선택해 주세요.", "SCHOOL_REQUIRED");
      const school = await database().prepare(`SELECT id FROM schools WHERE id = ? AND status = 'active'`)
        .bind(linkedSchoolId).first();
      if (!school) throw new ApiError(404, "연결할 공식 학교를 찾을 수 없습니다.", "SCHOOL_NOT_FOUND");
      nextStatus = "linked";
    } else if (action === "approve_new") {
      const duplicate = await database().prepare(
        `SELECT id FROM schools
         WHERE normalized_name = ? AND province_name = ? AND school_level = ? AND status = 'active'
         LIMIT 1`,
      ).bind(current.normalized_name, current.province_name, current.school_level).first<{ id: string }>();
      linkedSchoolId = duplicate?.id ?? `manual:${crypto.randomUUID()}`;
      if (!duplicate) {
        createSchool = database().prepare(
          `INSERT INTO schools
           (id, office_code, school_code, official_name, normalized_name, search_name, school_level,
            province_name, district_name, road_address, status, source, created_at, updated_at)
           VALUES (?, 'MANUAL', ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'manual_approved', ?, ?)`,
        ).bind(
          linkedSchoolId,
          id,
          current.entered_name,
          normalizeSchool(current.entered_name),
          normalizeSchoolSearch(current.entered_name),
          current.school_level,
          current.province_name,
          current.district_or_address,
          current.district_or_address,
          now,
          now,
        );
      }
      nextStatus = "approved";
    }

    const guardId = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [
      database().prepare(
        `INSERT INTO registration_operation_guards (id, operation, created_at)
         SELECT CASE WHEN EXISTS (
           SELECT 1 FROM school_manual_requests WHERE id = ? AND status = 'pending'
         ) THEN ? ELSE NULL END, 'admin_school_request_review', ?`,
      ).bind(id, guardId, now),
    ];
    if (createSchool) statements.push(createSchool);
    statements.push(
      database().prepare(
        `UPDATE school_manual_requests
         SET status = ?, linked_school_id = ?, reviewed_at = ?, reviewed_by = ?, review_note = ?
         WHERE id = ? AND status = 'pending'`,
      ).bind(nextStatus, linkedSchoolId, now, admin.adminKey, note, id),
    );
    if (linkedSchoolId) {
      statements.push(
        database().prepare(
          `UPDATE teachers SET school_id = ?, manual_school_request_id = NULL, updated_at = ?
           WHERE manual_school_request_id = ?`,
        ).bind(linkedSchoolId, now, id),
        database().prepare(
          `UPDATE classes SET school_id = ?, manual_school_request_id = NULL, updated_at = ?
           WHERE manual_school_request_id = ?`,
        ).bind(linkedSchoolId, now, id),
      );
    } else if (action === "reject") {
      statements.push(
        database().prepare(
          `DELETE FROM sessions
           WHERE teacher_id = ? AND EXISTS (
             SELECT 1 FROM teachers
             WHERE id = ? AND manual_school_request_id = ?
           )`,
        ).bind(current.submitted_by_teacher_id, current.submitted_by_teacher_id, id),
        database().prepare(
          `UPDATE teachers
           SET manual_school_request_id = NULL,
               credential_revision = credential_revision + 1,
               updated_at = ?
           WHERE id = ? AND manual_school_request_id = ?`,
        ).bind(now, current.submitted_by_teacher_id, id),
      );
    }
    statements.push(
      systemAdminAuditStatement({
        adminKey: admin.adminKey,
        action: action === "reject" ? "school_request_rejected" : action === "link" ? "school_request_linked" : "school_request_approved",
        targetType: "school_manual_request",
        targetId: id,
        before: { status: current.status, linkedSchoolId: current.linked_school_id },
        after: { status: nextStatus, linkedSchoolId, note },
      }, now),
      database().prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
    );
    try {
      await database().batch(statements);
    } catch (error) {
      if (isOperationGuardFailure(error)) {
        throw new ApiError(409, "다른 관리자 화면에서 먼저 처리한 학교 요청입니다.", "SCHOOL_REQUEST_ALREADY_REVIEWED");
      }
      throw error;
    }
    return json({ ok: true, request: { id, status: nextStatus, linked_school_id: linkedSchoolId } });
  } catch (error) {
    return apiFailure(error);
  }
}
