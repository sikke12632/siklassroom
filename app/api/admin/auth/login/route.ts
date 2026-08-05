import { database } from "@/lib/database";
import { consumeRateLimit, subjectThrottleKey, throttleKey } from "@/lib/rate-limit";
import { apiFailure, ApiError, json, readJson } from "@/lib/responses";
import { auditSystemAdmin, systemAdminAuditStatement } from "@/lib/system-admin-audit";
import { prepareSystemAdminSession, verifySystemAdminCredentials } from "@/lib/system-admin-auth";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ username?: string; password?: string }>(request);
    const username = String(body.username ?? "").normalize("NFKC").trim().slice(0, 100);
    const password = String(body.password ?? "");
    const ipKey = await throttleKey(request, "system-admin-login-ip", "all");
    const key = await subjectThrottleKey("system-admin-login", username.toLowerCase());
    await consumeRateLimit(ipKey, { maxAttempts: 20 });
    await consumeRateLimit(key, { maxAttempts: 7 });
    if (!username || !password || !(await verifySystemAdminCredentials(username, password))) {
      await auditSystemAdmin({ action: "admin_login_failed", success: false });
      throw new ApiError(401, "관리자 아이디 또는 비밀번호를 다시 확인해 주세요.", "ADMIN_LOGIN_FAILED");
    }
    const session = await prepareSystemAdminSession(request, { clearThrottleKeys: [key] });
    await database().batch([
      ...session.statements,
      systemAdminAuditStatement({ action: "admin_login_succeeded" }, session.createdAt),
    ]);
    return json(
      { admin: { key: "primary" }, csrfToken: session.csrfToken },
      200,
      { "Set-Cookie": session.cookie, "Cache-Control": "no-store" },
    );
  } catch (error) {
    return apiFailure(error);
  }
}
