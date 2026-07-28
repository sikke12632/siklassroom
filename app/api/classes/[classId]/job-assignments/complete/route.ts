import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { audit } from "@/lib/database";
import { completeInitialAssignments } from "@/lib/job-assignments";
import { apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedClass(teacherId, classId);
    await readJson<Record<string, never>>(request);
    const result = await completeInitialAssignments({ classId, teacherId });
    await audit({
      action: "initial_job_assignments_confirmed",
      teacherId,
      classId,
      detail: result,
    });
    return json({ completed: true, ...result });
  } catch (error) {
    return apiFailure(error);
  }
}
