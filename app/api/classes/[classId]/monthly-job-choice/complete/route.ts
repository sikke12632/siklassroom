import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
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
    return json({ completed: true, ...result }, result.idempotent ? 200 : 201);
  } catch (error) {
    return apiFailure(error);
  }
}
