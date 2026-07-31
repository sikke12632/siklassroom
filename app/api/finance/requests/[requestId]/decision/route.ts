import { decideFinanceCashRequest } from "@/lib/finance-requests";
import { apiFailure, json, readJson } from "@/lib/responses";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  try {
    const { requestId } = await context.params;
    const body = await readJson<{
      decision?: unknown;
      expectedRevision?: unknown;
      idempotencyKey?: unknown;
      reasonCode?: unknown;
      reasonNote?: unknown;
      interventionReason?: unknown;
    }>(request);
    return json(
      await decideFinanceCashRequest(request, requestId, body),
      200,
      PRIVATE_NO_STORE,
    );
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
