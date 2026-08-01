import { requireClassManagement } from "@/lib/auth";
import { ownedStudent } from "@/lib/authorization";
import { issueStudentQrResetGrant } from "@/lib/registration";
import { apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request, context: { params: Promise<{ studentId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    await readJson<Record<string, never>>(request);
    const { studentId } = await context.params;
    const student = await ownedStudent(teacherId, studentId);
    const grant = await issueStudentQrResetGrant({
      studentId,
      teacherId,
      classId: String(student.class_id),
    });
    return json({ ok: true, expiresAt: grant.expiresAt });
  } catch (error) {
    return apiFailure(error);
  }
}
