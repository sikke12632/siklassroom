import { contributeFinanceFundingCampaign } from "@/lib/finance-funding";
import { apiFailure, json, readJson } from "@/lib/responses";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  try {
    const { campaignId } = await params;
    const body = await readJson<{
      amount?: unknown;
      expectedCampaignRevision?: unknown;
      idempotencyKey?: unknown;
    }>(request);
    return json(
      await contributeFinanceFundingCampaign(request, campaignId, body),
      201,
      PRIVATE_NO_STORE,
    );
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
