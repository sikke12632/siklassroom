import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { audit } from "@/lib/database";
import { closeJobEvaluation } from "@/lib/job-evaluation";
import { apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedClass(teacherId, classId);
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
    await audit({
      action: "job_evaluation_closed",
      teacherId,
      classId,
      detail: {
        evaluationId: result.evaluation.id,
        submittedCount: result.evaluation.submittedCount,
        studentCount: result.evaluation.studentCountSnapshot,
        idempotent: result.idempotent,
      },
    });
    return json(result);
  } catch (error) {
    return apiFailure(error);
  }
}
