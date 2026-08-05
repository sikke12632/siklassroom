import {
  financePayrollsForRequest,
  updateFinanceSalarySettings,
} from "@/lib/finance-payroll";
import { apiFailure, json, readJson } from "@/lib/responses";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const data = await financePayrollsForRequest(request);
    return json(
      { settings: data.settings, serverTime: data.serverTime },
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
      gradeAAmount?: unknown;
      gradeBAmount?: unknown;
      gradeCAmount?: unknown;
      expectedRevision?: unknown;
      idempotencyKey?: unknown;
      changeReason?: unknown;
    }>(request);
    return json(
      await updateFinanceSalarySettings(request, body),
      200,
      PRIVATE_NO_STORE,
    );
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
