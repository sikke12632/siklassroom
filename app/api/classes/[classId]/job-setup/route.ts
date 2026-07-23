import { requireTeacher } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { JOB_CATEGORIES, JOB_TEMPLATES } from "@/lib/job-catalog";
import { eligibleStudentCount, loadJobSetup } from "@/lib/job-storage";
import { apiFailure, json } from "@/lib/responses";

export async function GET(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireTeacher(request);
    const { classId } = await context.params;
    const classRoom = await ownedClass(teacherId, classId);
    const [studentCount, setup] = await Promise.all([
      eligibleStudentCount(classId),
      loadJobSetup(classId),
    ]);
    return json({
      class: classRoom,
      studentCount,
      templates: JOB_TEMPLATES,
      categories: JOB_CATEGORIES,
      setup,
      studentCountChanged: setup.status !== "not_started" && setup.studentCountSnapshot !== studentCount,
    });
  } catch (error) {
    return apiFailure(error);
  }
}
