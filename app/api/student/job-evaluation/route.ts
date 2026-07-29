import { requireStudent } from "@/lib/auth";
import { audit } from "@/lib/database";
import {
  loadStudentJobEvaluation,
  submitStudentJobEvaluation,
} from "@/lib/job-evaluation";
import { apiFailure, json, readJson } from "@/lib/responses";

export async function GET(request: Request) {
  try {
    const { studentId } = await requireStudent(request);
    return json({ evaluation: await loadStudentJobEvaluation(studentId) });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const { studentId } = await requireStudent(request);
    const body = await readJson<{
      evaluationId?: unknown;
      expectedSessionRevision?: unknown;
      expectedResponseRevision?: unknown;
      requestId?: unknown;
      scores?: unknown;
    }>(request);
    const result = await submitStudentJobEvaluation({
      studentId,
      evaluationId: body.evaluationId,
      expectedSessionRevision: body.expectedSessionRevision,
      expectedResponseRevision: body.expectedResponseRevision,
      requestId: body.requestId,
      scores: body.scores,
    });
    await audit({
      action: "student_job_evaluation_submitted",
      studentId,
      detail: {
        evaluationId: result.evaluation?.id ?? null,
        responseRevision: result.evaluation?.submission?.revision ?? null,
        jobCount: result.evaluation?.jobs.length ?? 0,
        idempotent: result.idempotent,
      },
    });
    return json(result);
  } catch (error) {
    return apiFailure(error);
  }
}
