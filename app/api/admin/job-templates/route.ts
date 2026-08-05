import { database, isOperationGuardFailure } from "@/lib/database";
import { integerInRange } from "@/lib/identity";
import { ensureJobCenterSchema } from "@/lib/job-storage";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";
import { systemAdminAuditStatement } from "@/lib/system-admin-audit";
import { requireSystemAdmin } from "@/lib/system-admin-auth";

export async function GET(request: Request) {
  try {
    await requireSystemAdmin(request);
    await ensureJobCenterSchema();
    const result = await database().prepare(
      `SELECT id, name, short_description, category, recommended_min_members,
              recommended_max_members, default_priority, is_active
       FROM job_templates ORDER BY default_priority, name`,
    ).all();
    return json({ templates: result.results });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireSystemAdmin(request, { csrf: true });
    const body = await readJson<{
      id?: string;
      isActive?: boolean;
      recommendedMinMembers?: number;
      recommendedMaxMembers?: number;
      defaultPriority?: number;
    }>(request);
    const id = String(body.id ?? "");
    const min = integerInRange(body.recommendedMinMembers, 1, 60);
    const max = integerInRange(body.recommendedMaxMembers, 1, 60);
    const priority = integerInRange(body.defaultPriority, 1, 999);
    if (!id || min === null || max === null || priority === null || min > max || typeof body.isActive !== "boolean") {
      throw new ApiError(400, "기본 직업 설정 값을 확인해 주세요.", "INVALID_JOB_TEMPLATE_SETTINGS");
    }
    const before = await database().prepare(
      `SELECT id, is_active, recommended_min_members, recommended_max_members, default_priority
       FROM job_templates WHERE id = ?`,
    ).bind(id).first<{
      id: string;
      is_active: number;
      recommended_min_members: number;
      recommended_max_members: number;
      default_priority: number;
    }>();
    if (!before) throw new ApiError(404, "기본 직업을 찾을 수 없습니다.", "JOB_TEMPLATE_NOT_FOUND");
    const after = {
      is_active: body.isActive ? 1 : 0,
      recommended_min_members: min,
      recommended_max_members: max,
      default_priority: priority,
    };
    const guardId = crypto.randomUUID();
    const now = Date.now();
    try {
      await database().batch([
        database().prepare(
          `INSERT INTO registration_operation_guards (id, operation, created_at)
           SELECT CASE WHEN EXISTS (
             SELECT 1 FROM job_templates
             WHERE id = ? AND is_active = ? AND recommended_min_members = ?
               AND recommended_max_members = ? AND default_priority = ?
           ) THEN ? ELSE NULL END, 'admin_job_template_update', ?`,
        ).bind(
          id,
          before.is_active,
          before.recommended_min_members,
          before.recommended_max_members,
          before.default_priority,
          guardId,
          now,
        ),
        database().prepare(
          `UPDATE job_templates SET is_active = ?, recommended_min_members = ?,
           recommended_max_members = ?, default_priority = ?
           WHERE id = ? AND is_active = ? AND recommended_min_members = ?
             AND recommended_max_members = ? AND default_priority = ?`,
        ).bind(
          after.is_active,
          min,
          max,
          priority,
          id,
          before.is_active,
          before.recommended_min_members,
          before.recommended_max_members,
          before.default_priority,
        ),
        systemAdminAuditStatement({
          adminKey: admin.adminKey,
          action: "job_template_settings_changed",
          targetType: "job_template",
          targetId: id,
          before,
          after,
        }, now),
        database().prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
      ]);
    } catch (error) {
      if (isOperationGuardFailure(error)) {
        throw new ApiError(409, "다른 관리자 화면에서 기본 직업 설정이 먼저 바뀌었습니다.", "JOB_TEMPLATE_STALE");
      }
      throw error;
    }
    return json({ ok: true, template: { id, ...after } });
  } catch (error) {
    return apiFailure(error);
  }
}
