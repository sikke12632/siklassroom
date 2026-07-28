import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { audit } from "@/lib/database";
import { shuffleMonthlyJobChoice } from "@/lib/monthly-job-choice";
import { apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedClass(teacherId, classId);
    const body = await readJson<{ expectedRevision?: unknown }>(request);
    const result = await shuffleMonthlyJobChoice({
      classId,
      expectedRevision: body.expectedRevision,
    });
    await audit({
      action: "monthly_job_choice_shuffled",
      teacherId,
      classId,
      detail: {
        sessionId: result.sessionId,
        revision: result.revision,
      },
    });
    return json(result);
  } catch (error) {
    return apiFailure(error);
  }
}
