import { database, ensureSchema, isOperationGuardFailure } from "./database";
import { randomToken, sha256 } from "./crypto";
import { requestCookie } from "./cookies";
import { ApiError } from "./responses";
import { teacherAccountIssue } from "./teacher-access-rules";

export const SESSION_COOKIE = "job_classroom_session";
const TEACHER_SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const STUDENT_SESSION_MS = 4 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type SessionActor = {
  actorType: "teacher" | "student";
  teacherId: string | null;
  studentId: string | null;
  expiresAt: number;
};

export type TeacherAccess = {
  teacherId: string;
  emailVerifiedAt: number | null;
  teacherAccessStatus: "pending" | "invite_verified" | "revoked";
  schoolId: string | null;
  manualSchoolRequestId: string | null;
};

function secureCookieSuffix(request?: Request) {
  return request && new URL(request.url).protocol !== "https:" ? "" : "; Secure";
}

function sessionCookie(token: string, maxAgeSeconds: number, request?: Request) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secureCookieSuffix(request)}`;
}

export function clearSessionCookie(request?: Request) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookieSuffix(request)}`;
}

export async function prepareSession(
  actor: { actorType: "teacher" | "student"; teacherId?: string | null; studentId?: string | null },
  request?: Request,
) {
  const rawToken = randomToken(32);
  const tokenHash = await sha256(rawToken);
  const now = Date.now();
  const lifetime = actor.actorType === "teacher" ? TEACHER_SESSION_MS : STUDENT_SESSION_MS;
  return {
    id: crypto.randomUUID(),
    tokenHash,
    actorType: actor.actorType,
    teacherId: actor.teacherId ?? null,
    studentId: actor.studentId ?? null,
    expiresAt: now + lifetime,
    createdAt: now,
    cookie: sessionCookie(rawToken, Math.floor(lifetime / 1000), request),
  };
}

export async function createSession(actor: { actorType: "teacher" | "student"; teacherId?: string | null; studentId?: string | null }, request?: Request) {
  await ensureSchema();
  const session = await prepareSession(actor, request);
  await database().prepare(
    `INSERT INTO sessions (id, token_hash, actor_type, teacher_id, student_id, expires_at, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    session.id, session.tokenHash, session.actorType, session.teacherId,
    session.studentId, session.expiresAt, session.createdAt, session.createdAt,
  ).run();
  return { cookie: session.cookie };
}

export async function createGuardedTeacherSession(input: {
  teacherId: string;
  passwordHash: string;
  credentialRevision: number;
  request: Request;
  clearThrottleKeys?: string[];
  activateOpenRegistration?: boolean;
}) {
  await ensureSchema();
  const session = await prepareSession({ actorType: "teacher", teacherId: input.teacherId }, input.request);
  const guardId = crypto.randomUUID();
  const now = Date.now();
  const activationCondition = input.activateOpenRegistration
    ? " AND (email_verified_at IS NULL OR teacher_access_status != 'invite_verified')"
    : "";
  const statements: D1PreparedStatement[] = [
    database().prepare(
      `INSERT INTO registration_operation_guards (id, operation, created_at)
       SELECT CASE WHEN EXISTS (
         SELECT 1 FROM teachers
         WHERE id = ? AND status = 'active' AND teacher_access_status != 'revoked'
           AND password_hash = ? AND credential_revision = ?${activationCondition}
       ) THEN ? ELSE NULL END, 'teacher_password_login', ?`,
    ).bind(input.teacherId, input.passwordHash, input.credentialRevision, guardId, now),
  ];
  if (input.activateOpenRegistration) {
    statements.push(
      database().prepare(`DELETE FROM sessions WHERE teacher_id = ?`).bind(input.teacherId),
      database().prepare(
        `UPDATE teachers
         SET email_verified_at = COALESCE(email_verified_at, ?),
             teacher_access_status = 'invite_verified',
             teacher_access_verified_at = COALESCE(teacher_access_verified_at, ?),
             credential_revision = credential_revision + 1,
             updated_at = ?
         WHERE id = ?`,
      ).bind(now, now, now, input.teacherId),
      database().prepare(
        `INSERT INTO audit_logs (id, teacher_id, action, detail, created_at)
         VALUES (?, ?, 'teacher_open_registration_activated', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        input.teacherId,
        JSON.stringify({ mode: "temporary_open_registration" }),
        now,
      ),
    );
  }
  statements.push(
    database().prepare(
      `INSERT INTO sessions
       (id, token_hash, actor_type, teacher_id, student_id, expires_at, created_at, last_seen_at)
       VALUES (?, ?, 'teacher', ?, NULL, ?, ?, ?)`,
    ).bind(
      session.id, session.tokenHash, input.teacherId,
      session.expiresAt, session.createdAt, session.createdAt,
    ),
  );
  for (const key of new Set(input.clearThrottleKeys ?? [])) {
    statements.push(database().prepare(`DELETE FROM login_throttles WHERE key = ?`).bind(key));
  }
  statements.push(database().prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId));
  try {
    await database().batch(statements);
  } catch (error) {
    if (isOperationGuardFailure(error)) {
      throw new ApiError(401, "이메일 또는 비밀번호를 다시 확인해 주세요.", "LOGIN_FAILED");
    }
    throw error;
  }
  return { cookie: session.cookie };
}

export async function prepareTeacherSessionRotation(teacherId: string, request: Request) {
  await ensureSchema();
  const rawToken = requestCookie(request, SESSION_COOKIE);
  if (!rawToken) {
    throw new ApiError(401, "교사 로그인이 필요합니다.", "TEACHER_LOGIN_REQUIRED");
  }
  const currentTokenHash = await sha256(rawToken);
  const next = await prepareSession({ actorType: "teacher", teacherId }, request);
  const guardId = crypto.randomUUID();
  const now = Date.now();
  return {
    cookie: next.cookie,
    guardId,
    guard: database().prepare(
      `INSERT INTO registration_operation_guards (id, operation, created_at)
       SELECT CASE WHEN EXISTS (
         SELECT 1 FROM sessions session
         JOIN teachers teacher ON teacher.id = session.teacher_id
         WHERE session.token_hash = ? AND session.actor_type = 'teacher'
           AND session.teacher_id = ? AND session.expires_at > ?
           AND teacher.status = 'active' AND teacher.teacher_access_status != 'revoked'
       ) THEN ? ELSE NULL END, 'teacher_session_rotation', ?`,
    ).bind(currentTokenHash, teacherId, now, guardId, now),
    revoke: database().prepare(`DELETE FROM sessions WHERE teacher_id = ?`).bind(teacherId),
    create: database().prepare(
      `INSERT INTO sessions
       (id, token_hash, actor_type, teacher_id, student_id, expires_at, created_at, last_seen_at)
       VALUES (?, ?, 'teacher', ?, NULL, ?, ?, ?)`,
    ).bind(
      next.id, next.tokenHash, teacherId,
      next.expiresAt, next.createdAt, next.createdAt,
    ),
    cleanup: database().prepare(`DELETE FROM registration_operation_guards WHERE id = ?`).bind(guardId),
  };
}

export async function getSession(request: Request): Promise<SessionActor | null> {
  await ensureSchema();
  const rawToken = requestCookie(request, SESSION_COOKIE);
  if (!rawToken) return null;
  const tokenHash = await sha256(rawToken);
  const row = await database().prepare(
    `SELECT actor_type, teacher_id, student_id, expires_at, last_seen_at
     FROM sessions WHERE token_hash = ?`,
  ).bind(tokenHash).first<{
    actor_type: string;
    teacher_id: string | null;
    student_id: string | null;
    expires_at: number;
    last_seen_at: number;
  }>();
  const now = Date.now();
  if (!row || row.expires_at <= now) {
    if (row) await database().prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(tokenHash).run();
    return null;
  }
  if (row.actor_type !== "teacher" && row.actor_type !== "student") return null;
  if (row.last_seen_at <= now - SESSION_TOUCH_INTERVAL_MS) {
    await database().prepare(
      `UPDATE sessions SET last_seen_at = ?
       WHERE token_hash = ? AND last_seen_at <= ?`,
    ).bind(now, tokenHash, now - SESSION_TOUCH_INTERVAL_MS).run();
  }
  return { actorType: row.actor_type, teacherId: row.teacher_id, studentId: row.student_id, expiresAt: row.expires_at };
}

export async function requireTeacher(request: Request): Promise<{ teacherId: string }> {
  const session = await getSession(request);
  if (!session || session.actorType !== "teacher" || !session.teacherId) {
    throw new ApiError(401, "교사 로그인이 필요합니다.", "TEACHER_LOGIN_REQUIRED");
  }
  const teacher = await database().prepare(
    `SELECT status, teacher_access_status FROM teachers WHERE id = ?`,
  ).bind(session.teacherId).first<{ status: string; teacher_access_status: string }>();
  if (!teacher) throw new ApiError(403, "사용할 수 없는 교사 계정입니다.", "ACCOUNT_DISABLED");
  const issue = teacherAccountIssue(teacher.status, teacher.teacher_access_status);
  if (issue === "TEACHER_ACCESS_REVOKED") {
    throw new ApiError(403, "교사 이용 권한이 회수되어 사용할 수 없어요.", issue);
  }
  if (issue) throw new ApiError(403, "사용할 수 없는 교사 계정입니다.", issue);
  return { teacherId: session.teacherId };
}

export async function teacherAccess(request: Request): Promise<TeacherAccess> {
  const { teacherId } = await requireTeacher(request);
  const teacher = await database().prepare(
    `SELECT email_verified_at, teacher_access_status, school_id, manual_school_request_id
     FROM teachers WHERE id = ?`,
  ).bind(teacherId).first<{
    email_verified_at: number | null;
    teacher_access_status: string;
    school_id: string | null;
    manual_school_request_id: string | null;
  }>();
  if (!teacher) throw new ApiError(403, "사용할 수 없는 교사 계정입니다.", "ACCOUNT_DISABLED");
  const status = teacher.teacher_access_status;
  return {
    teacherId,
    emailVerifiedAt: teacher.email_verified_at,
    teacherAccessStatus: status === "invite_verified" || status === "revoked" ? status : "pending",
    schoolId: teacher.school_id,
    manualSchoolRequestId: teacher.manual_school_request_id,
  };
}

export async function requireEmailVerified(request: Request): Promise<TeacherAccess> {
  const access = await teacherAccess(request);
  if (!access.emailVerifiedAt) {
    throw new ApiError(403, "이메일 확인을 먼저 완료해 주세요.", "EMAIL_VERIFICATION_REQUIRED");
  }
  return access;
}

export async function requireTeacherAccess(request: Request): Promise<TeacherAccess> {
  const access = await requireEmailVerified(request);
  if (access.teacherAccessStatus === "revoked") {
    throw new ApiError(403, "교사 이용 권한이 회수되어 변경할 수 없습니다.", "TEACHER_ACCESS_REVOKED");
  }
  if (access.teacherAccessStatus !== "invite_verified") {
    throw new ApiError(403, "초대코드 인증을 먼저 완료해 주세요.", "INVITE_VERIFICATION_REQUIRED");
  }
  return access;
}

export async function requireClassManagement(request: Request): Promise<TeacherAccess> {
  const access = await requireTeacherAccess(request);
  if (!access.schoolId && !access.manualSchoolRequestId) {
    throw new ApiError(403, "학교를 먼저 선택하거나 직접 입력해 주세요.", "SCHOOL_SELECTION_REQUIRED");
  }
  if (!access.schoolId && access.manualSchoolRequestId) {
    const pendingRequest = await database().prepare(
      `SELECT id FROM school_manual_requests
       WHERE id = ? AND submitted_by_teacher_id = ? AND status = 'pending'`,
    ).bind(access.manualSchoolRequestId, access.teacherId).first();
    if (!pendingRequest) {
      throw new ApiError(403, "학교를 다시 선택하거나 직접 입력해 주세요.", "SCHOOL_SELECTION_REQUIRED");
    }
  }
  return access;
}

export async function requireStudent(request: Request): Promise<{ studentId: string }> {
  const session = await getSession(request);
  if (!session || session.actorType !== "student" || !session.studentId) {
    throw new ApiError(401, "학생 로그인이 필요합니다.", "STUDENT_LOGIN_REQUIRED");
  }
  const student = await database().prepare(
    `SELECT s.status AS student_status, c.status AS class_status
     FROM students s JOIN classes c ON c.id = s.class_id
     WHERE s.id = ?`,
  ).bind(session.studentId).first<{ student_status: string; class_status: string }>();
  if (!student || student.student_status !== "active" || student.class_status !== "active") {
    throw new ApiError(403, "이 계정은 지금 로그인할 수 없어요.", "ACCOUNT_DISABLED");
  }
  return { studentId: session.studentId };
}

export async function endSession(request: Request) {
  await ensureSchema();
  const rawToken = requestCookie(request, SESSION_COOKIE);
  if (rawToken) await database().prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await sha256(rawToken)).run();
}

export async function revokeActorSessions(actorType: "teacher" | "student", actorId: string) {
  await ensureSchema();
  const column = actorType === "teacher" ? "teacher_id" : "student_id";
  await database().prepare(`DELETE FROM sessions WHERE ${column} = ?`).bind(actorId).run();
}
