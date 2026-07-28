import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { audit } from "@/lib/database";
import { closeMonthlyJobSource } from "@/lib/monthly-job-choice";
import { apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedClass(teacherId, classId);
    const body = await readJson<{
      expectedSourcePeriodId?: unknown;
      jobGrades?: unknown;
    }>(request);
    const result = await closeMonthlyJobSource({
      classId,
      teacherId,
      expectedSourcePeriodId: body.expectedSourcePeriodId,
      jobGrades: body.jobGrades,
    });
    await audit({
      action: "monthly_job_source_closed",
      teacherId,
      classId,
      detail: {
        closureId: result.closureId,
        sourcePeriodId: body.expectedSourcePeriodId,
        idempotent: result.idempotent,
      },
    });
    return json(result, result.idempotent ? 200 : 201);
  } catch (error) {
    return apiFailure(error);
  }
}
