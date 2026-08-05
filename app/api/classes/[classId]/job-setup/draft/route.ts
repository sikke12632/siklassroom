import { requireClassManagement } from "@/lib/auth";
import { ownedActiveClass } from "@/lib/authorization";
import type { ClassJobDraft, SetupMode, SurveyAnswers } from "@/lib/job-catalog";
import { eligibleStudentCount, saveJobDraft } from "@/lib/job-storage";
import { apiFailure, json, readJson } from "@/lib/responses";

type DraftBody = {
  expectedRevision?: number;
  setupMode?: SetupMode;
  surveyAnswers?: Partial<SurveyAnswers>;
  jobs?: ClassJobDraft[];
  lastStep?: number;
};

export async function PUT(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedActiveClass(teacherId, classId);
    const body = await readJson<DraftBody>(request);
    const studentCount = await eligibleStudentCount(classId);
    const setup = await saveJobDraft({
      classId,
      teacherId,
      expectedRevision: body.expectedRevision,
      setupMode: body.setupMode ?? "manual",
      surveyAnswers: body.surveyAnswers,
      jobs: body.jobs ?? [],
      lastStep: body.lastStep ?? 1,
      studentCount,
    });
    return json({ setup, studentCount });
  } catch (error) {
    return apiFailure(error);
  }
}
