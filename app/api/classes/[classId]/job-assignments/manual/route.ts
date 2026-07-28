import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { audit } from "@/lib/database";
import { createManualAssignments } from "@/lib/job-assignments";
import { apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedClass(teacherId, classId);
    const body = await readJson<{
      classJobId?: unknown;
      studentIds?: unknown;
      studentId?: unknown;
      requestId?: unknown;
    }>(request);
    const studentIds = Array.isArray(body.studentIds)
      ? body.studentIds
      : body.studentId ? [body.studentId] : [];
    const result = await createManualAssignments({
      classId,
      classJobId: body.classJobId,
      studentIds,
      requestId: body.requestId,
    });
    await audit({
      action: "job_assignment_manual",
      teacherId,
      classId,
      detail: {
        classJobId: result.job.id,
        studentIds: result.students.map((student) => student.id),
        assignmentCount: result.assignmentCount,
        requestId: body.requestId,
        idempotent: result.idempotent,
      },
    });
    return json({ assignment: result }, result.idempotent ? 200 : 201);
  } catch (error) {
    return apiFailure(error);
  }
}
