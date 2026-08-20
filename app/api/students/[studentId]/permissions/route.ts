import { requireClassManagement } from "@/lib/auth";
import { ownedActiveStudent } from "@/lib/authorization";
import { database, isOperationGuardFailure } from "@/lib/database";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";
import { parseStudentPermissionKey } from "@/lib/student-permissions";

type PermissionRow = {
  id: string;
  class_id: string;
  student_id: string;
  permission_key: string;
  is_active: number;
  revision: number;
  created_at: number;
  updated_at: number;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ studentId: string }> },
) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { studentId } = await context.params;
    const student = await ownedActiveStudent(teacherId, studentId);
    const body = await readJson<{
      permissionKey?: unknown;
      enabled?: unknown;
      expectedRevision?: unknown;
    }>(request);
    const permissionKey = parseStudentPermissionKey(body.permissionKey);
    if (!permissionKey) {
      throw new ApiError(400, "운영 권한을 다시 선택해 주세요.", "STUDENT_PERMISSION_INVALID");
    }
    if (typeof body.enabled !== "boolean") {
      throw new ApiError(400, "권한 사용 여부를 다시 선택해 주세요.", "STUDENT_PERMISSION_STATE_INVALID");
    }
    if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) {
      throw new ApiError(400, "최신 권한 정보를 다시 불러와 주세요.", "STUDENT_PERMISSION_REVISION_INVALID");
    }
    const enabled = body.enabled;
    const expectedRevision = Number(body.expectedRevision);
    const current = await database().prepare(
      `SELECT id, class_id, student_id, permission_key, is_active, revision,
              created_at, updated_at
       FROM student_manual_permissions
       WHERE class_id = ? AND student_id = ? AND permission_key = ?
       LIMIT 1`,
    ).bind(student.class_id, studentId, permissionKey).first<PermissionRow>();

    if (!current && !enabled && expectedRevision === 0) {
      return json({ permissionKey, enabled: false, revision: 0, changed: false });
    }
    if (Number(current?.revision ?? 0) !== expectedRevision) {
      throw new ApiError(
        409,
        "다른 화면에서 권한이 먼저 바뀌었어요. 새로고침 후 다시 시도해 주세요.",
        "STUDENT_PERMISSION_STALE",
      );
    }
    if (Boolean(current?.is_active) === enabled) {
      return json({ permissionKey, enabled, revision: expectedRevision, changed: false });
    }
    if (enabled && student.status !== "active") {
      throw new ApiError(
        409,
        "현재 사용 중인 학생에게만 운영 권한을 줄 수 있어요.",
        "STUDENT_PERMISSION_STUDENT_NOT_ACTIVE",
      );
    }

    const now = Date.now();
    const nextRevision = expectedRevision + 1;
    const guardId = crypto.randomUUID();
    const permissionId = current?.id ?? crypto.randomUUID();
    const permissionMutation = current
      ? database().prepare(
        `UPDATE student_manual_permissions
         SET is_active = ?, granted_by_teacher_id = ?,
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND class_id = ? AND student_id = ?
           AND permission_key = ? AND revision = ? AND is_active <> ?`,
      ).bind(
        enabled ? 1 : 0,
        teacherId,
        now,
        current.id,
        student.class_id,
        studentId,
        permissionKey,
        expectedRevision,
        enabled ? 1 : 0,
      )
      : database().prepare(
        `INSERT INTO student_manual_permissions (
           id, class_id, student_id, permission_key, is_active,
           granted_by_teacher_id, revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 1, ?, 1, ?, ?)`,
      ).bind(
        permissionId,
        student.class_id,
        studentId,
        permissionKey,
        teacherId,
        now,
        now,
      );
    try {
      await database().batch([
        database().prepare(
          `INSERT INTO registration_operation_guards (id, operation, created_at)
           SELECT CASE WHEN EXISTS (
             SELECT 1
             FROM students target
             JOIN classes classroom ON classroom.id = target.class_id
             WHERE target.id = ?
               AND target.class_id = ?
               AND classroom.teacher_id = ?
               AND classroom.status = 'active'
               AND (? = 0 OR target.status = 'active')
               AND COALESCE((
                 SELECT permission.revision
                 FROM student_manual_permissions permission
                 WHERE permission.class_id = target.class_id
                   AND permission.student_id = target.id
                   AND permission.permission_key = ?
               ), 0) = ?
               AND COALESCE((
                 SELECT permission.is_active
                 FROM student_manual_permissions permission
                 WHERE permission.class_id = target.class_id
                   AND permission.student_id = target.id
                   AND permission.permission_key = ?
               ), 0) <> ?
           ) THEN ? ELSE NULL END, 'student_manual_permission_update', ?`,
        ).bind(
          studentId,
          student.class_id,
          teacherId,
          enabled ? 1 : 0,
          permissionKey,
          expectedRevision,
          permissionKey,
          enabled ? 1 : 0,
          guardId,
          now,
        ),
        database().prepare(
          `INSERT OR IGNORE INTO class_job_assignment_periods (
             id, class_id, assignment_year, assignment_month, assignment_type,
             mode, status, confirmed_at, confirmed_by_teacher_id, revision,
             created_at, updated_at
           )
           SELECT 'student-permission-period:' || classroom.id,
                  classroom.id, classroom.school_year, 1, 'permission',
                  'manual_permission', 'confirmed', ?, ?, 0, ?, ?
           FROM classes classroom
           WHERE classroom.id = ?
             AND classroom.teacher_id = ?
             AND classroom.status = 'active'
             AND ? = 1
             AND ? IN ('finance_banker', 'mart_operator')`,
        ).bind(
          now,
          teacherId,
          now,
          now,
          student.class_id,
          teacherId,
          enabled ? 1 : 0,
          permissionKey,
        ),
        permissionMutation,
        database().prepare(
          `INSERT INTO audit_logs (
             id, teacher_id, class_id, student_id, action, detail, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          teacherId,
          student.class_id,
          studentId,
          enabled ? "student_manual_permission_granted" : "student_manual_permission_revoked",
          JSON.stringify({ permissionKey, enabled, revision: nextRevision }),
          now,
        ),
        database().prepare(
          `DELETE FROM registration_operation_guards WHERE id = ?`,
        ).bind(guardId),
      ]);
    } catch (error) {
      if (isOperationGuardFailure(error)) {
        throw new ApiError(
          409,
          "다른 화면에서 학생 또는 권한 정보가 먼저 바뀌었어요. 새로고침 후 다시 시도해 주세요.",
          "STUDENT_PERMISSION_STALE",
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("STUDENT_PERMISSION_CONTEXT_INVALID")
        || message.includes("STUDENT_PERMISSION_STALE_OR_DENIED")
      ) {
        throw new ApiError(
          409,
          "학급 또는 학생 상태가 바뀌어 권한을 저장하지 못했어요. 새로고침 후 다시 시도해 주세요.",
          "STUDENT_PERMISSION_CONTEXT_CHANGED",
        );
      }
      throw error;
    }

    return json({
      permissionKey,
      enabled,
      revision: nextRevision,
      changed: true,
    });
  } catch (error) {
    return apiFailure(error);
  }
}
