import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { startMonthlyJobChoice } from "@/lib/monthly-job-choice";
import { apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedClass(teacherId, classId);
    await readJson<Record<string, never>>(request);
    const result = await startMonthlyJobChoice({ classId, teacherId });
    return json(result, result.idempotent ? 200 : 201);
  } catch (error) {
    return apiFailure(error);
  }
}
