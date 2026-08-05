import { requireClassManagement } from "@/lib/auth";
import { ownedActiveClass } from "@/lib/authorization";
import { database } from "@/lib/database";
import {
  issueRegistrationTokens,
  REGISTRATION_QR_ISSUE_BATCH_SIZE,
  registrationActivationUrl,
} from "@/lib/registration";
import { ApiError, apiFailure, assertSameOriginRequest, json, readJson } from "@/lib/responses";

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    assertSameOriginRequest(request);
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedActiveClass(teacherId, classId);
    const body = await readJson<{ afterStudentNumber?: unknown }>(request);
    const afterStudentNumber = body.afterStudentNumber === undefined
      || body.afterStudentNumber === null
      ? 0
      : Number(body.afterStudentNumber);
    if (!Number.isSafeInteger(afterStudentNumber) || afterStudentNumber < 0 || afterStudentNumber > 999) {
      throw new ApiError(400, "학생 목록 위치가 올바르지 않습니다.", "INVALID_QR_CURSOR");
    }
    const result = await database().prepare(
      `SELECT id, student_number, official_name, status FROM students
       WHERE class_id = ? AND status IN ('pending','reset_required')
         AND student_number > ?
       ORDER BY student_number
       LIMIT ?`,
    ).bind(
      classId,
      afterStudentNumber,
      REGISTRATION_QR_ISSUE_BATCH_SIZE,
    ).all<{ id: string; student_number: number; official_name: string; status: string }>();
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
        purpose: issued[index].purpose,
        activation_url: registrationActivationUrl(origin, issued[index].rawToken),
      }));
    const lastStudent = result.results.at(-1);
    return json({
      cards,
      nextAfterStudentNumber: result.results.length === REGISTRATION_QR_ISSUE_BATCH_SIZE
        ? lastStudent?.student_number ?? null
        : null,
    });
  } catch (error) {
    return apiFailure(error);
  }
}
