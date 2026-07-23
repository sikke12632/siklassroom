import { database, ensureSchema } from "./database";
import { cleanDisplayText, integerInRange } from "./identity";
import {
  DEFAULT_SURVEY_ANSWERS,
  JOB_CATEGORIES,
  JOB_TEMPLATES,
  normalizeSurveyAnswers,
  sumJobCapacity,
  type ClassJobDraft,
  type JobCategory,
  type SetupMode,
  type SurveyAnswers,
} from "./job-catalog";
import { ApiError } from "./responses";

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
  const db = database();
  await db.batch(JOB_TEMPLATES.map((template) => db.prepare(
    `INSERT INTO job_templates (
       id, name, short_description, detailed_tasks, category,
       recommended_min_members, recommended_max_members, icon_key, default_priority, is_active
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       short_description = excluded.short_description,
       detailed_tasks = excluded.detailed_tasks,
       category = excluded.category,
       recommended_min_members = excluded.recommended_min_members,
       recommended_max_members = excluded.recommended_max_members,
       icon_key = excluded.icon_key,
       default_priority = excluded.default_priority,
       is_active = 1`,
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
  )));
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
    `INSERT INTO class_job_setup (
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

export function validateJobDrafts(input: unknown, options: { allowEmpty?: boolean } = {}) {
  if (!Array.isArray(input)) throw new ApiError(400, "직업 목록을 다시 확인해 주세요.", "INVALID_JOBS");
  if (!options.allowEmpty && input.length === 0) {
    throw new ApiError(400, "직업을 한 개 이상 추가해 주세요.", "JOB_REQUIRED");
  }
  if (input.length > 60) throw new ApiError(400, "직업은 최대 60개까지 만들 수 있어요.", "TOO_MANY_JOBS");

  const seen = new Set<string>();
  return input.map((raw, index): ClassJobDraft => {
    const item = (raw ?? {}) as Partial<ClassJobDraft>;
    const id = cleanDisplayText(item.id, 100);
    if (!id || seen.has(id)) throw new ApiError(400, "직업 ID가 없거나 중복되었어요.", "INVALID_JOB_ID");
    seen.add(id);
    const name = cleanDisplayText(item.name, 40);
    const description = cleanDisplayText(item.description, 240);
    const memberCapacity = integerInRange(item.memberCapacity, 1, 60);
    const category = String(item.category ?? "") as JobCategory;
    const source = String(item.source ?? "") as ClassJobDraft["source"];
    const templateId = item.templateId ? cleanDisplayText(item.templateId, 80) : null;
    if (!name || !description || !memberCapacity) {
      throw new ApiError(400, `${index + 1}번째 직업의 이름, 설명, 정원을 확인해 주세요.`, "INVALID_JOB");
    }
    if (!(category in JOB_CATEGORIES)) {
      throw new ApiError(400, `${name}의 분류를 다시 선택해 주세요.`, "INVALID_JOB_CATEGORY");
    }
    if (!["recommended", "template", "custom"].includes(source)) {
      throw new ApiError(400, `${name}의 생성 방식을 확인해 주세요.`, "INVALID_JOB_SOURCE");
    }
    if (templateId && !JOB_TEMPLATES.some((template) => template.id === templateId)) {
      throw new ApiError(400, `${name}의 기본 직업을 찾을 수 없어요.`, "INVALID_TEMPLATE");
    }
    return {
      id,
      templateId,
      name,
      description,
      memberCapacity,
      category,
      source,
      sortOrder: index,
    };
  });
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
  const lastStep = integerInRange(input.lastStep, 1, 4);
  if (!lastStep || !["recommended", "manual"].includes(input.setupMode)) {
    throw new ApiError(400, "설정 단계를 다시 확인해 주세요.", "INVALID_SETUP");
  }
  const surveyAnswers = normalizeSurveyAnswers(input.surveyAnswers);
  const nextRevision = revision + 1;
  const result = await database().prepare(
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
    sumJobCapacity(jobs),
    lastStep,
    nextRevision,
    Date.now(),
    input.classId,
    revision,
  ).run();
  if (!result.meta.changes) {
    throw new ApiError(409, "다른 화면에서 먼저 저장했어요. 현재 입력은 유지되니 새로 불러온 뒤 다시 저장해 주세요.", "JOB_SETUP_STALE");
  }
  return loadJobSetup(input.classId);
}

export async function completeJobSetup(input: {
  classId: string;
  expectedRevision: unknown;
  setupMode: SetupMode;
  surveyAnswers?: Partial<SurveyAnswers> | null;
  jobs: unknown;
  studentCount: number;
}) {
  await ensureSetupRow(input.classId);
  if (input.studentCount < 1) {
    throw new ApiError(400, "학생을 한 명 이상 등록한 뒤 직업을 확정해 주세요.", "NO_STUDENTS");
  }
  const revision = requireExpectedRevision(input.expectedRevision);
  const jobs = validateJobDrafts(input.jobs);
  const capacity = sumJobCapacity(jobs);
  if (capacity !== input.studentCount) {
    throw new ApiError(
      422,
      `직업 자리 ${capacity}개를 학생 ${input.studentCount}명과 정확히 맞춰 주세요.`,
      "JOB_CAPACITY_MISMATCH",
    );
  }
  if (!["recommended", "manual"].includes(input.setupMode)) {
    throw new ApiError(400, "설정 방식을 다시 선택해 주세요.", "INVALID_SETUP");
  }

  const surveyAnswers = normalizeSurveyAnswers(input.surveyAnswers);
  const now = Date.now();
  const nextRevision = revision + 1;
  const update = await database().prepare(
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
  ).run();
  if (!update.meta.changes) {
    throw new ApiError(409, "다른 화면에서 먼저 확정했어요. 현재 입력은 유지되니 새로 불러온 뒤 다시 확인해 주세요.", "JOB_SETUP_STALE");
  }

  const db = database();
  await db.batch([
    db.prepare(`UPDATE class_jobs SET is_active = 0, updated_at = ? WHERE class_id = ?`).bind(now, input.classId),
    ...jobs.map((job, index) => db.prepare(
      `INSERT INTO class_jobs (
         id, class_id, template_id, name, description, member_capacity,
         category, source, sort_order, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
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
  ]);
  return loadJobSetup(input.classId);
}
