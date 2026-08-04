import {
  exchangeRegistrationToken,
  registrationResponseHeaders,
} from "@/lib/registration";
import { consumeRateLimit, throttleKey } from "@/lib/rate-limit";
import { ApiError, apiFailure, assertSameOriginRequest, json, readJson } from "@/lib/responses";

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const ipKey = await throttleKey(request, "registration-verify-ip", "all");
    await consumeRateLimit(ipKey, { maxAttempts: 120 });
    const body = await readJson<{ token?: string }>(request);
    const token = String(body.token ?? "");
    if (token.length < 40 || token.length > 128) {
      throw new ApiError(400, "QR 주소가 올바르지 않아요.", "INVALID_QR");
    }
    const exchanged = await exchangeRegistrationToken(token, request);
    return json({
      student: {
        official_name: exchanged.record.official_name,
        student_number: exchanged.record.student_number,
        grade: exchanged.record.grade,
        class_number: exchanged.record.class_number,
      },
      mode: exchanged.mode,
      resetExpiresAt: exchanged.resetExpiresAt,
    }, 200, registrationResponseHeaders(exchanged.cookie));
  } catch (error) {
    const response = apiFailure(error);
    const headers = registrationResponseHeaders();
    headers.set("Content-Type", response.headers.get("Content-Type") ?? "application/json");
    return new Response(response.body, { status: response.status, headers });
  }
}
