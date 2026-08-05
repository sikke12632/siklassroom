import {
  createFinanceFundingCampaign,
  financeFundingForRequest,
} from "@/lib/finance-funding";
import { apiFailure, json, readJson } from "@/lib/responses";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    return json(await financeFundingForRequest(request), 200, PRIVATE_NO_STORE);
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson<{
      title?: unknown;
      description?: unknown;
      targetAmount?: unknown;
      deadlineAt?: unknown;
      idempotencyKey?: unknown;
    }>(request);
    return json(
      await createFinanceFundingCampaign(request, body),
      201,
      PRIVATE_NO_STORE,
    );
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
