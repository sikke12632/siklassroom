import { reverseFinanceTransactionForRequest } from "@/lib/finance-requests";
import { apiFailure, json, readJson } from "@/lib/responses";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function POST(
  request: Request,
  context: { params: Promise<{ transactionId: string }> },
) {
  try {
    const { transactionId } = await context.params;
    const body = await readJson<{
      reason?: unknown;
      idempotencyKey?: unknown;
    }>(request);
    return json(
      await reverseFinanceTransactionForRequest(
        request,
        transactionId,
        body,
      ),
      200,
      PRIVATE_NO_STORE,
    );
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
