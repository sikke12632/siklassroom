import { requireTeacher } from "@/lib/auth";
import { database } from "@/lib/database";
import { apiFailure, json } from "@/lib/responses";
import { issueEmailVerification } from "@/lib/teacher-verification";
import { assertNotBlocked, recordFailure, throttleKey } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const { teacherId } = await requireTeacher(request);
    const key = await throttleKey(request, "teacher-email-verification", teacherId);
    await assertNotBlocked(key);
    const teacher = await database().prepare(
      `SELECT email, email_verified_at FROM teachers WHERE id = ?`,
    ).bind(teacherId).first<{ email: string; email_verified_at: number | null }>();
    if (!teacher) return json({ ok: true });
    if (teacher.email_verified_at) return json({ ok: true, alreadyVerified: true });
    const verification = await issueEmailVerification({ teacherId, email: teacher.email, request });
    await recordFailure(key);
    return json({ ok: true, verification });
  } catch (error) {
    return apiFailure(error);
  }
}
