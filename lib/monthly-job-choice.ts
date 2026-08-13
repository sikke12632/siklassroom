import { database, ensureSchema, isOperationGuardFailure } from "./database";
import {
  nextJobMonth,
  shuffleChoiceOrderWithinGrades,
  sortChoiceOrder,
  suggestJobGrade,
  type ChoiceOrderItem,
  type JobGrade,
  type PreviousChoiceGrade,
} from "./monthly-job-choice-rules";
import {
  finalizedEvaluationGrades,
  loadTeacherJobEvaluation,
  type TeacherJobEvaluation,
} from "./job-evaluation";
import { ApiError } from "./responses";
import { seoulServerTime } from "./seoul-time";
import { autoPayFinancePayrollForClosure } from "./finance-payroll";

async function automaticPayrollAfterClosure(classId: string, closureId: string) {
  try {
    const result = await autoPayFinancePayrollForClosure({ classId, closureId });
    if (result.payroll.status !== "completed") {
      return {
        status: "processing" as const,
        payrollId: result.payroll.id,
        recipientCount: result.payroll.recipientCount,
        totalAmount: result.payroll.totalAmount,
        message: "직업 월급은 안전하게 나누어 자동 지급 중입니다.",
      };
    }
    return {
      status: "completed" as const,
      payrollId: result.payroll.id,
      recipientCount: result.payroll.recipientCount,
      totalAmount: result.payroll.totalAmount,
      deduplicated: result.deduplicated,
    };
  } catch (error) {
    console.error("automatic job salary payout deferred", {
      classId,
      closureId,
      error,
    });
    return {
      status: "attention" as const,
      code: error instanceof ApiError
        ? error.code ?? "FINANCE_PAYROLL_DEFERRED"
        : "FINANCE_PAYROLL_DEFERRED",
      message: "직업 월급 자동 지급을 마치지 못했습니다. 금융센터의 직업 월급에서 다시 지급할 수 있습니다.",
    };
  }
}

export {
  nextJobMonth,
  shuffleChoiceOrderWithinGrades,
  sortChoiceOrder,
  suggestJobGrade,
} from "./monthly-job-choice-rules";
export type { ChoiceOrderItem, JobGrade, PreviousChoiceGrade } from "./monthly-job-choice-rules";

type ClassroomRow = {
  id: string;
  school_name: string;
  school_year: number;
  grade: number;
  class_number: number;
  display_name: string | null;
  status: string;
};

type StudentRow = {
  id: string;
  student_number: number;
  official_name: string;
  status: string;
};

type JobRow = {
  id: string;
  template_id: string | null;
  name: string;
  description: string;
  member_capacity: number;
  category: string;
  sort_order: number;
  is_active: number;
};

type JobSetupRow = {
  status: string;
  revision: number;
};

type PeriodRow = {
  id: string;
  class_id: string;
  assignment_year: number;
  assignment_month: number;
  assignment_type: string;
  mode: string | null;
  status: string;
  revision: number;
  confirmed_at: number | null;
  updated_at: number;
  assignment_count: number;
};

type SourceAssignmentRow = {
  student_id: string;
  class_job_id: string;
  assignment_sequence: number;
  assigned_at: number;
  student_number: number;
  student_name: string;
  student_status: string;
  template_id: string | null;
  job_name: string;
  job_description: string;
  job_capacity: number;
  job_category: string;
  job_sort_order: number;
  job_is_active: number;
};

type ClosureRow = {
  id: string;
  class_id: string;
  source_period_id: string;
  source_year: number;
  source_month: number;
  status: string;
  evaluation_session_id: string | null;
  evaluation_revision: number | null;
  closed_by_teacher_id: string;
  closed_at: number;
  created_at: number;
};

type ResultRow = {
  id: string;
  closure_id: string;
  student_id: string;
  student_number: number;
  student_name: string;
  class_job_id: string;
  job_name: string;
  job_grade: PreviousChoiceGrade;
};

type SessionRow = {
  id: string;
  class_id: string;
  closure_id: string;
  target_year: number;
  target_month: number;
  status: "draft" | "confirmed";
  order_mode: "roster" | "shuffled";
  order_json: string;
  student_count_snapshot: number;
  job_setup_revision: number;
  revision: number;
  confirmed_period_id: string | null;
  confirmed_by_teacher_id: string | null;
  confirmed_at: number | null;
  created_at: number;
  updated_at: number;
};

type ConfirmedAssignmentRow = {
  student_id: string;
  student_number: number;
  student_name: string;
  class_job_id: string;
  job_name: string;
  assignment_sequence: number;
  request_id: string | null;
};

type GradePreviewItem = {
  classJobId: string;
  name: string;
  studentCount: number;
  suggestedGrade: JobGrade;
};

type MonthlyContext = {
  classroom: ClassroomRow;
  students: StudentRow[];
  jobs: JobRow[];
  setup: JobSetupRow | null;
  sourcePeriod: PeriodRow | null;
  sourceAssignments: SourceAssignmentRow[];
  gradePreview: GradePreviewItem[];
  closure: ClosureRow | null;
  closureResults: ResultRow[];
  session: SessionRow | null;
  order: ChoiceOrderItem[];
  confirmedAssignments: ConfirmedAssignmentRow[];
  latestConfirmedSession: SessionRow | null;
  evaluation: TeacherJobEvaluation | null;
};

const SOURCE_PERIOD_SELECT = `
  SELECT p.id, p.class_id, p.assignment_year, p.assignment_month,
         p.assignment_type, p.mode, p.status, p.revision,
         p.confirmed_at, p.updated_at,
         (SELECT COUNT(*) FROM student_job_assignments a WHERE a.period_id = p.id) AS assignment_count
  FROM class_job_assignment_periods p
`;

function validRevision(value: unknown, code = "INVALID_MONTHLY_CHOICE_REVISION") {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new ApiError(400, "선택 화면의 저장 버전을 확인할 수 없어요.", code);
  }
  return revision;
}

function textId(value: unknown, message: string, code: string, maxLength = 120) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id.length > maxLength) throw new ApiError(400, message, code);
  return id;
}

function parseOrder(value: string): ChoiceOrderItem[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((raw): ChoiceOrderItem[] => {
      if (!raw || typeof raw !== "object") return [];
      const item = raw as Partial<ChoiceOrderItem>;
      const previousGrade = item.previousGrade;
      if (
        typeof item.studentId !== "string"
        || !Number.isInteger(Number(item.studentNumber))
        || typeof item.studentName !== "string"
        || !["A", "B", "C", "D", "NEW"].includes(String(previousGrade))
      ) {
        return [];
      }
      return [{
        studentId: item.studentId,
        studentNumber: Number(item.studentNumber),
        studentName: item.studentName,
        previousJobName: typeof item.previousJobName === "string" ? item.previousJobName : null,
        previousGrade: previousGrade as PreviousChoiceGrade,
      }];
    });
  } catch {
    return [];
  }
}

async function activeStudents(classId: string) {
  const result = await database().prepare(
    `SELECT id, student_number, official_name, status
     FROM students
     WHERE class_id = ? AND status <> 'excluded'
     ORDER BY student_number, official_name, id`,
  ).bind(classId).all<StudentRow>();
  return result.results;
}

async function classJobs(classId: string) {
  const result = await database().prepare(
    `SELECT id, template_id, name, description, member_capacity, category,
            sort_order, is_active
     FROM class_jobs
     WHERE class_id = ? AND is_active = 1
     ORDER BY sort_order, created_at, id`,
  ).bind(classId).all<JobRow>();
  return result.results;
}

async function classroom(classId: string) {
  const row = await database().prepare(
    `SELECT id, school_name, school_year, grade, class_number, display_name, status
     FROM classes WHERE id = ?`,
  ).bind(classId).first<ClassroomRow>();
  if (!row) throw new ApiError(404, "학급을 찾을 수 없습니다.", "CLASS_NOT_FOUND");
  return row;
}

async function jobSetup(classId: string) {
  return database().prepare(
    `SELECT status, revision FROM class_job_setup WHERE class_id = ?`,
  ).bind(classId).first<JobSetupRow>();
}

async function latestEligibleSourcePeriod(classId: string, epochMs = Date.now()) {
  const current = seoulServerTime(epochMs);
  return database().prepare(
    `${SOURCE_PERIOD_SELECT}
     WHERE p.class_id = ?
       AND p.status = 'confirmed'
       AND p.assignment_type IN ('initial', 'monthly')
       AND (
         p.assignment_year < ?
         OR (p.assignment_year = ? AND p.assignment_month <= ?)
       )
     ORDER BY p.assignment_year DESC, p.assignment_month DESC,
              p.confirmed_at DESC, p.updated_at DESC, p.id DESC
     LIMIT 1`,
  ).bind(classId, current.year, current.year, current.month).first<PeriodRow>();
}

async function sourceAssignments(periodId: string) {
  const result = await database().prepare(
    `SELECT a.student_id, a.class_job_id, a.assignment_sequence, a.assigned_at,
            s.student_number, s.official_name AS student_name, s.status AS student_status,
            j.template_id, j.name AS job_name, j.description AS job_description,
            j.member_capacity AS job_capacity, j.category AS job_category,
            j.sort_order AS job_sort_order, j.is_active AS job_is_active
     FROM student_job_assignments a
     JOIN students s ON s.id = a.student_id AND s.class_id = a.class_id
     JOIN class_jobs j ON j.id = a.class_job_id AND j.class_id = a.class_id
     WHERE a.period_id = ?
     ORDER BY a.assignment_sequence, s.student_number, s.official_name, s.id`,
  ).bind(periodId).all<SourceAssignmentRow>();
  return result.results;
}

async function closureForSource(sourcePeriodId: string) {
  return database().prepare(
    `SELECT id, class_id, source_period_id, source_year, source_month, status,
            evaluation_session_id, evaluation_revision,
            closed_by_teacher_id, closed_at, created_at
     FROM class_job_month_closures
     WHERE source_period_id = ?`,
  ).bind(sourcePeriodId).first<ClosureRow>();
}

async function closureResults(closureId: string) {
  const result = await database().prepare(
    `SELECT id, closure_id, student_id, student_number, student_name,
            class_job_id, job_name, job_grade
     FROM class_job_month_results
     WHERE closure_id = ?
     ORDER BY student_number, student_name, student_id`,
  ).bind(closureId).all<ResultRow>();
  return result.results;
}

async function sessionForClosure(closureId: string) {
  return database().prepare(
    `SELECT id, class_id, closure_id, target_year, target_month, status,
            order_mode, order_json, student_count_snapshot, job_setup_revision,
            revision, confirmed_period_id, confirmed_by_teacher_id, confirmed_at,
            created_at, updated_at
     FROM class_job_choice_sessions
     WHERE closure_id = ?`,
  ).bind(closureId).first<SessionRow>();
}

async function latestConfirmedChoiceSession(classId: string) {
  return database().prepare(
    `SELECT id, class_id, closure_id, target_year, target_month, status,
            order_mode, order_json, student_count_snapshot, job_setup_revision,
            revision, confirmed_period_id, confirmed_by_teacher_id, confirmed_at,
            created_at, updated_at
     FROM class_job_choice_sessions
     WHERE class_id = ? AND status = 'confirmed'
     ORDER BY confirmed_at DESC, updated_at DESC, id DESC
     LIMIT 1`,
  ).bind(classId).first<SessionRow>();
}

async function confirmedAssignments(periodId: string) {
  const result = await database().prepare(
    `SELECT a.student_id, s.student_number, s.official_name AS student_name,
            a.class_job_id, j.name AS job_name, a.assignment_sequence, a.request_id
     FROM student_job_assignments a
     JOIN students s ON s.id = a.student_id
     JOIN class_jobs j ON j.id = a.class_job_id
     WHERE a.period_id = ?
     ORDER BY a.assignment_sequence, s.student_number, s.id`,
  ).bind(periodId).all<ConfirmedAssignmentRow>();
  return result.results;
}

function buildGradePreview(
  jobs: JobRow[],
  assignments: SourceAssignmentRow[],
) {
  const jobById = new Map<string, {
    id: string;
    templateId: string | null;
    name: string;
    sortOrder: number;
  }>();
  for (const job of jobs) {
    jobById.set(job.id, {
      id: job.id,
      templateId: job.template_id,
      name: job.name,
      sortOrder: Number(job.sort_order),
    });
  }
  for (const assignment of assignments) {
    if (jobById.has(assignment.class_job_id)) continue;
    jobById.set(assignment.class_job_id, {
      id: assignment.class_job_id,
      templateId: assignment.template_id,
      name: assignment.job_name,
      sortOrder: Number(assignment.job_sort_order),
    });
  }
  const counts = new Map<string, number>();
  for (const assignment of assignments) {
    counts.set(assignment.class_job_id, (counts.get(assignment.class_job_id) ?? 0) + 1);
  }
  return [...jobById.values()]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "ko"))
    .map((job): GradePreviewItem => ({
      classJobId: job.id,
      name: job.name,
      studentCount: counts.get(job.id) ?? 0,
      suggestedGrade: suggestJobGrade({ templateId: job.templateId, name: job.name }),
    }));
}

async function loadContext(classId: string): Promise<MonthlyContext> {
  await ensureSchema();
  const [classroomRow, students, jobs, setup, sourcePeriod, latestSession] = await Promise.all([
    classroom(classId),
    activeStudents(classId),
    classJobs(classId),
    jobSetup(classId),
    latestEligibleSourcePeriod(classId),
    latestConfirmedChoiceSession(classId),
  ]);
  const assignments = sourcePeriod ? await sourceAssignments(sourcePeriod.id) : [];
  const gradePreview = buildGradePreview(jobs, assignments);
  const [closure, evaluation] = sourcePeriod
    ? await Promise.all([
      closureForSource(sourcePeriod.id).then((item) => item ?? null),
      loadTeacherJobEvaluation(classId, sourcePeriod.id),
    ])
    : [null, null];
  const results = closure ? await closureResults(closure.id) : [];
  const session = closure ? await sessionForClosure(closure.id) ?? null : null;
  const order = session ? parseOrder(session.order_json) : [];
  const confirmedPeriodId = session?.confirmed_period_id
    ?? (!session ? latestSession?.confirmed_period_id : null);
  const targetAssignments = confirmedPeriodId
    ? await confirmedAssignments(confirmedPeriodId)
    : [];
  return {
    classroom: classroomRow,
    students,
    jobs,
    setup: setup ?? null,
    sourcePeriod: sourcePeriod ?? null,
    sourceAssignments: assignments,
    gradePreview,
    closure,
    closureResults: results,
    session,
    order,
    confirmedAssignments: targetAssignments,
    latestConfirmedSession: latestSession ?? null,
    evaluation,
  };
}

function blockingReason(context: MonthlyContext) {
  if (!context.sourcePeriod) {
    return {
      code: "MONTHLY_SOURCE_REQUIRED",
      message: "현재 서울 연월까지 확정된 직업 배정이 없어요. 첫 직업 배정을 먼저 확정해 주세요.",
    };
  }
  if (!context.students.length) {
    return {
      code: "NO_ACTIVE_STUDENTS",
      message: "활성 학생을 한 명 이상 등록해 주세요.",
    };
  }
  if (
    !context.closure
    && (
      Number(context.sourcePeriod.assignment_count) < 1
      || context.sourceAssignments.length !== Number(context.sourcePeriod.assignment_count)
    )
  ) {
    return {
      code: "SOURCE_ASSIGNMENTS_INCOMPLETE",
      message: "지난달 확정 배정 기록이 비어 있거나 일부를 불러오지 못했어요.",
    };
  }
  if (!context.jobs.length || context.setup?.status !== "completed") {
    return {
      code: "JOB_SETUP_REQUIRED",
      message: "현재 사용할 우리 반 직업을 먼저 확정해 주세요.",
    };
  }
  const capacity = context.jobs.reduce((sum, job) => sum + Number(job.member_capacity), 0);
  if (capacity !== context.students.length) {
    return {
      code: "JOB_CAPACITY_MISMATCH",
      message: `활성 학생은 ${context.students.length}명인데 현재 직업 정원은 ${capacity}자리예요.`,
    };
  }
  return null;
}

function closureJobGrades(results: ResultRow[]) {
  const grades: Record<string, JobGrade> = {};
  for (const result of results) {
    if (["A", "B", "C"].includes(result.job_grade) && !grades[result.class_job_id]) {
      grades[result.class_job_id] = result.job_grade as JobGrade;
    }
  }
  return grades;
}

function serializeSession(session: SessionRow | null, order: ChoiceOrderItem[]) {
  if (!session) return null;
  return {
    id: session.id,
    status: session.status,
    revision: Number(session.revision),
    orderMode: session.order_mode,
    targetYear: Number(session.target_year),
    targetMonth: Number(session.target_month),
    order,
    studentCountSnapshot: Number(session.student_count_snapshot),
    jobSetupRevision: Number(session.job_setup_revision),
    confirmedPeriodId: session.confirmed_period_id,
    confirmedAt: session.confirmed_at ? Number(session.confirmed_at) : null,
  };
}

function serializeBoard(context: MonthlyContext) {
  const source = context.sourcePeriod;
  const targetMonth = source
    ? nextJobMonth(Number(source.assignment_year), Number(source.assignment_month))
    : null;
  return {
    classroom: {
      id: context.classroom.id,
      name: context.classroom.display_name
        || `${context.classroom.grade}학년 ${context.classroom.class_number}반`,
      schoolName: context.classroom.school_name,
      schoolYear: Number(context.classroom.school_year),
      grade: Number(context.classroom.grade),
      classNumber: Number(context.classroom.class_number),
      displayName: context.classroom.display_name,
      status: context.classroom.status,
    },
    sourcePeriod: source ? {
      id: source.id,
      year: Number(source.assignment_year),
      month: Number(source.assignment_month),
      type: source.assignment_type,
      assignmentYear: Number(source.assignment_year),
      assignmentMonth: Number(source.assignment_month),
      assignmentType: source.assignment_type,
      revision: Number(source.revision),
      confirmedAt: source.confirmed_at ? Number(source.confirmed_at) : null,
      assignmentCount: Number(source.assignment_count),
    } : null,
    targetMonth,
    gradePreview: context.gradePreview,
    evaluation: context.evaluation,
    closure: context.closure ? {
      id: context.closure.id,
      sourcePeriodId: context.closure.source_period_id,
      sourceYear: Number(context.closure.source_year),
      sourceMonth: Number(context.closure.source_month),
      status: context.closure.status,
      evaluationSessionId: context.closure.evaluation_session_id,
      evaluationRevision: context.closure.evaluation_revision === null
        ? null
        : Number(context.closure.evaluation_revision),
      closedAt: Number(context.closure.closed_at),
      studentCount: context.closureResults.length,
      jobGrades: closureJobGrades(context.closureResults),
    } : null,
    session: serializeSession(context.session, context.order),
    students: context.students.map((student) => ({
      id: student.id,
      studentNumber: Number(student.student_number),
      name: student.official_name,
      studentName: student.official_name,
      status: student.status,
    })),
    jobs: context.jobs.map((job) => ({
      id: job.id,
      name: job.name,
      description: job.description,
      capacity: Number(job.member_capacity),
      category: job.category,
      sortOrder: Number(job.sort_order),
    })),
    confirmedAssignments: context.confirmedAssignments.map((assignment) => ({
      studentId: assignment.student_id,
      studentNumber: Number(assignment.student_number),
      studentName: assignment.student_name,
      classJobId: assignment.class_job_id,
      jobName: assignment.job_name,
      assignmentSequence: Number(assignment.assignment_sequence),
    })),
    latestConfirmedSession: context.latestConfirmedSession ? {
      id: context.latestConfirmedSession.id,
      closureId: context.latestConfirmedSession.closure_id,
      targetYear: Number(context.latestConfirmedSession.target_year),
      targetMonth: Number(context.latestConfirmedSession.target_month),
      confirmedPeriodId: context.latestConfirmedSession.confirmed_period_id,
      confirmedAt: context.latestConfirmedSession.confirmed_at
        ? Number(context.latestConfirmedSession.confirmed_at)
        : null,
    } : null,
    blockingReason: blockingReason(context),
    serverTime: seoulServerTime(),
  };
}

export async function loadMonthlyJobChoiceBoard(classId: string) {
  return serializeBoard(await loadContext(classId));
}

function monthlyClosureWriteConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("NOT NULL constraint failed: class_job_month_closures.status")
    || message.includes("UNIQUE constraint failed: class_job_month_closures")
    || message.includes("UNIQUE constraint failed: class_job_month_results");
}

export async function closeMonthlyJobSource(input: {
  classId: string;
  teacherId: string;
  expectedSourcePeriodId: unknown;
}) {
  const expectedSourcePeriodId = textId(
    input.expectedSourcePeriodId,
    "지난달 배정 정보를 다시 확인해 주세요.",
    "INVALID_SOURCE_PERIOD",
  );
  const context = await loadContext(input.classId);
  if (!context.sourcePeriod || context.sourcePeriod.id !== expectedSourcePeriodId) {
    throw new ApiError(
      409,
      "기준이 되는 지난달 배정이 바뀌었어요. 최신 화면을 다시 확인해 주세요.",
      "MONTHLY_CHOICE_STALE",
    );
  }
  if (context.closure) {
    const payroll = await automaticPayrollAfterClosure(
      input.classId,
      context.closure.id,
    );
    return {
      idempotent: true,
      closureId: context.closure.id,
      board: serializeBoard(context),
      payroll,
    };
  }
  const blocked = blockingReason(context);
  if (blocked?.code === "SOURCE_ASSIGNMENTS_INCOMPLETE" || blocked?.code === "NO_ACTIVE_STUDENTS") {
    throw new ApiError(409, blocked.message, blocked.code);
  }
  const finalizedEvaluation = await finalizedEvaluationGrades(
    input.classId,
    expectedSourcePeriodId,
  );
  const grades = finalizedEvaluation.grades;
  const assignments = context.sourceAssignments;
  if (
    assignments.length < 1
    || assignments.length !== Number(context.sourcePeriod.assignment_count)
  ) {
    throw new ApiError(
      409,
      "지난달 확정 배정 기록을 온전히 불러오지 못했어요.",
      "SOURCE_ASSIGNMENTS_INCOMPLETE",
    );
  }
  const sourceJobIds = new Set(assignments.map((assignment) => assignment.class_job_id));
  const gradeJobIds = Object.keys(grades);
  if (
    gradeJobIds.length !== sourceJobIds.size
    || gradeJobIds.some((jobId) => !sourceJobIds.has(jobId))
    || [...sourceJobIds].some((jobId) => (
      !Object.prototype.hasOwnProperty.call(grades, jobId)
      || !["A", "B", "C"].includes(grades[jobId])
    ))
  ) {
    throw new ApiError(
      409,
      "확정된 직업평가 등급과 지난달 직업 목록이 맞지 않아요. 평가 결과를 다시 확인해 주세요.",
      "JOB_EVALUATION_RESULTS_REQUIRED",
    );
  }
  const now = Date.now();
  const current = seoulServerTime(now);
  const closureId = crypto.randomUUID();
  const db = database();
  const statements = [
    db.prepare(
      `INSERT OR IGNORE INTO class_job_month_closures (
         id, class_id, source_period_id, source_year, source_month, status,
         evaluation_session_id, evaluation_revision,
         closed_by_teacher_id, closed_at, created_at
       )
       SELECT ?, p.class_id, p.id, p.assignment_year, p.assignment_month, 'closed',
              ?, ?, ?, ?, ?
       FROM class_job_assignment_periods p
       WHERE p.id = ? AND p.class_id = ? AND p.status = 'confirmed'
         AND p.assignment_type IN ('initial', 'monthly')
         AND p.id = (
           SELECT latest.id
           FROM class_job_assignment_periods latest
           WHERE latest.class_id = ? AND latest.status = 'confirmed'
             AND latest.assignment_type IN ('initial', 'monthly')
             AND (
               latest.assignment_year < ?
               OR (latest.assignment_year = ? AND latest.assignment_month <= ?)
             )
           ORDER BY latest.assignment_year DESC, latest.assignment_month DESC,
                    latest.confirmed_at DESC, latest.updated_at DESC, latest.id DESC
           LIMIT 1
         )
         AND (SELECT COUNT(*) FROM student_job_assignments a WHERE a.period_id = p.id) = ?
         AND EXISTS (
           SELECT 1 FROM class_job_evaluation_sessions evaluation
           WHERE evaluation.id = ? AND evaluation.class_id = p.class_id
             AND evaluation.source_period_id = p.id
             AND evaluation.status = 'finalized' AND evaluation.revision = ?
         )`,
    ).bind(
      closureId,
      finalizedEvaluation.sessionId,
      finalizedEvaluation.revision,
      input.teacherId,
      now,
      now,
      expectedSourcePeriodId,
      input.classId,
      input.classId,
      current.year,
      current.year,
      current.month,
      assignments.length,
      finalizedEvaluation.sessionId,
      finalizedEvaluation.revision,
    ),
    ...assignments.map((assignment) => db.prepare(
      `INSERT INTO class_job_month_results (
         id, closure_id, class_id, student_id, student_number, student_name,
         class_job_id, job_name, job_grade, created_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM class_job_month_closures
         WHERE id = ? AND class_id = ? AND source_period_id = ?
       )`,
    ).bind(
      crypto.randomUUID(),
      closureId,
      input.classId,
      assignment.student_id,
      Number(assignment.student_number),
      assignment.student_name,
      assignment.class_job_id,
      assignment.job_name,
      grades[assignment.class_job_id],
      now,
      closureId,
      input.classId,
      expectedSourcePeriodId,
    )),
    db.prepare(
      `UPDATE class_job_month_closures
       SET status = CASE WHEN status = 'closed'
         AND (SELECT COUNT(*) FROM class_job_month_results r WHERE r.closure_id = ?) = ?
         AND NOT EXISTS (
           SELECT 1 FROM student_job_assignments a
           WHERE a.period_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM class_job_month_results r
               WHERE r.closure_id = ? AND r.student_id = a.student_id
             )
         )
       THEN 'closed' ELSE NULL END
       WHERE id = ?`,
    ).bind(
      closureId,
      assignments.length,
      context.sourcePeriod.id,
      closureId,
      closureId,
    ),
    db.prepare(
      `INSERT INTO audit_logs (
         id, teacher_id, class_id, student_id, action, detail, created_at
       )
       SELECT ?, ?, ?, NULL, 'monthly_job_source_closed', ?, ?
       WHERE EXISTS (
         SELECT 1 FROM class_job_month_closures
         WHERE id = ? AND class_id = ? AND source_period_id = ? AND status = 'closed'
       )`,
    ).bind(
      crypto.randomUUID(),
      input.teacherId,
      input.classId,
      JSON.stringify({
        closureId,
        sourcePeriodId: expectedSourcePeriodId,
        idempotent: false,
      }),
      now,
      closureId,
      input.classId,
      expectedSourcePeriodId,
    ),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    const raced = await closureForSource(expectedSourcePeriodId);
    if (raced) {
      const nextContext = await loadContext(input.classId);
      return { idempotent: true, closureId: raced.id, board: serializeBoard(nextContext) };
    }
    if (!monthlyClosureWriteConflict(error)) throw error;
    throw new ApiError(
      409,
      "월마감 직전에 학생이나 지난달 배정이 바뀌었어요. 최신 화면을 다시 확인해 주세요.",
      "MONTHLY_CHOICE_STALE",
    );
  }
  const stored = await closureForSource(expectedSourcePeriodId);
  if (!stored) {
    throw new ApiError(
      409,
      "월마감 직전에 기준 배정이 바뀌었어요. 최신 화면을 다시 확인해 주세요.",
      "MONTHLY_CHOICE_STALE",
    );
  }
  const nextContext = await loadContext(input.classId);
  const payroll = await automaticPayrollAfterClosure(input.classId, stored.id);
  return {
    idempotent: stored.id !== closureId,
    closureId: stored.id,
    board: serializeBoard(nextContext),
    payroll,
  };
}

function sessionOrder(context: MonthlyContext) {
  const resultByStudent = new Map(
    context.closureResults.map((result) => [result.student_id, result]),
  );
  return sortChoiceOrder(context.students.map((student): ChoiceOrderItem => {
    const previous = resultByStudent.get(student.id);
    return {
      studentId: student.id,
      studentNumber: Number(student.student_number),
      studentName: student.official_name,
      previousJobName: previous?.job_name ?? null,
      previousGrade: previous?.job_grade ?? "NEW",
    };
  }));
}

export async function startMonthlyJobChoice(input: {
  classId: string;
  teacherId: string;
}) {
  const context = await loadContext(input.classId);
  if (!context.sourcePeriod || !context.closure) {
    throw new ApiError(409, "지난달 결과를 먼저 마감해 주세요.", "MONTHLY_CLOSURE_REQUIRED");
  }
  if (context.session) {
    return {
      idempotent: true,
      sessionId: context.session.id,
      board: serializeBoard(context),
    };
  }
  const blocked = blockingReason(context);
  if (blocked) throw new ApiError(409, blocked.message, blocked.code);
  if (!context.setup || context.setup.status !== "completed") {
    throw new ApiError(409, "현재 직업 설정을 먼저 확정해 주세요.", "JOB_SETUP_REQUIRED");
  }
  const target = nextJobMonth(
    Number(context.sourcePeriod.assignment_year),
    Number(context.sourcePeriod.assignment_month),
  );
  const existingTarget = await database().prepare(
    `SELECT id FROM class_job_choice_sessions
     WHERE class_id = ? AND target_year = ? AND target_month = ?`,
  ).bind(input.classId, target.year, target.month).first<{ id: string }>();
  if (existingTarget) {
    throw new ApiError(
      409,
      "이 달의 직업 선택 세션이 이미 다른 기준 기록으로 만들어졌어요.",
      "MONTHLY_CHOICE_TARGET_CONFLICT",
    );
  }
  const order = shuffleChoiceOrderWithinGrades(sessionOrder(context), secureRandomIndex);
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  const db = database();
  const batchResults = await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO class_job_choice_sessions (
         id, class_id, closure_id, target_year, target_month, status, order_mode,
         order_json, student_count_snapshot, job_setup_revision, revision,
         confirmed_period_id, confirmed_by_teacher_id, confirmed_at, created_at, updated_at
       )
       SELECT ?, ?, ?, ?, ?, 'draft', 'shuffled', ?, ?, ?, 0,
              NULL, NULL, NULL, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM class_job_month_closures c
         WHERE c.id = ? AND c.class_id = ? AND c.source_period_id = ?
       )
         AND EXISTS (
           SELECT 1 FROM class_job_setup setup
           WHERE setup.class_id = ? AND setup.status = 'completed' AND setup.revision = ?
         )
         AND (SELECT COUNT(*) FROM students s
              WHERE s.class_id = ? AND s.status <> 'excluded') = ?`,
    ).bind(
      sessionId,
      input.classId,
      context.closure.id,
      target.year,
      target.month,
      JSON.stringify(order),
      order.length,
      Number(context.setup.revision),
      now,
      now,
      context.closure.id,
      input.classId,
      context.sourcePeriod.id,
      input.classId,
      Number(context.setup.revision),
      input.classId,
      order.length,
    ),
    db.prepare(
      `INSERT INTO audit_logs (
         id, teacher_id, class_id, student_id, action, detail, created_at
       )
       SELECT ?, ?, ?, NULL, 'monthly_job_choice_started', ?, ?
       WHERE EXISTS (
         SELECT 1 FROM class_job_choice_sessions
         WHERE id = ? AND class_id = ? AND closure_id = ?
       )`,
    ).bind(
      crypto.randomUUID(),
      input.teacherId,
      input.classId,
      JSON.stringify({ sessionId, idempotent: false }),
      now,
      sessionId,
      input.classId,
      context.closure.id,
    ),
  ]);
  const result = batchResults[0];
  if (!result.meta.changes) {
    const raced = await sessionForClosure(context.closure.id);
    if (!raced) {
      throw new ApiError(
        409,
        "선택 세션을 만드는 동안 학생이나 직업이 바뀌었어요.",
        "MONTHLY_CHOICE_STALE",
      );
    }
    const racedContext = await loadContext(input.classId);
    return { idempotent: true, sessionId: raced.id, board: serializeBoard(racedContext) };
  }
  const nextContext = await loadContext(input.classId);
  return { idempotent: false, sessionId, board: serializeBoard(nextContext) };
}

function secureRandomIndex(length: number) {
  if (!Number.isInteger(length) || length < 1) throw new RangeError("length must be positive");
  const limit = Math.floor(0x1_0000_0000 / length) * length;
  const values = new Uint32Array(1);
  do {
    crypto.getRandomValues(values);
  } while (values[0] >= limit);
  return values[0] % length;
}

function sameStudentSet(students: StudentRow[], order: ChoiceOrderItem[]) {
  if (students.length !== order.length) return false;
  const ids = new Set(order.map((item) => item.studentId));
  return ids.size === order.length && students.every((student) => ids.has(student.id));
}

function requireFreshDraftSession(context: MonthlyContext) {
  if (!context.session) {
    throw new ApiError(409, "먼저 다음 달 선택 순서를 만들어 주세요.", "MONTHLY_CHOICE_SESSION_REQUIRED");
  }
  if (context.session.status !== "draft") {
    throw new ApiError(409, "이미 확정된 선택 결과예요.", "MONTHLY_CHOICE_STALE");
  }
  if (
    !context.setup
    || context.setup.status !== "completed"
    || Number(context.setup.revision) !== Number(context.session.job_setup_revision)
    || Number(context.session.student_count_snapshot) !== context.students.length
    || !sameStudentSet(context.students, context.order)
  ) {
    throw new ApiError(
      409,
      "학생 명단이나 직업 설정이 바뀌었어요. 선택 순서를 다시 시작해 주세요.",
      "MONTHLY_CHOICE_STALE",
    );
  }
  return context.session;
}

export async function shuffleMonthlyJobChoice(input: {
  classId: string;
  teacherId: string;
  expectedRevision: unknown;
}) {
  const expectedRevision = validRevision(input.expectedRevision);
  const context = await loadContext(input.classId);
  const session = requireFreshDraftSession(context);
  if (Number(session.revision) !== expectedRevision) {
    throw new ApiError(409, "다른 화면에서 순서가 먼저 바뀌었어요.", "MONTHLY_CHOICE_STALE");
  }
  const shuffled = shuffleChoiceOrderWithinGrades(context.order, secureRandomIndex);
  const shuffledJson = JSON.stringify(shuffled);
  const now = Date.now();
  const guardId = crypto.randomUUID();
  const db = database();
  try {
    await db.batch([
      db.prepare(
        `UPDATE class_job_choice_sessions
         SET order_mode = 'shuffled', order_json = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND class_id = ? AND status = 'draft' AND revision = ?
           AND student_count_snapshot = ?
           AND job_setup_revision = ?
           AND order_json = ?
           AND (SELECT COUNT(*) FROM students s
                WHERE s.class_id = ? AND s.status <> 'excluded') = ?
           AND EXISTS (
             SELECT 1 FROM class_job_setup setup
             WHERE setup.class_id = ? AND setup.status = 'completed' AND setup.revision = ?
           )`,
      ).bind(
        shuffledJson,
        now,
        session.id,
        input.classId,
        expectedRevision,
        context.students.length,
        Number(session.job_setup_revision),
        session.order_json,
        input.classId,
        context.students.length,
        input.classId,
        Number(session.job_setup_revision),
      ),
      db.prepare(
        `INSERT INTO registration_operation_guards (id, operation, created_at)
         SELECT CASE WHEN EXISTS (
           SELECT 1 FROM class_job_choice_sessions
           WHERE id = ? AND class_id = ? AND status = 'draft'
             AND revision = ? AND order_json = ?
         ) THEN ? ELSE NULL END, 'monthly_job_choice_shuffle', ?`,
      ).bind(
        session.id,
        input.classId,
        expectedRevision + 1,
        shuffledJson,
        guardId,
        now,
      ),
      db.prepare(
        `INSERT INTO audit_logs (
           id, teacher_id, class_id, student_id, action, detail, created_at
         ) VALUES (?, ?, ?, NULL, 'monthly_job_choice_shuffled', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        input.teacherId,
        input.classId,
        JSON.stringify({ sessionId: session.id, revision: expectedRevision + 1 }),
        now,
      ),
      db.prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
    ]);
  } catch (error) {
    if (isOperationGuardFailure(error)) {
      throw new ApiError(
        409,
        "순서를 바꾸는 동안 학생이나 직업이 달라졌어요.",
        "MONTHLY_CHOICE_STALE",
      );
    }
    throw error;
  }
  return {
    sessionId: session.id,
    revision: expectedRevision + 1,
    board: serializeBoard(await loadContext(input.classId)),
  };
}

type SubmittedAssignment = {
  studentId: string;
  classJobId: string;
};

function parseSubmittedAssignmentPayload(value: unknown) {
  if (!Array.isArray(value)) {
    throw new ApiError(400, "학생별 직업 선택 결과를 확인해 주세요.", "INVALID_MONTHLY_ASSIGNMENTS");
  }
  const seen = new Set<string>();
  return value.map((raw): SubmittedAssignment => {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const studentId = textId(
      item.studentId,
      "선택 결과의 학생 정보를 확인해 주세요.",
      "INVALID_MONTHLY_ASSIGNMENTS",
    );
    const classJobId = textId(
      item.classJobId,
      "선택 결과의 직업 정보를 확인해 주세요.",
      "INVALID_MONTHLY_ASSIGNMENTS",
    );
    if (seen.has(studentId)) {
      throw new ApiError(
        400,
        "학생 또는 직업이 중복되었거나 현재 학급 정보와 맞지 않아요.",
        "INVALID_MONTHLY_ASSIGNMENTS",
      );
    }
    seen.add(studentId);
    return { studentId, classJobId };
  });
}

function parseSubmittedAssignments(
  value: unknown,
  students: StudentRow[],
  jobs: JobRow[],
) {
  const parsed = parseSubmittedAssignmentPayload(value);
  const studentIds = new Set(students.map((student) => student.id));
  const jobIds = new Set(jobs.map((job) => job.id));
  const counts = new Map<string, number>();
  for (const assignment of parsed) {
    if (!studentIds.has(assignment.studentId) || !jobIds.has(assignment.classJobId)) {
      throw new ApiError(
        400,
        "학생 또는 직업이 중복되었거나 현재 학급 정보와 맞지 않아요.",
        "INVALID_MONTHLY_ASSIGNMENTS",
      );
    }
    counts.set(assignment.classJobId, (counts.get(assignment.classJobId) ?? 0) + 1);
  }
  if (parsed.length !== students.length) {
    throw new ApiError(
      422,
      "활성 학생 모두가 직업을 하나씩 선택해야 해요.",
      "MONTHLY_ASSIGNMENT_INCOMPLETE",
    );
  }
  const totalCapacity = jobs.reduce((sum, job) => sum + Number(job.member_capacity), 0);
  if (totalCapacity !== students.length) {
    throw new ApiError(
      422,
      `학생 ${students.length}명과 직업 정원 ${totalCapacity}자리를 정확히 맞춰 주세요.`,
      "JOB_CAPACITY_MISMATCH",
    );
  }
  const mismatched = jobs.find(
    (job) => (counts.get(job.id) ?? 0) !== Number(job.member_capacity),
  );
  if (mismatched) {
    throw new ApiError(
      422,
      `${mismatched.name}의 선택 인원이 정원 ${mismatched.member_capacity}명과 맞지 않아요.`,
      "JOB_CAPACITY_MISMATCH",
    );
  }
  return parsed;
}

function confirmedMonthlyRequestState(input: {
  context: MonthlyContext;
  assignments: SubmittedAssignment[];
  requestId: string;
  expectedRevision: number;
  expectedJobSetupRevision: number;
}) {
  const session = input.context.latestConfirmedSession;
  if (!session?.confirmed_period_id) return { exact: false, reused: false, session: null };
  const prefix = `${input.requestId}:`;
  const requestRows = input.context.confirmedAssignments.filter(
    (row) => row.request_id?.startsWith(prefix),
  );
  if (!requestRows.length) return { exact: false, reused: false, session };
  const byStudent = new Map(requestRows.map((row) => [row.student_id, row]));
  const exact = requestRows.length === input.assignments.length
    && Number(session.revision) === input.expectedRevision + 1
    && Number(session.job_setup_revision) === input.expectedJobSetupRevision
    && input.assignments.every((assignment) => {
      const stored = byStudent.get(assignment.studentId);
      return stored?.class_job_id === assignment.classJobId
        && stored.request_id === `${input.requestId}:${assignment.studentId}`;
    });
  return { exact, reused: true, session };
}

function monthlyChoiceWriteConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("NOT NULL constraint failed: class_job_assignment_periods.status")
    || message.includes("NOT NULL constraint failed: class_job_choice_sessions.status")
    || message.includes("UNIQUE constraint failed: class_job_assignment_periods")
    || message.includes("UNIQUE constraint failed: student_job_assignments")
    || message.includes("UNIQUE constraint failed: class_job_choice_sessions");
}

export async function completeMonthlyJobChoice(input: {
  classId: string;
  teacherId: string;
  expectedRevision: unknown;
  expectedJobSetupRevision: unknown;
  requestId: unknown;
  assignments: unknown;
}) {
  const expectedRevision = validRevision(input.expectedRevision);
  const expectedJobSetupRevision = validRevision(
    input.expectedJobSetupRevision,
    "INVALID_JOB_SETUP_REVISION",
  );
  const requestId = textId(
    input.requestId,
    "확정 요청 번호를 확인할 수 없어요.",
    "INVALID_REQUEST_ID",
    100,
  );
  if (requestId.includes(":")) {
    throw new ApiError(
      400,
      "확정 요청 번호 형식이 올바르지 않아요. 화면을 새로고침한 뒤 다시 시도해 주세요.",
      "INVALID_REQUEST_ID",
    );
  }
  const context = await loadContext(input.classId);
  const submittedPayload = parseSubmittedAssignmentPayload(input.assignments);
  const confirmedRequest = confirmedMonthlyRequestState({
    context,
    assignments: submittedPayload,
    requestId,
    expectedRevision,
    expectedJobSetupRevision,
  });
  if (confirmedRequest.exact && confirmedRequest.session) {
    return {
      periodId: confirmedRequest.session.confirmed_period_id!,
      sessionId: confirmedRequest.session.id,
      confirmedAt: Number(confirmedRequest.session.confirmed_at),
      assignmentCount: submittedPayload.length,
      targetYear: Number(confirmedRequest.session.target_year),
      targetMonth: Number(confirmedRequest.session.target_month),
      idempotent: true,
      board: serializeBoard(context),
    };
  }
  if (confirmedRequest.reused) {
    throw new ApiError(
      409,
      "같은 요청 번호가 다른 다음 달 배정에 이미 사용되었어요. 최신 결과를 확인해 주세요.",
      "MONTHLY_CHOICE_REQUEST_REUSED",
    );
  }
  const assignments = parseSubmittedAssignments(submittedPayload, context.students, context.jobs);
  const session = requireFreshDraftSession(context);
  if (
    Number(session.revision) !== expectedRevision
    || Number(session.job_setup_revision) !== expectedJobSetupRevision
    || Number(context.setup?.revision) !== expectedJobSetupRevision
  ) {
    throw new ApiError(
      409,
      "학생 명단이나 직업 설정이 다른 화면에서 바뀌었어요. 로컬 선택은 유지한 채 최신 정보를 확인해 주세요.",
      "MONTHLY_CHOICE_STALE",
    );
  }
  const orderIndex = new Map(context.order.map((item, index) => [item.studentId, index]));
  assignments.sort(
    (left, right) => (orderIndex.get(left.studentId) ?? 0) - (orderIndex.get(right.studentId) ?? 0),
  );
  const existingPeriod = await database().prepare(
    `SELECT id, status FROM class_job_assignment_periods
     WHERE class_id = ? AND assignment_year = ? AND assignment_month = ?
       AND assignment_type = 'monthly'`,
  ).bind(
    input.classId,
    Number(session.target_year),
    Number(session.target_month),
  ).first<{ id: string; status: string }>();
  if (existingPeriod) {
    throw new ApiError(409, "이 달의 직업 배정이 이미 저장되어 있어요.", "MONTHLY_CHOICE_STALE");
  }
  const now = Date.now();
  const current = seoulServerTime(now);
  const periodId = crypto.randomUUID();
  const db = database();
  const statements = [
    db.prepare(
      `INSERT INTO class_job_assignment_periods (
         id, class_id, assignment_year, assignment_month, assignment_type,
         mode, status, calendar_revision, first_job_start_date, first_job_end_date,
         confirmed_at, confirmed_by_teacher_id, revision, created_at, updated_at
       )
       SELECT ?, ?, ?, ?, 'monthly', 'student_choice', 'draft',
              NULL, NULL, NULL, NULL, NULL, 0, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM class_job_choice_sessions session
         WHERE session.id = ? AND session.class_id = ? AND session.status = 'draft'
           AND session.revision = ? AND session.job_setup_revision = ?
           AND session.student_count_snapshot = ? AND session.order_json = ?
       )
         AND EXISTS (
           SELECT 1 FROM class_job_setup setup
           WHERE setup.class_id = ? AND setup.status = 'completed' AND setup.revision = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM class_job_assignment_periods existing
           WHERE existing.class_id = ? AND existing.assignment_year = ?
             AND existing.assignment_month = ? AND existing.assignment_type = 'monthly'
         )`,
    ).bind(
      periodId,
      input.classId,
      Number(session.target_year),
      Number(session.target_month),
      now,
      now,
      session.id,
      input.classId,
      expectedRevision,
      expectedJobSetupRevision,
      context.students.length,
      session.order_json,
      input.classId,
      expectedJobSetupRevision,
      input.classId,
      Number(session.target_year),
      Number(session.target_month),
    ),
    ...assignments.map((assignment, index) => db.prepare(
      `INSERT INTO student_job_assignments (
         id, period_id, class_id, class_job_id, student_id, assignment_method,
         request_id, assignment_sequence, assigned_at, created_at
       )
       SELECT ?, ?, ?, ?, ?, 'choice', ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM class_job_assignment_periods p
         WHERE p.id = ? AND p.class_id = ? AND p.status = 'draft'
       )
         AND EXISTS (
           SELECT 1 FROM students s
           WHERE s.id = ? AND s.class_id = ? AND s.status <> 'excluded'
         )
         AND EXISTS (
           SELECT 1 FROM class_jobs j
           WHERE j.id = ? AND j.class_id = ? AND j.is_active = 1
         )`,
    ).bind(
      crypto.randomUUID(),
      periodId,
      input.classId,
      assignment.classJobId,
      assignment.studentId,
      `${requestId}:${assignment.studentId}`,
      index + 1,
      now,
      now,
      periodId,
      input.classId,
      assignment.studentId,
      input.classId,
      assignment.classJobId,
      input.classId,
    )),
    db.prepare(
      `UPDATE class_job_assignment_periods
       SET status = CASE WHEN status = 'draft'
         AND EXISTS (
           SELECT 1 FROM class_job_choice_sessions session
           WHERE session.id = ? AND session.class_id = ? AND session.status = 'draft'
             AND session.revision = ? AND session.job_setup_revision = ?
             AND session.student_count_snapshot = ? AND session.order_json = ?
         )
         AND EXISTS (
           SELECT 1 FROM class_job_month_closures closure
           WHERE closure.id = ? AND closure.class_id = ?
             AND closure.source_period_id = (
               SELECT latest.id
               FROM class_job_assignment_periods latest
               WHERE latest.class_id = ? AND latest.status = 'confirmed'
                 AND latest.assignment_type IN ('initial', 'monthly')
                 AND (
                   latest.assignment_year < ?
                   OR (latest.assignment_year = ? AND latest.assignment_month <= ?)
                 )
               ORDER BY latest.assignment_year DESC, latest.assignment_month DESC,
                        latest.confirmed_at DESC, latest.updated_at DESC, latest.id DESC
               LIMIT 1
             )
         )
         AND EXISTS (
           SELECT 1 FROM class_job_setup setup
           WHERE setup.class_id = ? AND setup.status = 'completed' AND setup.revision = ?
         )
         AND (SELECT COUNT(*) FROM students s
              WHERE s.class_id = ? AND s.status <> 'excluded') = ?
         AND (SELECT COUNT(*) FROM student_job_assignments a WHERE a.period_id = ?) = ?
         AND (SELECT COALESCE(SUM(j.member_capacity), 0) FROM class_jobs j
              WHERE j.class_id = ? AND j.is_active = 1) = ?
         AND NOT EXISTS (
           SELECT 1 FROM students s
           WHERE s.class_id = ? AND s.status <> 'excluded'
             AND NOT EXISTS (
               SELECT 1 FROM student_job_assignments a
               WHERE a.period_id = ? AND a.student_id = s.id
             )
         )
         AND NOT EXISTS (
           SELECT 1 FROM student_job_assignments a
           LEFT JOIN students s ON s.id = a.student_id
           LEFT JOIN class_jobs j ON j.id = a.class_job_id
           WHERE a.period_id = ?
             AND (
               s.class_id <> ? OR s.status = 'excluded'
               OR j.class_id <> ? OR j.is_active <> 1
             )
         )
         AND NOT EXISTS (
           SELECT 1 FROM class_jobs j
           WHERE j.class_id = ? AND j.is_active = 1
             AND (
               SELECT COUNT(*) FROM student_job_assignments a
               WHERE a.period_id = ? AND a.class_job_id = j.id
             ) <> j.member_capacity
         )
       THEN 'confirmed' ELSE NULL END,
       confirmed_at = ?, confirmed_by_teacher_id = ?,
       revision = revision + 1, updated_at = ?
       WHERE id = ? AND class_id = ?`,
    ).bind(
      session.id,
      input.classId,
      expectedRevision,
      expectedJobSetupRevision,
      context.students.length,
      session.order_json,
      context.closure!.id,
      input.classId,
      input.classId,
      current.year,
      current.year,
      current.month,
      input.classId,
      expectedJobSetupRevision,
      input.classId,
      assignments.length,
      periodId,
      assignments.length,
      input.classId,
      assignments.length,
      input.classId,
      periodId,
      periodId,
      input.classId,
      input.classId,
      input.classId,
      periodId,
      now,
      input.teacherId,
      now,
      periodId,
      input.classId,
    ),
    db.prepare(
      `UPDATE class_job_choice_sessions
       SET status = CASE WHEN status = 'draft' AND revision = ?
         AND job_setup_revision = ?
         AND EXISTS (
           SELECT 1 FROM class_job_assignment_periods p
           WHERE p.id = ? AND p.class_id = ? AND p.status = 'confirmed'
         )
       THEN 'confirmed' ELSE NULL END,
       confirmed_period_id = ?, confirmed_by_teacher_id = ?, confirmed_at = ?,
       revision = revision + 1, updated_at = ?
       WHERE id = ? AND class_id = ?`,
    ).bind(
      expectedRevision,
      expectedJobSetupRevision,
      periodId,
      input.classId,
      periodId,
      input.teacherId,
      now,
      now,
      session.id,
      input.classId,
    ),
    db.prepare(
      `INSERT INTO audit_logs (
         id, teacher_id, class_id, student_id, action, detail, created_at
       ) VALUES (?, ?, ?, NULL, 'monthly_job_choice_confirmed', ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      input.teacherId,
      input.classId,
      JSON.stringify({
        sessionId: session.id,
        periodId,
        targetYear: Number(session.target_year),
        targetMonth: Number(session.target_month),
        assignmentCount: assignments.length,
        requestId,
        idempotent: false,
      }),
      now,
    ),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    const latestContext = await loadContext(input.classId);
    const latestRequest = confirmedMonthlyRequestState({
      context: latestContext,
      assignments,
      requestId,
      expectedRevision,
      expectedJobSetupRevision,
    });
    if (latestRequest.exact && latestRequest.session) {
      return {
        periodId: latestRequest.session.confirmed_period_id!,
        sessionId: latestRequest.session.id,
        confirmedAt: Number(latestRequest.session.confirmed_at),
        assignmentCount: assignments.length,
        targetYear: Number(latestRequest.session.target_year),
        targetMonth: Number(latestRequest.session.target_month),
        idempotent: true,
        board: serializeBoard(latestContext),
      };
    }
    if (monthlyChoiceWriteConflict(error)) {
      throw new ApiError(
        409,
        "확정 직전에 학생·직업·선택 순서가 바뀌었어요. 로컬 선택은 유지했으니 최신 정보를 확인해 주세요.",
        "MONTHLY_CHOICE_STALE",
      );
    }
    throw error;
  }
  return {
    periodId,
    sessionId: session.id,
    confirmedAt: now,
    assignmentCount: assignments.length,
    targetYear: Number(session.target_year),
    targetMonth: Number(session.target_month),
    idempotent: false,
    board: serializeBoard(await loadContext(input.classId)),
  };
}
