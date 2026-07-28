import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { saveJobCandidates } from "@/lib/job-assignments";
import { apiFailure, json, readJson } from "@/lib/responses";

export async function PUT(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedClass(teacherId, classId);
    const body = await readJson<{ classJobId?: unknown; studentIds?: unknown }>(request);
    const result = await saveJobCandidates({
      classId,
      classJobId: body.classJobId,
      studentIds: body.studentIds,
    });
    return json(result);
  } catch (error) {
    return apiFailure(error);
  }
}
