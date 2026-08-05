import { updateFinanceFundingCampaign } from "@/lib/finance-funding";
import { apiFailure, json, readJson } from "@/lib/responses";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  try {
    const { campaignId } = await params;
    const body = await readJson<{
      action?: unknown;
      title?: unknown;
      description?: unknown;
      targetAmount?: unknown;
      deadlineAt?: unknown;
      expectedRevision?: unknown;
      idempotencyKey?: unknown;
      interventionReason?: unknown;
    }>(request);
    return json(
      await updateFinanceFundingCampaign(request, campaignId, body),
      200,
      PRIVATE_NO_STORE,
    );
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
