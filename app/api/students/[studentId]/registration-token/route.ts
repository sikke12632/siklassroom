import { requireClassManagement } from "@/lib/auth";
import { ownedActiveStudent } from "@/lib/authorization";
import {
  issueRegistrationToken,
  registrationActivationUrl,
  revokeRegistrationToken,
} from "@/lib/registration";
import { apiFailure, assertSameOriginRequest, json } from "@/lib/responses";

export async function POST(request: Request, context: { params: Promise<{ studentId: string }> }) {
  try {
    assertSameOriginRequest(request);
    const { teacherId } = await requireClassManagement(request);
    const { studentId } = await context.params;
    const student = await ownedActiveStudent(teacherId, studentId);
    const rawToken = await issueRegistrationToken({
      studentId,
      teacherId,
      classId: String(student.class_id),
    });
    return json({
      card: {
        id: studentId,
        student_number: student.student_number,
        official_name: student.official_name,
        purpose: student.status === "reset_required" ? "reset" : "activate",
        activation_url: registrationActivationUrl(new URL(request.url).origin, rawToken),
      },
    });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ studentId: string }> }) {
  try {
    assertSameOriginRequest(request);
    const { teacherId } = await requireClassManagement(request);
    const { studentId } = await context.params;
    const student = await ownedActiveStudent(teacherId, studentId);
    const result = await revokeRegistrationToken({
      studentId,
      teacherId,
      classId: String(student.class_id),
    });
    return json({ ok: true, qrRevoked: result.revoked, generation: result.generation });
  } catch (error) {
    return apiFailure(error);
  }
}
