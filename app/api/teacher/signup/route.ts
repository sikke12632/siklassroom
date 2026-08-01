import { createGuardedTeacherSession } from "@/lib/auth";
import { audit, database, ensureSchema } from "@/lib/database";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { normalizeEmail } from "@/lib/identity";
import { ApiError, apiFailure, json, readJson } from "@/lib/responses";
import { issueEmailVerification } from "@/lib/teacher-verification";
import { assertNotBlocked, recordFailure, throttleKey } from "@/lib/rate-limit";
import { activateOpenTeacherRegistration, isOpenTeacherRegistration } from "@/lib/open-registration";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ email?: string; password?: string }>(request);
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "");
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 160) throw new ApiError(400, "사용할 이메일을 정확히 입력해 주세요.", "INVALID_EMAIL");
    if (password.length < 8 || password.length > 72) throw new ApiError(400, "비밀번호는 8~72자로 만들어 주세요.", "WEAK_PASSWORD");
    const throttle = await throttleKey(request, "teacher-signup", email);
    await assertNotBlocked(throttle);
    await ensureSchema();
    const openRegistration = isOpenTeacherRegistration();
    const existing = await database().prepare(
      `SELECT id, password_hash, email_verified_at, teacher_access_status,
              teacher_access_verified_at, school_id, manual_school_request_id, credential_revision
       FROM teachers WHERE email = ?`,
    ).bind(email).first<{
      id: string;
      password_hash: string;
      email_verified_at: number | null;
      teacher_access_status: string;
      teacher_access_verified_at: number | null;
      school_id: string | null;
      manual_school_request_id: string | null;
      credential_revision: number;
    }>();
    if (existing) {
      if (!existing.email_verified_at && await verifyPassword(password, existing.password_hash)) {
        await activateOpenTeacherRegistration(existing.id);
        const now = Date.now();
        const openAccess = openRegistration && existing.teacher_access_status !== "revoked";
        const verification = openRegistration
          ? undefined
          : await issueEmailVerification({ teacherId: existing.id, email, request });
        const session = await createGuardedTeacherSession({
          teacherId: existing.id,
          passwordHash: existing.password_hash,
          credentialRevision: existing.credential_revision,
          request,
        });
        await recordFailure(throttle);
        return json({
          teacher: {
            id: existing.id,
            email,
            email_verified_at: openRegistration ? now : null,
            teacher_access_status: openAccess ? "invite_verified" : existing.teacher_access_status,
            teacher_access_verified_at: openAccess ? (existing.teacher_access_verified_at ?? now) : existing.teacher_access_verified_at,
            school_id: existing.school_id,
            manual_school_request_id: existing.manual_school_request_id,
            registration_mode: openRegistration ? "open" : "verified",
          },
          verification,
        }, 200, { "Set-Cookie": session.cookie });
      }
      throw new ApiError(409, "이미 가입한 이메일이에요. 로그인하거나 비밀번호를 다시 설정해 주세요.", "EMAIL_EXISTS");
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    const passwordHash = await hashPassword(password);
    await database().prepare(
      `INSERT INTO teachers
       (id, email, password_hash, status, email_verified_at, teacher_access_status,
        teacher_access_verified_at, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      email,
      passwordHash,
      openRegistration ? now : null,
      openRegistration ? "invite_verified" : "pending",
      openRegistration ? now : null,
      now,
      now,
    ).run();
    await audit({ action: "teacher_signup", teacherId: id });
    const verification = openRegistration
      ? undefined
      : await issueEmailVerification({ teacherId: id, email, request });
    const session = await createGuardedTeacherSession({
      teacherId: id,
      passwordHash,
      credentialRevision: 0,
      request,
    });
    await recordFailure(throttle);
    return json({
      teacher: {
        id,
        email,
        email_verified_at: openRegistration ? now : null,
        teacher_access_status: openRegistration ? "invite_verified" : "pending",
        teacher_access_verified_at: openRegistration ? now : null,
        school_id: null,
        manual_school_request_id: null,
        registration_mode: openRegistration ? "open" : "verified",
      },
      verification,
    }, 201, { "Set-Cookie": session.cookie });
  } catch (error) {
    return apiFailure(error);
  }
}
