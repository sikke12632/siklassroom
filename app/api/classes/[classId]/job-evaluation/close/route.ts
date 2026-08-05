import { requireClassManagement } from "@/lib/auth";
import { ownedActiveClass } from "@/lib/authorization";
import { closeJobEvaluation } from "@/lib/job-evaluation";
import { apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedActiveClass(teacherId, classId);
    const body = await readJson<{
      evaluationId?: unknown;
      expectedRevision?: unknown;
      expectedResponseRevision?: unknown;
      allowIncomplete?: unknown;
    }>(request);
    const result = await closeJobEvaluation({
      classId,
      teacherId,
      evaluationId: body.evaluationId,
      expectedRevision: body.expectedRevision,
      expectedResponseRevision: body.expectedResponseRevision,
      allowIncomplete: body.allowIncomplete,
    });
    return json(result);
  } catch (error) {
    return apiFailure(error);
  }
}
