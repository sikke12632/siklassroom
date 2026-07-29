import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { audit } from "@/lib/database";
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
    await audit({
      action: "job_evaluation_finalized",
      teacherId,
      classId,
      detail: {
        evaluationId: result.evaluation.id,
        idempotent: result.idempotent,
      },
    });
    return json(result);
  } catch (error) {
    return apiFailure(error);
  }
}
