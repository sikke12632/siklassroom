import { updateFinanceDepositProductState } from "@/lib/finance-deposits";
import { apiFailure, json, readJson } from "@/lib/responses";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  try {
    const { productId } = await params;
    const body = await readJson<{
      isOpen?: unknown;
      expectedRevision?: unknown;
      idempotencyKey?: unknown;
    }>(request);
    return json(
      await updateFinanceDepositProductState(request, productId, body),
      200,
      PRIVATE_NO_STORE,
    );
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
