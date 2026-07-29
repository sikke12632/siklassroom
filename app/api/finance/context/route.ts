import { financeContextForRequest } from "@/lib/finance-access";
import { apiFailure, json } from "@/lib/responses";

export async function GET(request: Request) {
  try {
    return json(
      await financeContextForRequest(request),
      200,
      { "Cache-Control": "private, no-store" },
    );
  } catch (error) {
    const response = apiFailure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
