import {
  financeSettingsForRequest,
  updateFinanceSettings,
} from "@/lib/finance-settings";
import { apiFailure, json, readJson } from "@/lib/responses";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    return json(
      await financeSettingsForRequest(request),
      200,
      PRIVATE_NO_STORE,
    );
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

export async function PUT(request: Request) {
  try {
    const body = await readJson<{
      currencyName?: unknown;
      currencyUnit?: unknown;
      denominations?: unknown;
      bankOpen?: unknown;
      depositEnabled?: unknown;
      withdrawalEnabled?: unknown;
      bankerProcessingEnabled?: unknown;
      maxRequestAmount?: unknown;
      expectedRevision?: unknown;
      idempotencyKey?: unknown;
      changeReason?: unknown;
    }>(request);
    return json(
      await updateFinanceSettings(request, body),
      200,
      PRIVATE_NO_STORE,
    );
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
