import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { database } from "@/lib/database";
import { issueRegistrationToken, registrationActivationUrl } from "@/lib/registration";
import { apiFailure, json } from "@/lib/responses";

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedClass(teacherId, classId);
    const result = await database().prepare(
      `SELECT id, student_number, official_name, status FROM students
       WHERE class_id = ? AND status IN ('pending','reset_required') ORDER BY student_number`,
    ).bind(classId).all<{ id: string; student_number: number; official_name: string; status: string }>();
    const origin = new URL(request.url).origin;
    const cards = [];
    for (const student of result.results) {
      const rawToken = await issueRegistrationToken({ studentId: student.id, teacherId, classId });
      cards.push({
        id: student.id,
        student_number: student.student_number,
        official_name: student.official_name,
        purpose: "activate",
        activation_url: registrationActivationUrl(origin, rawToken),
      });
    }
    return json({ cards });
  } catch (error) {
    return apiFailure(error);
  }
}
