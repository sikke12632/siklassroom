import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { completeInitialAssignments } from "@/lib/job-assignments";
import { apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedClass(teacherId, classId);
    const body = await readJson<Record<string, unknown>>(request);
    const result = await completeInitialAssignments({
      classId,
      teacherId,
      mode: body.mode,
      expectedRevision: body.expectedRevision,
      expectedCalendarRevision: body.expectedCalendarRevision,
      requestId: body.requestId,
      assignments: body.assignments,
    });
    return json({ completed: true, ...result });
  } catch (error) {
    return apiFailure(error);
  }
}
