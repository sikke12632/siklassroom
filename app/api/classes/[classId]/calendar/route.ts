import { requireClassManagement, requireTeacher } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { loadClassCalendar, saveClassCalendar } from "@/lib/class-calendar";
import { audit } from "@/lib/database";
import { apiFailure, json, readJson } from "@/lib/responses";

export async function GET(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireTeacher(request);
    const { classId } = await context.params;
    const classRoom = await ownedClass(teacherId, classId);
    const monthValue = new URL(request.url).searchParams.get("month");
    const calendar = await loadClassCalendar(classId, { monthValue });
    return json({ class: classRoom, calendar });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedClass(teacherId, classId);
    const body = await readJson<{
      expectedRevision?: unknown;
      schoolYear?: unknown;
      classStartDate?: unknown;
      firstJobStartDate?: unknown;
      firstJobEndDate?: unknown;
      days?: unknown;
    }>(request);
    const calendar = await saveClassCalendar({
      classId,
      expectedRevision: body.expectedRevision,
      schoolYear: body.schoolYear,
      classStartDate: body.classStartDate,
      firstJobStartDate: body.firstJobStartDate,
      firstJobEndDate: body.firstJobEndDate,
      days: body.days,
    });
    await audit({
      action: "class_calendar_saved",
      teacherId,
      classId,
      detail: {
        revision: calendar.revision,
        classStartDate: calendar.classStartDate,
        firstJobStartDate: calendar.firstJobStartDate,
        firstJobEndDate: calendar.firstJobEndDate,
      },
    });
    return json({ calendar });
  } catch (error) {
    return apiFailure(error);
  }
}
