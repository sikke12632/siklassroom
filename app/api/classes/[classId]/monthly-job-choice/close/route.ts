import { requireClassManagement } from "@/lib/auth";
import { ownedActiveClass } from "@/lib/authorization";
import { closeMonthlyJobSource } from "@/lib/monthly-job-choice";
import { apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedActiveClass(teacherId, classId);
    const body = await readJson<{
      expectedSourcePeriodId?: unknown;
    }>(request);
    const result = await closeMonthlyJobSource({
      classId,
      teacherId,
      expectedSourcePeriodId: body.expectedSourcePeriodId,
    });
    return json(result, result.idempotent ? 200 : 201);
  } catch (error) {
    return apiFailure(error);
  }
}
