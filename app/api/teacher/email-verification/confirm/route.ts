import { apiFailure, json, readJson } from "@/lib/responses";
import { confirmEmailVerification } from "@/lib/teacher-verification";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ token?: string }>(request);
    const confirmation = await confirmEmailVerification(String(body.token ?? ""), request);
    return json(
      { ok: true },
      200,
      confirmation.cookie ? { "Set-Cookie": confirmation.cookie } : undefined,
    );
  } catch (error) {
    return apiFailure(error);
  }
}
