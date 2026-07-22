import { requireTeacher, revokeActorSessions } from "@/lib/auth";
import { ownedStudent } from "@/lib/authorization";
import { issueRegistrationToken } from "@/lib/registration";
import { apiFailure, json } from "@/lib/responses";

export async function POST(request: Request, context: { params: Promise<{ studentId: string }> }) {
  try {
    const { teacherId } = await requireTeacher(request);
    const { studentId } = await context.params;
    const student = await ownedStudent(teacherId, studentId);
    const purpose = student.status === "active" ? "reset" : student.status === "reset_required" ? "reset" : "activate";
    const rawToken = await issueRegistrationToken({
      studentId,
      teacherId,
      classId: String(student.class_id),
      purpose,
    });
    if (purpose === "reset") await revokeActorSessions("student", studentId);
    return json({
      card: {
        id: studentId,
        student_number: student.student_number,
        official_name: student.official_name,
        purpose,
        activation_url: `${new URL(request.url).origin}/activate?token=${encodeURIComponent(rawToken)}`,
      },
    });
  } catch (error) {
    return apiFailure(error);
  }
}
