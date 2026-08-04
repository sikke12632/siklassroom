import { getSession, requireStudent } from "@/lib/auth";
import { database } from "@/lib/database";
import { ApiError, apiFailure, json } from "@/lib/responses";

export async function GET(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) throw new ApiError(401, "로그인이 필요합니다.", "LOGIN_REQUIRED");
    if (session.actorType === "student") await requireStudent(request);
    const audience = session.actorType;
    const result = await database().prepare(
      `SELECT id, title, body, audience, updated_at
       FROM service_announcements
       WHERE is_active = 1 AND (audience = 'all' OR audience = ?)
       ORDER BY updated_at DESC LIMIT 1`,
    ).bind(audience).all();
    return json({ announcements: result.results }, 200, { "Cache-Control": "no-store" });
  } catch (error) {
    return apiFailure(error);
  }
}
