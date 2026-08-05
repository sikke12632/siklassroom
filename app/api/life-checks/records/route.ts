import { setLifeCheckRecord } from "@/lib/life-checks";
import { apiFailure, json, readJson } from "@/lib/responses";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function PUT(request: Request) {
  try {
    const body = await readJson<{
      type?: unknown;
      date?: unknown;
      studentId?: unknown;
      passed?: unknown;
      reason?: unknown;
      expectedRevision?: unknown;
      requestId?: unknown;
    }>(request);
    return json(await setLifeCheckRecord(request, body), 200, PRIVATE_NO_STORE);
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
