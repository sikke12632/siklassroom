import { database, ensureSchema } from "./database";
import { activeClassJobs, loadJobSetup } from "./job-storage";
import { cleanDisplayText } from "./identity";
import { randomCandidate } from "./seoul-time";
import { ApiError } from "./responses";

export type AssignmentMethod = "random" | "manual";

type StudentRow = {
  id: string;
  student_number: number;
  official_name: string;
  status: string;
};

type AssignmentRow = {
  id: string;
  period_id: string;
  class_job_id: string;
  student_id: string;
  assignment_method: AssignmentMethod;
  assigned_at: number;
  job_name: string;
  student_number: number;
  student_name: string;
};

async function periodRow(classId: string, year: number, month: number) {
  return database().prepare(
    `SELECT id, class_id, assignment_year, assignment_month, assignment_type, created_at, updated_at
     FROM class_job_assignment_periods
     WHERE class_id = ? AND assignment_year = ? AND assignment_month = ? AND assignment_type = 'initial'`,
  ).bind(classId, year, month).first<Record<string, string | number>>();
}

async function ensurePeriod(classId: string, year: number, month: number) {
  await ensureSchema();
  const existing = await periodRow(classId, year, month);
  if (existing) return existing;
  const id = crypto.randomUUID();
  const now = Date.now();
  await database().prepare(
    `INSERT OR IGNORE INTO class_job_assignment_periods
     (id, class_id, assignment_year, assignment_month, assignment_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'initial', ?, ?)`,
  ).bind(id, classId, year, month, now, now).run();
  return (await periodRow(classId, year, month))!;
}

async function assignmentRows(periodId: string) {
  const result = await database().prepare(
    `SELECT a.id, a.period_id, a.class_job_id, a.student_id, a.assignment_method, a.assigned_at,
            j.name AS job_name, s.student_number, s.official_name AS student_name
     FROM student_job_assignments a
     JOIN class_jobs j ON j.id = a.class_job_id
     JOIN students s ON s.id = a.student_id
     WHERE a.period_id = ?
     ORDER BY j.sort_order, s.student_number, a.created_at`,
  ).bind(periodId).all<AssignmentRow>();
  return result.results;
}

export async function loadInitialAssignmentBoard(classId: string, year: number, month: number) {
  await ensureSchema();
  const [setup, jobs, studentResult, period] = await Promise.all([
    loadJobSetup(classId),
    activeClassJobs(classId),
    database().prepare(
      `SELECT id, student_number, official_name, status
       FROM students WHERE class_id = ? AND status <> 'excluded'
       ORDER BY student_number`,
    ).bind(classId).all<StudentRow>(),
    periodRow(classId, year, month),
  ]);
  const assignments = period ? await assignmentRows(String(period.id)) : [];
  const assignedIds = new Set(assignments.map((item) => item.student_id));
  const byJob = new Map<string, AssignmentRow[]>();
  for (const assignment of assignments) {
    const rows = byJob.get(assignment.class_job_id) ?? [];
    rows.push(assignment);
    byJob.set(assignment.class_job_id, rows);
  }
  return {
    setupReady: setup.status === "completed" && jobs.length > 0,
    setupStatus: setup.status,
    assignmentPeriodRecord: period ?? null,
    students: studentResult.results,
    availableStudents: studentResult.results.filter((student) => !assignedIds.has(student.id)),
    assignments,
    jobs: jobs.map((job) => {
      const assigned = byJob.get(job.id) ?? [];
      return {
        ...job,
        assignedCount: assigned.length,
        remainingCapacity: Math.max(0, job.memberCapacity - assigned.length),
        assignedStudents: assigned.map((item) => ({
          assignmentId: item.id,
          id: item.student_id,
          studentNumber: Number(item.student_number),
          name: item.student_name,
          method: item.assignment_method,
        })),
      };
    }),
  };
}

async function requireCompletedJob(classId: string, classJobId: unknown) {
  const id = cleanDisplayText(classJobId, 100);
  if (!id) throw new ApiError(400, "배정할 직업을 선택해 주세요.", "JOB_REQUIRED");
  const job = await database().prepare(
    `SELECT j.id, j.name, j.member_capacity
     FROM class_jobs j
     JOIN class_job_setup setup ON setup.class_id = j.class_id
     WHERE j.id = ? AND j.class_id = ? AND j.is_active = 1 AND setup.status = 'completed'`,
  ).bind(id, classId).first<{ id: string; name: string; member_capacity: number }>();
  if (!job) {
    throw new ApiError(409, "우리 반 직업을 먼저 확정해 주세요.", "JOB_SETUP_REQUIRED");
  }
  return job;
}

async function eligibleStudents(classId: string, studentIds: string[]) {
  if (!studentIds.length) {
    throw new ApiError(422, "학생을 한 명 이상 선택해 주세요.", "STUDENT_REQUIRED");
  }
  const uniqueIds = [...new Set(studentIds.map((id) => cleanDisplayText(id, 100)).filter(Boolean))];
  if (uniqueIds.length !== studentIds.length || uniqueIds.length > 60) {
    throw new ApiError(400, "선택한 학생 목록을 다시 확인해 주세요.", "INVALID_STUDENTS");
  }
  const placeholders = uniqueIds.map(() => "?").join(", ");
  const result = await database().prepare(
    `SELECT id, student_number, official_name, status
     FROM students
     WHERE class_id = ? AND status <> 'excluded' AND id IN (${placeholders})
     ORDER BY student_number`,
  ).bind(classId, ...uniqueIds).all<StudentRow>();
  if (result.results.length !== uniqueIds.length) {
    throw new ApiError(400, "우리 반의 배정 가능한 학생만 선택해 주세요.", "INVALID_STUDENTS");
  }
  return result.results;
}

async function insertAssignment(input: {
  classId: string;
  periodId: string;
  classJobId: string;
  studentId: string;
  method: AssignmentMethod;
}) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const result = await database().prepare(
    `INSERT INTO student_job_assignments
       (id, period_id, class_id, class_job_id, student_id, assignment_method, assigned_at, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?
     WHERE EXISTS (
       SELECT 1 FROM students
       WHERE id = ? AND class_id = ? AND status <> 'excluded'
     )
       AND EXISTS (
         SELECT 1 FROM class_jobs j
         JOIN class_job_setup setup ON setup.class_id = j.class_id
         WHERE j.id = ? AND j.class_id = ? AND j.is_active = 1 AND setup.status = 'completed'
       )
       AND NOT EXISTS (
         SELECT 1 FROM student_job_assignments WHERE period_id = ? AND student_id = ?
       )
       AND (
         SELECT COUNT(*) FROM student_job_assignments
         WHERE period_id = ? AND class_job_id = ?
       ) < (
         SELECT member_capacity FROM class_jobs WHERE id = ? AND class_id = ? AND is_active = 1
       )`,
  ).bind(
    id, input.periodId, input.classId, input.classJobId, input.studentId, input.method, now, now,
    input.studentId, input.classId,
    input.classJobId, input.classId,
    input.periodId, input.studentId,
    input.periodId, input.classJobId,
    input.classJobId, input.classId,
  ).run();
  if (!result.meta.changes) {
    throw new ApiError(
      409,
      "이미 배정된 학생이거나 직업 자리가 모두 찼어요. 화면을 새로 불러와 주세요.",
      "ASSIGNMENT_CONFLICT",
    );
  }
  return id;
}

export async function createManualAssignment(input: {
  classId: string;
  year: number;
  month: number;
  classJobId: unknown;
  studentId: unknown;
}) {
  const job = await requireCompletedJob(input.classId, input.classJobId);
  const students = await eligibleStudents(input.classId, [String(input.studentId ?? "")]);
  const period = await ensurePeriod(input.classId, input.year, input.month);
  const assignmentId = await insertAssignment({
    classId: input.classId,
    periodId: String(period.id),
    classJobId: job.id,
    studentId: students[0].id,
    method: "manual",
  });
  return { assignmentId, job, student: students[0] };
}

export async function createRandomAssignment(input: {
  classId: string;
  year: number;
  month: number;
  classJobId: unknown;
  candidateStudentIds: unknown;
}) {
  const job = await requireCompletedJob(input.classId, input.classJobId);
  if (!Array.isArray(input.candidateStudentIds)) {
    throw new ApiError(400, "희망 학생을 다시 선택해 주세요.", "INVALID_STUDENTS");
  }
  const students = await eligibleStudents(input.classId, input.candidateStudentIds.map(String));
  const period = await ensurePeriod(input.classId, input.year, input.month);
  const existing = await database().prepare(
    `SELECT student_id FROM student_job_assignments
     WHERE period_id = ? AND student_id IN (${students.map(() => "?").join(", ")})`,
  ).bind(String(period.id), ...students.map((student) => student.id)).all<{ student_id: string }>();
  const alreadyAssigned = new Set(existing.results.map((row) => row.student_id));
  const hopefuls = students.filter((student) => !alreadyAssigned.has(student.id));
  if (!hopefuls.length) {
    throw new ApiError(409, "선택한 희망 학생은 이미 다른 직업에 배정됐어요.", "NO_AVAILABLE_CANDIDATES");
  }
  const student = randomCandidate(hopefuls);
  const assignmentId = await insertAssignment({
    classId: input.classId,
    periodId: String(period.id),
    classJobId: job.id,
    studentId: student.id,
    method: "random",
  });
  return { assignmentId, job, student, candidateCount: hopefuls.length };
}

export async function removeInitialAssignment(classId: string, assignmentId: unknown) {
  const id = cleanDisplayText(assignmentId, 100);
  if (!id) throw new ApiError(400, "취소할 배정을 찾을 수 없어요.", "ASSIGNMENT_REQUIRED");
  const current = await database().prepare(
    `SELECT a.id, a.student_id, a.class_job_id, a.assignment_method,
            p.assignment_year, p.assignment_month
     FROM student_job_assignments a
     JOIN class_job_assignment_periods p ON p.id = a.period_id
     WHERE a.id = ? AND a.class_id = ? AND p.assignment_type = 'initial'`,
  ).bind(id, classId).first<Record<string, string | number>>();
  if (!current) throw new ApiError(404, "배정 기록을 찾을 수 없어요.", "ASSIGNMENT_NOT_FOUND");
  await database().prepare(
    `DELETE FROM student_job_assignments WHERE id = ? AND class_id = ?`,
  ).bind(id, classId).run();
  return current;
}
