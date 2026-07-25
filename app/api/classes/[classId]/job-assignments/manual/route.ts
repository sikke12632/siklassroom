import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { audit } from "@/lib/database";
import { createManualAssignment } from "@/lib/job-assignments";
import { apiFailure, json, readJson } from "@/lib/responses";
import { assignmentPeriod } from "@/lib/seoul-time";

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedClass(teacherId, classId);
    const body = await readJson<{
      year?: unknown;
      month?: unknown;
      classJobId?: unknown;
      studentId?: unknown;
    }>(request);
    const period = assignmentPeriod({ year: body.year, month: body.month });
    const result = await createManualAssignment({
      classId,
      year: period.year,
      month: period.month,
      classJobId: body.classJobId,
      studentId: body.studentId,
    });
    await audit({
      action: "job_assignment_manual",
      teacherId,
      classId,
      studentId: result.student.id,
      detail: {
        classJobId: result.job.id,
        assignmentId: result.assignmentId,
        year: period.year,
        month: period.month,
      },
    });
    return json({ assignment: result, period }, 201);
  } catch (error) {
    return apiFailure(error);
  }
}
