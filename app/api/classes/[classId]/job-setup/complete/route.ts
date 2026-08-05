import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import type { ClassJobDraft, SetupMode, SurveyAnswers } from "@/lib/job-catalog";
import { completeJobSetup, eligibleStudentCount } from "@/lib/job-storage";
import { apiFailure, json, readJson } from "@/lib/responses";

type CompleteBody = {
  expectedRevision?: number;
  setupMode?: SetupMode;
  surveyAnswers?: Partial<SurveyAnswers>;
  jobs?: ClassJobDraft[];
  acknowledgeAssignmentImpact?: boolean;
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
      teacherId,
      expectedRevision: body.expectedRevision,
      setupMode: body.setupMode ?? "manual",
      surveyAnswers: body.surveyAnswers,
      jobs: body.jobs ?? [],
      studentCount,
      acknowledgeAssignmentImpact: body.acknowledgeAssignmentImpact,
    });
    return json({ setup, studentCount });
  } catch (error) {
    return apiFailure(error);
  }
}
