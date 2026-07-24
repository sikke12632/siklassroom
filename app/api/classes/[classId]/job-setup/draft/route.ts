import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { audit } from "@/lib/database";
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
    await ownedClass(teacherId, classId);
    const body = await readJson<DraftBody>(request);
    const studentCount = await eligibleStudentCount(classId);
    const setup = await saveJobDraft({
      classId,
      expectedRevision: body.expectedRevision,
      setupMode: body.setupMode ?? "manual",
      surveyAnswers: body.surveyAnswers,
      jobs: body.jobs ?? [],
      lastStep: body.lastStep ?? 1,
      studentCount,
    });
    await audit({
      action: "job_setup_draft_saved",
      teacherId,
      classId,
      detail: { revision: setup.revision, jobCount: setup.selectedJobCount, lastStep: setup.lastStep },
    });
    return json({ setup, studentCount });
  } catch (error) {
    return apiFailure(error);
  }
}
