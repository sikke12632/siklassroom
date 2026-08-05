import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { removeInitialAssignment } from "@/lib/job-assignments";
import { apiFailure, assertSameOriginRequest, json } from "@/lib/responses";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ classId: string; assignmentId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { teacherId } = await requireClassManagement(request);
    const { classId, assignmentId } = await context.params;
    await ownedClass(teacherId, classId);
    await removeInitialAssignment({ classId, teacherId, assignmentId });
    return json({ removed: true });
  } catch (error) {
    return apiFailure(error);
  }
}
