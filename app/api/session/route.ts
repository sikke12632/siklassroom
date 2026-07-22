import { clearSessionCookie, endSession, getSession } from "@/lib/auth";
import { apiFailure, json } from "@/lib/responses";
import { database, ensureSchema } from "@/lib/database";

export async function GET(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) return json({ actor: null });
    if (session.actorType === "teacher" && session.teacherId) {
      const teacher = await database().prepare(`SELECT id, email FROM teachers WHERE id = ? AND status = 'active'`).bind(session.teacherId).first();
      return json({ actor: teacher ? { type: "teacher", ...teacher } : null });
    }
    if (session.actorType === "student" && session.studentId) {
      await ensureSchema();
      const student = await database().prepare(
        `SELECT s.id, s.official_name, s.student_number, c.id AS class_id, c.school_name, c.school_year,
                c.grade, c.class_number, c.display_name
         FROM students s JOIN classes c ON c.id = s.class_id
         WHERE s.id = ? AND s.status = 'active'`,
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
    await endSession(request);
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(request) });
  } catch (error) {
    return apiFailure(error);
  }
}
