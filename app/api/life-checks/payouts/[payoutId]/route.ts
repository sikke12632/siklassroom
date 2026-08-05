import { updateLifeCheckPayout } from "@/lib/life-checks";
import { apiFailure, json, readJson } from "@/lib/responses";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ payoutId: string }> },
) {
  try {
    const { payoutId } = await params;
    const body = await readJson<{
      action?: unknown;
      expectedRevision?: unknown;
      requestId?: unknown;
      reason?: unknown;
    }>(request);
    return json(await updateLifeCheckPayout(request, payoutId, body), 200, PRIVATE_NO_STORE);
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
