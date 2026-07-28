import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { audit } from "@/lib/database";
import { createRandomAssignment } from "@/lib/job-assignments";
import { apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedClass(teacherId, classId);
    const body = await readJson<{
      classJobId?: unknown;
      candidateStudentIds?: unknown;
      requestId?: unknown;
    }>(request);
    const result = await createRandomAssignment({
      classId,
      classJobId: body.classJobId,
      candidateStudentIds: body.candidateStudentIds,
      requestId: body.requestId,
    });
    await audit({
      action: "job_assignment_random",
      teacherId,
      classId,
      studentId: result.student.id,
      detail: {
        classJobId: result.job.id,
        assignmentId: result.assignmentId,
        candidateCount: result.candidateCount,
        sequence: result.sequence,
        requestId: body.requestId,
        idempotent: result.idempotent,
      },
    });
    return json({ assignment: result }, result.idempotent ? 200 : 201);
  } catch (error) {
    return apiFailure(error);
  }
}
