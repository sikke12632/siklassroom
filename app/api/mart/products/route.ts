import {
  createMartProduct,
  martProductsForRequest,
  updateMartProduct,
} from "@/lib/mart";
import { martRequestWithClassId } from "@/lib/mart-access";
import { apiFailure, json, readJson } from "@/lib/responses";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    return json(await martProductsForRequest(request), 200, PRIVATE_NO_STORE);
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson<{
      action?: unknown;
      classId?: unknown;
      productId?: unknown;
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
    const scopedRequest = martRequestWithClassId(request, body.classId);
    if (body.action === "update" || body.productId) {
      return json(
        await updateMartProduct(scopedRequest, body.productId, body),
        200,
        PRIVATE_NO_STORE,
      );
    }
    return json(await createMartProduct(scopedRequest, body), 201, PRIVATE_NO_STORE);
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
