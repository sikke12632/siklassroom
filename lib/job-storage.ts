import { database, ensureSchema, isOperationGuardFailure } from "./database";
import { integerInRange } from "./identity";
import {
  DEFAULT_SURVEY_ANSWERS,
  JOB_TEMPLATES,
  normalizeSurveyAnswers,
  sumJobCapacity,
  type ClassJobDraft,
  type JobCategory,
  type JobTemplate,
  type SetupMode,
  type SurveyAnswers,
} from "./job-catalog";
import { jobIdOwnedOrAvailableForClass, validateJobDrafts } from "./job-draft-rules";
import { ApiError } from "./responses";

export { validateJobDrafts } from "./job-draft-rules";

// Bump this key whenever JOB_TEMPLATES changes so every database receives the new defaults once.
const JOB_TEMPLATE_SEED_KEY = "2026-08-job-template-seed-v1";
let jobTemplatesReady: Promise<void> | null = null;

type SetupRow = {
  class_id: string;
  status: "not_started" | "draft" | "completed";
  setup_mode: SetupMode | null;
  survey_answers: string | null;
  draft_jobs: string | null;
  student_count_snapshot: number;
  selected_job_count: number;
  selected_capacity: number;
  last_step: number;
  revision: number;
  completed_at: number | null;
  updated_at: number;
};

export type JobSetupState = {
  status: SetupRow["status"];
  setupMode: SetupMode | null;
  surveyAnswers: SurveyAnswers;
  draftJobs: ClassJobDraft[];
  studentCountSnapshot: number;
  selectedJobCount: number;
  selectedCapacity: number;
  lastStep: number;
  revision: number;
  completedAt: number | null;
  updatedAt: number;
};

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function ensureJobCenterSchema() {
  await ensureSchema();
  if (!jobTemplatesReady) {
    jobTemplatesReady = (async () => {
      const db = database();
      const seeded = await db.prepare(
        "SELECT 1 AS seeded FROM system_migrations WHERE key = ? LIMIT 1",
      ).bind(JOB_TEMPLATE_SEED_KEY).first<{ seeded: number }>();
      if (seeded?.seeded) return;
      const now = Date.now();
      await db.batch([
        ...JOB_TEMPLATES.map((template) => db.prepare(
          `INSERT INTO job_templates (
             id, name, short_description, detailed_tasks, category,
             recommended_min_members, recommended_max_members, icon_key, default_priority, is_active
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT(id) DO NOTHING`,
        ).bind(
          template.id,
          template.name,
          template.shortDescription,
          template.detailedTasks,
          template.category,
          template.recommendedMinMembers,
          template.recommendedMaxMembers,
          template.iconKey,
          template.defaultPriority,
        )),
        db.prepare(
          "INSERT OR IGNORE INTO system_migrations (key, applied_at) VALUES (?, ?)",
        ).bind(JOB_TEMPLATE_SEED_KEY, now),
      ]);
    })().catch((error) => {
      jobTemplatesReady = null;
      throw error;
    });
  }
  await jobTemplatesReady;
}

export async function loadJobTemplates(options: { activeOnly?: boolean } = {}): Promise<JobTemplate[]> {
  await ensureJobCenterSchema();
  const result = await database().prepare(
    `SELECT id, name, short_description, detailed_tasks, category,
            recommended_min_members, recommended_max_members, icon_key, default_priority
     FROM job_templates
     ${options.activeOnly ? "WHERE is_active = 1" : ""}
     ORDER BY default_priority, id`,
  ).all<{
    id: string;
    name: string;
    short_description: string;
    detailed_tasks: string;
    category: JobCategory;
    recommended_min_members: number;
    recommended_max_members: number;
    icon_key: string;
    default_priority: number;
  }>();
  return result.results.map((row) => ({
    id: row.id,
    name: row.name,
    shortDescription: row.short_description,
    detailedTasks: row.detailed_tasks,
    category: row.category,
    recommendedMinMembers: Number(row.recommended_min_members),
    recommendedMaxMembers: Number(row.recommended_max_members),
    iconKey: row.icon_key,
    defaultPriority: Number(row.default_priority),
  }));
}

export async function eligibleStudentCount(classId: string) {
  await ensureJobCenterSchema();
  const row = await database().prepare(
    `SELECT COUNT(*) AS student_count FROM students
     WHERE class_id = ? AND status <> 'excluded'`,
  ).bind(classId).first<{ student_count: number }>();
  return Number(row?.student_count ?? 0);
}

async function setupRow(classId: string) {
  return database().prepare(
    `SELECT class_id, status, setup_mode, survey_answers, draft_jobs,
            student_count_snapshot, selected_job_count, selected_capacity,
            last_step, revision, completed_at, updated_at
     FROM class_job_setup WHERE class_id = ?`,
  ).bind(classId).first<SetupRow>();
}

async function ensureSetupRow(classId: string) {
  await ensureJobCenterSchema();
  const current = await setupRow(classId);
  if (current) return current;
  const now = Date.now();
  await database().prepare(
    `INSERT OR IGNORE INTO class_job_setup (
       class_id, status, setup_mode, survey_answers, draft_jobs,
       student_count_snapshot, selected_job_count, selected_capacity,
       last_step, revision, completed_at, updated_at
     ) VALUES (?, 'not_started', NULL, ?, '[]', 0, 0, 0, 1, 0, NULL, ?)`,
  ).bind(classId, JSON.stringify(DEFAULT_SURVEY_ANSWERS), now).run();
  return (await setupRow(classId))!;
}

export async function activeClassJobs(classId: string): Promise<ClassJobDraft[]> {
  await ensureJobCenterSchema();
  const result = await database().prepare(
    `SELECT id, template_id, name, description, member_capacity, category, source, sort_order
     FROM class_jobs WHERE class_id = ? AND is_active = 1 ORDER BY sort_order, created_at`,
  ).bind(classId).all<{
    id: string;
    template_id: string | null;
    name: string;
    description: string;
    member_capacity: number;
    category: JobCategory;
    source: ClassJobDraft["source"];
    sort_order: number;
  }>();
  return result.results.map((row) => ({
    id: row.id,
    templateId: row.template_id,
    name: row.name,
    description: row.description,
    memberCapacity: Number(row.member_capacity),
    category: row.category,
    source: row.source,
    sortOrder: Number(row.sort_order),
  }));
}

function serializeSetup(row: SetupRow, finalJobs: ClassJobDraft[]): JobSetupState {
  const surveyAnswers = normalizeSurveyAnswers(parseJson<Partial<SurveyAnswers>>(
    row.survey_answers,
    DEFAULT_SURVEY_ANSWERS,
  ));
  const storedDraft = validateJobDrafts(parseJson<unknown[]>(row.draft_jobs, []), { allowEmpty: true });
  return {
    status: row.status,
    setupMode: row.setup_mode,
    surveyAnswers,
    draftJobs: row.status === "completed" && finalJobs.length ? finalJobs : storedDraft,
    studentCountSnapshot: Number(row.student_count_snapshot),
    selectedJobCount: Number(row.selected_job_count),
    selectedCapacity: Number(row.selected_capacity),
    lastStep: Number(row.last_step),
    revision: Number(row.revision),
    completedAt: row.completed_at ? Number(row.completed_at) : null,
    updatedAt: Number(row.updated_at),
  };
}

export async function loadJobSetup(classId: string) {
  const row = await ensureSetupRow(classId);
  const finalJobs = row.status === "completed" ? await activeClassJobs(classId) : [];
  return serializeSetup(row, finalJobs);
}

export async function assertClassJobDraftIds(classId: string, jobs: ClassJobDraft[]) {
  if (!jobs.length) return;
  const placeholders = jobs.map(() => "?").join(", ");
  const existing = await database().prepare(
    `SELECT id, class_id FROM class_jobs WHERE id IN (${placeholders})`,
  ).bind(...jobs.map((job) => job.id)).all<{ id: string; class_id: string }>();
  const ownerById = new Map(existing.results.map((row) => [row.id, row.class_id]));
  const invalid = jobs.find((job) => !jobIdOwnedOrAvailableForClass(
    job.id,
    classId,
    ownerById.get(job.id) ?? null,
  ));
  if (invalid) {
    throw new ApiError(
      400,
      "현재 학급에서 만든 직업만 저장할 수 있어요.",
      "JOB_ID_CLASS_MISMATCH",
    );
  }
}

function requireExpectedRevision(value: unknown) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new ApiError(400, "저장 버전이 올바르지 않아요.", "INVALID_REVISION");
  }
  return revision;
}

export async function saveJobDraft(input: {
  classId: string;
  teacherId: string;
  expectedRevision: unknown;
  setupMode: SetupMode;
  surveyAnswers?: Partial<SurveyAnswers> | null;
  jobs: unknown;
  lastStep: unknown;
  studentCount: number;
}) {
  await ensureSetupRow(input.classId);
  const revision = requireExpectedRevision(input.expectedRevision);
  const jobs = validateJobDrafts(input.jobs, { allowEmpty: true });
  await assertClassJobDraftIds(input.classId, jobs);
  const lastStep = integerInRange(input.lastStep, 1, 4);
  if (!lastStep || !["recommended", "manual"].includes(input.setupMode)) {
    throw new ApiError(400, "설정 단계를 다시 확인해 주세요.", "INVALID_SETUP");
  }
  const surveyAnswers = normalizeSurveyAnswers(input.surveyAnswers);
  const nextRevision = revision + 1;
  const capacity = sumJobCapacity(jobs);
  const now = Date.now();
  const guardId = crypto.randomUUID();
  const db = database();
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO registration_operation_guards (id, operation, created_at)
         SELECT CASE WHEN EXISTS (
           SELECT 1 FROM class_job_setup WHERE class_id = ? AND revision = ?
         ) THEN ? ELSE NULL END, 'job_setup_draft_save', ?`,
      ).bind(input.classId, revision, guardId, now),
      db.prepare(
        `UPDATE class_job_setup SET
           status = 'draft', setup_mode = ?, survey_answers = ?, draft_jobs = ?,
           student_count_snapshot = ?, selected_job_count = ?, selected_capacity = ?,
           last_step = ?, revision = ?, completed_at = NULL, updated_at = ?
         WHERE class_id = ? AND revision = ?`,
      ).bind(
        input.setupMode,
        JSON.stringify(surveyAnswers),
        JSON.stringify(jobs),
        input.studentCount,
        jobs.length,
        capacity,
        lastStep,
        nextRevision,
        now,
        input.classId,
        revision,
      ),
      db.prepare(
        `INSERT INTO audit_logs (
           id, teacher_id, class_id, student_id, action, detail, created_at
         ) VALUES (?, ?, ?, NULL, 'job_setup_draft_saved', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        input.teacherId,
        input.classId,
        JSON.stringify({ revision: nextRevision, jobCount: jobs.length, lastStep }),
        now,
      ),
      db.prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
    ]);
  } catch (error) {
    if (isOperationGuardFailure(error)) {
      throw new ApiError(
        409,
        "다른 화면에서 먼저 저장했어요. 현재 입력은 유지되니 새로 불러온 뒤 다시 저장해 주세요.",
        "JOB_SETUP_STALE",
      );
    }
    throw error;
  }
  return loadJobSetup(input.classId);
}

export async function completeJobSetup(input: {
  classId: string;
  teacherId: string;
  expectedRevision: unknown;
  setupMode: SetupMode;
  surveyAnswers?: Partial<SurveyAnswers> | null;
  jobs: unknown;
  studentCount: number;
  acknowledgeAssignmentImpact?: boolean;
}) {
  await ensureSetupRow(input.classId);
  const assignmentState = await database().prepare(
    `SELECT
       EXISTS (
         SELECT 1 FROM class_job_assignment_periods
         WHERE class_id = ? AND assignment_type = 'initial' AND status = 'confirmed'
       ) AS confirmed_count,
       (
         SELECT COUNT(*) FROM student_job_assignments assignment
         JOIN class_job_assignment_periods period ON period.id = assignment.period_id
         WHERE period.class_id = ? AND period.assignment_type = 'initial'
           AND period.status = 'draft'
       ) AS assignment_count`,
  ).bind(input.classId, input.classId).first<{
    confirmed_count: number;
    assignment_count: number;
  }>();
  if (Number(assignmentState?.confirmed_count ?? 0) > 0) {
    throw new ApiError(
      409,
      "첫 직업 배정이 이미 확정되어 초기 설정에서 직업과 정원을 바꿀 수 없어요.",
      "ASSIGNMENT_CONFIRMED",
    );
  }
  if (Number(assignmentState?.assignment_count ?? 0) > 0 && !input.acknowledgeAssignmentImpact) {
    throw new ApiError(
      409,
      "진행 중인 첫 직업 배정이 있어요. 직업을 다시 확정하면 임시 배정을 초기화합니다.",
      "ASSIGNMENT_IMPACT_CONFIRM_REQUIRED",
    );
  }
  if (input.studentCount < 1) {
    throw new ApiError(400, "학생을 한 명 이상 등록한 뒤 직업을 확정해 주세요.", "NO_STUDENTS");
  }
  const revision = requireExpectedRevision(input.expectedRevision);
  const jobs = validateJobDrafts(input.jobs);
  await assertClassJobDraftIds(input.classId, jobs);
  const capacity = sumJobCapacity(jobs);
  if (!["recommended", "manual"].includes(input.setupMode)) {
    throw new ApiError(400, "설정 방식을 다시 선택해 주세요.", "INVALID_SETUP");
  }

  const surveyAnswers = normalizeSurveyAnswers(input.surveyAnswers);
  const now = Date.now();
  const nextRevision = revision + 1;
  const guardId = crypto.randomUUID();
  const db = database();
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO registration_operation_guards (id, operation, created_at)
         SELECT CASE WHEN
           EXISTS (
             SELECT 1 FROM class_job_setup WHERE class_id = ? AND revision = ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM class_job_assignment_periods
             WHERE class_id = ? AND assignment_type = 'initial' AND status = 'confirmed'
           )
           AND (
             ? = 1 OR NOT EXISTS (
               SELECT 1 FROM student_job_assignments assignment
               JOIN class_job_assignment_periods period ON period.id = assignment.period_id
               WHERE period.class_id = ? AND period.assignment_type = 'initial'
                 AND period.status = 'draft'
             )
           )
         THEN ? ELSE NULL END, 'job_setup_complete', ?`,
      ).bind(
        input.classId,
        revision,
        input.classId,
        input.acknowledgeAssignmentImpact ? 1 : 0,
        input.classId,
        guardId,
        now,
      ),
      db.prepare(
        `UPDATE class_job_setup SET
           status = 'completed', setup_mode = ?, survey_answers = ?, draft_jobs = ?,
           student_count_snapshot = ?, selected_job_count = ?, selected_capacity = ?,
           last_step = 4, revision = ?, completed_at = ?, updated_at = ?
         WHERE class_id = ? AND revision = ?`,
      ).bind(
        input.setupMode,
        JSON.stringify(surveyAnswers),
        JSON.stringify(jobs),
        input.studentCount,
        jobs.length,
        capacity,
        nextRevision,
        now,
        now,
        input.classId,
        revision,
      ),
      db.prepare(
        `UPDATE class_job_assignment_periods
         SET mode = NULL, revision = revision + 1, updated_at = ?
         WHERE class_id = ? AND assignment_type = 'initial' AND status = 'draft'
           AND EXISTS (
             SELECT 1 FROM student_job_assignments assignment
             WHERE assignment.period_id = class_job_assignment_periods.id
           )`,
      ).bind(now, input.classId),
      db.prepare(
        `DELETE FROM job_assignment_candidates
         WHERE period_id IN (
           SELECT id FROM class_job_assignment_periods
           WHERE class_id = ? AND assignment_type = 'initial' AND status = 'draft'
         )`,
      ).bind(input.classId),
      db.prepare(
        `DELETE FROM student_job_assignments
         WHERE period_id IN (
           SELECT id FROM class_job_assignment_periods
           WHERE class_id = ? AND assignment_type = 'initial' AND status = 'draft'
         )`,
      ).bind(input.classId),
      db.prepare(
        `UPDATE class_jobs SET is_active = 0, updated_at = ? WHERE class_id = ?`,
      ).bind(now, input.classId),
      ...jobs.map((job, index) => db.prepare(
        `INSERT INTO class_jobs (
           id, class_id, template_id, name, description, member_capacity,
           category, source, sort_order, is_active, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           class_id = CASE
             WHEN class_jobs.class_id = excluded.class_id THEN class_jobs.class_id
             ELSE NULL
           END,
           template_id = excluded.template_id,
           name = excluded.name,
           description = excluded.description,
           member_capacity = excluded.member_capacity,
           category = excluded.category,
           source = excluded.source,
           sort_order = excluded.sort_order,
           is_active = 1,
           updated_at = excluded.updated_at`,
      ).bind(
        job.id,
        input.classId,
        job.templateId,
        job.name,
        job.description,
        job.memberCapacity,
        job.category,
        job.source,
        index,
        now,
        now,
      )),
      db.prepare(
        `INSERT INTO audit_logs (
           id, teacher_id, class_id, student_id, action, detail, created_at
         ) VALUES (?, ?, ?, NULL, 'job_setup_completed', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        input.teacherId,
        input.classId,
        JSON.stringify({
          revision: nextRevision,
          jobCount: jobs.length,
          capacity,
          studentCount: input.studentCount,
          unfilledSeatCount: Math.max(0, capacity - input.studentCount),
          potentiallyUnassignedStudentCount: Math.max(0, input.studentCount - capacity),
        }),
        now,
      ),
      db.prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
    ]);
  } catch (error) {
    if (isOperationGuardFailure(error)) {
      const latestAssignmentState = await database().prepare(
        `SELECT
           EXISTS (
             SELECT 1 FROM class_job_assignment_periods
             WHERE class_id = ? AND assignment_type = 'initial' AND status = 'confirmed'
           ) AS confirmed_count,
           (
             SELECT COUNT(*) FROM student_job_assignments assignment
             JOIN class_job_assignment_periods period ON period.id = assignment.period_id
             WHERE period.class_id = ? AND period.assignment_type = 'initial'
               AND period.status = 'draft'
           ) AS assignment_count`,
      ).bind(input.classId, input.classId).first<{
        confirmed_count: number;
        assignment_count: number;
      }>();
      if (Number(latestAssignmentState?.confirmed_count ?? 0) > 0) {
        throw new ApiError(
          409,
          "첫 직업 배정이 이미 확정되어 초기 설정에서 직업과 정원을 바꿀 수 없어요.",
          "ASSIGNMENT_CONFIRMED",
        );
      }
      if (
        Number(latestAssignmentState?.assignment_count ?? 0) > 0
        && !input.acknowledgeAssignmentImpact
      ) {
        throw new ApiError(
          409,
          "진행 중인 첫 직업 배정이 있어요. 직업을 다시 확정하면 임시 배정을 초기화합니다.",
          "ASSIGNMENT_IMPACT_CONFIRM_REQUIRED",
        );
      }
      throw new ApiError(
        409,
        "다른 화면에서 먼저 확정했어요. 현재 입력은 유지되니 새로 불러온 뒤 다시 확인해 주세요.",
        "JOB_SETUP_STALE",
      );
    }
    throw error;
  }
  return loadJobSetup(input.classId);
}
