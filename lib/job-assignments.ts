import { loadClassCalendar, requireSavedClassCalendar } from "./class-calendar";
import { database, ensureSchema, isOperationGuardFailure } from "./database";
import { activeClassJobs, loadJobSetup } from "./job-storage";
import { cleanDisplayText } from "./identity";
import { randomCandidate } from "./seoul-time";
import { ApiError } from "./responses";

export type AssignmentMethod = "random" | "manual";
export type AssignmentMode = AssignmentMethod;

type StudentRow = {
  id: string;
  student_number: number;
  official_name: string;
  status: string;
};

type PeriodRow = {
  id: string;
  class_id: string;
  assignment_year: number;
  assignment_month: number;
  assignment_type: string;
  mode: AssignmentMode | null;
  status: "draft" | "confirmed";
  calendar_revision: number | null;
  first_job_start_date: string | null;
  first_job_end_date: string | null;
  confirmed_at: number | null;
  confirmed_by_teacher_id: string | null;
  revision: number;
  created_at: number;
  updated_at: number;
};

type AssignmentRow = {
  id: string;
  period_id: string;
  class_job_id: string;
  student_id: string;
  assignment_method: AssignmentMethod;
  request_id: string | null;
  assignment_sequence: number;
  assigned_at: number;
  job_name: string;
  student_number: number;
  student_name: string;
};

type ManualRequestAssignmentRow = {
  class_job_id: string;
  student_id: string;
  assignment_method: string;
  request_id: string;
};

function periodKey(firstJobStartDate: string) {
  const [year, month] = firstJobStartDate.split("-").map(Number);
  return { year, month };
}

async function periodRow(classId: string, year: number, month: number) {
  await ensureSchema();
  return database().prepare(
    `SELECT id, class_id, assignment_year, assignment_month, assignment_type,
            mode, status, calendar_revision, first_job_start_date, first_job_end_date,
            confirmed_at, confirmed_by_teacher_id, revision, created_at, updated_at
     FROM class_job_assignment_periods
     WHERE class_id = ? AND assignment_year = ? AND assignment_month = ? AND assignment_type = 'initial'`,
  ).bind(classId, year, month).first<PeriodRow>();
}

async function latestInitialPeriod(classId: string) {
  await ensureSchema();
  return database().prepare(
    `SELECT id, class_id, assignment_year, assignment_month, assignment_type,
            mode, status, calendar_revision, first_job_start_date, first_job_end_date,
            confirmed_at, confirmed_by_teacher_id, revision, created_at, updated_at
     FROM class_job_assignment_periods
     WHERE class_id = ? AND assignment_type = 'initial'
     ORDER BY confirmed_at DESC, updated_at DESC LIMIT 1`,
  ).bind(classId).first<PeriodRow>();
}

async function ensurePeriod(classId: string) {
  const calendar = await requireSavedClassCalendar(classId);
  const { year, month } = periodKey(calendar.firstJobStartDate);
  const existing = await periodRow(classId, year, month);
  if (existing) return existing;
  const id = crypto.randomUUID();
  const now = Date.now();
  await database().prepare(
    `INSERT OR IGNORE INTO class_job_assignment_periods (
       id, class_id, assignment_year, assignment_month, assignment_type,
       mode, status, calendar_revision, first_job_start_date, first_job_end_date,
       confirmed_at, confirmed_by_teacher_id, revision, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'initial', NULL, 'draft', ?, ?, ?, NULL, NULL, 0, ?, ?)`,
  ).bind(
    id,
    classId,
    year,
    month,
    calendar.revision,
    calendar.firstJobStartDate,
    calendar.firstJobEndDate,
    now,
    now,
  ).run();
  return (await periodRow(classId, year, month))!;
}

async function assignmentRows(periodId: string) {
  const result = await database().prepare(
    `SELECT a.id, a.period_id, a.class_job_id, a.student_id, a.assignment_method,
            a.request_id, a.assignment_sequence, a.assigned_at,
            j.name AS job_name, s.student_number, s.official_name AS student_name
     FROM student_job_assignments a
     JOIN class_jobs j ON j.id = a.class_job_id
     JOIN students s ON s.id = a.student_id
     WHERE a.period_id = ?
     ORDER BY a.assignment_sequence, j.sort_order, s.student_number`,
  ).bind(periodId).all<AssignmentRow>();
  return result.results;
}

async function candidateMap(periodId: string | null) {
  const byJob: Record<string, string[]> = {};
  if (!periodId) return byJob;
  const result = await database().prepare(
    `SELECT c.class_job_id, c.student_id
     FROM job_assignment_candidates c
     JOIN students s ON s.id = c.student_id
     WHERE c.period_id = ? AND s.status <> 'excluded'
       AND NOT EXISTS (
         SELECT 1 FROM student_job_assignments a
         WHERE a.period_id = c.period_id AND a.student_id = c.student_id
       )
     ORDER BY s.student_number`,
  ).bind(periodId).all<{ class_job_id: string; student_id: string }>();
  for (const row of result.results) {
    (byJob[row.class_job_id] ??= []).push(row.student_id);
  }
  return byJob;
}

function preflightState(input: {
  setupReady: boolean;
  studentCount: number;
  jobs: Array<{ memberCapacity: number }>;
  calendarReady: boolean;
  confirmed: boolean;
}) {
  const seatCount = input.jobs.reduce((sum, job) => sum + Number(job.memberCapacity), 0);
  const errors: Array<{ code: string; message: string; action?: string }> = [];
  if (!input.setupReady || input.jobs.length < 1) {
    errors.push({ code: "JOB_SETUP_REQUIRED", message: "우리 반 직업을 먼저 확정해 주세요.", action: "jobs" });
  }
  if (input.studentCount < 1) {
    errors.push({ code: "NO_STUDENTS", message: "활성 학생을 한 명 이상 등록해 주세요.", action: "students" });
  }
  if (input.jobs.some((job) => Number(job.memberCapacity) < 1)) {
    errors.push({ code: "INVALID_JOB_CAPACITY", message: "모든 직업의 정원은 한 자리 이상이어야 해요.", action: "jobs" });
  }
  if (!input.calendarReady) {
    errors.push({ code: "CALENDAR_REQUIRED", message: "달력과 첫 직업 운영 기간을 먼저 저장해 주세요.", action: "calendar" });
  }
  return {
    ready: errors.length === 0 && !input.confirmed,
    errors,
    studentCount: input.studentCount,
    seatCount,
    seatDifference: seatCount - input.studentCount,
    confirmed: input.confirmed,
  };
}

export async function loadInitialAssignmentBoard(
  classId: string,
  requested?: { year?: number; month?: number },
) {
  await ensureSchema();
  const [setup, jobs, studentResult, calendar] = await Promise.all([
    loadJobSetup(classId),
    activeClassJobs(classId),
    database().prepare(
      `SELECT id, student_number, official_name, status
       FROM students WHERE class_id = ? AND status <> 'excluded'
       ORDER BY student_number`,
    ).bind(classId).all<StudentRow>(),
    loadClassCalendar(classId),
  ]);
  let period: PeriodRow | null = null;
  if (requested?.year && requested?.month) {
    period = await periodRow(classId, requested.year, requested.month) ?? null;
  } else if (calendar.saved) {
    const key = periodKey(calendar.firstJobStartDate);
    period = await periodRow(classId, key.year, key.month) ?? null;
  } else {
    period = await latestInitialPeriod(classId) ?? null;
  }
  const assignments = period ? await assignmentRows(period.id) : [];
  const assignedIds = new Set(assignments.map((item) => item.student_id));
  const byJob = new Map<string, AssignmentRow[]>();
  for (const assignment of assignments) {
    const rows = byJob.get(assignment.class_job_id) ?? [];
    rows.push(assignment);
    byJob.set(assignment.class_job_id, rows);
  }
  const setupReady = setup.status === "completed" && jobs.length > 0;
  const preflight = preflightState({
    setupReady,
    studentCount: studentResult.results.length,
    jobs,
    calendarReady: calendar.saved,
    confirmed: period?.status === "confirmed",
  });
  const remainingSeats = Math.max(0, preflight.seatCount - assignments.length);
  return {
    setupReady,
    setupStatus: setup.status,
    calendar,
    assignmentPeriodRecord: period,
    mode: period?.mode ?? null,
    status: period?.status ?? "not_started",
    revision: Number(period?.revision ?? 0),
    students: studentResult.results,
    availableStudents: studentResult.results.filter((student) => !assignedIds.has(student.id)),
    assignments,
    candidateStudentIdsByJob: await candidateMap(period?.id ?? null),
    preflight,
    summary: {
      totalStudents: studentResult.results.length,
      assignedCount: assignments.length,
      availableCount: studentResult.results.length - assignments.length,
      remainingSeats,
      canComplete: preflight.errors.length === 0
        && period?.status === "draft",
    },
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
          sequence: Number(item.assignment_sequence),
        })),
      };
    }),
  };
}

async function requireReadyDraftPeriod(classId: string) {
  const board = await loadInitialAssignmentBoard(classId);
  if (board.assignmentPeriodRecord?.status === "confirmed") {
    throw new ApiError(
      409,
      "첫 직업 배정이 이미 확정됐어요. 이후 변경은 운영 화면의 직업 변경 절차를 이용해 주세요.",
      "ASSIGNMENT_CONFIRMED",
    );
  }
  if (board.preflight.errors.length) {
    const first = board.preflight.errors[0];
    throw new ApiError(422, first.message, first.code);
  }
  return ensurePeriod(classId);
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

function requestId(value: unknown) {
  const id = cleanDisplayText(value, 100);
  if (!id) throw new ApiError(400, "요청 식별값이 없어요. 화면을 새로고침한 뒤 다시 시도해 주세요.", "REQUEST_ID_REQUIRED");
  return id;
}

function compositeRequestId(value: unknown) {
  const id = requestId(value);
  if (id.includes(":")) {
    throw new ApiError(
      400,
      "요청 식별값 형식이 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.",
      "INVALID_REQUEST_ID",
    );
  }
  return id;
}

async function manualRequestAssignments(periodId: string, id: string) {
  const result = await database().prepare(
    `SELECT class_job_id, student_id, assignment_method, request_id
     FROM student_job_assignments
     WHERE period_id = ?
       AND request_id IS NOT NULL
       AND substr(request_id, 1, length(?) + 1) = ? || ':'
     ORDER BY student_id`,
  ).bind(periodId, id, id).all<ManualRequestAssignmentRow>();
  return result.results;
}

function isExactManualRequest(input: {
  rows: ManualRequestAssignmentRow[];
  id: string;
  classJobId: string;
  studentIds: string[];
}) {
  if (input.rows.length !== input.studentIds.length) return false;
  const selected = new Set(input.studentIds);
  return input.rows.every((row) => (
    row.class_job_id === input.classJobId
    && row.assignment_method === "manual"
    && selected.has(row.student_id)
    && row.request_id === `${input.id}:${row.student_id}`
  ));
}

async function existingRequestAssignment(periodId: string, id: string) {
  return database().prepare(
    `SELECT a.id, a.period_id, a.class_job_id, a.student_id, a.assignment_method,
            a.request_id, a.assignment_sequence, a.assigned_at,
            j.name AS job_name, s.student_number, s.official_name AS student_name
     FROM student_job_assignments a
     JOIN class_jobs j ON j.id = a.class_job_id
     JOIN students s ON s.id = a.student_id
     WHERE a.period_id = ? AND a.request_id = ?`,
  ).bind(periodId, id).first<AssignmentRow>();
}

export async function setAssignmentMode(input: {
  classId: string;
  teacherId: string;
  mode: unknown;
}) {
  const mode = input.mode === "random" || input.mode === "manual" ? input.mode : null;
  if (!mode) throw new ApiError(400, "배정 방식을 다시 선택해 주세요.", "INVALID_ASSIGNMENT_MODE");
  const period = await requireReadyDraftPeriod(input.classId);
  const now = Date.now();
  const guardId = crypto.randomUUID();
  const db = database();
  try {
    await db.batch([
      db.prepare(
        `UPDATE class_job_assignment_periods
         SET mode = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND class_id = ? AND status = 'draft' AND revision = ?`,
      ).bind(mode, now, period.id, input.classId, Number(period.revision)),
      db.prepare(
        `INSERT INTO registration_operation_guards (id, operation, created_at)
         SELECT CASE WHEN EXISTS (
           SELECT 1 FROM class_job_assignment_periods
           WHERE id = ? AND class_id = ? AND status = 'draft'
             AND revision = ? AND mode = ? AND updated_at = ?
         ) THEN ? ELSE NULL END, 'job_assignment_mode_change', ?`,
      ).bind(
        period.id,
        input.classId,
        Number(period.revision) + 1,
        mode,
        now,
        guardId,
        now,
      ),
      db.prepare(
        `INSERT INTO audit_logs (
           id, teacher_id, class_id, student_id, action, detail, created_at
         )
         SELECT ?, ?, ?, NULL, 'job_assignment_mode_changed', ?, ?
         WHERE EXISTS (SELECT 1 FROM registration_operation_guards WHERE id = ?)`,
      ).bind(
        crypto.randomUUID(),
        input.teacherId,
        input.classId,
        JSON.stringify({ mode, periodId: period.id }),
        now,
        guardId,
      ),
      db.prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
    ]);
  } catch (error) {
    if (isOperationGuardFailure(error)) {
      throw new ApiError(
        409,
        "배정 방식이 다른 화면에서 먼저 변경됐어요. 최신 화면을 다시 확인해 주세요.",
        "ASSIGNMENT_CONFLICT",
      );
    }
    throw error;
  }
  return { mode, periodId: period.id };
}

export async function saveJobCandidates(input: {
  classId: string;
  classJobId: unknown;
  studentIds: unknown;
}) {
  const period = await requireReadyDraftPeriod(input.classId);
  const job = await requireCompletedJob(input.classId, input.classJobId);
  if (!Array.isArray(input.studentIds)) {
    throw new ApiError(400, "희망 학생 목록을 다시 확인해 주세요.", "INVALID_STUDENTS");
  }
  const ids = input.studentIds.map(String);
  const students = ids.length ? await eligibleStudents(input.classId, ids) : [];
  if (students.length) {
    const placeholders = students.map(() => "?").join(", ");
    const assigned = await database().prepare(
      `SELECT student_id FROM student_job_assignments
       WHERE period_id = ? AND student_id IN (${placeholders})`,
    ).bind(period.id, ...students.map((student) => student.id)).all<{ student_id: string }>();
    if (assigned.results.length) {
      throw new ApiError(
        409,
        "다른 화면에서 이미 배정된 학생이 있어요. 최신 배정표를 불러왔습니다.",
        "ASSIGNMENT_CONFLICT",
      );
    }
  }
  const now = Date.now();
  const db = database();
  await db.batch([
    db.prepare(
      `DELETE FROM job_assignment_candidates WHERE period_id = ? AND class_job_id = ?`,
    ).bind(period.id, job.id),
    ...students.map((student) => db.prepare(
      `INSERT INTO job_assignment_candidates (
         id, period_id, class_job_id, student_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), period.id, job.id, student.id, now, now)),
  ]);
  return { classJobId: job.id, studentIds: students.map((student) => student.id) };
}

export async function createManualAssignments(input: {
  teacherId: string;
  classId: string;
  classJobId: unknown;
  studentIds: unknown;
  requestId: unknown;
}) {
  const period = await requireReadyDraftPeriod(input.classId);
  const job = await requireCompletedJob(input.classId, input.classJobId);
  if (!Array.isArray(input.studentIds)) {
    throw new ApiError(400, "배정할 학생을 다시 선택해 주세요.", "INVALID_STUDENTS");
  }
  const students = await eligibleStudents(input.classId, input.studentIds.map(String));
  const id = compositeRequestId(input.requestId);
  const selectedStudentIds = students.map((student) => student.id);
  const existing = await manualRequestAssignments(period.id, id);
  if (existing.length) {
    if (isExactManualRequest({
      rows: existing,
      id,
      classJobId: job.id,
      studentIds: selectedStudentIds,
    })) {
      return { job, students, assignmentCount: students.length, idempotent: true };
    }
    throw new ApiError(
      409,
      "같은 요청 식별값이 다른 배정에 이미 사용되었습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.",
      "ASSIGNMENT_REQUEST_REUSED",
    );
  }
  const now = Date.now();
  const db = database();
  const selectedJson = JSON.stringify(selectedStudentIds);
  const reservationGuardId = crypto.randomUUID();
  const completionGuardId = crypto.randomUUID();
  const insert = db.prepare(
    `WITH selected(student_id) AS (
       SELECT CAST(value AS TEXT) FROM json_each(?)
     ),
     valid AS (
       SELECT s.id, s.student_number
       FROM students s JOIN selected x ON x.student_id = s.id
       WHERE s.class_id = ? AND s.status <> 'excluded'
         AND NOT EXISTS (
           SELECT 1 FROM student_job_assignments a
           WHERE a.period_id = ? AND a.student_id = s.id
         )
     ),
     base AS (
       SELECT COALESCE(MAX(assignment_sequence), 0) AS sequence
       FROM student_job_assignments WHERE period_id = ?
     )
     INSERT INTO student_job_assignments (
       id, period_id, class_id, class_job_id, student_id, assignment_method,
       request_id, assignment_sequence, assigned_at, created_at
     )
     SELECT lower(hex(randomblob(16))), ?, ?, ?, valid.id, 'manual',
            ? || ':' || valid.id,
            base.sequence + ROW_NUMBER() OVER (ORDER BY valid.student_number),
            ?, ?
     FROM valid CROSS JOIN base
     WHERE (SELECT COUNT(*) FROM valid) = (SELECT COUNT(*) FROM selected)
       AND (SELECT COUNT(*) FROM valid) <= (
         (SELECT member_capacity FROM class_jobs WHERE id = ? AND class_id = ? AND is_active = 1)
         - (SELECT COUNT(*) FROM student_job_assignments WHERE period_id = ? AND class_job_id = ?)
       )
       AND EXISTS (
         SELECT 1 FROM class_job_assignment_periods
         WHERE id = ? AND class_id = ? AND status = 'draft'
       )`,
  ).bind(
    selectedJson,
    input.classId,
    period.id,
    period.id,
    period.id,
    input.classId,
    job.id,
    id,
    now,
    now,
    job.id,
    input.classId,
    period.id,
    job.id,
    period.id,
    input.classId,
  );
  const placeholders = students.map(() => "?").join(", ");
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO registration_operation_guards (id, operation, created_at)
         SELECT CASE WHEN
           EXISTS (
             SELECT 1 FROM class_job_assignment_periods
             WHERE id = ? AND class_id = ? AND status = 'draft'
           )
           AND NOT EXISTS (
             SELECT 1 FROM student_job_assignments
             WHERE period_id = ? AND request_id IS NOT NULL
               AND substr(request_id, 1, length(?) + 1) = ? || ':'
           )
         THEN ? ELSE NULL END, 'job_assignment_manual_reserve', ?`,
      ).bind(
        period.id,
        input.classId,
        period.id,
        id,
        id,
        reservationGuardId,
        now,
      ),
      insert,
      db.prepare(
        `INSERT INTO registration_operation_guards (id, operation, created_at)
         SELECT CASE WHEN
           EXISTS (SELECT 1 FROM registration_operation_guards WHERE id = ?)
           AND (
             SELECT COUNT(*) FROM student_job_assignments
             WHERE period_id = ? AND request_id IS NOT NULL
               AND substr(request_id, 1, length(?) + 1) = ? || ':'
           ) = ?
           AND NOT EXISTS (
             SELECT 1 FROM json_each(?) selected
             WHERE NOT EXISTS (
               SELECT 1 FROM student_job_assignments assignment
               WHERE assignment.period_id = ?
                 AND assignment.student_id = CAST(selected.value AS TEXT)
                 AND assignment.class_job_id = ?
                 AND assignment.assignment_method = 'manual'
                 AND assignment.request_id = ? || ':' || CAST(selected.value AS TEXT)
             )
           )
         THEN ? ELSE NULL END, 'job_assignment_manual_complete', ?`,
      ).bind(
        reservationGuardId,
        period.id,
        id,
        id,
        students.length,
        selectedJson,
        period.id,
        job.id,
        id,
        completionGuardId,
        now,
      ),
      db.prepare(
        `DELETE FROM job_assignment_candidates
         WHERE period_id = ? AND student_id IN (${placeholders})`,
      ).bind(period.id, ...selectedStudentIds),
      db.prepare(
        `UPDATE class_job_assignment_periods
         SET revision = revision + 1, updated_at = ? WHERE id = ? AND status = 'draft'`,
      ).bind(now, period.id),
      db.prepare(
        `INSERT INTO audit_logs (
           id, teacher_id, class_id, student_id, action, detail, created_at
         ) VALUES (?, ?, ?, NULL, 'job_assignment_manual', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        input.teacherId,
        input.classId,
        JSON.stringify({
          classJobId: job.id,
          studentIds: selectedStudentIds,
          assignmentCount: students.length,
          requestId: id,
          idempotent: false,
        }),
        now,
      ),
      db.prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(completionGuardId),
      db.prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(reservationGuardId),
    ]);
  } catch (error) {
    if (isOperationGuardFailure(error)) {
      const latest = await manualRequestAssignments(period.id, id);
      if (isExactManualRequest({
        rows: latest,
        id,
        classJobId: job.id,
        studentIds: selectedStudentIds,
      })) {
        return { job, students, assignmentCount: students.length, idempotent: true };
      }
      if (latest.length) {
        throw new ApiError(
          409,
          "같은 요청 식별값이 다른 배정에 이미 사용되었습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.",
          "ASSIGNMENT_REQUEST_REUSED",
        );
      }
      throw new ApiError(
        409,
        "정원이 부족하거나 다른 화면에서 먼저 배정된 학생이 있어 아무 내용도 저장하지 않았습니다.",
        "ASSIGNMENT_CONFLICT",
      );
    }
    const latest = await manualRequestAssignments(period.id, id);
    if (isExactManualRequest({
      rows: latest,
      id,
      classJobId: job.id,
      studentIds: selectedStudentIds,
    })) {
      return { job, students, assignmentCount: students.length, idempotent: true };
    }
    throw error;
  }
  return { job, students, assignmentCount: students.length, idempotent: false };
}

export async function createRandomAssignment(input: {
  teacherId: string;
  classId: string;
  classJobId: unknown;
  candidateStudentIds: unknown;
  requestId: unknown;
}) {
  const period = await requireReadyDraftPeriod(input.classId);
  const job = await requireCompletedJob(input.classId, input.classJobId);
  const id = requestId(input.requestId);
  const prior = await existingRequestAssignment(period.id, id);
  if (prior) {
    return {
      assignmentId: prior.id,
      job: { id: prior.class_job_id, name: prior.job_name, member_capacity: job.member_capacity },
      student: {
        id: prior.student_id,
        student_number: prior.student_number,
        official_name: prior.student_name,
        status: "active",
      },
      candidateCount: 1,
      sequence: Number(prior.assignment_sequence),
      idempotent: true,
    };
  }
  if (!Array.isArray(input.candidateStudentIds)) {
    throw new ApiError(400, "희망 학생을 다시 선택해 주세요.", "INVALID_STUDENTS");
  }
  const students = await eligibleStudents(input.classId, input.candidateStudentIds.map(String));
  const existing = await database().prepare(
    `SELECT student_id FROM student_job_assignments
     WHERE period_id = ? AND student_id IN (${students.map(() => "?").join(", ")})`,
  ).bind(period.id, ...students.map((student) => student.id)).all<{ student_id: string }>();
  const alreadyAssigned = new Set(existing.results.map((row) => row.student_id));
  const hopefuls = students.filter((student) => !alreadyAssigned.has(student.id));
  if (!hopefuls.length) {
    throw new ApiError(
      409,
      "선택한 희망 학생이 모두 다른 직업에 배정됐어요. 최신 배정표를 불러왔습니다.",
      "NO_AVAILABLE_CANDIDATES",
    );
  }
  const student = randomCandidate(hopefuls);
  const assignmentId = crypto.randomUUID();
  const reservationGuardId = crypto.randomUUID();
  const completionGuardId = crypto.randomUUID();
  const now = Date.now();
  const db = database();
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO registration_operation_guards (id, operation, created_at)
         SELECT CASE WHEN
           EXISTS (
             SELECT 1 FROM class_job_assignment_periods
             WHERE id = ? AND class_id = ? AND status = 'draft'
           )
           AND NOT EXISTS (
             SELECT 1 FROM student_job_assignments
             WHERE period_id = ? AND request_id = ?
           )
         THEN ? ELSE NULL END, 'job_assignment_random_reserve', ?`,
      ).bind(
        period.id,
        input.classId,
        period.id,
        id,
        reservationGuardId,
        now,
      ),
      db.prepare(
        `INSERT INTO student_job_assignments (
           id, period_id, class_id, class_job_id, student_id, assignment_method,
           request_id, assignment_sequence, assigned_at, created_at
         )
         SELECT ?, ?, ?, ?, ?, 'random', ?,
                COALESCE((SELECT MAX(assignment_sequence) + 1
                          FROM student_job_assignments WHERE period_id = ?), 1),
                ?, ?
         WHERE EXISTS (
           SELECT 1 FROM registration_operation_guards WHERE id = ?
         )
           AND EXISTS (
             SELECT 1 FROM students WHERE id = ? AND class_id = ? AND status <> 'excluded'
           )
           AND EXISTS (
             SELECT 1 FROM class_jobs j
             JOIN class_job_setup setup ON setup.class_id = j.class_id
             WHERE j.id = ? AND j.class_id = ? AND j.is_active = 1
               AND setup.status = 'completed'
           )
           AND NOT EXISTS (
             SELECT 1 FROM student_job_assignments WHERE period_id = ? AND student_id = ?
           )
           AND (
             SELECT COUNT(*) FROM student_job_assignments
             WHERE period_id = ? AND class_job_id = ?
           ) < (
             SELECT member_capacity FROM class_jobs
             WHERE id = ? AND class_id = ? AND is_active = 1
           )`,
      ).bind(
        assignmentId,
        period.id,
        input.classId,
        job.id,
        student.id,
        id,
        period.id,
        now,
        now,
        reservationGuardId,
        student.id,
        input.classId,
        job.id,
        input.classId,
        period.id,
        student.id,
        period.id,
        job.id,
        job.id,
        input.classId,
      ),
      db.prepare(
        `INSERT INTO registration_operation_guards (id, operation, created_at)
         SELECT CASE WHEN
           EXISTS (SELECT 1 FROM registration_operation_guards WHERE id = ?)
           AND EXISTS (
             SELECT 1 FROM student_job_assignments
             WHERE id = ? AND period_id = ? AND class_id = ?
               AND class_job_id = ? AND student_id = ?
               AND assignment_method = 'random' AND request_id = ?
           )
         THEN ? ELSE NULL END, 'job_assignment_random_complete', ?`,
      ).bind(
        reservationGuardId,
        assignmentId,
        period.id,
        input.classId,
        job.id,
        student.id,
        id,
        completionGuardId,
        now,
      ),
      db.prepare(
        `DELETE FROM job_assignment_candidates
         WHERE period_id = ? AND student_id = ?
           AND EXISTS (SELECT 1 FROM registration_operation_guards WHERE id = ?)`,
      ).bind(period.id, student.id, completionGuardId),
      db.prepare(
        `UPDATE class_job_assignment_periods
         SET revision = revision + 1, updated_at = ?
         WHERE id = ? AND class_id = ? AND status = 'draft'
           AND EXISTS (SELECT 1 FROM registration_operation_guards WHERE id = ?)`,
      ).bind(now, period.id, input.classId, completionGuardId),
      db.prepare(
        `INSERT INTO audit_logs (
           id, teacher_id, class_id, student_id, action, detail, created_at
         )
         SELECT ?, ?, ?, ?, 'job_assignment_random',
                json_object(
                  'classJobId', ?, 'assignmentId', ?, 'candidateCount', ?,
                  'sequence', (
                    SELECT assignment_sequence FROM student_job_assignments WHERE id = ?
                  ),
                  'requestId', ?, 'idempotent', json('false')
                ), ?
         WHERE EXISTS (SELECT 1 FROM registration_operation_guards WHERE id = ?)`,
      ).bind(
        crypto.randomUUID(),
        input.teacherId,
        input.classId,
        student.id,
        job.id,
        assignmentId,
        hopefuls.length,
        assignmentId,
        id,
        now,
        completionGuardId,
      ),
      db.prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(completionGuardId),
      db.prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(reservationGuardId),
    ]);
  } catch (error) {
    const duplicate = await existingRequestAssignment(period.id, id);
    if (!duplicate) {
      if (isOperationGuardFailure(error)) {
        throw new ApiError(
          409,
          "다른 화면에서 학생이 먼저 배정됐거나 직업 자리가 모두 찼어요.",
          "ASSIGNMENT_CONFLICT",
        );
      }
      throw error;
    }
    return {
      assignmentId: duplicate.id,
      job,
      student: {
        id: duplicate.student_id,
        student_number: duplicate.student_number,
        official_name: duplicate.student_name,
        status: "active",
      },
      candidateCount: hopefuls.length,
      sequence: Number(duplicate.assignment_sequence),
      idempotent: true,
    };
  }
  const saved = await existingRequestAssignment(period.id, id);
  return {
    assignmentId,
    job,
    student,
    candidateCount: hopefuls.length,
    sequence: Number(saved?.assignment_sequence ?? 0),
    idempotent: false,
  };
}

export async function removeInitialAssignment(input: {
  classId: string;
  teacherId: string;
  assignmentId: unknown;
}) {
  const id = cleanDisplayText(input.assignmentId, 100);
  if (!id) throw new ApiError(400, "취소할 배정을 찾을 수 없어요.", "ASSIGNMENT_REQUIRED");
  const current = await database().prepare(
    `SELECT a.id, a.student_id, a.class_job_id, a.assignment_method,
            a.assignment_sequence, p.id AS period_id, p.assignment_year, p.assignment_month,
            p.status, p.revision AS period_revision
     FROM student_job_assignments a
     JOIN class_job_assignment_periods p ON p.id = a.period_id
     WHERE a.id = ? AND a.class_id = ? AND p.assignment_type = 'initial'`,
  ).bind(id, input.classId).first<Record<string, string | number>>();
  if (!current) throw new ApiError(404, "배정 기록을 찾을 수 없어요.", "ASSIGNMENT_NOT_FOUND");
  if (current.status === "confirmed") {
    throw new ApiError(
      409,
      "이미 확정된 첫 배정은 초기 설정 화면에서 취소할 수 없어요.",
      "ASSIGNMENT_CONFIRMED",
    );
  }
  const now = Date.now();
  const reservationGuardId = crypto.randomUUID();
  const completionGuardId = crypto.randomUUID();
  const db = database();
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO registration_operation_guards (id, operation, created_at)
         SELECT CASE WHEN
           EXISTS (
             SELECT 1 FROM student_job_assignments assignment
             JOIN class_job_assignment_periods period ON period.id = assignment.period_id
             WHERE assignment.id = ? AND assignment.class_id = ?
               AND period.id = ? AND period.status = 'draft' AND period.revision = ?
           )
         THEN ? ELSE NULL END, 'job_assignment_remove_reserve', ?`,
      ).bind(
        id,
        input.classId,
        current.period_id,
        Number(current.period_revision),
        reservationGuardId,
        now,
      ),
      db.prepare(
        `DELETE FROM student_job_assignments
         WHERE id = ? AND class_id = ?
           AND EXISTS (SELECT 1 FROM registration_operation_guards WHERE id = ?)`,
      ).bind(id, input.classId, reservationGuardId),
      db.prepare(
        `INSERT INTO registration_operation_guards (id, operation, created_at)
         SELECT CASE WHEN
           EXISTS (SELECT 1 FROM registration_operation_guards WHERE id = ?)
           AND NOT EXISTS (
             SELECT 1 FROM student_job_assignments WHERE id = ? AND class_id = ?
           )
         THEN ? ELSE NULL END, 'job_assignment_remove', ?`,
      ).bind(reservationGuardId, id, input.classId, completionGuardId, now),
      db.prepare(
        `UPDATE class_job_assignment_periods
         SET revision = revision + 1, updated_at = ?
         WHERE id = ? AND class_id = ? AND status = 'draft' AND revision = ?
           AND EXISTS (SELECT 1 FROM registration_operation_guards WHERE id = ?)`,
      ).bind(
        now,
        current.period_id,
        input.classId,
        Number(current.period_revision),
        completionGuardId,
      ),
      db.prepare(
        `INSERT INTO audit_logs (
           id, teacher_id, class_id, student_id, action, detail, created_at
         )
         SELECT ?, ?, ?, ?, 'job_assignment_removed', ?, ?
         WHERE EXISTS (SELECT 1 FROM registration_operation_guards WHERE id = ?)`,
      ).bind(
        crypto.randomUUID(),
        input.teacherId,
        input.classId,
        String(current.student_id),
        JSON.stringify({
          assignmentId: id,
          classJobId: current.class_job_id,
          method: current.assignment_method,
          year: current.assignment_year,
          month: current.assignment_month,
        }),
        now,
        completionGuardId,
      ),
      db.prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(completionGuardId),
      db.prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(reservationGuardId),
    ]);
  } catch (error) {
    if (isOperationGuardFailure(error)) {
      throw new ApiError(
        409,
        "다른 화면에서 배정 상태가 먼저 변경됐어요. 최신 배정표를 다시 확인해 주세요.",
        "ASSIGNMENT_CONFLICT",
      );
    }
    throw error;
  }
  return current;
}

type SubmittedAssignment = {
  classJobId: string;
  studentId: string;
  method: AssignmentMethod;
};

function parseSubmittedAssignmentPayload(value: unknown) {
  if (!Array.isArray(value) || value.length > 60) {
    throw new ApiError(400, "전체 배정표를 다시 확인해 주세요.", "INVALID_ASSIGNMENTS");
  }
  const seenStudents = new Set<string>();
  return value.map((item): SubmittedAssignment => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const classJobId = cleanDisplayText(row.classJobId, 100);
    const studentId = cleanDisplayText(row.studentId, 100);
    const method = row.method === "random" || row.method === "manual" ? row.method : null;
    if (!classJobId || !studentId || !method || seenStudents.has(studentId)) {
      throw new ApiError(400, "학생 또는 직업이 중복되었거나 현재 학급 정보와 맞지 않아요.", "INVALID_ASSIGNMENTS");
    }
    seenStudents.add(studentId);
    return { classJobId, studentId, method };
  });
}

function submittedAssignments(
  value: unknown,
  board: Awaited<ReturnType<typeof loadInitialAssignmentBoard>>,
) {
  const assignments = parseSubmittedAssignmentPayload(value);
  const studentOrder = new Map(board.students.map((student, index) => [student.id, index]));
  const studentIds = new Set(board.students.map((student) => student.id));
  const jobIds = new Set(board.jobs.map((job) => job.id));
  const jobCounts = new Map<string, number>();
  for (const assignment of assignments) {
    if (!jobIds.has(assignment.classJobId) || !studentIds.has(assignment.studentId)) {
      throw new ApiError(400, "학생 또는 직업이 중복되었거나 현재 학급 정보와 맞지 않아요.", "INVALID_ASSIGNMENTS");
    }
    jobCounts.set(assignment.classJobId, (jobCounts.get(assignment.classJobId) ?? 0) + 1);
  }
  if (board.jobs.some((job) => (jobCounts.get(job.id) ?? 0) > Number(job.memberCapacity))) {
    throw new ApiError(422, "직업별 배정 인원이 설정한 정원을 초과했어요.", "JOB_CAPACITY_EXCEEDED");
  }
  return assignments.sort(
    (left, right) => (studentOrder.get(left.studentId) ?? 0) - (studentOrder.get(right.studentId) ?? 0),
  );
}

async function storedInitialConfirmationRequestId(classId: string, periodId: string) {
  const result = await database().prepare(
    `SELECT detail FROM audit_logs
     WHERE class_id = ? AND action = 'initial_job_assignments_confirmed'
     ORDER BY created_at DESC, id DESC`,
  ).bind(classId).all<{ detail: string }>();
  for (const row of result.results) {
    try {
      const detail = JSON.parse(row.detail) as Record<string, unknown>;
      if (detail.periodId === periodId && typeof detail.requestId === "string") {
        return detail.requestId;
      }
    } catch {}
  }
  return null;
}

async function isExactSubmittedCompletion(input: {
  classId: string;
  periodId: string;
  stored: AssignmentRow[];
  submitted: SubmittedAssignment[];
  requestId: string;
}) {
  if (input.stored.length === 0) {
    const storedRequestId = await storedInitialConfirmationRequestId(
      input.classId,
      input.periodId,
    );
    if (storedRequestId === input.requestId) {
      return { exact: input.submitted.length === 0, reused: true };
    }
    if (input.submitted.length === 0) {
      return { exact: false, reused: false };
    }
  }
  const prefix = `${input.requestId}:`;
  const requestRows = input.stored.filter((row) => row.request_id?.startsWith(prefix));
  if (requestRows.length !== input.submitted.length) {
    return { exact: false, reused: requestRows.length > 0 };
  }
  const byStudent = new Map(requestRows.map((row) => [row.student_id, row]));
  const exact = input.submitted.every((assignment) => {
    const stored = byStudent.get(assignment.studentId);
    return stored?.class_job_id === assignment.classJobId
      && stored.assignment_method === assignment.method
      && stored.request_id === `${input.requestId}:${assignment.studentId}`;
  });
  return { exact, reused: requestRows.length > 0 };
}

async function completeSubmittedAssignments(input: {
  classId: string;
  teacherId: string;
  mode: unknown;
  expectedRevision: unknown;
  expectedCalendarRevision: unknown;
  requestId: unknown;
  assignments: unknown;
}) {
  const mode = input.mode === "random" || input.mode === "manual" ? input.mode : null;
  if (!mode) throw new ApiError(400, "배정 방식을 다시 선택해 주세요.", "INVALID_ASSIGNMENT_MODE");
  const expectedRevision = Number(input.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new ApiError(400, "배정표 버전을 확인할 수 없어요. 새로고침한 뒤 다시 시도해 주세요.", "INVALID_REVISION");
  }
  const expectedCalendarRevision = Number(input.expectedCalendarRevision);
  if (!Number.isInteger(expectedCalendarRevision) || expectedCalendarRevision < 1) {
    throw new ApiError(400, "달력 버전을 확인할 수 없어요. 새로고침한 뒤 다시 시도해 주세요.", "INVALID_CALENDAR_REVISION");
  }
  const idempotencyKey = compositeRequestId(input.requestId);
  const submittedPayload = parseSubmittedAssignmentPayload(input.assignments);
  const currentBoard = await loadInitialAssignmentBoard(input.classId);
  const currentPeriod = currentBoard.assignmentPeriodRecord;
  if (currentPeriod?.status === "confirmed") {
    const requestState = await isExactSubmittedCompletion({
      classId: input.classId,
      periodId: currentPeriod.id,
      stored: currentBoard.assignments,
      submitted: submittedPayload,
      requestId: idempotencyKey,
    });
    if (requestState.exact && currentPeriod.mode === mode) {
      return {
        periodId: currentPeriod.id,
        confirmedAt: Number(currentPeriod.confirmed_at),
        assignmentCount: submittedPayload.length,
        source: "local_draft",
        idempotent: true,
      };
    }
    if (requestState.reused) {
      throw new ApiError(
        409,
        "같은 요청 식별값이 다른 배정표에 이미 사용되었습니다. 최신 배정표를 확인해 주세요.",
        "ASSIGNMENT_REQUEST_REUSED",
      );
    }
    throw new ApiError(
      409,
      "첫 직업 배정이 이미 확정되었습니다. 최신 배정표를 확인해 주세요.",
      "ASSIGNMENT_CONFIRMED",
    );
  }
  const period = await requireReadyDraftPeriod(input.classId);
  if (Number(period.revision) !== expectedRevision) {
    throw new ApiError(
      409,
      "학생이나 직업 정보가 다른 화면에서 바뀌었어요. 새로고침한 뒤 다시 확인해 주세요.",
      "ASSIGNMENT_CONFIRM_CONFLICT",
    );
  }
  const board = await loadInitialAssignmentBoard(input.classId, {
    year: Number(period.assignment_year),
    month: Number(period.assignment_month),
  });
  if (board.calendar.revision !== expectedCalendarRevision) {
    throw new ApiError(
      409,
      "달력이 다른 화면에서 바뀌었어요. 새로고침한 뒤 운영 기간을 다시 확인해 주세요.",
      "ASSIGNMENT_CONFIRM_CONFLICT",
    );
  }
  const assignments = submittedAssignments(submittedPayload, board);
  const now = Date.now();
  const db = database();
  const reservationGuardId = crypto.randomUUID();
  const completionGuardId = crypto.randomUUID();
  const statements = [
    db.prepare(
      `INSERT INTO registration_operation_guards (id, operation, created_at)
       SELECT CASE WHEN
         EXISTS (
           SELECT 1 FROM class_job_assignment_periods
           WHERE id = ? AND class_id = ? AND status = 'draft' AND revision = ?
         )
         AND EXISTS (
           SELECT 1 FROM class_calendars
           WHERE class_id = ? AND revision = ?
             AND first_job_start_date = ? AND first_job_end_date = ?
         )
         AND EXISTS (
           SELECT 1 FROM class_job_setup
           WHERE class_id = ? AND status = 'completed'
         )
        THEN ? ELSE NULL END, 'initial_job_assignments_complete', ?`,
    ).bind(
      period.id,
      input.classId,
      expectedRevision,
      input.classId,
      expectedCalendarRevision,
      board.calendar.firstJobStartDate,
      board.calendar.firstJobEndDate,
      input.classId,
      reservationGuardId,
      now,
    ),
    db.prepare(
      `DELETE FROM student_job_assignments
       WHERE period_id = ? AND EXISTS (
         SELECT 1 FROM class_job_assignment_periods
         WHERE id = ? AND class_id = ? AND status = 'draft' AND revision = ?
       )`,
    ).bind(period.id, period.id, input.classId, expectedRevision),
    ...assignments.map((assignment, index) => db.prepare(
      `INSERT INTO student_job_assignments (
         id, period_id, class_id, class_job_id, student_id, assignment_method,
         request_id, assignment_sequence, assigned_at, created_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM class_job_assignment_periods
         WHERE id = ? AND class_id = ? AND status = 'draft' AND revision = ?
       )
         AND EXISTS (
           SELECT 1 FROM students WHERE id = ? AND class_id = ? AND status <> 'excluded'
         )
         AND EXISTS (
           SELECT 1 FROM class_jobs j
           JOIN class_job_setup setup ON setup.class_id = j.class_id
           WHERE j.id = ? AND j.class_id = ? AND j.is_active = 1 AND setup.status = 'completed'
         )`,
    ).bind(
      crypto.randomUUID(),
      period.id,
      input.classId,
      assignment.classJobId,
      assignment.studentId,
      assignment.method,
      `${idempotencyKey}:${assignment.studentId}`,
      index + 1,
      now,
      now,
      period.id,
      input.classId,
      expectedRevision,
      assignment.studentId,
      input.classId,
      assignment.classJobId,
      input.classId,
    )),
    db.prepare(
      `INSERT INTO registration_operation_guards (id, operation, created_at)
       SELECT CASE WHEN
         EXISTS (SELECT 1 FROM registration_operation_guards WHERE id = ?)
         AND (SELECT COUNT(*) FROM student_job_assignments WHERE period_id = ?) = ?
         AND NOT EXISTS (
           SELECT 1 FROM student_job_assignments assignment
           LEFT JOIN students student ON student.id = assignment.student_id
           LEFT JOIN class_jobs job ON job.id = assignment.class_job_id
           WHERE assignment.period_id = ?
              AND (student.id IS NULL OR student.class_id <> ? OR student.status = 'excluded'
                OR job.id IS NULL OR job.class_id <> ? OR job.is_active <> 1)
         )
         AND NOT EXISTS (
           SELECT 1 FROM class_jobs job
           WHERE job.class_id = ? AND job.is_active = 1
             AND (
               SELECT COUNT(*) FROM student_job_assignments assignment
               WHERE assignment.period_id = ? AND assignment.class_job_id = job.id
              ) > job.member_capacity
         )
       THEN ? ELSE NULL END, 'initial_job_assignments_complete', ?`,
    ).bind(
      reservationGuardId,
      period.id,
      assignments.length,
      period.id,
      input.classId,
      input.classId,
      input.classId,
      period.id,
      completionGuardId,
      now,
    ),
    db.prepare(
      `DELETE FROM job_assignment_candidates WHERE period_id = ?`,
    ).bind(period.id),
    db.prepare(
      `UPDATE class_job_assignment_periods
       SET mode = ?, status = 'confirmed',
           calendar_revision = ?, first_job_start_date = ?, first_job_end_date = ?,
           confirmed_at = ?, confirmed_by_teacher_id = ?,
           revision = revision + 1, updated_at = ?
       WHERE id = ? AND class_id = ? AND status = 'draft' AND revision = ?
         AND EXISTS (SELECT 1 FROM registration_operation_guards WHERE id = ?)`,
    ).bind(
      mode,
      expectedCalendarRevision,
      board.calendar.firstJobStartDate,
      board.calendar.firstJobEndDate,
      now,
      input.teacherId,
      now,
      period.id,
      input.classId,
      expectedRevision,
      completionGuardId,
    ),
    db.prepare(
      `UPDATE classes SET setup_stage = 'completed', updated_at = ?
       WHERE id = ? AND EXISTS (
         SELECT 1 FROM class_job_assignment_periods
         WHERE id = ? AND class_id = ? AND status = 'confirmed'
       )`,
    ).bind(now, input.classId, period.id, input.classId),
    db.prepare(
      `INSERT INTO audit_logs (
         id, teacher_id, class_id, student_id, action, detail, created_at
       ) VALUES (?, ?, ?, NULL, 'initial_job_assignments_confirmed', ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      input.teacherId,
      input.classId,
      JSON.stringify({
        periodId: period.id,
        confirmedAt: now,
        assignmentCount: assignments.length,
        requestId: idempotencyKey,
        source: "local_draft",
        idempotent: false,
      }),
      now,
    ),
    db.prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(completionGuardId),
    db.prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(reservationGuardId),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (isOperationGuardFailure(error)) {
      throw new ApiError(
        409,
        "확정 직전에 학생·직업·달력 정보가 바뀌었어요. 로컬 배정은 유지했으니 새로고침 후 다시 확인해 주세요.",
        "ASSIGNMENT_CONFIRM_CONFLICT",
      );
    }
    throw error;
  }
  return {
    periodId: period.id,
    confirmedAt: now,
    assignmentCount: assignments.length,
    source: "local_draft",
    idempotent: false,
  };
}

export async function completeInitialAssignments(input: {
  classId: string;
  teacherId: string;
  mode?: unknown;
  expectedRevision?: unknown;
  expectedCalendarRevision?: unknown;
  requestId?: unknown;
  assignments?: unknown;
}) {
  if (input.assignments !== undefined) {
    return completeSubmittedAssignments({
      classId: input.classId,
      teacherId: input.teacherId,
      mode: input.mode,
      expectedRevision: input.expectedRevision,
      expectedCalendarRevision: input.expectedCalendarRevision,
      requestId: input.requestId,
      assignments: input.assignments,
    });
  }
  const period = await requireReadyDraftPeriod(input.classId);
  const board = await loadInitialAssignmentBoard(input.classId, {
    year: Number(period.assignment_year),
    month: Number(period.assignment_month),
  });
  if (!board.summary.canComplete) {
    throw new ApiError(
      422,
      "현재 배정표를 확정할 수 없어요. 학생·직업·달력 정보를 다시 확인해 주세요.",
      "ASSIGNMENT_NOT_READY",
    );
  }
  const now = Date.now();
  const db = database();
  const completionGuardId = crypto.randomUUID();
  try {
    await db.batch([
      db.prepare(
        `UPDATE class_job_assignment_periods
         SET status = 'confirmed', confirmed_at = ?, confirmed_by_teacher_id = ?,
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND class_id = ? AND status = 'draft'
            AND EXISTS (SELECT 1 FROM class_calendars WHERE class_id = ?)
            AND NOT EXISTS (
              SELECT 1 FROM student_job_assignments assignment
              LEFT JOIN students student ON student.id = assignment.student_id
              LEFT JOIN class_jobs job ON job.id = assignment.class_job_id
              WHERE assignment.period_id = ?
                AND (student.id IS NULL OR student.class_id <> ? OR student.status = 'excluded'
                  OR job.id IS NULL OR job.class_id <> ? OR job.is_active <> 1)
            )
            AND NOT EXISTS (
              SELECT 1 FROM class_jobs job
              WHERE job.class_id = ? AND job.is_active = 1
                AND (
                  SELECT COUNT(*) FROM student_job_assignments assignment
                  WHERE assignment.period_id = ? AND assignment.class_job_id = job.id
                ) > job.member_capacity
            )`,
      ).bind(
        now, input.teacherId, now, period.id, input.classId,
        input.classId, period.id, input.classId, input.classId, input.classId, period.id,
      ),
      db.prepare(
        `INSERT INTO registration_operation_guards (id, operation, created_at)
         SELECT CASE WHEN EXISTS (
           SELECT 1 FROM class_job_assignment_periods
           WHERE id = ? AND class_id = ? AND status = 'confirmed'
             AND confirmed_at = ? AND confirmed_by_teacher_id = ?
         ) THEN ? ELSE NULL END, 'initial_job_assignments_complete', ?`,
      ).bind(
        period.id,
        input.classId,
        now,
        input.teacherId,
        completionGuardId,
        now,
      ),
      db.prepare(
        `UPDATE classes SET setup_stage = 'completed', updated_at = ?
         WHERE id = ? AND EXISTS (
           SELECT 1 FROM class_job_assignment_periods
           WHERE id = ? AND class_id = ? AND status = 'confirmed'
         )`,
      ).bind(now, input.classId, period.id, input.classId),
      db.prepare(
        `INSERT INTO audit_logs (
           id, teacher_id, class_id, student_id, action, detail, created_at
         ) VALUES (?, ?, ?, NULL, 'initial_job_assignments_confirmed', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        input.teacherId,
        input.classId,
        JSON.stringify({
          periodId: period.id,
          confirmedAt: now,
          assignmentCount: board.assignments.length,
          source: "server_draft",
          idempotent: false,
        }),
        now,
      ),
      db.prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(completionGuardId),
    ]);
  } catch (error) {
    if (isOperationGuardFailure(error)) {
      throw new ApiError(
        409,
        "확정 직전에 학생이나 직업 정보가 바뀌었어요. 최신 배정표를 확인해 주세요.",
        "ASSIGNMENT_CONFIRM_CONFLICT",
      );
    }
    throw error;
  }
  return {
    periodId: period.id,
    confirmedAt: now,
    assignmentCount: board.assignments.length,
    source: "server_draft",
    idempotent: false,
  };
}
