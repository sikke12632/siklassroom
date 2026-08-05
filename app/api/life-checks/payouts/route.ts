import { prepareLifeCheckPayout } from "@/lib/life-checks";
import { apiFailure, json, readJson } from "@/lib/responses";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  try {
    const body = await readJson<{
      type?: unknown;
      month?: unknown;
      period?: unknown;
      expectedSeriesRevision?: unknown;
      expectedCalendarRevision?: unknown;
      expectedPayoutRevision?: unknown;
      requestId?: unknown;
    }>(request);
    return json(await prepareLifeCheckPayout(request, body), 201, PRIVATE_NO_STORE);
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
