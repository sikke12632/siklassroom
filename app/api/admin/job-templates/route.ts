import { database } from "@/lib/database";
import { integerInRange } from "@/lib/identity";
import { ensureJobCenterSchema } from "@/lib/job-storage";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";
import { auditSystemAdmin } from "@/lib/system-admin-audit";
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
    ).bind(id).first();
    if (!before) throw new ApiError(404, "기본 직업을 찾을 수 없습니다.", "JOB_TEMPLATE_NOT_FOUND");
    await database().prepare(
      `UPDATE job_templates SET is_active = ?, recommended_min_members = ?,
       recommended_max_members = ?, default_priority = ? WHERE id = ?`,
    ).bind(body.isActive ? 1 : 0, min, max, priority, id).run();
    const after = {
      is_active: body.isActive ? 1 : 0,
      recommended_min_members: min,
      recommended_max_members: max,
      default_priority: priority,
    };
    await auditSystemAdmin({
      adminKey: admin.adminKey,
      action: "job_template_settings_changed",
      targetType: "job_template",
      targetId: id,
      before,
      after,
    });
    return json({ ok: true, template: { id, ...after } });
  } catch (error) {
    return apiFailure(error);
  }
}
