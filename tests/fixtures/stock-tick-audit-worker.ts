import { financeAuditForRequest } from "../../lib/finance-audit";
import { ApiError } from "../../lib/responses";

const stockTickAuditWorker = {
  async fetch(request: Request) {
    try {
      return Response.json(await financeAuditForRequest(request));
    } catch (error) {
      if (error instanceof ApiError) {
        return Response.json(
          { code: error.code, error: error.message },
          { status: error.status },
        );
      }
      return Response.json(
        { code: "AUDIT_TEST_FAILED", error: String(error) },
        { status: 500 },
      );
    }
  },
};

export default stockTickAuditWorker;
