import { updateFinanceStock } from "@/lib/finance-stocks";
import { apiFailure, json, readJson } from "@/lib/responses";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function PUT(
  request: Request,
  context: { params: Promise<{ stockId: string }> },
) {
  try {
    const { stockId } = await context.params;
    const body = await readJson<Record<string, unknown>>(request);
    return json(
      await updateFinanceStock(request, stockId, body),
      200,
      PRIVATE_NO_STORE,
    );
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
