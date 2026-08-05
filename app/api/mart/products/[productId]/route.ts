import { updateMartProduct } from "@/lib/mart";
import { martRequestWithClassId } from "@/lib/mart-access";
import { apiFailure, json, readJson } from "@/lib/responses";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  try {
    const { productId } = await params;
    const body = await readJson<{
      classId?: unknown;
      name?: unknown;
      category?: unknown;
      description?: unknown;
      price?: unknown;
      unitPrice?: unknown;
      lowStockThreshold?: unknown;
      isActive?: unknown;
      expectedRevision?: unknown;
      idempotencyKey?: unknown;
    }>(request);
    return json(
      await updateMartProduct(martRequestWithClassId(request, body.classId), productId, body),
      200,
      PRIVATE_NO_STORE,
    );
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
