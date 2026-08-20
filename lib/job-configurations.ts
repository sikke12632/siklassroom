import { database, ensureSchema, isOperationGuardFailure } from "./database";
import { cleanDisplayText } from "./identity";
import { sumJobCapacity, type ClassJobDraft, type JobCategory } from "./job-catalog";
import {
  assertClassJobDraftIds,
  eligibleStudentCount,
  validateJobDrafts,
} from "./job-storage";
import { ApiError } from "./responses";
import { seoulServerTime } from "./seoul-time";

type ConfirmedPeriodRow = {
  id: string;
  class_id: string;
  assignment_year: number;
  assignment_month: number;
  assignment_type: "initial" | "monthly";
  mode: string | null;
  revision: number;
  confirmed_at: number | null;
  updated_at: number;
};

type SetupRow = {
  status: string;
  revision: number;
  draft_jobs: string | null;
};

type JobRow = {
  id: string;
  template_id: string | null;
  name: string;
  description: string;
  member_capacity: number;
  category: JobCategory;
  source: ClassJobDraft["source"];
  sort_order: number;
  is_active: number;
};

type StudentRow = {
  id: string;
  student_number: number;
  official_name: string;
};

type AssignmentRow = {
  id: string;
  class_job_id: string;
  student_id: string;
  assignment_method: string;
  assignment_sequence: number;
  assigned_at: number;
  student_number: number;
  student_name: string;
};

type ChoiceSessionRow = {
  id: string;
  status: "draft" | "confirmed";
  target_year: number;
  target_month: number;
};

type PlanRow = {
  id: string;
  class_id: string;
  target_year: number;
  target_month: number;
  jobs_json: string;
  previous_jobs_json: string | null;
  applied_jobs_json: string | null;
  status: "draft" | "applied";
  base_setup_revision: number;
  revision: number;
  created_by_teacher_id: string;
  applied_by_teacher_id: string | null;
  applied_at: number | null;
  created_at: number;
  updated_at: number;
};

type RequestAuditDetail = {
  requestId?: unknown;
  payloadHash?: unknown;
  resultingRevision?: unknown;
  targetYear?: unknown;
  targetMonth?: unknown;
  impact?: JobConfigurationImpact;
};

export type JobConfigurationImpact = {
  hasImpact: boolean;
  affectedStudentCount: number;
  removedAssignedJobs: Array<{
    id: string;
    name: string;
    assignedCount: number;
  }>;
  overCapacityJobs: Array<{
    id: string;
    name: string;
    assignedCount: number;
    currentCapacity: number;
    nextCapacity: number;
    overCapacityCount: number;
  }>;
};

export class JobConfigurationImpactError extends ApiError {
  constructor(public impact: JobConfigurationImpact) {
    super(
      409,
      "현재 배정된 학생에게 영향을 주는 변경이 있어요. 영향을 확인한 뒤 다시 저장해 주세요.",
      "JOB_CONFIG_IMPACT_CONFIRMATION_REQUIRED",
    );
  }
}

function requiredRevision(value: unknown, code: string) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new ApiError(400, "저장 버전을 다시 확인해 주세요.", code);
  }
  return revision;
}

function requiredTargetPart(
  value: unknown,
  min: number,
  max: number,
  code: string,
) {
  const part = Number(value);
  if (!Number.isInteger(part) || part < min || part > max) {
    throw new ApiError(400, "다음 달 기준을 다시 확인해 주세요.", code);
  }
  return part;
}

function requiredRequestId(value: unknown) {
  const requestId = cleanDisplayText(value, 100);
  if (!requestId) {
    throw new ApiError(
      400,
      "저장 요청 번호를 확인할 수 없어요. 화면을 새로고침한 뒤 다시 시도해 주세요.",
      "REQUEST_ID_REQUIRED",
    );
  }
  return requestId;
}

async function payloadHash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function nextMonth(year: number, month: number) {
  return month === 12
    ? { year: year + 1, month: 1 }
    : { year, month: month + 1 };
}

function previousMonth(year: number, month: number) {
  return month === 1
    ? { year: year - 1, month: 12 }
    : { year, month: month - 1 };
}

export async function latestEffectiveJobPeriod(
  classId: string,
  epochMs = Date.now(),
) {
  await ensureSchema();
  const current = seoulServerTime(epochMs);
  return database().prepare(
    `SELECT id, class_id, assignment_year, assignment_month, assignment_type,
            mode, revision, confirmed_at, updated_at
     FROM class_job_assignment_periods
     WHERE class_id = ? AND status = 'confirmed'
       AND assignment_type IN ('initial', 'monthly')
       AND (
         assignment_year < ?
         OR (assignment_year = ? AND assignment_month <= ?)
       )
     ORDER BY assignment_year DESC, assignment_month DESC,
              COALESCE(confirmed_at, 0) DESC, updated_at DESC, id DESC
     LIMIT 1`,
  ).bind(classId, current.year, current.year, current.month).first<ConfirmedPeriodRow>();
}

async function nextScheduledJobPeriod(
  classId: string,
  epochMs = Date.now(),
) {
  const current = seoulServerTime(epochMs);
  return database().prepare(
    `SELECT id, class_id, assignment_year, assignment_month, assignment_type,
            mode, revision, confirmed_at, updated_at
     FROM class_job_assignment_periods
     WHERE class_id = ? AND status = 'confirmed'
       AND assignment_type IN ('initial', 'monthly')
       AND (
         assignment_year > ?
         OR (assignment_year = ? AND assignment_month > ?)
       )
     ORDER BY assignment_year, assignment_month,
              COALESCE(confirmed_at, 0) DESC, updated_at DESC, id DESC
     LIMIT 1`,
  ).bind(classId, current.year, current.year, current.month).first<ConfirmedPeriodRow>();
}

async function setupRow(classId: string) {
  return database().prepare(
    `SELECT status, revision, draft_jobs FROM class_job_setup WHERE class_id = ?`,
  ).bind(classId).first<SetupRow>();
}

function setupConfigurationJobs(setup: SetupRow | null) {
  if (!setup?.draft_jobs) return [];
  try {
    return validateJobDrafts(JSON.parse(setup.draft_jobs), { allowEmpty: true });
  } catch {
    throw new ApiError(
      500,
      "저장된 현재 직업 구성을 불러오지 못했어요.",
      "JOB_SETUP_DATA_INVALID",
    );
  }
}

async function planRow(classId: string, target: { year: number; month: number }) {
  return database().prepare(
    `SELECT id, class_id, target_year, target_month, jobs_json,
            previous_jobs_json, applied_jobs_json, status,
            base_setup_revision, revision, created_by_teacher_id,
            applied_by_teacher_id, applied_at, created_at, updated_at
     FROM class_job_change_plans
     WHERE class_id = ? AND target_year = ? AND target_month = ?`,
  ).bind(classId, target.year, target.month).first<PlanRow>();
}

function storedPlanJobs(plan: PlanRow) {
  try {
    const serialized = plan.status === "applied" && plan.applied_jobs_json
      ? plan.applied_jobs_json
      : plan.jobs_json;
    return validateJobDrafts(JSON.parse(serialized), { allowEmpty: true });
  } catch {
    throw new ApiError(
      500,
      "저장된 다음 달 직업 구성을 불러오지 못했어요.",
      "JOB_PLAN_DATA_INVALID",
    );
  }
}

function storedPreviousJobs(plan: PlanRow) {
  if (!plan.previous_jobs_json) return [];
  try {
    return validateJobDrafts(JSON.parse(plan.previous_jobs_json), { allowEmpty: true });
  } catch {
    throw new ApiError(
      500,
      "저장된 이전 직업 구성을 불러오지 못했어요.",
      "JOB_PLAN_DATA_INVALID",
    );
  }
}

function serializePlan(plan: PlanRow | null) {
  if (!plan) return null;
  return {
    id: plan.id,
    targetYear: Number(plan.target_year),
    targetMonth: Number(plan.target_month),
    status: plan.status,
    jobs: storedPlanJobs(plan),
    baseSetupRevision: Number(plan.base_setup_revision),
    revision: Number(plan.revision),
    appliedAt: plan.applied_at === null ? null : Number(plan.applied_at),
    updatedAt: Number(plan.updated_at),
  };
}

async function requestAudit(classId: string, action: string, requestId: string) {
  const rows = await database().prepare(
    `SELECT detail FROM audit_logs
     WHERE class_id = ? AND action = ?
     ORDER BY created_at DESC, id DESC`,
  ).bind(classId, action).all<{ detail: string | null }>();
  for (const row of rows.results) {
    if (!row.detail) continue;
    try {
      const detail = JSON.parse(row.detail) as RequestAuditDetail;
      if (detail.requestId === requestId) return detail;
    } catch {}
  }
  return null;
}

function planTarget(period: ConfirmedPeriodRow | null) {
  return period
    ? nextMonth(Number(period.assignment_year), Number(period.assignment_month))
    : null;
}

function draftAsJobRow(job: ClassJobDraft): JobRow {
  return {
    id: job.id,
    template_id: job.templateId,
    name: job.name,
    description: job.description,
    member_capacity: job.memberCapacity,
    category: job.category,
    source: job.source,
    sort_order: job.sortOrder,
    is_active: 1,
  };
}

export async function loadJobOverview(classId: string) {
  await ensureSchema();
  const [effectivePeriod, scheduledPeriod] = await Promise.all([
    latestEffectiveJobPeriod(classId).then((row) => row ?? null),
    nextScheduledJobPeriod(classId).then((row) => row ?? null),
  ]);
  const period = effectivePeriod ?? scheduledPeriod;
  const target = planTarget(effectivePeriod);
  const [setup, studentsResult, jobsResult, assignmentsResult, plan, nextSession] = await Promise.all([
    setupRow(classId),
    database().prepare(
      `SELECT id, student_number, official_name
       FROM students
       WHERE class_id = ? AND status <> 'excluded'
       ORDER BY student_number, official_name, id`,
    ).bind(classId).all<StudentRow>(),
    database().prepare(
      `SELECT id, template_id, name, description, member_capacity,
              category, source, sort_order, is_active
       FROM class_jobs job
       WHERE job.class_id = ?
         AND (
           job.is_active = 1
           OR (? IS NOT NULL AND EXISTS (
             SELECT 1 FROM student_job_assignments assignment
             WHERE assignment.period_id = ? AND assignment.class_id = job.class_id
               AND assignment.class_job_id = job.id
           ))
         )
       ORDER BY job.is_active DESC, job.sort_order, job.created_at, job.id`,
    ).bind(classId, period?.id ?? null, period?.id ?? null).all<JobRow>(),
    period
      ? database().prepare(
        `SELECT assignment.id, assignment.class_job_id, assignment.student_id,
                assignment.assignment_method, assignment.assignment_sequence,
                assignment.assigned_at, student.student_number,
                student.official_name AS student_name
         FROM student_job_assignments assignment
         JOIN students student
           ON student.id = assignment.student_id
          AND student.class_id = assignment.class_id
         WHERE assignment.period_id = ? AND assignment.class_id = ?
           AND student.status <> 'excluded'
         ORDER BY assignment.assignment_sequence, student.student_number, student.id`,
      ).bind(period.id, classId).all<AssignmentRow>()
      : Promise.resolve({ results: [] as AssignmentRow[] }),
    target ? planRow(classId, target).then((row) => row ?? null) : Promise.resolve(null),
    target
      ? database().prepare(
        `SELECT id, status, target_year, target_month
         FROM class_job_choice_sessions
         WHERE class_id = ? AND target_year = ? AND target_month = ?`,
      ).bind(classId, target.year, target.month).first<ChoiceSessionRow>()
      : Promise.resolve(null),
  ]);

  const assignmentsByJob = new Map<string, AssignmentRow[]>();
  const assignedStudentIds = new Set<string>();
  for (const assignment of assignmentsResult.results) {
    assignedStudentIds.add(assignment.student_id);
    const current = assignmentsByJob.get(assignment.class_job_id) ?? [];
    current.push(assignment);
    assignmentsByJob.set(assignment.class_job_id, current);
  }

  const appliedPlanPending = Boolean(
    plan?.status === "applied"
    && (
      !period
      || Number(period.assignment_year) !== Number(plan.target_year)
      || Number(period.assignment_month) !== Number(plan.target_month)
    ),
  );
  let visibleJobs = jobsResult.results;
  if (appliedPlanPending && plan) {
    const previousJobs = storedPreviousJobs(plan);
    const previousIds = new Set(previousJobs.map((job) => job.id));
    const assignedRetiredJobs = jobsResult.results.filter((job) => (
      assignmentsByJob.has(job.id) && !previousIds.has(job.id)
    )).map((job) => ({ ...job, is_active: 0 }));
    visibleJobs = [
      ...previousJobs.map(draftAsJobRow),
      ...assignedRetiredJobs,
    ];
  }

  return {
    period: period ? {
      id: period.id,
      year: Number(period.assignment_year),
      month: Number(period.assignment_month),
      assignmentType: period.assignment_type,
      mode: period.mode,
      revision: Number(period.revision),
      confirmedAt: period.confirmed_at === null ? null : Number(period.confirmed_at),
      isScheduled: !effectivePeriod || effectivePeriod.id !== period.id,
    } : null,
    jobs: visibleJobs.map((job) => {
      const assigned = assignmentsByJob.get(job.id) ?? [];
      const capacity = Number(job.member_capacity);
      const assignedCount = assigned.length;
      const overCapacityCount = Math.max(0, assignedCount - capacity);
      const isActive = Boolean(job.is_active);
      return {
        id: job.id,
        templateId: job.template_id,
        name: job.name,
        description: job.description,
        memberCapacity: capacity,
        capacity,
        category: job.category,
        source: job.source,
        sortOrder: Number(job.sort_order),
        assignedStudents: assigned.map((assignment) => ({
          assignmentId: assignment.id,
          id: assignment.student_id,
          studentNumber: Number(assignment.student_number),
          name: assignment.student_name,
          method: assignment.assignment_method,
          sequence: Number(assignment.assignment_sequence),
          assignedAt: Number(assignment.assigned_at),
        })),
        assignedCount,
        vacancies: Math.max(0, capacity - assignedCount),
        overCapacity: overCapacityCount > 0,
        overCapacityCount,
        isActive,
        retired: !isActive,
      };
    }),
    unassignedStudents: studentsResult.results
      .filter((student) => !assignedStudentIds.has(student.id))
      .map((student) => ({
        id: student.id,
        studentNumber: Number(student.student_number),
        name: student.official_name,
      })),
    studentCount: studentsResult.results.length,
    setupRevision: Number(setup?.revision ?? 0),
    configurationJobs: setupConfigurationJobs(setup ?? null),
    futureConfirmedPeriod: scheduledPeriod ? {
      id: scheduledPeriod.id,
      year: Number(scheduledPeriod.assignment_year),
      month: Number(scheduledPeriod.assignment_month),
      assignmentType: scheduledPeriod.assignment_type,
    } : null,
    nextTarget: target ? { year: target.year, month: target.month } : null,
    nextPlan: serializePlan(plan),
    nextSession: nextSession ? {
      id: nextSession.id,
      status: nextSession.status,
      targetYear: Number(nextSession.target_year),
      targetMonth: Number(nextSession.target_month),
    } : null,
  };
}

async function activeClassJobRows(classId: string) {
  const result = await database().prepare(
    `SELECT id, template_id, name, description, member_capacity,
            category, source, sort_order, is_active
     FROM class_jobs WHERE class_id = ? AND is_active = 1
     ORDER BY sort_order, created_at, id`,
  ).bind(classId).all<JobRow>();
  return result.results;
}

async function allClassJobRows(classId: string) {
  const result = await database().prepare(
    `SELECT id, template_id, name, description, member_capacity,
            category, source, sort_order, is_active
     FROM class_jobs WHERE class_id = ?
     ORDER BY sort_order, created_at, id`,
  ).bind(classId).all<JobRow>();
  return result.results;
}

function jobRowAsDraft(job: JobRow): ClassJobDraft {
  return {
    id: job.id,
    templateId: job.template_id,
    name: job.name,
    description: job.description,
    memberCapacity: Number(job.member_capacity),
    category: job.category,
    source: job.source,
    sortOrder: Number(job.sort_order),
  };
}

function jobDefinitionChanged(previous: JobRow, next: ClassJobDraft) {
  return previous.template_id !== next.templateId
    || previous.name !== next.name
    || previous.description !== next.description
    || Number(previous.member_capacity) !== next.memberCapacity
    || previous.category !== next.category
    || previous.source !== next.source
    || Number(previous.sort_order) !== next.sortOrder;
}

function materializeJobConfiguration(
  classId: string,
  jobs: ClassJobDraft[],
  existingRows: JobRow[],
) {
  const existingById = new Map(existingRows.map((job) => [job.id, job]));
  const idMapping: Array<{ fromId: string; toId: string }> = [];
  const materializedJobs = jobs.map((job, index) => {
    const normalized = { ...job, sortOrder: index };
    const previous = existingById.get(job.id);
    if (!previous || !jobDefinitionChanged(previous, normalized)) return normalized;
    const nextId = `${classId}:v:${crypto.randomUUID()}`;
    idMapping.push({ fromId: job.id, toId: nextId });
    return { ...normalized, id: nextId };
  });
  return { jobs: materializedJobs, idMapping };
}

function configurationDiff(current: JobRow[], next: ClassJobDraft[]) {
  const currentById = new Map(current.map((job) => [job.id, job]));
  const nextById = new Map(next.map((job) => [job.id, job]));
  return {
    addedJobIds: next.filter((job) => !currentById.has(job.id)).map((job) => job.id),
    removedJobIds: current.filter((job) => !nextById.has(job.id)).map((job) => job.id),
    changedJobIds: next.flatMap((job) => {
      const previous = currentById.get(job.id);
      if (!previous) return [];
      return previous.template_id !== job.templateId
        || previous.name !== job.name
        || previous.description !== job.description
        || Number(previous.member_capacity) !== job.memberCapacity
        || previous.category !== job.category
        || previous.source !== job.source
        || Number(previous.sort_order) !== job.sortOrder
        ? [job.id]
        : [];
    }),
  };
}

async function configurationImpact(
  classId: string,
  period: ConfirmedPeriodRow | null,
  currentJobs: JobRow[],
  nextJobs: ClassJobDraft[],
): Promise<JobConfigurationImpact> {
  if (!period) {
    return {
      hasImpact: false,
      affectedStudentCount: 0,
      removedAssignedJobs: [],
      overCapacityJobs: [],
    };
  }
  const counts = await database().prepare(
    `SELECT class_job_id, COUNT(*) AS assigned_count
     FROM student_job_assignments
     WHERE period_id = ? AND class_id = ?
     GROUP BY class_job_id`,
  ).bind(period.id, classId).all<{ class_job_id: string; assigned_count: number }>();
  const countByJob = new Map(
    counts.results.map((row) => [row.class_job_id, Number(row.assigned_count)]),
  );
  const nextById = new Map(nextJobs.map((job) => [job.id, job]));
  const currentById = new Map(currentJobs.map((job) => [job.id, job]));
  const removedAssignedJobs = currentJobs.flatMap((job) => {
    const assignedCount = countByJob.get(job.id) ?? 0;
    return !nextById.has(job.id) && assignedCount > 0
      ? [{ id: job.id, name: job.name, assignedCount }]
      : [];
  });
  const overCapacityJobs = nextJobs.flatMap((job) => {
    const assignedCount = countByJob.get(job.id) ?? 0;
    if (assignedCount <= job.memberCapacity) return [];
    return [{
      id: job.id,
      name: job.name,
      assignedCount,
      currentCapacity: Number(currentById.get(job.id)?.member_capacity ?? job.memberCapacity),
      nextCapacity: job.memberCapacity,
      overCapacityCount: assignedCount - job.memberCapacity,
    }];
  });
  const affectedIds = new Set([
    ...removedAssignedJobs.map((job) => job.id),
    ...overCapacityJobs.map((job) => job.id),
  ]);
  const affectedStudentCount = [...affectedIds]
    .reduce((sum, jobId) => sum + (countByJob.get(jobId) ?? 0), 0);
  return {
    hasImpact: affectedIds.size > 0,
    affectedStudentCount,
    removedAssignedJobs,
    overCapacityJobs,
  };
}

async function unsafeOpenWorkflow(classId: string) {
  const current = seoulServerTime();
  const row = await database().prepare(
    `WITH latest_effective_period AS (
       SELECT id, assignment_year, assignment_month
       FROM class_job_assignment_periods
       WHERE class_id = ? AND status = 'confirmed'
         AND assignment_type IN ('initial', 'monthly')
         AND (
           assignment_year < ?
           OR (assignment_year = ? AND assignment_month <= ?)
         )
       ORDER BY assignment_year DESC, assignment_month DESC,
                COALESCE(confirmed_at, 0) DESC, updated_at DESC, id DESC
       LIMIT 1
     )
     SELECT
       EXISTS (
         SELECT 1 FROM class_job_choice_sessions
         WHERE class_id = ? AND status = 'draft'
       ) AS monthly_choice_open,
       EXISTS (
         SELECT 1 FROM class_job_choice_sessions session
         WHERE session.class_id = ? AND session.status = 'confirmed'
           AND (
             NOT EXISTS (SELECT 1 FROM latest_effective_period)
             OR EXISTS (
               SELECT 1 FROM latest_effective_period period
               WHERE session.target_year > period.assignment_year
                  OR (session.target_year = period.assignment_year
                      AND session.target_month > period.assignment_month)
             )
           )
       ) AS monthly_choice_pending,
       EXISTS (
         SELECT 1 FROM class_job_change_plans plan
         WHERE plan.class_id = ? AND plan.status = 'applied'
           AND (
             NOT EXISTS (SELECT 1 FROM latest_effective_period)
             OR EXISTS (
               SELECT 1 FROM latest_effective_period period
               WHERE plan.target_year > period.assignment_year
                  OR (plan.target_year = period.assignment_year
                      AND plan.target_month > period.assignment_month)
             )
           )
       ) AS applied_plan_pending,
       EXISTS (
         SELECT 1 FROM class_job_evaluation_sessions
         WHERE class_id = ? AND status IN ('open', 'closed')
       ) AS evaluation_open,
       EXISTS (
         SELECT 1 FROM latest_effective_period period
         WHERE EXISTS (
           SELECT 1 FROM class_job_month_closures closure
           WHERE closure.class_id = ? AND closure.source_period_id = period.id
         ) OR EXISTS (
           SELECT 1 FROM class_job_evaluation_sessions evaluation
           WHERE evaluation.class_id = ? AND evaluation.source_period_id = period.id
             AND evaluation.status = 'finalized'
         )
       ) AS current_period_finalized,
       EXISTS (
         SELECT 1 FROM class_job_assignment_periods period
         WHERE period.class_id = ? AND period.status = 'confirmed'
           AND period.assignment_type IN ('initial', 'monthly')
           AND (
             period.assignment_year > ?
             OR (period.assignment_year = ? AND period.assignment_month > ?)
           )
       ) AS future_period_pending,
       EXISTS (
         SELECT 1
         FROM class_job_assignment_periods period
         WHERE period.class_id = ? AND period.status = 'draft'
           AND period.assignment_type = 'initial'
           AND (
             EXISTS (SELECT 1 FROM student_job_assignments a WHERE a.period_id = period.id)
             OR EXISTS (SELECT 1 FROM job_assignment_candidates c WHERE c.period_id = period.id)
           )
       ) AS initial_assignment_open`,
  ).bind(
    classId,
    current.year,
    current.year,
    current.month,
    classId,
    classId,
    classId,
    classId,
    classId,
    classId,
    classId,
    current.year,
    current.year,
    current.month,
    classId,
  ).first<{
    monthly_choice_open: number;
    monthly_choice_pending: number;
    applied_plan_pending: number;
    evaluation_open: number;
    current_period_finalized: number;
    future_period_pending: number;
    initial_assignment_open: number;
  }>();
  return {
    monthlyChoiceOpen: Boolean(row?.monthly_choice_open),
    monthlyChoicePending: Boolean(row?.monthly_choice_pending),
    appliedPlanPending: Boolean(row?.applied_plan_pending),
    evaluationOpen: Boolean(row?.evaluation_open),
    currentPeriodFinalized: Boolean(row?.current_period_finalized),
    futurePeriodPending: Boolean(row?.future_period_pending),
    initialAssignmentOpen: Boolean(row?.initial_assignment_open),
  };
}

function hasUnsafeWorkflow(workflow: Awaited<ReturnType<typeof unsafeOpenWorkflow>>) {
  return workflow.monthlyChoiceOpen
    || workflow.monthlyChoicePending
    || workflow.appliedPlanPending
    || workflow.evaluationOpen
    || workflow.currentPeriodFinalized
    || workflow.futurePeriodPending
    || workflow.initialAssignmentOpen;
}

function classJobWriteStatements(input: {
  db: D1Database;
  classId: string;
  jobs: ClassJobDraft[];
  expectedSetupRevision: number;
  nextSetupRevision: number;
  studentCount: number;
  now: number;
  guardId: string;
}) {
  const capacity = sumJobCapacity(input.jobs);
  return [
    input.db.prepare(
      `UPDATE class_job_setup SET
         status = 'completed', draft_jobs = ?, student_count_snapshot = ?,
         selected_job_count = ?, selected_capacity = ?, last_step = 4,
         revision = ?, completed_at = COALESCE(completed_at, ?), updated_at = ?
       WHERE class_id = ? AND status = 'completed' AND revision = ?
         AND EXISTS (SELECT 1 FROM registration_operation_guards WHERE id = ?)`,
    ).bind(
      JSON.stringify(input.jobs),
      input.studentCount,
      input.jobs.length,
      capacity,
      input.nextSetupRevision,
      input.now,
      input.now,
      input.classId,
      input.expectedSetupRevision,
      input.guardId,
    ),
    input.db.prepare(
      `UPDATE class_jobs SET is_active = 0, updated_at = ?
       WHERE class_id = ? AND is_active = 1
         AND EXISTS (SELECT 1 FROM registration_operation_guards WHERE id = ?)`,
    ).bind(input.now, input.classId, input.guardId),
    ...input.jobs.map((job, index) => input.db.prepare(
      `INSERT INTO class_jobs (
         id, class_id, template_id, name, description, member_capacity,
         category, source, sort_order, is_active, created_at, updated_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
       WHERE EXISTS (SELECT 1 FROM registration_operation_guards WHERE id = ?)
       ON CONFLICT(id) DO UPDATE SET
         class_id = (CASE
           WHEN class_jobs.class_id = excluded.class_id THEN class_jobs.class_id
           ELSE NULL
         END),
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
      input.now,
      input.now,
      input.guardId,
    )),
  ];
}

async function currentRequestReplay(input: {
  classId: string;
  requestId: string;
  hash: string;
}) {
  const detail = await requestAudit(
    input.classId,
    "job_configuration_applied_current",
    input.requestId,
  );
  if (!detail) return null;
  if (detail.payloadHash !== input.hash) {
    throw new ApiError(
      409,
      "같은 저장 요청 번호가 다른 직업 구성에 이미 사용됐어요.",
      "JOB_CONFIG_REQUEST_REUSED",
    );
  }
  const setup = await setupRow(input.classId);
  if (Number(setup?.revision) !== Number(detail.resultingRevision)) {
    throw new ApiError(
      409,
      "이 저장 요청 이후 직업 구성이 다시 변경됐어요. 최신 화면을 확인해 주세요.",
      "JOB_CONFIG_REQUEST_REUSED",
    );
  }
  return {
    revision: Number(detail.resultingRevision),
    impact: detail.impact,
  };
}

export async function applyCurrentJobConfiguration(input: {
  classId: string;
  teacherId: string;
  expectedSetupRevision: unknown;
  requestId: unknown;
  jobs: unknown;
  acknowledgeImpact?: boolean;
}) {
  await ensureSchema();
  const expectedSetupRevision = requiredRevision(
    input.expectedSetupRevision,
    "INVALID_JOB_SETUP_REVISION",
  );
  const requestId = requiredRequestId(input.requestId);
  const jobs = validateJobDrafts(input.jobs);
  await assertClassJobDraftIds(input.classId, jobs);
  const serializedJobs = JSON.stringify(jobs);
  const hash = await payloadHash(serializedJobs);
  const replay = await currentRequestReplay({
    classId: input.classId,
    requestId,
    hash,
  });
  if (replay !== null) {
    return {
      idempotent: true,
      setupRevision: replay.revision,
      impact: replay.impact ?? await configurationImpact(
          input.classId,
          await latestEffectiveJobPeriod(input.classId) ?? null,
          await activeClassJobRows(input.classId),
          jobs,
        ),
      overview: await loadJobOverview(input.classId),
    };
  }

  const [setup, currentJobs, allJobs, period, workflow, studentCount] = await Promise.all([
    setupRow(input.classId),
    activeClassJobRows(input.classId),
    allClassJobRows(input.classId),
    latestEffectiveJobPeriod(input.classId).then((row) => row ?? null),
    unsafeOpenWorkflow(input.classId),
    eligibleStudentCount(input.classId),
  ]);
  if (!setup || setup.status !== "completed") {
    throw new ApiError(409, "우리 반 직업을 먼저 확정해 주세요.", "JOB_SETUP_REQUIRED");
  }
  if (Number(setup.revision) !== expectedSetupRevision) {
    throw new ApiError(
      409,
      "다른 화면에서 직업 구성이 먼저 변경됐어요. 최신 화면을 확인해 주세요.",
      "JOB_CONFIG_STALE",
    );
  }
  if (workflow.futurePeriodPending) {
    throw new ApiError(
      409,
      "앞으로 시작할 확정 배정이 있어 현재 구성을 바꿀 수 없어요. 예정 월이 시작된 뒤 다음 달 구성으로 준비해 주세요.",
      "FUTURE_JOB_PERIOD_PENDING",
    );
  }
  if (hasUnsafeWorkflow(workflow)) {
    throw new ApiError(
      409,
      "진행 중인 배정 또는 평가가 있어 지금 반영하면 작업이 어긋날 수 있어요. 다음 달 반영으로 저장해 주세요.",
      "OPEN_JOB_WORKFLOW_IMPACT",
    );
  }
  const impact = await configurationImpact(input.classId, period, currentJobs, jobs);
  if (impact.hasImpact && !input.acknowledgeImpact) {
    throw new JobConfigurationImpactError(impact);
  }
  const materialized = materializeJobConfiguration(input.classId, jobs, allJobs);
  const remappedAssignmentCount = period && materialized.idMapping.length
    ? Number((await database().prepare(
      `SELECT COUNT(*) AS assignment_count
       FROM student_job_assignments
       WHERE period_id = ? AND class_id = ?
         AND class_job_id IN (${materialized.idMapping.map(() => "?").join(", ")})`,
    ).bind(
      period.id,
      input.classId,
      ...materialized.idMapping.map((mapping) => mapping.fromId),
    ).first<{ assignment_count: number }>())?.assignment_count ?? 0)
    : 0;
  const resultingPeriodRevision = period
    ? Number(period.revision) + (remappedAssignmentCount > 0 ? 1 : 0)
    : null;

  const now = Date.now();
  const currentTime = seoulServerTime(now);
  const nextSetupRevision = expectedSetupRevision + 1;
  const guardId = crypto.randomUUID();
  const diff = configurationDiff(currentJobs, jobs);
  const db = database();
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO registration_operation_guards (id, operation, created_at)
         SELECT (CASE WHEN
           EXISTS (
             SELECT 1 FROM classes
             WHERE id = ? AND teacher_id = ? AND status = 'active'
           )
           AND EXISTS (
             SELECT 1 FROM class_job_setup
             WHERE class_id = ? AND status = 'completed' AND revision = ?
           )
           AND COALESCE((
             SELECT period.id
             FROM class_job_assignment_periods period
             WHERE period.class_id = ? AND period.status = 'confirmed'
               AND period.assignment_type IN ('initial', 'monthly')
            AND (
                 period.assignment_year < ?
                 OR (period.assignment_year = ? AND period.assignment_month <= ?)
               )
             ORDER BY period.assignment_year DESC, period.assignment_month DESC,
                      COALESCE(period.confirmed_at, 0) DESC,
                      period.updated_at DESC, period.id DESC
             LIMIT 1
           ), '') = COALESCE(?, '')
           AND COALESCE((
             SELECT period.revision
             FROM class_job_assignment_periods period
             WHERE period.class_id = ? AND period.status = 'confirmed'
               AND period.assignment_type IN ('initial', 'monthly')
               AND (
                 period.assignment_year < ?
                 OR (period.assignment_year = ? AND period.assignment_month <= ?)
               )
             ORDER BY period.assignment_year DESC, period.assignment_month DESC,
                      COALESCE(period.confirmed_at, 0) DESC,
                      period.updated_at DESC, period.id DESC
             LIMIT 1
           ), -1) = ?
           AND NOT EXISTS (
             SELECT 1 FROM class_job_choice_sessions
             WHERE class_id = ? AND status = 'draft'
           )
           AND NOT EXISTS (
             SELECT 1 FROM class_job_choice_sessions session
             WHERE session.class_id = ? AND session.status = 'confirmed'
               AND (
                 ? IS NULL
                 OR session.target_year > ?
                 OR (session.target_year = ? AND session.target_month > ?)
               )
           )
           AND NOT EXISTS (
             SELECT 1 FROM class_job_change_plans plan
             WHERE plan.class_id = ? AND plan.status = 'applied'
               AND (
                 ? IS NULL
                 OR plan.target_year > ?
                 OR (plan.target_year = ? AND plan.target_month > ?)
               )
           )
           AND NOT EXISTS (
             SELECT 1 FROM class_job_evaluation_sessions
             WHERE class_id = ? AND status IN ('open', 'closed')
           )
           AND (
             ? IS NULL OR NOT EXISTS (
               SELECT 1 FROM class_job_month_closures
               WHERE class_id = ? AND source_period_id = ?
             )
           )
           AND (
             ? IS NULL OR NOT EXISTS (
               SELECT 1 FROM class_job_evaluation_sessions
               WHERE class_id = ? AND source_period_id = ? AND status = 'finalized'
             )
           )
           AND NOT EXISTS (
             SELECT 1 FROM class_job_assignment_periods period
             WHERE period.class_id = ? AND period.status = 'confirmed'
               AND period.assignment_type IN ('initial', 'monthly')
               AND (
                 period.assignment_year > ?
                 OR (period.assignment_year = ? AND period.assignment_month > ?)
               )
           )
           AND NOT EXISTS (
             SELECT 1 FROM class_job_assignment_periods period
             WHERE period.class_id = ? AND period.status = 'draft'
               AND period.assignment_type = 'initial'
               AND (
                 EXISTS (SELECT 1 FROM student_job_assignments a WHERE a.period_id = period.id)
                 OR EXISTS (SELECT 1 FROM job_assignment_candidates c WHERE c.period_id = period.id)
               )
           )
         THEN ? ELSE NULL END), 'job_configuration_apply_current', ?`,
      ).bind(
        input.classId,
        input.teacherId,
        input.classId,
        expectedSetupRevision,
        input.classId,
        currentTime.year,
        currentTime.year,
        currentTime.month,
        period?.id ?? null,
        input.classId,
        currentTime.year,
        currentTime.year,
        currentTime.month,
        Number(period?.revision ?? -1),
        input.classId,
        input.classId,
        period?.id ?? null,
        Number(period?.assignment_year ?? -1),
        Number(period?.assignment_year ?? -1),
        Number(period?.assignment_month ?? -1),
        input.classId,
        period?.id ?? null,
        Number(period?.assignment_year ?? -1),
        Number(period?.assignment_year ?? -1),
        Number(period?.assignment_month ?? -1),
        input.classId,
        period?.id ?? null,
        input.classId,
        period?.id ?? null,
        period?.id ?? null,
        input.classId,
        period?.id ?? null,
        input.classId,
        currentTime.year,
        currentTime.year,
        currentTime.month,
        input.classId,
        guardId,
        now,
      ),
      ...classJobWriteStatements({
        db,
        classId: input.classId,
        jobs: materialized.jobs,
        expectedSetupRevision,
        nextSetupRevision,
        studentCount,
        now,
        guardId,
      }),
      ...materialized.idMapping.flatMap((mapping) => period ? [db.prepare(
        `UPDATE student_job_assignments
         SET class_job_id = ?
         WHERE period_id = ? AND class_id = ? AND class_job_id = ?
           AND EXISTS (SELECT 1 FROM registration_operation_guards WHERE id = ?)`,
      ).bind(
        mapping.toId,
        period.id,
        input.classId,
        mapping.fromId,
        guardId,
      )] : []),
      ...(period && remappedAssignmentCount > 0 ? [db.prepare(
        `UPDATE class_job_assignment_periods
         SET revision = revision + 1, updated_at = ?
         WHERE id = ? AND class_id = ? AND status = 'confirmed' AND revision = ?
           AND EXISTS (SELECT 1 FROM registration_operation_guards WHERE id = ?)`,
      ).bind(
        now,
        period.id,
        input.classId,
        Number(period.revision),
        guardId,
      )] : []),
      db.prepare(
        `INSERT INTO audit_logs (
           id, teacher_id, class_id, student_id, action, detail, created_at
         )
         SELECT ?, ?, ?, NULL, 'job_configuration_applied_current', ?, ?
         WHERE EXISTS (SELECT 1 FROM registration_operation_guards WHERE id = ?)`,
      ).bind(
        crypto.randomUUID(),
        input.teacherId,
        input.classId,
        JSON.stringify({
          requestId,
          payloadHash: hash,
          expectedRevision: expectedSetupRevision,
          resultingRevision: nextSetupRevision,
          diff,
          impact,
          materializedIdMapping: materialized.idMapping,
          currentPeriodRemapCount: remappedAssignmentCount,
          resultingPeriodRevision,
        }),
        now,
        guardId,
      ),
      db.prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
    ]);
  } catch (error) {
    const racedReplay = await currentRequestReplay({
      classId: input.classId,
      requestId,
      hash,
    });
    if (racedReplay !== null) {
      return {
        idempotent: true,
        setupRevision: racedReplay.revision,
        impact: racedReplay.impact ?? impact,
        overview: await loadJobOverview(input.classId),
      };
    }
    if (isOperationGuardFailure(error)) {
      const latestWorkflow = await unsafeOpenWorkflow(input.classId);
      if (latestWorkflow.futurePeriodPending) {
        throw new ApiError(
          409,
          "앞으로 시작할 확정 배정이 생겨 현재 구성을 바꿀 수 없어요. 예정 월이 시작된 뒤 다음 달 구성으로 준비해 주세요.",
          "FUTURE_JOB_PERIOD_PENDING",
        );
      }
      if (hasUnsafeWorkflow(latestWorkflow)) {
        throw new ApiError(
          409,
          "진행 중인 배정 또는 평가가 생겼어요. 다음 달 반영으로 저장해 주세요.",
          "OPEN_JOB_WORKFLOW_IMPACT",
        );
      }
      throw new ApiError(
        409,
        "저장 직전에 직업 구성이 변경됐어요. 최신 화면을 확인해 주세요.",
        "JOB_CONFIG_STALE",
      );
    }
    throw error;
  }
  return {
    idempotent: false,
    setupRevision: nextSetupRevision,
    impact,
    overview: await loadJobOverview(input.classId),
  };
}

async function planRequestReplay(input: {
  classId: string;
  target: { year: number; month: number };
  requestId: string;
  hash: string;
}) {
  const detail = await requestAudit(
    input.classId,
    "job_configuration_plan_saved",
    input.requestId,
  );
  if (!detail) return null;
  if (
    detail.payloadHash !== input.hash
    || Number(detail.targetYear) !== input.target.year
    || Number(detail.targetMonth) !== input.target.month
  ) {
    throw new ApiError(
      409,
      "같은 저장 요청 번호가 다른 다음 달 구성에 이미 사용됐어요.",
      "JOB_PLAN_REQUEST_REUSED",
    );
  }
  const plan = await planRow(input.classId, input.target);
  if (!plan || Number(plan.revision) !== Number(detail.resultingRevision)) {
    throw new ApiError(
      409,
      "이 저장 요청 이후 다음 달 구성이 다시 변경됐어요. 최신 화면을 확인해 주세요.",
      "JOB_PLAN_REQUEST_REUSED",
    );
  }
  return plan;
}

export async function saveNextJobPlan(input: {
  classId: string;
  teacherId: string;
  expectedRevision: unknown;
  expectedSetupRevision: unknown;
  expectedTargetYear: unknown;
  expectedTargetMonth: unknown;
  requestId: unknown;
  jobs: unknown;
}) {
  await ensureSchema();
  const expectedRevision = requiredRevision(input.expectedRevision, "INVALID_JOB_PLAN_REVISION");
  const expectedSetupRevision = requiredRevision(
    input.expectedSetupRevision,
    "INVALID_JOB_SETUP_REVISION",
  );
  const expectedTarget = {
    year: requiredTargetPart(
      input.expectedTargetYear,
      2020,
      2100,
      "INVALID_JOB_PLAN_TARGET",
    ),
    month: requiredTargetPart(
      input.expectedTargetMonth,
      1,
      12,
      "INVALID_JOB_PLAN_TARGET",
    ),
  };
  const requestId = requiredRequestId(input.requestId);
  const jobs = validateJobDrafts(input.jobs);
  await assertClassJobDraftIds(input.classId, jobs);
  const serializedJobs = JSON.stringify(jobs);
  const hash = await payloadHash(serializedJobs);
  const replay = await planRequestReplay({
    classId: input.classId,
    target: expectedTarget,
    requestId,
    hash,
  });
  if (replay) {
    return {
      idempotent: true,
      plan: serializePlan(replay),
      overview: await loadJobOverview(input.classId),
    };
  }
  const period = await latestEffectiveJobPeriod(input.classId) ?? null;
  if (!period) {
    throw new ApiError(
      409,
      "첫 직업 배정을 확정한 뒤 다음 달 구성을 저장할 수 있어요.",
      "FIRST_ASSIGNMENT_REQUIRED",
    );
  }
  const target = nextMonth(Number(period.assignment_year), Number(period.assignment_month));
  const [setup, currentPlan, targetSession, targetPeriod] = await Promise.all([
    setupRow(input.classId),
    planRow(input.classId, target).then((row) => row ?? null),
    database().prepare(
      `SELECT id, status, target_year, target_month
       FROM class_job_choice_sessions
       WHERE class_id = ? AND target_year = ? AND target_month = ?`,
    ).bind(input.classId, target.year, target.month).first<ChoiceSessionRow>(),
    database().prepare(
      `SELECT id FROM class_job_assignment_periods
       WHERE class_id = ? AND assignment_year = ? AND assignment_month = ?
         AND status = 'confirmed' AND assignment_type IN ('initial', 'monthly')
       LIMIT 1`,
    ).bind(input.classId, target.year, target.month).first<{ id: string }>(),
  ]);
  if (!setup || setup.status !== "completed") {
    throw new ApiError(409, "우리 반 직업을 먼저 확정해 주세요.", "JOB_SETUP_REQUIRED");
  }
  if (
    Number(setup.revision) !== expectedSetupRevision
    || target.year !== expectedTarget.year
    || target.month !== expectedTarget.month
  ) {
    throw new ApiError(
      409,
      "현재 직업 구성이나 다음 달 기준이 바뀌었어요. 최신 화면을 확인해 주세요.",
      "JOB_PLAN_STALE",
    );
  }
  if (targetSession || targetPeriod) {
    throw new ApiError(
      409,
      "다음 달 직업 선택이 이미 시작되어 구성을 다시 저장할 수 없어요.",
      "JOB_PLAN_WORKFLOW_STARTED",
    );
  }
  if (currentPlan?.status === "applied") {
    throw new ApiError(
      409,
      "다음 달 구성이 이미 직업 선택에 반영됐어요.",
      "JOB_PLAN_ALREADY_APPLIED",
    );
  }
  if (Number(currentPlan?.revision ?? 0) !== expectedRevision) {
    throw new ApiError(
      409,
      "다른 화면에서 다음 달 구성이 먼저 저장됐어요. 최신 화면을 확인해 주세요.",
      "JOB_PLAN_STALE",
    );
  }

  const now = Date.now();
  const current = seoulServerTime(now);
  const expectedSource = previousMonth(expectedTarget.year, expectedTarget.month);
  const nextRevision = expectedRevision + 1;
  const planId = currentPlan?.id ?? crypto.randomUUID();
  const guardId = crypto.randomUUID();
  const db = database();
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO registration_operation_guards (id, operation, created_at)
         SELECT (CASE WHEN
           EXISTS (
             SELECT 1 FROM classes
             WHERE id = ? AND teacher_id = ? AND status = 'active'
           )
           AND EXISTS (
             SELECT 1 FROM class_job_setup
             WHERE class_id = ? AND status = 'completed' AND revision = ?
           )
           AND EXISTS (
             SELECT 1 FROM class_job_assignment_periods period
              WHERE period.id = ? AND period.class_id = ? AND period.status = 'confirmed'
                AND period.assignment_type IN ('initial', 'monthly')
                AND period.assignment_year = ? AND period.assignment_month = ?
                AND NOT EXISTS (
                 SELECT 1 FROM class_job_assignment_periods newer
                 WHERE newer.class_id = period.class_id AND newer.status = 'confirmed'
                   AND newer.assignment_type IN ('initial', 'monthly')
                   AND (
                     newer.assignment_year < ?
                     OR (newer.assignment_year = ? AND newer.assignment_month <= ?)
                   )
                   AND (
                     newer.assignment_year > period.assignment_year
                     OR (newer.assignment_year = period.assignment_year
                         AND newer.assignment_month > period.assignment_month)
                     OR (newer.assignment_year = period.assignment_year
                         AND newer.assignment_month = period.assignment_month
                         AND COALESCE(newer.confirmed_at, 0) > COALESCE(period.confirmed_at, 0))
                     OR (newer.assignment_year = period.assignment_year
                         AND newer.assignment_month = period.assignment_month
                         AND COALESCE(newer.confirmed_at, 0) = COALESCE(period.confirmed_at, 0)
                         AND newer.updated_at > period.updated_at)
                     OR (newer.assignment_year = period.assignment_year
                         AND newer.assignment_month = period.assignment_month
                         AND COALESCE(newer.confirmed_at, 0) = COALESCE(period.confirmed_at, 0)
                         AND newer.updated_at = period.updated_at AND newer.id > period.id)
                   )
               )
           )
           AND (
             (? = 0 AND NOT EXISTS (
               SELECT 1 FROM class_job_change_plans
               WHERE class_id = ? AND target_year = ? AND target_month = ?
             ))
             OR EXISTS (
               SELECT 1 FROM class_job_change_plans
               WHERE class_id = ? AND target_year = ? AND target_month = ?
                 AND status = 'draft' AND revision = ?
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM class_job_choice_sessions
              WHERE class_id = ? AND target_year = ? AND target_month = ?
            )
            AND NOT EXISTS (
              SELECT 1 FROM class_job_assignment_periods
              WHERE class_id = ? AND assignment_year = ? AND assignment_month = ?
                AND status = 'confirmed' AND assignment_type IN ('initial', 'monthly')
            )
          THEN ? ELSE NULL END), 'job_configuration_plan_save', ?`,
      ).bind(
        input.classId,
        input.teacherId,
        input.classId,
        expectedSetupRevision,
        period.id,
        input.classId,
        expectedSource.year,
        expectedSource.month,
        current.year,
        current.year,
        current.month,
        expectedRevision,
        input.classId,
        target.year,
        target.month,
        input.classId,
        target.year,
        target.month,
        expectedRevision,
        input.classId,
        target.year,
        target.month,
        input.classId,
        target.year,
        target.month,
        guardId,
        now,
      ),
      db.prepare(
         `INSERT INTO class_job_change_plans (
            id, class_id, target_year, target_month, jobs_json,
            previous_jobs_json, applied_jobs_json, status,
            base_setup_revision, revision, created_by_teacher_id,
            applied_by_teacher_id, applied_at, created_at, updated_at
          )
          SELECT ?, ?, ?, ?, ?, NULL, NULL, 'draft', ?, ?, ?, NULL, NULL, ?, ?
         WHERE EXISTS (SELECT 1 FROM registration_operation_guards WHERE id = ?)
         ON CONFLICT(class_id, target_year, target_month) DO UPDATE SET
            jobs_json = excluded.jobs_json,
            previous_jobs_json = NULL,
            applied_jobs_json = NULL,
           status = 'draft',
           base_setup_revision = excluded.base_setup_revision,
           revision = excluded.revision,
           applied_by_teacher_id = NULL,
           applied_at = NULL,
           updated_at = excluded.updated_at`,
      ).bind(
        planId,
        input.classId,
        target.year,
        target.month,
        serializedJobs,
        expectedSetupRevision,
        nextRevision,
        input.teacherId,
        now,
        now,
        guardId,
      ),
      db.prepare(
        `INSERT INTO audit_logs (
           id, teacher_id, class_id, student_id, action, detail, created_at
         )
         SELECT ?, ?, ?, NULL, 'job_configuration_plan_saved', ?, ?
         WHERE EXISTS (SELECT 1 FROM registration_operation_guards WHERE id = ?)`,
      ).bind(
        crypto.randomUUID(),
        input.teacherId,
        input.classId,
        JSON.stringify({
          requestId,
          payloadHash: hash,
          targetYear: target.year,
          targetMonth: target.month,
          expectedSetupRevision,
          expectedTargetYear: expectedTarget.year,
          expectedTargetMonth: expectedTarget.month,
          expectedRevision,
          resultingRevision: nextRevision,
          jobCount: jobs.length,
          capacity: sumJobCapacity(jobs),
        }),
        now,
        guardId,
      ),
      db.prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
    ]);
  } catch (error) {
    const racedReplay = await planRequestReplay({
      classId: input.classId,
      target,
      requestId,
      hash,
    });
    if (racedReplay) {
      return {
        idempotent: true,
        plan: serializePlan(racedReplay),
        overview: await loadJobOverview(input.classId),
      };
    }
    if (isOperationGuardFailure(error)) {
      const racedWorkflow = await database().prepare(
        `SELECT id FROM class_job_choice_sessions
         WHERE class_id = ? AND target_year = ? AND target_month = ?
         UNION ALL
         SELECT id FROM class_job_assignment_periods
         WHERE class_id = ? AND assignment_year = ? AND assignment_month = ?
           AND status = 'confirmed' AND assignment_type IN ('initial', 'monthly')
         LIMIT 1`,
      ).bind(
        input.classId,
        target.year,
        target.month,
        input.classId,
        target.year,
        target.month,
      ).first<{ id: string }>();
      if (racedWorkflow) {
        throw new ApiError(
          409,
          "다음 달 직업 선택이 이미 시작되어 구성을 다시 저장할 수 없어요.",
          "JOB_PLAN_WORKFLOW_STARTED",
        );
      }
      throw new ApiError(
        409,
        "저장 직전에 기준 월이나 다음 달 구성이 변경됐어요. 최신 화면을 확인해 주세요.",
        "JOB_PLAN_STALE",
      );
    }
    throw error;
  }
  const saved = await planRow(input.classId, target);
  return {
    idempotent: false,
    plan: serializePlan(saved ?? null),
    overview: await loadJobOverview(input.classId),
  };
}

export async function applyDraftJobPlanForTarget(input: {
  classId: string;
  teacherId: string;
  targetYear: number;
  targetMonth: number;
  expectedSourcePeriodId: string;
  expectedClosureId: string;
}) {
  await ensureSchema();
  const target = { year: input.targetYear, month: input.targetMonth };
  const plan = await planRow(input.classId, target);
  if (!plan) return { applied: false, idempotent: false, setupRevision: null };
  if (plan.status === "applied") {
    return {
      applied: false,
      idempotent: true,
      setupRevision: Number((await setupRow(input.classId))?.revision ?? 0),
    };
  }
  const targetPeriod = await database().prepare(
    `SELECT id FROM class_job_assignment_periods
     WHERE class_id = ? AND assignment_year = ? AND assignment_month = ?
       AND status = 'confirmed' AND assignment_type IN ('initial', 'monthly')
     LIMIT 1`,
  ).bind(input.classId, target.year, target.month).first<{ id: string }>();
  if (targetPeriod) {
    throw new ApiError(
      409,
      "해당 월의 직업 배정이 이미 확정되어 다음 달 구성을 적용할 수 없어요.",
      "JOB_PLAN_APPLY_STALE",
    );
  }
  const plannedJobs = storedPlanJobs(plan);
  if (!plannedJobs.length) {
    throw new ApiError(409, "다음 달 직업 구성이 비어 있어요.", "JOB_PLAN_DATA_INVALID");
  }
  await assertClassJobDraftIds(input.classId, plannedJobs);
  const [setup, studentCount, currentJobs, allJobs] = await Promise.all([
    setupRow(input.classId),
    eligibleStudentCount(input.classId),
    activeClassJobRows(input.classId),
    allClassJobRows(input.classId),
  ]);
  if (!setup || setup.status !== "completed") {
    throw new ApiError(409, "우리 반 직업을 먼저 확정해 주세요.", "JOB_SETUP_REQUIRED");
  }
  if (Number(plan.base_setup_revision) !== Number(setup.revision)) {
    throw new ApiError(
      409,
      "현재 직업 구성이 바뀌어 다음 달 구성을 다시 저장해야 해요.",
      "JOB_PLAN_BASE_STALE",
    );
  }
  const expectedSetupRevision = Number(setup.revision);
  const nextSetupRevision = expectedSetupRevision + 1;
  const materialized = materializeJobConfiguration(input.classId, plannedJobs, allJobs);
  const previousJobs = currentJobs.map(jobRowAsDraft);
  const serializedPreviousJobs = JSON.stringify(previousJobs);
  const serializedAppliedJobs = JSON.stringify(materialized.jobs);
  const now = Date.now();
  const current = seoulServerTime(now);
  const expectedSource = previousMonth(target.year, target.month);
  const guardId = crypto.randomUUID();
  const db = database();
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO registration_operation_guards (id, operation, created_at)
         SELECT (CASE WHEN
           EXISTS (
             SELECT 1 FROM classes
             WHERE id = ? AND teacher_id = ? AND status = 'active'
           )
           AND EXISTS (
             SELECT 1 FROM class_job_setup
             WHERE class_id = ? AND status = 'completed' AND revision = ?
           )
           AND EXISTS (
              SELECT 1 FROM class_job_change_plans
              WHERE id = ? AND class_id = ? AND target_year = ? AND target_month = ?
                AND status = 'draft' AND revision = ? AND base_setup_revision = ?
           )
           AND EXISTS (
             SELECT 1 FROM class_job_month_closures closure
             JOIN class_job_assignment_periods period
               ON period.id = closure.source_period_id
              AND period.class_id = closure.class_id
             WHERE closure.id = ? AND closure.class_id = ?
               AND period.id = ? AND period.status = 'confirmed'
               AND period.assignment_type IN ('initial', 'monthly')
               AND period.assignment_year = ? AND period.assignment_month = ?
               AND (
                 period.assignment_year < ?
                 OR (period.assignment_year = ? AND period.assignment_month <= ?)
               )
               AND NOT EXISTS (
                 SELECT 1 FROM class_job_assignment_periods newer
                 WHERE newer.class_id = period.class_id AND newer.status = 'confirmed'
                   AND newer.assignment_type IN ('initial', 'monthly')
                   AND (
                     newer.assignment_year < ?
                     OR (newer.assignment_year = ? AND newer.assignment_month <= ?)
                   )
                   AND (
                     newer.assignment_year > period.assignment_year
                     OR (newer.assignment_year = period.assignment_year
                         AND newer.assignment_month > period.assignment_month)
                     OR (newer.assignment_year = period.assignment_year
                         AND newer.assignment_month = period.assignment_month
                         AND COALESCE(newer.confirmed_at, 0) > COALESCE(period.confirmed_at, 0))
                     OR (newer.assignment_year = period.assignment_year
                         AND newer.assignment_month = period.assignment_month
                         AND COALESCE(newer.confirmed_at, 0) = COALESCE(period.confirmed_at, 0)
                         AND newer.updated_at > period.updated_at)
                     OR (newer.assignment_year = period.assignment_year
                         AND newer.assignment_month = period.assignment_month
                         AND COALESCE(newer.confirmed_at, 0) = COALESCE(period.confirmed_at, 0)
                         AND newer.updated_at = period.updated_at AND newer.id > period.id)
                   )
               )
           )
           AND NOT EXISTS (
             SELECT 1 FROM class_job_choice_sessions
             WHERE class_id = ? AND target_year = ? AND target_month = ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM class_job_assignment_periods
             WHERE class_id = ? AND assignment_year = ? AND assignment_month = ?
               AND status = 'confirmed' AND assignment_type IN ('initial', 'monthly')
           )
         THEN ? ELSE NULL END), 'job_configuration_plan_apply', ?`,
      ).bind(
        input.classId,
        input.teacherId,
        input.classId,
        expectedSetupRevision,
        plan.id,
        input.classId,
        target.year,
        target.month,
        Number(plan.revision),
        expectedSetupRevision,
        input.expectedClosureId,
        input.classId,
        input.expectedSourcePeriodId,
        expectedSource.year,
        expectedSource.month,
        current.year,
        current.year,
        current.month,
        current.year,
        current.year,
        current.month,
        input.classId,
        target.year,
        target.month,
        input.classId,
        target.year,
        target.month,
        guardId,
        now,
      ),
      ...classJobWriteStatements({
        db,
        classId: input.classId,
        jobs: materialized.jobs,
        expectedSetupRevision,
        nextSetupRevision,
        studentCount,
        now,
        guardId,
      }),
      db.prepare(
        `UPDATE class_job_change_plans
         SET jobs_json = ?, previous_jobs_json = ?, applied_jobs_json = ?,
             status = 'applied', applied_by_teacher_id = ?, applied_at = ?, updated_at = ?
         WHERE id = ? AND class_id = ? AND status = 'draft' AND revision = ?
           AND base_setup_revision = ?
           AND EXISTS (SELECT 1 FROM registration_operation_guards WHERE id = ?)`,
      ).bind(
        serializedAppliedJobs,
        serializedPreviousJobs,
        serializedAppliedJobs,
        input.teacherId,
        now,
        now,
        plan.id,
        input.classId,
        Number(plan.revision),
        expectedSetupRevision,
        guardId,
      ),
      db.prepare(
        `INSERT INTO audit_logs (
           id, teacher_id, class_id, student_id, action, detail, created_at
         )
         SELECT ?, ?, ?, NULL, 'job_configuration_plan_applied', ?, ?
         WHERE EXISTS (SELECT 1 FROM registration_operation_guards WHERE id = ?)`,
      ).bind(
        crypto.randomUUID(),
        input.teacherId,
        input.classId,
        JSON.stringify({
          planId: plan.id,
          planRevision: Number(plan.revision),
          targetYear: target.year,
          targetMonth: target.month,
          expectedSetupRevision,
          resultingRevision: nextSetupRevision,
          jobCount: materialized.jobs.length,
          capacity: sumJobCapacity(materialized.jobs),
          materializedIdMapping: materialized.idMapping,
        }),
        now,
        guardId,
      ),
      db.prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
    ]);
  } catch (error) {
    const latest = await planRow(input.classId, target);
    if (latest?.status === "applied") {
      return {
        applied: false,
        idempotent: true,
        setupRevision: Number((await setupRow(input.classId))?.revision ?? 0),
      };
    }
    if (isOperationGuardFailure(error)) {
      const latestSetup = await setupRow(input.classId);
      if (
        latest
        && Number(latest.base_setup_revision) !== Number(latestSetup?.revision ?? -1)
      ) {
        throw new ApiError(
          409,
          "현재 직업 구성이 바뀌어 다음 달 구성을 다시 저장해야 해요.",
          "JOB_PLAN_BASE_STALE",
        );
      }
      throw new ApiError(
        409,
        "다음 달 구성을 적용하는 동안 직업 또는 선택 상태가 변경됐어요.",
        "JOB_PLAN_APPLY_STALE",
      );
    }
    throw error;
  }
  return { applied: true, idempotent: false, setupRevision: nextSetupRevision };
}
