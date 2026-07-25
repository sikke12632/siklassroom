import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { audit } from "@/lib/database";
import { removeInitialAssignment } from "@/lib/job-assignments";
import { apiFailure, json } from "@/lib/responses";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ classId: string; assignmentId: string }> },
) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId, assignmentId } = await context.params;
    await ownedClass(teacherId, classId);
    const removed = await removeInitialAssignment(classId, assignmentId);
    await audit({
      action: "job_assignment_removed",
      teacherId,
      classId,
      studentId: String(removed.student_id),
      detail: {
        assignmentId,
        classJobId: removed.class_job_id,
        method: removed.assignment_method,
        year: removed.assignment_year,
        month: removed.assignment_month,
      },
    });
    return json({ removed: true });
  } catch (error) {
    return apiFailure(error);
  }
}
