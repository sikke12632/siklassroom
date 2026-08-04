import { emergencySettleFinanceDepositForRequest } from "@/lib/finance-deposits";
import { apiFailure, json, readJson } from "@/lib/responses";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ contractId: string }> },
) {
  try {
    const { contractId } = await params;
    const body = await readJson<{
      expectedSettlementRevision?: unknown;
      expectedSettlementType?: unknown;
      expectedPayout?: unknown;
      interventionReason?: unknown;
      idempotencyKey?: unknown;
      origin?: unknown;
    }>(request);
    return json(
      await emergencySettleFinanceDepositForRequest(request, contractId, body),
      200,
      PRIVATE_NO_STORE,
    );
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
