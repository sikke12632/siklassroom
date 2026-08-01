import { database, ensureSchema } from "./database";
import { randomToken, sha256 } from "./crypto";
import { ApiError } from "./responses";
import { teacherAccountIssue } from "./teacher-access-rules";

export const SESSION_COOKIE = "job_classroom_session";
const TEACHER_SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const STUDENT_SESSION_MS = 4 * 60 * 60 * 1000;

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

function requestCookie(request: Request, name: string): string | null {
  const source = request.headers.get("cookie") ?? "";
  for (const part of source.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

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

export async function getSession(request: Request): Promise<SessionActor | null> {
  await ensureSchema();
  const rawToken = requestCookie(request, SESSION_COOKIE);
  if (!rawToken) return null;
  const tokenHash = await sha256(rawToken);
  const row = await database().prepare(
    `SELECT actor_type, teacher_id, student_id, expires_at FROM sessions WHERE token_hash = ?`,
  ).bind(tokenHash).first<{ actor_type: string; teacher_id: string | null; student_id: string | null; expires_at: number }>();
  if (!row || row.expires_at <= Date.now()) {
    if (row) await database().prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(tokenHash).run();
    return null;
  }
  if (row.actor_type !== "teacher" && row.actor_type !== "student") return null;
  await database().prepare(`UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?`).bind(Date.now(), tokenHash).run();
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
  return access;
}

export async function requireStudent(request: Request): Promise<{ studentId: string }> {
  const session = await getSession(request);
  if (!session || session.actorType !== "student" || !session.studentId) {
    throw new ApiError(401, "학생 로그인이 필요합니다.", "STUDENT_LOGIN_REQUIRED");
  }
  const student = await database().prepare(`SELECT status FROM students WHERE id = ?`).bind(session.studentId).first<{ status: string }>();
  if (!student || student.status !== "active") throw new ApiError(403, "이 계정은 지금 로그인할 수 없어요.", "ACCOUNT_DISABLED");
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
