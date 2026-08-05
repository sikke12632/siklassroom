import { createMartInventoryMovement } from "@/lib/mart";
import { martRequestWithClassId } from "@/lib/mart-access";
import { apiFailure, json, readJson } from "@/lib/responses";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  try {
    const body = await readJson<{
      classId?: unknown;
      productId?: unknown;
      movementType?: unknown;
      quantity?: unknown;
      delta?: unknown;
      reason?: unknown;
      expectedInventoryRevision?: unknown;
      idempotencyKey?: unknown;
    }>(request);
    return json(
      await createMartInventoryMovement(martRequestWithClassId(request, body.classId), body),
      201,
      PRIVATE_NO_STORE,
    );
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
