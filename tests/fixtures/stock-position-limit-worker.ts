import {
  tickFinanceStockForRequest,
  tradeFinanceStock,
  updateFinanceStock,
} from "../../lib/finance-stocks";
import { ApiError } from "../../lib/responses";

const stockPositionLimitWorker = {
  async fetch(request: Request) {
    try {
      const input = await request.json() as Record<string, unknown>;
      const action = typeof input.action === "string" ? input.action : "";
      if (action === "update") {
        return Response.json(
          await updateFinanceStock(request, "stock-class", input),
          { status: 200 },
        );
      }
      if (action === "trade") {
        return Response.json(
          await tradeFinanceStock(request, "stock-class", input),
          { status: 201 },
        );
      }
      if (action === "tick") {
        return Response.json(
          await tickFinanceStockForRequest(request, input),
          { status: 200 },
        );
      }
      return Response.json(
        { code: "UNKNOWN_TEST_ACTION" },
        { status: 400 },
      );
    } catch (error) {
      if (error instanceof ApiError) {
        return Response.json(
          { code: error.code, error: error.message },
          { status: error.status },
        );
      }
      return Response.json(
        { code: "INTERNAL_ERROR", error: String(error) },
        { status: 500 },
      );
    }
  },
};

export default stockPositionLimitWorker;
