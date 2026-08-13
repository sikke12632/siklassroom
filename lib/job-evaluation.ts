import { database, ensureSchema, isOperationGuardFailure } from "./database";
import {
  calculateJobEvaluationResults,
  type JobEvaluationJob,
  type JobEvaluationResult,
  type JobEvaluationScore,
  type JobGrade,
} from "./job-evaluation-rules";
import { ApiError } from "./responses";
import { seoulServerTime } from "./seoul-time";

type EvaluationStatus = "open" | "closed" | "finalized";

type EvaluationSessionRow = {
  id: string;
  class_id: string;
  source_period_id: string;
  source_year: number;
  source_month: number;
  status: EvaluationStatus;
  jobs_json: string;
  student_ids_json: string;
  student_count_snapshot: number;
  job_count_snapshot: number;
  source_period_revision: number;
  job_setup_revision: number;
  revision: number;
  response_revision: number;
  calculated_response_revision: number | null;
  algorithm_version: string;
  final_grades_json: string | null;
  opened_by_teacher_id: string;
  opened_at: number;
  closed_by_teacher_id: string | null;
  closed_at: number | null;
  finalized_by_teacher_id: string | null;
  finalized_at: number | null;
  created_at: number;
  updated_at: number;
};

type EvaluationResponseRow = {
  id: string;
  session_id: string;
  class_id: string;
  student_id: string;
  student_number: number;
  student_name: string;
  scores_json: string;
  revision: number;
  request_id: string;
  write_nonce: string;
  submitted_at: number;
  updated_at: number;
};

type EvaluationResultRow = {
  class_job_id: string;
  job_name: string;
  hard_average: number;
  responsibility_average: number;
  consistency_average: number;
  burden_average: number;
  total_average: number;
  response_count: number;
  rank: number;
  recommended_grade: JobGrade;
  cutoff_tie: number;
};

type SourcePeriodRow = {
  id: string;
  class_id: string;
  assignment_year: number;
  assignment_month: number;
  revision: number;
  assignment_count: number;
};

type StudentSnapshotRow = {
  id: string;
  student_number: number;
  official_name: string;
  status: string;
};

type SourceJobRow = {
  id: string;
  name: string;
  description: string;
  sort_order: number;
};

export type TeacherJobEvaluation = {
  id: string;
  sourcePeriodId: string;
  sourceYear: number;
  sourceMonth: number;
  status: EvaluationStatus;
  revision: number;
  responseRevision: number;
  calculatedResponseRevision: number | null;
  algorithmVersion: string;
  openedAt: number;
  closedAt: number | null;
  finalizedAt: number | null;
  studentCountSnapshot: number;
  submittedCount: number;
  missingStudents: Array<{
    id: string;
    studentNumber: number | null;
    name: string;
  }>;
  rosterChanged: boolean;
  jobsChanged: boolean;
  cutoffTie: boolean;
  jobs: Array<JobEvaluationJob & {
    responseCount: number;
    hardAverage: number | null;
    responsibilityAverage: number | null;
    consistencyAverage: number | null;
    burdenAverage: number | null;
    totalAverage: number | null;
    rank: number | null;
    recommendedGrade: JobGrade | null;
    finalGrade: JobGrade | null;
    cutoffTie: boolean;
  }>;
};

export type StudentJobEvaluation = {
  id: string;
  sourcePeriodId: string;
  year: number;
  month: number;
  status: EvaluationStatus;
  revision: number;
  jobs: JobEvaluationJob[];
  submission: null | {
    submittedAt: number;
    revision: number;
    scores: Array<{ classJobId: string } & JobEvaluationScore>;
  };
};

const SESSION_SELECT = `
  SELECT id, class_id, source_period_id, source_year, source_month, status,
         jobs_json, student_ids_json, student_count_snapshot, job_count_snapshot,
         source_period_revision, job_setup_revision, revision, response_revision,
         calculated_response_revision, algorithm_version, final_grades_json,
         opened_by_teacher_id, opened_at, closed_by_teacher_id, closed_at,
         finalized_by_teacher_id, finalized_at, created_at, updated_at
  FROM class_job_evaluation_sessions
`;

const RESPONSE_SELECT = `
  SELECT id, session_id, class_id, student_id, student_number, student_name,
         scores_json, revision, request_id, write_nonce, submitted_at, updated_at
  FROM class_job_evaluation_responses
`;

function validRevision(value: unknown, code = "JOB_EVALUATION_STALE") {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new ApiError(400, "평가 화면의 저장 버전을 확인할 수 없어요.", code);
  }
  return revision;
}

function textId(value: unknown, message: string, code: string, maxLength = 120) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id.length > maxLength) throw new ApiError(400, message, code);
  return id;
}

function parseStudentIds(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && Boolean(item));
  } catch {
    return [];
  }
}

function parseJobs(value: string): JobEvaluationJob[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((raw): JobEvaluationJob[] => {
      if (!raw || typeof raw !== "object") return [];
      const item = raw as Partial<JobEvaluationJob>;
      if (
        typeof item.classJobId !== "string"
        || typeof item.name !== "string"
        || typeof item.description !== "string"
        || !Number.isInteger(Number(item.sortOrder))
      ) {
        return [];
      }
      return [{
        classJobId: item.classJobId,
        name: item.name,
        description: item.description,
        sortOrder: Number(item.sortOrder),
      }];
    });
  } catch {
    return [];
  }
}

function parseFinalGrades(value: string | null, jobs: JobEvaluationJob[]) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const raw = parsed as Record<string, unknown>;
    const result = Object.create(null) as Record<string, JobGrade>;
    for (const job of jobs) {
      const grade = raw[job.classJobId];
      if (grade !== "A" && grade !== "B" && grade !== "C") return null;
      result[job.classJobId] = grade;
    }
    return result;
  } catch {
    return null;
  }
}

function normalizeScore(raw: unknown, jobName: string): JobEvaluationScore {
  const item = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const score = {
    hard: Number(item.hard),
    responsibility: Number(item.responsibility),
    consistency: Number(item.consistency),
    burden: Number(item.burden),
  };
  if (Object.values(score).some((value) => !Number.isInteger(value) || value < 1 || value > 5)) {
    throw new ApiError(
      400,
      `${jobName}의 네 평가 점수를 모두 1~5점으로 선택해 주세요.`,
      "INVALID_JOB_EVALUATION_SCORES",
    );
  }
  return score;
}

function parseSubmittedScores(
  value: unknown,
  jobs: JobEvaluationJob[],
) {
  if (!Array.isArray(value)) {
    throw new ApiError(
      400,
      "직업별 평가 점수를 다시 확인해 주세요.",
      "INVALID_JOB_EVALUATION_SCORES",
    );
  }
  const expectedIds = new Set(jobs.map((job) => job.classJobId));
  const seen = new Set<string>();
  const byId = new Map(jobs.map((job) => [job.classJobId, job]));
  const scores = value.map((raw) => {
    const item = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    const classJobId = textId(
      item.classJobId,
      "평가할 직업 정보를 다시 확인해 주세요.",
      "INVALID_JOB_EVALUATION_SCORES",
    );
    const job = byId.get(classJobId);
    if (!job || !expectedIds.has(classJobId) || seen.has(classJobId)) {
      throw new ApiError(
        400,
        "직업이 빠졌거나 중복된 평가가 있어요.",
        "INVALID_JOB_EVALUATION_SCORES",
      );
    }
    seen.add(classJobId);
    return { classJobId, ...normalizeScore(item, job.name) };
  });
  if (scores.length !== jobs.length || seen.size !== jobs.length) {
    throw new ApiError(
      400,
      "모든 직업을 하나씩 평가해 주세요.",
      "INVALID_JOB_EVALUATION_SCORES",
    );
  }
  return jobs.map((job) => scores.find((score) => score.classJobId === job.classJobId)!);
}

function parseStoredScores(value: string, jobs: JobEvaluationJob[]) {
  return parseSubmittedScores(JSON.parse(value) as unknown, jobs);
}

function scoreRecord(
  scores: Array<{ classJobId: string } & JobEvaluationScore>,
) {
  return Object.fromEntries(
    scores.map(({ classJobId, ...score }) => [classJobId, score]),
  );
}

async function sessionForSource(classId: string, sourcePeriodId: string) {
  return database().prepare(
    `${SESSION_SELECT} WHERE class_id = ? AND source_period_id = ?`,
  ).bind(classId, sourcePeriodId).first<EvaluationSessionRow>();
}

async function sessionById(sessionId: string) {
  return database().prepare(
    `${SESSION_SELECT} WHERE id = ?`,
  ).bind(sessionId).first<EvaluationSessionRow>();
}

async function evaluationResponses(sessionId: string) {
  const result = await database().prepare(
    `${RESPONSE_SELECT} WHERE session_id = ? ORDER BY submitted_at, student_number, student_id`,
  ).bind(sessionId).all<EvaluationResponseRow>();
  return result.results;
}

async function evaluationResults(sessionId: string) {
  const result = await database().prepare(
    `SELECT class_job_id, job_name, hard_average, responsibility_average,
            consistency_average, burden_average, total_average, response_count,
            rank, recommended_grade, cutoff_tie
     FROM class_job_evaluation_results
     WHERE session_id = ?
     ORDER BY rank, job_name, class_job_id`,
  ).bind(sessionId).all<EvaluationResultRow>();
  return result.results;
}

async function classStudents(classId: string, activeOnly = false) {
  const result = await database().prepare(
    `SELECT id, student_number, official_name, status
     FROM students
     WHERE class_id = ? ${activeOnly ? "AND status <> 'excluded'" : ""}
     ORDER BY student_number, official_name, id`,
  ).bind(classId).all<StudentSnapshotRow>();
  return result.results;
}

async function currentJobSetup(classId: string) {
  return database().prepare(
    `SELECT status, revision FROM class_job_setup WHERE class_id = ?`,
  ).bind(classId).first<{ status: string; revision: number }>();
}

async function currentActiveJobIds(classId: string) {
  const result = await database().prepare(
    `SELECT id FROM class_jobs WHERE class_id = ? AND is_active = 1 ORDER BY sort_order, id`,
  ).bind(classId).all<{ id: string }>();
  return result.results.map((job) => job.id);
}

async function sourcePeriod(classId: string, epochMs = Date.now()) {
  const current = seoulServerTime(epochMs);
  return database().prepare(
    `SELECT p.id, p.class_id, p.assignment_year, p.assignment_month, p.revision,
            (SELECT COUNT(*) FROM student_job_assignments a WHERE a.period_id = p.id) AS assignment_count
     FROM class_job_assignment_periods p
     WHERE p.class_id = ? AND p.status = 'confirmed'
       AND p.assignment_type IN ('initial', 'monthly')
       AND (
         p.assignment_year < ?
         OR (p.assignment_year = ? AND p.assignment_month <= ?)
       )
     ORDER BY p.assignment_year DESC, p.assignment_month DESC,
              p.confirmed_at DESC, p.updated_at DESC, p.id DESC
     LIMIT 1`,
  ).bind(classId, current.year, current.year, current.month).first<SourcePeriodRow>();
}

async function sourceJobs(periodId: string) {
  const result = await database().prepare(
    `SELECT j.id, j.name, j.description, j.sort_order
     FROM student_job_assignments a
     JOIN class_jobs j ON j.id = a.class_job_id AND j.class_id = a.class_id
     WHERE a.period_id = ?
     GROUP BY j.id, j.name, j.description, j.sort_order
     ORDER BY j.sort_order, j.name, j.id`,
  ).bind(periodId).all<SourceJobRow>();
  return result.results.map((job): JobEvaluationJob => ({
    classJobId: job.id,
    name: job.name,
    description: job.description,
    sortOrder: Number(job.sort_order),
  }));
}

async function teacherEvaluationFromRow(
  session: EvaluationSessionRow,
): Promise<TeacherJobEvaluation> {
  const jobs = parseJobs(session.jobs_json);
  const studentIds = parseStudentIds(session.student_ids_json);
  const [responses, results, allStudents, setup, activeJobIds] = await Promise.all([
    evaluationResponses(session.id),
    evaluationResults(session.id),
    classStudents(session.class_id),
    currentJobSetup(session.class_id),
    currentActiveJobIds(session.class_id),
  ]);
  const responseStudentIds = new Set(responses.map((response) => response.student_id));
  const studentById = new Map(allStudents.map((student) => [student.id, student]));
  const missingStudents = studentIds
    .filter((studentId) => !responseStudentIds.has(studentId))
    .map((studentId) => {
      const student = studentById.get(studentId);
      return {
        id: studentId,
        studentNumber: student ? Number(student.student_number) : null,
        name: student?.official_name ?? "명단에서 제외된 학생",
      };
    })
    .sort((left, right) => (
      (left.studentNumber ?? Number.MAX_SAFE_INTEGER) - (right.studentNumber ?? Number.MAX_SAFE_INTEGER)
      || left.name.localeCompare(right.name, "ko")
      || left.id.localeCompare(right.id)
    ));
  const resultByJob = new Map(results.map((result) => [result.class_job_id, result]));
  const finalGrades = parseFinalGrades(session.final_grades_json, jobs);
  const activeStudentIds = new Set(
    allStudents.filter((student) => student.status !== "excluded").map((student) => student.id),
  );
  const snapshotStudentIds = new Set(studentIds);
  const rosterChanged = activeStudentIds.size !== snapshotStudentIds.size
    || [...activeStudentIds].some((studentId) => !snapshotStudentIds.has(studentId));
  const snapshotJobIds = new Set(jobs.map((job) => job.classJobId));
  const jobsChanged = Number(setup?.revision ?? -1) !== Number(session.job_setup_revision)
    || activeJobIds.length !== snapshotJobIds.size
    || activeJobIds.some((jobId) => !snapshotJobIds.has(jobId));
  return {
    id: session.id,
    sourcePeriodId: session.source_period_id,
    sourceYear: Number(session.source_year),
    sourceMonth: Number(session.source_month),
    status: session.status,
    revision: Number(session.revision),
    responseRevision: Number(session.response_revision),
    calculatedResponseRevision: session.calculated_response_revision === null
      ? null
      : Number(session.calculated_response_revision),
    algorithmVersion: session.algorithm_version,
    openedAt: Number(session.opened_at),
    closedAt: session.closed_at === null ? null : Number(session.closed_at),
    finalizedAt: session.finalized_at === null ? null : Number(session.finalized_at),
    studentCountSnapshot: Number(session.student_count_snapshot),
    submittedCount: responses.length,
    missingStudents,
    rosterChanged,
    jobsChanged,
    cutoffTie: results.some((result) => Boolean(result.cutoff_tie)),
    jobs: jobs.map((job) => {
      const result = resultByJob.get(job.classJobId);
      return {
        ...job,
        responseCount: result ? Number(result.response_count) : 0,
        hardAverage: result ? Number(result.hard_average) : null,
        responsibilityAverage: result ? Number(result.responsibility_average) : null,
        consistencyAverage: result ? Number(result.consistency_average) : null,
        burdenAverage: result ? Number(result.burden_average) : null,
        totalAverage: result ? Number(result.total_average) : null,
        rank: result ? Number(result.rank) : null,
        recommendedGrade: result?.recommended_grade ?? null,
        finalGrade: finalGrades?.[job.classJobId] ?? result?.recommended_grade ?? null,
        cutoffTie: Boolean(result?.cutoff_tie),
      };
    }),
  };
}

export async function loadTeacherJobEvaluation(
  classId: string,
  sourcePeriodId: string | null,
) {
  await ensureSchema();
  if (!sourcePeriodId) return null;
  const session = await sessionForSource(classId, sourcePeriodId);
  return session ? teacherEvaluationFromRow(session) : null;
}

export async function loadLatestTeacherJobEvaluation(classId: string) {
  await ensureSchema();
  const source = await sourcePeriod(classId);
  return {
    sourcePeriod: source ? {
      id: source.id,
      year: Number(source.assignment_year),
      month: Number(source.assignment_month),
      revision: Number(source.revision),
    } : null,
    evaluation: source
      ? await loadTeacherJobEvaluation(classId, source.id)
      : null,
  };
}

export async function openJobEvaluation(input: {
  classId: string;
  teacherId: string;
  expectedSourcePeriodId: unknown;
  expectedSourcePeriodRevision: unknown;
}) {
  await ensureSchema();
  const expectedSourcePeriodId = textId(
    input.expectedSourcePeriodId,
    "평가할 직업 배정 월을 다시 확인해 주세요.",
    "INVALID_JOB_EVALUATION_SOURCE",
  );
  const expectedSourcePeriodRevision = validRevision(
    input.expectedSourcePeriodRevision,
    "INVALID_JOB_EVALUATION_SOURCE",
  );
  const latest = await sourcePeriod(input.classId);
  if (
    !latest
    || latest.id !== expectedSourcePeriodId
    || Number(latest.revision) !== expectedSourcePeriodRevision
  ) {
    throw new ApiError(
      409,
      "평가 기준이 되는 직업 배정이 바뀌었어요. 최신 화면을 확인해 주세요.",
      "JOB_EVALUATION_STALE",
    );
  }
  const existing = await sessionForSource(input.classId, latest.id);
  if (existing) {
    return {
      idempotent: true,
      evaluation: await teacherEvaluationFromRow(existing),
    };
  }
  const closure = await database().prepare(
    `SELECT id FROM class_job_month_closures WHERE class_id = ? AND source_period_id = ?`,
  ).bind(input.classId, latest.id).first();
  if (closure) {
    throw new ApiError(
      409,
      "이미 마감한 달은 새 평가를 열 수 없어요.",
      "JOB_EVALUATION_FINALIZED",
    );
  }
  const [students, jobs, setup] = await Promise.all([
    classStudents(input.classId, true),
    sourceJobs(latest.id),
    currentJobSetup(input.classId),
  ]);
  if (!students.length) {
    throw new ApiError(409, "평가에 참여할 학생이 없어요.", "NO_ACTIVE_STUDENTS");
  }
  if (!jobs.length || Number(latest.assignment_count) < 1) {
    throw new ApiError(
      409,
      "평가할 지난달 직업 배정 기록이 없어요.",
      "JOB_EVALUATION_SOURCE_REQUIRED",
    );
  }
  if (!setup || setup.status !== "completed") {
    throw new ApiError(409, "우리 반 직업을 먼저 확정해 주세요.", "JOB_SETUP_REQUIRED");
  }
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  const current = seoulServerTime(now);
  const guardId = crypto.randomUUID();
  const db = database();
  let results: D1Result<unknown>[];
  try {
    results = await db.batch([
      db.prepare(
        `INSERT OR IGNORE INTO class_job_evaluation_sessions (
           id, class_id, source_period_id, source_year, source_month, status,
           jobs_json, student_ids_json, student_count_snapshot, job_count_snapshot,
           source_period_revision, job_setup_revision, revision, response_revision,
           calculated_response_revision, algorithm_version, final_grades_json,
           opened_by_teacher_id, opened_at, closed_by_teacher_id, closed_at,
           finalized_by_teacher_id, finalized_at, created_at, updated_at
         )
         SELECT ?, ?, p.id, p.assignment_year, p.assignment_month, 'open',
                ?, ?, ?, ?, p.revision, ?, 0, 0, NULL, 'legacy-rank-v1', NULL,
                ?, ?, NULL, NULL, NULL, NULL, ?, ?
         FROM class_job_assignment_periods p
         WHERE p.id = ? AND p.class_id = ? AND p.status = 'confirmed' AND p.revision = ?
           AND p.assignment_type IN ('initial', 'monthly')
           AND p.id = (
             SELECT eligible.id
             FROM class_job_assignment_periods eligible
             WHERE eligible.class_id = ? AND eligible.status = 'confirmed'
               AND eligible.assignment_type IN ('initial', 'monthly')
               AND (
                 eligible.assignment_year < ?
                 OR (eligible.assignment_year = ? AND eligible.assignment_month <= ?)
               )
             ORDER BY eligible.assignment_year DESC, eligible.assignment_month DESC,
                      eligible.confirmed_at DESC, eligible.updated_at DESC, eligible.id DESC
             LIMIT 1
           )
           AND NOT EXISTS (
             SELECT 1 FROM class_job_month_closures closure
             WHERE closure.class_id = ? AND closure.source_period_id = p.id
           )
           AND (SELECT COUNT(*) FROM student_job_assignments a WHERE a.period_id = p.id) = ?
           AND (SELECT COUNT(*) FROM students student
                WHERE student.class_id = p.class_id AND student.status <> 'excluded') = ?
           AND EXISTS (
             SELECT 1 FROM class_job_setup current_setup
             WHERE current_setup.class_id = p.class_id
               AND current_setup.status = 'completed' AND current_setup.revision = ?
           )`,
      ).bind(
    sessionId,
    input.classId,
    JSON.stringify(jobs),
    JSON.stringify(students.map((student) => student.id)),
    students.length,
    jobs.length,
    Number(setup.revision),
    input.teacherId,
    now,
    now,
    now,
    latest.id,
    input.classId,
    expectedSourcePeriodRevision,
    input.classId,
    current.year,
    current.year,
    current.month,
    input.classId,
    Number(latest.assignment_count),
    students.length,
    Number(setup.revision),
      ),
      db.prepare(
        `INSERT INTO registration_operation_guards (id, operation, created_at)
         SELECT CASE WHEN EXISTS (
           SELECT 1 FROM class_job_evaluation_sessions
           WHERE class_id = ? AND source_period_id = ?
         ) THEN ? ELSE NULL END, 'job_evaluation_open', ?`,
      ).bind(input.classId, latest.id, guardId, now),
      db.prepare(
        `INSERT INTO audit_logs (
           id, teacher_id, class_id, student_id, action, detail, created_at
         )
         SELECT ?, ?, ?, NULL, 'job_evaluation_opened', ?, ?
         WHERE EXISTS (
           SELECT 1 FROM class_job_evaluation_sessions WHERE id = ? AND class_id = ?
         )`,
      ).bind(
        crypto.randomUUID(),
        input.teacherId,
        input.classId,
        JSON.stringify({ evaluationId: sessionId, idempotent: false }),
        now,
        sessionId,
        input.classId,
      ),
      db.prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
    ]);
  } catch (error) {
    if (isOperationGuardFailure(error)) {
      throw new ApiError(
        409,
        "평가를 여는 동안 지난달 배정이 바뀌었어요.",
        "JOB_EVALUATION_STALE",
      );
    }
    throw error;
  }
  const created = Boolean(results[0]?.meta.changes);
  const stored = created
    ? await sessionById(sessionId)
    : await sessionForSource(input.classId, latest.id);
  if (!stored) {
    throw new ApiError(
      409,
      "평가를 여는 동안 지난달 배정이 바뀌었어요.",
      "JOB_EVALUATION_STALE",
    );
  }
  return {
    idempotent: !created,
    evaluation: await teacherEvaluationFromRow(stored),
  };
}

export async function loadStudentJobEvaluation(
  studentId: string,
): Promise<StudentJobEvaluation | null> {
  await ensureSchema();
  const student = await database().prepare(
    `SELECT id, class_id FROM students WHERE id = ? AND status = 'active'`,
  ).bind(studentId).first<{ id: string; class_id: string }>();
  if (!student) throw new ApiError(403, "이 계정은 지금 평가에 참여할 수 없어요.", "ACCOUNT_DISABLED");
  const sessions = await database().prepare(
    `${SESSION_SELECT}
     WHERE class_id = ?
     ORDER BY source_year DESC, source_month DESC, opened_at DESC
     LIMIT 4`,
  ).bind(student.class_id).all<EvaluationSessionRow>();
  const session = sessions.results.find(
    (item) => parseStudentIds(item.student_ids_json).includes(studentId),
  );
  if (!session) return null;
  const jobs = parseJobs(session.jobs_json);
  const response = await database().prepare(
    `${RESPONSE_SELECT} WHERE session_id = ? AND student_id = ?`,
  ).bind(session.id, studentId).first<EvaluationResponseRow>();
  return {
    id: session.id,
    sourcePeriodId: session.source_period_id,
    year: Number(session.source_year),
    month: Number(session.source_month),
    status: session.status,
    revision: Number(session.revision),
    jobs,
    submission: response ? {
      submittedAt: Number(response.submitted_at),
      revision: Number(response.revision),
      scores: parseStoredScores(response.scores_json, jobs),
    } : null,
  };
}

export async function submitStudentJobEvaluation(input: {
  studentId: string;
  evaluationId: unknown;
  expectedSessionRevision: unknown;
  expectedResponseRevision: unknown;
  requestId: unknown;
  scores: unknown;
}) {
  await ensureSchema();
  const evaluationId = textId(
    input.evaluationId,
    "평가 번호를 다시 확인해 주세요.",
    "INVALID_JOB_EVALUATION",
  );
  const expectedSessionRevision = validRevision(input.expectedSessionRevision);
  const expectedResponseRevision = validRevision(
    input.expectedResponseRevision,
    "JOB_EVALUATION_RESPONSE_STALE",
  );
  const requestId = textId(
    input.requestId,
    "제출 요청 번호를 다시 확인해 주세요.",
    "INVALID_REQUEST_ID",
    100,
  );
  const [session, student] = await Promise.all([
    sessionById(evaluationId),
    database().prepare(
      `SELECT id, class_id, student_number, official_name
       FROM students WHERE id = ? AND status = 'active'`,
    ).bind(input.studentId).first<{
      id: string;
      class_id: string;
      student_number: number;
      official_name: string;
    }>(),
  ]);
  if (!student || !session || session.class_id !== student.class_id) {
    throw new ApiError(404, "참여할 직업평가를 찾을 수 없어요.", "JOB_EVALUATION_NOT_FOUND");
  }
  if (!parseStudentIds(session.student_ids_json).includes(input.studentId)) {
    throw new ApiError(403, "이 평가는 개설 당시 참여 학생만 제출할 수 있어요.", "JOB_EVALUATION_NOT_ELIGIBLE");
  }
  const existingByRequest = await database().prepare(
    `${RESPONSE_SELECT} WHERE session_id = ? AND request_id = ?`,
  ).bind(session.id, requestId).first<EvaluationResponseRow>();
  if (existingByRequest) {
    if (existingByRequest.student_id !== input.studentId) {
      throw new ApiError(409, "이미 사용된 제출 요청 번호예요.", "JOB_EVALUATION_RESPONSE_STALE");
    }
    return {
      idempotent: true,
      evaluation: await loadStudentJobEvaluation(input.studentId),
    };
  }
  if (session.status !== "open" || Number(session.revision) !== expectedSessionRevision) {
    throw new ApiError(
      409,
      "선생님이 평가를 마감했거나 화면 상태가 바뀌었어요.",
      "JOB_EVALUATION_NOT_OPEN",
    );
  }
  const jobs = parseJobs(session.jobs_json);
  const scores = parseSubmittedScores(input.scores, jobs);
  const existing = await database().prepare(
    `${RESPONSE_SELECT} WHERE session_id = ? AND student_id = ?`,
  ).bind(session.id, input.studentId).first<EvaluationResponseRow>();
  if (Number(existing?.revision ?? 0) !== expectedResponseRevision) {
    throw new ApiError(
      409,
      "다른 화면에서 내 평가가 먼저 저장됐어요. 최신 평가를 다시 확인해 주세요.",
      "JOB_EVALUATION_RESPONSE_STALE",
    );
  }
  const now = Date.now();
  const writeNonce = crypto.randomUUID();
  const responseId = existing?.id ?? crypto.randomUUID();
  const db = database();
  await db.batch([
    db.prepare(
      `INSERT INTO class_job_evaluation_responses (
         id, session_id, class_id, student_id, student_number, student_name,
         scores_json, revision, request_id, write_nonce, submitted_at, updated_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM class_job_evaluation_sessions session
         WHERE session.id = ? AND session.class_id = ? AND session.status = 'open'
           AND session.revision = ?
       )
       ON CONFLICT(session_id, student_id) DO UPDATE SET
         scores_json = excluded.scores_json,
         revision = class_job_evaluation_responses.revision + 1,
         request_id = excluded.request_id,
         write_nonce = excluded.write_nonce,
         submitted_at = excluded.submitted_at,
         updated_at = excluded.updated_at
       WHERE class_job_evaluation_responses.revision = ?`,
    ).bind(
      responseId,
      session.id,
      session.class_id,
      input.studentId,
      Number(student.student_number),
      student.official_name,
      JSON.stringify(scores),
      requestId,
      writeNonce,
      now,
      now,
      session.id,
      session.class_id,
      expectedSessionRevision,
      expectedResponseRevision,
    ),
    db.prepare(
      `UPDATE class_job_evaluation_sessions
       SET response_revision = response_revision + 1, updated_at = ?
       WHERE id = ? AND class_id = ? AND status = 'open' AND revision = ?
         AND EXISTS (
           SELECT 1 FROM class_job_evaluation_responses response
           WHERE response.session_id = class_job_evaluation_sessions.id
             AND response.student_id = ? AND response.write_nonce = ?
         )`,
    ).bind(
      now,
      session.id,
      session.class_id,
      expectedSessionRevision,
      input.studentId,
      writeNonce,
    ),
    db.prepare(
      `INSERT INTO audit_logs (
         id, teacher_id, class_id, student_id, action, detail, created_at
       )
       SELECT ?, NULL, ?, ?, 'student_job_evaluation_submitted', ?, ?
       WHERE EXISTS (
         SELECT 1 FROM class_job_evaluation_responses response
         WHERE response.session_id = ? AND response.student_id = ?
           AND response.write_nonce = ?
       )`,
    ).bind(
      crypto.randomUUID(),
      session.class_id,
      input.studentId,
      JSON.stringify({
        evaluationId: session.id,
        responseRevision: expectedResponseRevision + 1,
        jobCount: jobs.length,
        idempotent: false,
      }),
      now,
      session.id,
      input.studentId,
      writeNonce,
    ),
  ]);
  const stored = await database().prepare(
    `${RESPONSE_SELECT} WHERE session_id = ? AND student_id = ?`,
  ).bind(session.id, input.studentId).first<EvaluationResponseRow>();
  if (!stored || stored.request_id !== requestId) {
    const latestSession = await sessionById(session.id);
    throw new ApiError(
      409,
      latestSession?.status === "open"
        ? "다른 화면에서 내 평가가 먼저 저장됐어요."
        : "선생님이 평가를 마감해서 더는 제출할 수 없어요.",
      latestSession?.status === "open"
        ? "JOB_EVALUATION_RESPONSE_STALE"
        : "JOB_EVALUATION_NOT_OPEN",
    );
  }
  return {
    idempotent: stored.write_nonce !== writeNonce,
    evaluation: await loadStudentJobEvaluation(input.studentId),
  };
}

function resultInsertStatement(
  result: JobEvaluationResult,
  session: EvaluationSessionRow,
  expectedRevision: number,
  responseRevision: number,
  now: number,
) {
  return database().prepare(
    `INSERT INTO class_job_evaluation_results (
       id, session_id, class_id, class_job_id, job_name,
       hard_average, responsibility_average, consistency_average, burden_average,
       total_average, response_count, rank, recommended_grade, cutoff_tie,
       created_at, updated_at
     )
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE EXISTS (
       SELECT 1 FROM class_job_evaluation_sessions session
       WHERE session.id = ? AND session.class_id = ? AND session.status = 'closed'
         AND session.revision = ? AND session.calculated_response_revision = ?
     )`,
  ).bind(
    crypto.randomUUID(),
    session.id,
    session.class_id,
    result.classJobId,
    result.name,
    result.hardAverage,
    result.responsibilityAverage,
    result.consistencyAverage,
    result.burdenAverage,
    result.totalAverage,
    result.responseCount,
    result.rank,
    result.recommendedGrade,
    result.cutoffTie ? 1 : 0,
    now,
    now,
    session.id,
    session.class_id,
    expectedRevision + 1,
    responseRevision,
  );
}

function jobEvaluationCloseWriteConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("NOT NULL constraint failed: class_job_evaluation_sessions.status")
    || message.includes("UNIQUE constraint failed: class_job_evaluation_results.session_id");
}

export async function closeJobEvaluation(input: {
  classId: string;
  teacherId: string;
  evaluationId: unknown;
  expectedRevision: unknown;
  expectedResponseRevision: unknown;
  allowIncomplete: unknown;
}) {
  await ensureSchema();
  const evaluationId = textId(
    input.evaluationId,
    "마감할 평가를 다시 확인해 주세요.",
    "INVALID_JOB_EVALUATION",
  );
  const expectedRevision = validRevision(input.expectedRevision);
  const expectedResponseRevision = validRevision(
    input.expectedResponseRevision,
    "JOB_EVALUATION_STALE",
  );
  const session = await sessionById(evaluationId);
  if (!session || session.class_id !== input.classId) {
    throw new ApiError(404, "마감할 평가를 찾을 수 없어요.", "JOB_EVALUATION_NOT_FOUND");
  }
  if (session.status !== "open") {
    return {
      idempotent: true,
      evaluation: await teacherEvaluationFromRow(session),
    };
  }
  if (
    Number(session.revision) !== expectedRevision
    || Number(session.response_revision) !== expectedResponseRevision
  ) {
    throw new ApiError(
      409,
      "학생 제출 현황이 바뀌었어요. 최신 정보를 확인한 뒤 다시 마감해 주세요.",
      "JOB_EVALUATION_STALE",
    );
  }
  const [responses, jobs] = await Promise.all([
    evaluationResponses(session.id),
    Promise.resolve(parseJobs(session.jobs_json)),
  ]);
  if (!responses.length) {
    throw new ApiError(
      409,
      "최소 한 명이 제출해야 평가 결과를 계산할 수 있어요.",
      "JOB_EVALUATION_RESPONSES_REQUIRED",
    );
  }
  if (
    responses.length < Number(session.student_count_snapshot)
    && input.allowIncomplete !== true
  ) {
    throw new ApiError(
      409,
      `아직 ${Number(session.student_count_snapshot) - responses.length}명이 제출하지 않았어요.`,
      "JOB_EVALUATION_INCOMPLETE",
    );
  }
  const scoreRecords = responses.map(
    (response) => scoreRecord(parseStoredScores(response.scores_json, jobs)),
  );
  const results = calculateJobEvaluationResults(jobs, scoreRecords);
  const now = Date.now();
  const db = database();
  let closeChanged = false;
  try {
    const batchResults = await db.batch([
      db.prepare(
        `UPDATE class_job_evaluation_sessions
         SET status = 'closed', revision = revision + 1,
             calculated_response_revision = response_revision,
             closed_by_teacher_id = ?, closed_at = ?, updated_at = ?
         WHERE id = ? AND class_id = ? AND status = 'open'
           AND revision = ? AND response_revision = ?`,
      ).bind(
        input.teacherId,
        now,
        now,
        session.id,
        input.classId,
        expectedRevision,
        expectedResponseRevision,
      ),
      ...results.map((result) => resultInsertStatement(
        result,
        session,
        expectedRevision,
        expectedResponseRevision,
        now,
      )),
      db.prepare(
        `INSERT INTO audit_logs (
           id, teacher_id, class_id, student_id, action, detail, created_at
         )
         SELECT ?, ?, ?, NULL, 'job_evaluation_closed', ?, ?
         WHERE EXISTS (
           SELECT 1 FROM class_job_evaluation_sessions
           WHERE id = ? AND class_id = ? AND status = 'closed'
             AND revision = ? AND calculated_response_revision = ?
         )`,
      ).bind(
        crypto.randomUUID(),
        input.teacherId,
        input.classId,
        JSON.stringify({
          evaluationId: session.id,
          submittedCount: responses.length,
          studentCount: Number(session.student_count_snapshot),
          idempotent: false,
        }),
        now,
        session.id,
        input.classId,
        expectedRevision + 1,
        expectedResponseRevision,
      ),
    ]);
    closeChanged = Boolean(batchResults[0]?.meta.changes);
  } catch (error) {
    const latest = await sessionById(session.id);
    if (latest && latest.status !== "open") {
      return {
        idempotent: true,
        evaluation: await teacherEvaluationFromRow(latest),
      };
    }
    if (!jobEvaluationCloseWriteConflict(error)) throw error;
    throw new ApiError(
      409,
      "마감하는 동안 학생 제출 현황이 바뀌었어요. 최신 정보를 확인해 주세요.",
      "JOB_EVALUATION_STALE",
    );
  }
  const stored = await sessionById(session.id);
  if (!stored || stored.status === "open") {
    throw new ApiError(
      409,
      "마감하는 동안 학생 제출 현황이 바뀌었어요. 최신 정보를 확인해 주세요.",
      "JOB_EVALUATION_STALE",
    );
  }
  return {
    idempotent: !closeChanged,
    evaluation: await teacherEvaluationFromRow(stored),
  };
}

function parseFinalGradeInput(value: unknown, jobs: JobEvaluationJob[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "직업별 최종등급을 모두 확인해 주세요.", "INVALID_JOB_GRADES");
  }
  const raw = value as Record<string, unknown>;
  const result = Object.create(null) as Record<string, JobGrade>;
  for (const job of jobs) {
    const grade = raw[job.classJobId];
    if (grade !== "A" && grade !== "B" && grade !== "C") {
      throw new ApiError(
        400,
        `${job.name}의 최종등급을 A, B, C 중에서 골라 주세요.`,
        "INVALID_JOB_GRADES",
      );
    }
    result[job.classJobId] = grade;
  }
  if (Object.keys(raw).length !== jobs.length) {
    throw new ApiError(400, "현재 평가에 없는 직업 등급이 포함됐어요.", "INVALID_JOB_GRADES");
  }
  return result;
}

export async function finalizeJobEvaluation(input: {
  classId: string;
  teacherId: string;
  evaluationId: unknown;
  expectedRevision: unknown;
  finalGrades: unknown;
}) {
  await ensureSchema();
  const evaluationId = textId(
    input.evaluationId,
    "확정할 평가를 다시 확인해 주세요.",
    "INVALID_JOB_EVALUATION",
  );
  const expectedRevision = validRevision(input.expectedRevision);
  const session = await sessionById(evaluationId);
  if (!session || session.class_id !== input.classId) {
    throw new ApiError(404, "확정할 평가를 찾을 수 없어요.", "JOB_EVALUATION_NOT_FOUND");
  }
  if (session.status === "finalized") {
    return {
      idempotent: true,
      evaluation: await teacherEvaluationFromRow(session),
    };
  }
  if (session.status !== "closed" || Number(session.revision) !== expectedRevision) {
    throw new ApiError(
      409,
      "평가 결과가 바뀌었어요. 최신 결과를 확인해 주세요.",
      "JOB_EVALUATION_STALE",
    );
  }
  const jobs = parseJobs(session.jobs_json);
  const results = await evaluationResults(session.id);
  if (results.length !== jobs.length || !results.length) {
    throw new ApiError(
      409,
      "직업별 평가 결과를 온전히 불러오지 못했어요.",
      "JOB_EVALUATION_RESULTS_REQUIRED",
    );
  }
  const finalGrades = parseFinalGradeInput(input.finalGrades, jobs);
  const now = Date.now();
  const db = database();
  const batchResults = await db.batch([
    db.prepare(
      `UPDATE class_job_evaluation_sessions
       SET status = 'finalized', final_grades_json = ?, revision = revision + 1,
           finalized_by_teacher_id = ?, finalized_at = ?, updated_at = ?
       WHERE id = ? AND class_id = ? AND status = 'closed' AND revision = ?
         AND calculated_response_revision = response_revision
         AND (SELECT COUNT(*) FROM class_job_evaluation_results result
              WHERE result.session_id = class_job_evaluation_sessions.id) = ?`,
    ).bind(
      JSON.stringify(finalGrades),
      input.teacherId,
      now,
      now,
      session.id,
      input.classId,
      expectedRevision,
      jobs.length,
    ),
    db.prepare(
      `INSERT INTO audit_logs (
         id, teacher_id, class_id, student_id, action, detail, created_at
       )
       SELECT ?, ?, ?, NULL, 'job_evaluation_finalized', ?, ?
       WHERE EXISTS (
         SELECT 1 FROM class_job_evaluation_sessions
         WHERE id = ? AND class_id = ? AND status = 'finalized'
           AND revision = ? AND finalized_by_teacher_id = ? AND finalized_at = ?
       )`,
    ).bind(
      crypto.randomUUID(),
      input.teacherId,
      input.classId,
      JSON.stringify({ evaluationId: session.id, idempotent: false }),
      now,
      session.id,
      input.classId,
      expectedRevision + 1,
      input.teacherId,
      now,
    ),
  ]);
  const result = batchResults[0];
  if (!result.meta.changes) {
    const latest = await sessionById(session.id);
    if (latest?.status === "finalized") {
      return {
        idempotent: true,
        evaluation: await teacherEvaluationFromRow(latest),
      };
    }
    throw new ApiError(
      409,
      "최종등급을 확정하는 동안 결과가 바뀌었어요.",
      "JOB_EVALUATION_STALE",
    );
  }
  const stored = await sessionById(session.id);
  return {
    idempotent: false,
    evaluation: await teacherEvaluationFromRow(stored!),
  };
}

export async function finalizedEvaluationGrades(
  classId: string,
  sourcePeriodId: string,
) {
  await ensureSchema();
  const session = await sessionForSource(classId, sourcePeriodId);
  if (!session || session.status !== "finalized") {
    throw new ApiError(
      409,
      "학생 직업평가를 마감하고 최종등급을 먼저 확정해 주세요.",
      "JOB_EVALUATION_REQUIRED",
    );
  }
  const jobs = parseJobs(session.jobs_json);
  const grades = parseFinalGrades(session.final_grades_json, jobs);
  if (!grades) {
    throw new ApiError(
      409,
      "확정된 직업등급을 불러오지 못했어요.",
      "JOB_EVALUATION_RESULTS_REQUIRED",
    );
  }
  return {
    sessionId: session.id,
    revision: Number(session.revision),
    grades,
  };
}
