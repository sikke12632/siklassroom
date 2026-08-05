import { createMartInventoryMovement, martInventoryForRequest } from "@/lib/mart";
import { martRequestWithClassId } from "@/lib/mart-access";
import { apiFailure, json, readJson } from "@/lib/responses";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    return json(await martInventoryForRequest(request), 200, PRIVATE_NO_STORE);
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson<{
      classId?: unknown;
      productId?: unknown;
      operation?: unknown;
      quantity?: unknown;
      reason?: unknown;
      expectedRevision?: unknown;
      idempotencyKey?: unknown;
    }>(request);
    const movementType = body.operation === "receive"
      ? "inbound"
      : body.operation === "correct"
        ? "correction"
        : body.operation;
    const result = await createMartInventoryMovement(
      martRequestWithClassId(request, body.classId),
      {
        productId: body.productId,
        movementType,
        ...(movementType === "correction"
          ? { targetQuantity: body.quantity }
          : { quantity: body.quantity }),
        reason: body.reason,
        expectedInventoryRevision: body.expectedRevision,
        idempotencyKey: body.idempotencyKey,
      },
    );
    return json(result, 201, PRIVATE_NO_STORE);
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
