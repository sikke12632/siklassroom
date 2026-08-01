import { requireClassManagement } from "@/lib/auth";
import { ownedClass } from "@/lib/authorization";
import { adjustJobsToStudentCount, type ClassJobDraft } from "@/lib/job-catalog";
import { scopeAdjustedJobIds } from "@/lib/job-draft-rules";
import {
  assertClassJobDraftIds,
  eligibleStudentCount,
  loadJobTemplates,
  validateJobDrafts,
} from "@/lib/job-storage";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    const { teacherId } = await requireClassManagement(request);
    const { classId } = await context.params;
    await ownedClass(teacherId, classId);
    const studentCount = await eligibleStudentCount(classId);
    if (studentCount < 1) {
      throw new ApiError(422, "학생을 한 명 이상 등록한 뒤 자동 맞춤을 사용할 수 있어요.", "NO_STUDENTS");
    }
    const body = await readJson<{ jobs?: ClassJobDraft[] }>(request);
    const jobs = validateJobDrafts(body.jobs ?? [], { allowEmpty: true });
    await assertClassJobDraftIds(classId, jobs);
    const templates = await loadJobTemplates({ activeOnly: true });
    const adjusted = adjustJobsToStudentCount(studentCount, jobs, templates);
    const adjustedJobs = scopeAdjustedJobIds(classId, jobs, adjusted.jobs);
    await assertClassJobDraftIds(classId, adjustedJobs);
    return json({ studentCount, jobs: adjustedJobs, reasons: adjusted.reasons });
  } catch (error) {
    return apiFailure(error);
  }
}
