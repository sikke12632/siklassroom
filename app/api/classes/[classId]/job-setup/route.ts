import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { database } from "@/lib/database";
import { JOB_CATEGORIES } from "@/lib/job-catalog";
import { eligibleStudentCount, loadJobSetup, loadJobTemplates } from "@/lib/job-storage";
import { apiFailure, json } from "@/lib/responses";

export async function GET(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    const classRoom = await ownedClass(teacherId, classId);
    const [studentCount, setup, templates, assignmentState] = await Promise.all([
      eligibleStudentCount(classId),
      loadJobSetup(classId),
      loadJobTemplates({ activeOnly: true }),
      database().prepare(
        `SELECT p.status, COUNT(a.id) AS assignment_count
         FROM class_job_assignment_periods p
         LEFT JOIN student_job_assignments a ON a.period_id = p.id
         WHERE p.class_id = ? AND p.assignment_type = 'initial'
         GROUP BY p.id ORDER BY p.updated_at DESC LIMIT 1`,
      ).bind(classId).first<{ status: string; assignment_count: number }>(),
    ]);
    return json({
      class: classRoom,
      studentCount,
      templates,
      categories: JOB_CATEGORIES,
      setup,
      assignmentStatus: assignmentState?.status ?? "not_started",
      assignmentCount: Number(assignmentState?.assignment_count ?? 0),
      studentCountChanged: setup.status !== "not_started" && setup.studentCountSnapshot !== studentCount,
    });
  } catch (error) {
    return apiFailure(error);
  }
}
