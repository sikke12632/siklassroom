import { requireClassManagement } from "@/lib/auth";
import { ownedActiveClass } from "@/lib/authorization";
import {
  applyCurrentJobConfiguration,
  JobConfigurationImpactError,
} from "@/lib/job-configurations";
import { apiFailure, json, readJson } from "@/lib/responses";

type ApplyCurrentBody = {
  expectedSetupRevision?: number;
  requestId?: string;
  jobs?: unknown;
  acknowledgeImpact?: boolean;
};

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedActiveClass(teacherId, classId);
    const body = await readJson<ApplyCurrentBody>(request);
    return json(await applyCurrentJobConfiguration({
      classId,
      teacherId,
      expectedSetupRevision: body.expectedSetupRevision,
      requestId: body.requestId,
      jobs: body.jobs,
      acknowledgeImpact: body.acknowledgeImpact === true,
    }), 200, { "Cache-Control": "private, no-store" });
  } catch (error) {
    if (error instanceof JobConfigurationImpactError) {
      return json(
        { error: error.message, code: error.code, impact: error.impact },
        error.status,
        { "Cache-Control": "private, no-store" },
      );
    }
    return apiFailure(error);
  }
}
