import { clearSessionCookie, endSession, getSession } from "@/lib/auth";
import { apiFailure, assertSameOriginRequest, json } from "@/lib/responses";
import { database, ensureSchema } from "@/lib/database";
import { isOpenTeacherRegistration } from "@/lib/open-registration";

export async function GET(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) return json({ actor: null });
    if (session.actorType === "teacher" && session.teacherId) {
      const teacher = await database().prepare(
        `SELECT t.id, t.email, t.email_verified_at, t.teacher_access_status,
                t.teacher_access_verified_at, t.school_id, t.manual_school_request_id,
                COALESCE(s.official_name, r.entered_name) AS school_display_name,
                COALESCE(s.province_name, r.province_name) AS school_province_name,
                COALESCE(s.school_level, r.school_level) AS school_level,
                CASE WHEN r.id IS NOT NULL AND r.status = 'pending' THEN 1 ELSE 0 END AS school_pending
         FROM teachers t
         LEFT JOIN schools s ON s.id = t.school_id
         LEFT JOIN school_manual_requests r ON r.id = t.manual_school_request_id
         WHERE t.id = ? AND t.status = 'active'`,
      ).bind(session.teacherId).first();
      if (
        teacher
        && isOpenTeacherRegistration()
        && (!teacher.email_verified_at || teacher.teacher_access_status !== "invite_verified")
      ) {
        await endSession(request);
        return json(
          { actor: null, reauthenticationRequired: true },
          200,
          { "Set-Cookie": clearSessionCookie(request) },
        );
      }
      return json({
        actor: teacher ? {
          type: "teacher",
          ...teacher,
          registration_mode: isOpenTeacherRegistration() ? "open" : "verified",
        } : null,
      });
    }
    if (session.actorType === "student" && session.studentId) {
      await ensureSchema();
      const student = await database().prepare(
        `SELECT s.id, s.official_name, s.student_number, c.id AS class_id, c.school_name, c.school_year,
                c.grade, c.class_number, c.display_name
         FROM students s JOIN classes c ON c.id = s.class_id
         WHERE s.id = ? AND s.status = 'active' AND c.status = 'active'`,
      ).bind(session.studentId).first();
      return json({ actor: student ? { type: "student", ...student } : null });
    }
    return json({ actor: null });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOriginRequest(request);
    await endSession(request);
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(request) });
  } catch (error) {
    return apiFailure(error);
  }
}
