import { requireClassManagement } from "@/lib/auth";
import { ownedActiveClass } from "@/lib/authorization";
import { audit } from "@/lib/database";
import { recommendJobs, type SurveyAnswers } from "@/lib/job-catalog";
import { eligibleStudentCount, loadJobTemplates } from "@/lib/job-storage";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedActiveClass(teacherId, classId);
    const studentCount = await eligibleStudentCount(classId);
    if (studentCount < 1) {
      throw new ApiError(422, "학생을 한 명 이상 등록한 뒤 추천받을 수 있어요.", "NO_STUDENTS");
    }
    const body = await readJson<{ surveyAnswers?: Partial<SurveyAnswers> }>(request);
    const templates = await loadJobTemplates({ activeOnly: true });
    const plan = recommendJobs(studentCount, body.surveyAnswers, templates);
    const jobs = plan.jobs.map((job) => ({
      ...job,
      id: `${classId}:${job.templateId ?? crypto.randomUUID()}`,
    }));
    await audit({
      action: "job_recommendation_created",
      teacherId,
      classId,
      detail: { studentCount, jobCount: jobs.length },
    });
    return json({ studentCount, jobs, reasons: plan.reasons });
  } catch (error) {
    return apiFailure(error);
  }
}
