import { requireEmailVerified } from "@/lib/auth";
import { apiFailure, json, readJson } from "@/lib/responses";
import { redeemInviteCode } from "@/lib/teacher-verification";
import { assertNotBlocked, clearFailures, recordFailure, throttleKey } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const { teacherId, teacherAccessStatus } = await requireEmailVerified(request);
    if (teacherAccessStatus === "invite_verified") return json({ ok: true, alreadyVerified: true });
    const body = await readJson<{ code?: string }>(request);
    const key = await throttleKey(request, "teacher-invite-code", teacherId);
    await assertNotBlocked(key);
    try {
      await redeemInviteCode(teacherId, body.code);
      await clearFailures(key);
    } catch (error) {
      await recordFailure(key);
      throw error;
    }
    return json({ ok: true });
  } catch (error) {
    return apiFailure(error);
  }
}
