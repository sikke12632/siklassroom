import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { audit } from "@/lib/database";
import { completeMonthlyJobChoice } from "@/lib/monthly-job-choice";
import { apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedClass(teacherId, classId);
    const body = await readJson<{
      expectedRevision?: unknown;
      expectedJobSetupRevision?: unknown;
      requestId?: unknown;
      assignments?: unknown;
    }>(request);
    const result = await completeMonthlyJobChoice({
      classId,
      teacherId,
      expectedRevision: body.expectedRevision,
      expectedJobSetupRevision: body.expectedJobSetupRevision,
      requestId: body.requestId,
      assignments: body.assignments,
    });
    await audit({
      action: "monthly_job_choice_confirmed",
      teacherId,
      classId,
      detail: {
        sessionId: result.sessionId,
        periodId: result.periodId,
        targetYear: result.targetYear,
        targetMonth: result.targetMonth,
        assignmentCount: result.assignmentCount,
      },
    });
    return json({ completed: true, ...result }, 201);
  } catch (error) {
    return apiFailure(error);
  }
}
