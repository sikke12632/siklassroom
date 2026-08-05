import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { finalizeJobEvaluation } from "@/lib/job-evaluation";
import { apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedClass(teacherId, classId);
    const body = await readJson<{
      evaluationId?: unknown;
      expectedRevision?: unknown;
      finalGrades?: unknown;
    }>(request);
    const result = await finalizeJobEvaluation({
      classId,
      teacherId,
      evaluationId: body.evaluationId,
      expectedRevision: body.expectedRevision,
      finalGrades: body.finalGrades,
    });
    return json(result);
  } catch (error) {
    return apiFailure(error);
  }
}
