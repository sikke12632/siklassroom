import { requireEmailVerified } from "@/lib/auth";
import { apiFailure, json, readJson } from "@/lib/responses";
import { redeemInviteCode } from "@/lib/teacher-verification";
import { consumeRateLimit, subjectThrottleKey } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const { teacherId, teacherAccessStatus } = await requireEmailVerified(request);
    if (teacherAccessStatus === "invite_verified") return json({ ok: true, alreadyVerified: true });
    const body = await readJson<{ code?: string }>(request);
    const key = await subjectThrottleKey("teacher-invite-code", teacherId);
    await consumeRateLimit(key, { maxAttempts: 7 });
    const rotation = await redeemInviteCode(teacherId, body.code, request);
    return json({ ok: true }, 200, { "Set-Cookie": rotation.cookie });
  } catch (error) {
    return apiFailure(error);
  }
}
