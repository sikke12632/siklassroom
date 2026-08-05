import {
  financePayrollsForRequest,
  payFinancePayrollForRequest,
} from "@/lib/finance-payroll";
import { apiFailure, json, readJson } from "@/lib/responses";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    return json(
      await financePayrollsForRequest(request),
      200,
      PRIVATE_NO_STORE,
    );
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson<{
      closureId?: unknown;
      expectedSettingsRevision?: unknown;
      idempotencyKey?: unknown;
    }>(request);
    const result = await payFinancePayrollForRequest(request, body);
    return json(
      result,
      result.deduplicated ? 200 : 201,
      PRIVATE_NO_STORE,
    );
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
