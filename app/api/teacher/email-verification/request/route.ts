import { requireTeacher } from "@/lib/auth";
import { database } from "@/lib/database";
import { apiFailure, assertSameOriginRequest, json } from "@/lib/responses";
import { issueEmailVerification } from "@/lib/teacher-verification";
import { consumeRateLimit, subjectThrottleKey } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const noStore = { "Cache-Control": "no-store" };
    assertSameOriginRequest(request);
    const { teacherId } = await requireTeacher(request);
    const key = await subjectThrottleKey("teacher-email-verification", teacherId);
    await consumeRateLimit(key, {
      maxAttempts: 5,
      windowMs: 60 * 60 * 1000,
      blockMs: 60 * 60 * 1000,
    });
    const teacher = await database().prepare(
      `SELECT email, email_verified_at FROM teachers WHERE id = ?`,
    ).bind(teacherId).first<{ email: string; email_verified_at: number | null }>();
    if (!teacher) return json({ ok: true }, 200, noStore);
    if (teacher.email_verified_at) return json({ ok: true, alreadyVerified: true }, 200, noStore);
    const verification = await issueEmailVerification({ teacherId, email: teacher.email, request });
    return json({ ok: true, verification }, 200, noStore);
  } catch (error) {
    return apiFailure(error);
  }
}
