import {
  createFinanceDepositProduct,
  financeDepositsForRequest,
} from "@/lib/finance-deposits";
import { apiFailure, json, readJson } from "@/lib/responses";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    return json(await financeDepositsForRequest(request), 200, PRIVATE_NO_STORE);
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson<{
      name?: unknown;
      description?: unknown;
      termWeeks?: unknown;
      maturityInterestBps?: unknown;
      earlyInterestBps?: unknown;
      minAmount?: unknown;
      maxAmount?: unknown;
      idempotencyKey?: unknown;
    }>(request);
    return json(
      await createFinanceDepositProduct(request, body),
      201,
      PRIVATE_NO_STORE,
    );
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
