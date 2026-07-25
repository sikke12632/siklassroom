import { requireTeacher } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { JOB_CATEGORIES } from "@/lib/job-catalog";
import { eligibleStudentCount, loadJobSetup, loadJobTemplates } from "@/lib/job-storage";
import { apiFailure, json } from "@/lib/responses";

export async function GET(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireTeacher(request);
    const { classId } = await context.params;
    const classRoom = await ownedClass(teacherId, classId);
    const [studentCount, setup, templates] = await Promise.all([
      eligibleStudentCount(classId),
      loadJobSetup(classId),
      loadJobTemplates({ activeOnly: true }),
    ]);
    return json({
      class: classRoom,
      studentCount,
      templates,
      categories: JOB_CATEGORIES,
      setup,
      studentCountChanged: setup.status !== "not_started" && setup.studentCountSnapshot !== studentCount,
    });
  } catch (error) {
    return apiFailure(error);
  }
}
