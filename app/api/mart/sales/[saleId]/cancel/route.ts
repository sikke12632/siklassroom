import { cancelMartSale } from "@/lib/mart";
import { martRequestWithClassId } from "@/lib/mart-access";
import { apiFailure, json, readJson } from "@/lib/responses";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ saleId: string }> },
) {
  try {
    const { saleId } = await params;
    const body = await readJson<{
      classId?: unknown;
      expectedRevision?: unknown;
      reason?: unknown;
      idempotencyKey?: unknown;
    }>(request);
    return json(
      await cancelMartSale(martRequestWithClassId(request, body.classId), saleId, body),
      200,
      PRIVATE_NO_STORE,
    );
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
