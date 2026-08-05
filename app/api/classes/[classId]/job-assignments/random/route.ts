import { requireClassManagement } from "@/lib/auth";
import { ownedActiveClass } from "@/lib/authorization";
import { createRandomAssignment } from "@/lib/job-assignments";
import { apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedActiveClass(teacherId, classId);
    const body = await readJson<{
      classJobId?: unknown;
      candidateStudentIds?: unknown;
      requestId?: unknown;
    }>(request);
    const result = await createRandomAssignment({
      teacherId,
      classId,
      classJobId: body.classJobId,
      candidateStudentIds: body.candidateStudentIds,
      requestId: body.requestId,
    });
    return json({ assignment: result }, result.idempotent ? 200 : 201);
  } catch (error) {
    return apiFailure(error);
  }
}
