import { requireClassManagement } from "@/lib/auth";
import { ownedActiveClass } from "@/lib/authorization";
import { saveNextJobPlan } from "@/lib/job-configurations";
import { apiFailure, json, readJson } from "@/lib/responses";

type SavePlanBody = {
  expectedRevision?: number;
  expectedSetupRevision?: number;
  expectedTargetYear?: number;
  expectedTargetMonth?: number;
  requestId?: string;
  jobs?: unknown;
};

export async function PUT(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedActiveClass(teacherId, classId);
    const body = await readJson<SavePlanBody>(request);
    return json(await saveNextJobPlan({
      classId,
      teacherId,
      expectedRevision: body.expectedRevision,
      expectedSetupRevision: body.expectedSetupRevision,
      expectedTargetYear: body.expectedTargetYear,
      expectedTargetMonth: body.expectedTargetMonth,
      requestId: body.requestId,
      jobs: body.jobs,
    }), 200, { "Cache-Control": "private, no-store" });
  } catch (error) {
    return apiFailure(error);
  }
}
