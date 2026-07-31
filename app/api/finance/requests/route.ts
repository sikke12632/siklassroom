import { createFinanceCashRequest } from "@/lib/finance-requests";
import { apiFailure, json, readJson } from "@/lib/responses";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  try {
    const body = await readJson<{
      requestType?: unknown;
      amount?: unknown;
      memo?: unknown;
      idempotencyKey?: unknown;
    }>(request);
    return json(
      await createFinanceCashRequest(request, body),
      201,
      PRIVATE_NO_STORE,
    );
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
