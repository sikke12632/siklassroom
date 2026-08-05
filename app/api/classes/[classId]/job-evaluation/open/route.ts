import { requireClassManagement } from "@/lib/auth";
import { ownedActiveClass } from "@/lib/authorization";
import { openJobEvaluation } from "@/lib/job-evaluation";
import { apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedActiveClass(teacherId, classId);
    const body = await readJson<{
      expectedSourcePeriodId?: unknown;
      expectedSourcePeriodRevision?: unknown;
    }>(request);
    const result = await openJobEvaluation({
      classId,
      teacherId,
      expectedSourcePeriodId: body.expectedSourcePeriodId,
      expectedSourcePeriodRevision: body.expectedSourcePeriodRevision,
    });
    return json(result, result.idempotent ? 200 : 201);
  } catch (error) {
    return apiFailure(error);
  }
}
