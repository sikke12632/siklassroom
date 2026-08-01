import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { loadInitialAssignmentBoard } from "@/lib/job-assignments";
import { apiFailure, json } from "@/lib/responses";
import { assignmentPeriod } from "@/lib/seoul-time";

export async function GET(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    const classRoom = await ownedClass(teacherId, classId);
    const url = new URL(request.url);
    const period = assignmentPeriod({
      year: url.searchParams.get("year"),
      month: url.searchParams.get("month"),
    });
    const board = await loadInitialAssignmentBoard(classId, {
      year: url.searchParams.has("year") ? period.year : undefined,
      month: url.searchParams.has("month") ? period.month : undefined,
    });
    return json({ class: classRoom, period, ...board });
  } catch (error) {
    return apiFailure(error);
  }
}
