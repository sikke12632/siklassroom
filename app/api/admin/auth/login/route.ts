import { assertNotBlocked, clearFailures, recordFailure, throttleKey } from "@/lib/rate-limit";
import { apiFailure, ApiError, json, readJson } from "@/lib/responses";
import { auditSystemAdmin } from "@/lib/system-admin-audit";
import { createSystemAdminSession, verifySystemAdminCredentials } from "@/lib/system-admin-auth";

export async function POST(request: Request) {
  let key = "";
  try {
    const body = await readJson<{ username?: string; password?: string }>(request);
    const username = String(body.username ?? "").normalize("NFKC").trim().slice(0, 100);
    const password = String(body.password ?? "");
    key = await throttleKey(request, "system-admin-login", username.toLowerCase());
    await assertNotBlocked(key);
    if (!username || !password || !(await verifySystemAdminCredentials(username, password))) {
      await recordFailure(key);
      await auditSystemAdmin({ action: "admin_login_failed", success: false });
      throw new ApiError(401, "관리자 아이디 또는 비밀번호를 다시 확인해 주세요.", "ADMIN_LOGIN_FAILED");
    }
    await clearFailures(key);
    const session = await createSystemAdminSession(request);
    await auditSystemAdmin({ action: "admin_login_succeeded" });
    return json(
      { admin: { key: "primary" }, csrfToken: session.csrfToken },
      200,
      { "Set-Cookie": session.cookie, "Cache-Control": "no-store" },
    );
  } catch (error) {
    return apiFailure(error);
  }
}
