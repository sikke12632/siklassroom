import { requireClassManagement } from "@/lib/auth";
import { ownedActiveClass, ownedClass } from "@/lib/authorization";
import { loadClassCalendar } from "@/lib/class-calendar";
import { loadClassTimetable, saveClassTimetable } from "@/lib/class-timetable";
import { apiFailure, json, readJson } from "@/lib/responses";
import { seoulServerTime } from "@/lib/seoul-time";

export async function GET(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    const classRoom = await ownedClass(teacherId, classId);
    const requestedMonth = new URL(request.url).searchParams.get("month");
    const epochMs = Date.now();
    const monthValue = requestedMonth || seoulServerTime(epochMs).monthValue;
    const [calendar, timetable] = await Promise.all([
      loadClassCalendar(classId, { monthValue, epochMs }),
      loadClassTimetable(classId),
    ]);
    return json({ class: classRoom, calendar, timetable });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedActiveClass(teacherId, classId);
    const body = await readJson<{
      expectedRevision?: unknown;
      periodCount?: unknown;
      slots?: unknown;
    }>(request);
    const timetable = await saveClassTimetable({
      classId,
      teacherId,
      expectedRevision: body.expectedRevision,
      periodCount: body.periodCount,
      slots: body.slots,
    });
    return json({ timetable });
  } catch (error) {
    return apiFailure(error);
  }
}
