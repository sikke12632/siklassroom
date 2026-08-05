import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
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
      teacherId,
      expectedRevision: body.expectedRevision,
    });
    return json(result);
  } catch (error) {
    return apiFailure(error);
  }
}
