import { autoPayFinancePayrollForClosure } from "../../lib/finance-payroll";
import { ApiError } from "../../lib/responses";

const financePayrollDenominationWorker = {
  async fetch(request: Request) {
    try {
      const input = await request.json() as { classId?: unknown; closureId?: unknown };
      if (typeof input.classId !== "string" || typeof input.closureId !== "string") {
        return Response.json(
          { code: "INVALID_TEST_INPUT", error: "classId and closureId are required." },
          { status: 400 },
        );
      }
      return Response.json(await autoPayFinancePayrollForClosure({
        classId: input.classId,
        closureId: input.closureId,
      }));
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

export default financePayrollDenominationWorker;
