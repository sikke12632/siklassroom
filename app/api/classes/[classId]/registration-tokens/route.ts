import { requireClassManagement } from "@/lib/auth";
import { ownedActiveClass } from "@/lib/authorization";
import { database } from "@/lib/database";
import { issueRegistrationTokens, registrationActivationUrl } from "@/lib/registration";
import { apiFailure, assertSameOriginRequest, json } from "@/lib/responses";

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    assertSameOriginRequest(request);
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedActiveClass(teacherId, classId);
    const result = await database().prepare(
      `SELECT id, student_number, official_name, status FROM students
       WHERE class_id = ? AND status IN ('pending','reset_required') ORDER BY student_number`,
    ).bind(classId).all<{ id: string; student_number: number; official_name: string; status: string }>();
    const origin = new URL(request.url).origin;
    const issued = await issueRegistrationTokens({
      studentIds: result.results.map((student) => student.id),
      teacherId,
      classId,
    });
    const cards = result.results.map((student, index) => ({
        id: student.id,
        student_number: student.student_number,
        official_name: student.official_name,
        purpose: "activate",
        activation_url: registrationActivationUrl(origin, issued[index].rawToken),
      }));
    return json({ cards });
  } catch (error) {
    return apiFailure(error);
  }
}
