import { apiFailure, json, readJson } from "@/lib/responses";
import { confirmEmailVerification } from "@/lib/teacher-verification";

export async function POST(request: Request) {
  try {
    const body = await readJson<{ token?: string }>(request);
    await confirmEmailVerification(String(body.token ?? ""));
    return json({ ok: true });
  } catch (error) {
    return apiFailure(error);
  }
}
