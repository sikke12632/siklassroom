import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { audit } from "@/lib/database";
import type { ClassJobDraft, SetupMode, SurveyAnswers } from "@/lib/job-catalog";
import { completeJobSetup, eligibleStudentCount } from "@/lib/job-storage";
import { apiFailure, json, readJson } from "@/lib/responses";

type CompleteBody = {
  expectedRevision?: number;
  setupMode?: SetupMode;
  surveyAnswers?: Partial<SurveyAnswers>;
  jobs?: ClassJobDraft[];
};

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedClass(teacherId, classId);
    const body = await readJson<CompleteBody>(request);
    const studentCount = await eligibleStudentCount(classId);
    const setup = await completeJobSetup({
      classId,
      expectedRevision: body.expectedRevision,
      setupMode: body.setupMode ?? "manual",
      surveyAnswers: body.surveyAnswers,
      jobs: body.jobs ?? [],
      studentCount,
    });
    await audit({
      action: "job_setup_completed",
      teacherId,
      classId,
      detail: { revision: setup.revision, jobCount: setup.selectedJobCount, capacity: setup.selectedCapacity },
    });
    return json({ setup, studentCount });
  } catch (error) {
    return apiFailure(error);
  }
}
