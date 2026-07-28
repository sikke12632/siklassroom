import { requireTeacher } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { loadMonthlyJobChoiceBoard } from "@/lib/monthly-job-choice";
import { apiFailure, json } from "@/lib/responses";

export async function GET(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireTeacher(request);
    const { classId } = await context.params;
    await ownedClass(teacherId, classId);
    const board = await loadMonthlyJobChoiceBoard(classId);
    return json(board);
  } catch (error) {
    return apiFailure(error);
  }
}
