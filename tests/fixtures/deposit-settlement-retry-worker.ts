import { settleFinanceDepositContractWithDb } from "../../lib/finance-deposits";
import { ApiError } from "../../lib/responses";

type TestEnvironment = {
  DB: D1Database;
};

const depositSettlementRetryWorker = {
  async fetch(request: Request, environment: TestEnvironment) {
    try {
      const input = await request.json() as Record<string, unknown>;
      const actor = input.actorType === "teacher"
        ? {
          type: "teacher" as const,
          teacherId: "teacher-legacy",
          label: "Legacy retry teacher",
        }
        : { type: "system" as const, label: "Deposit automation" };
      const result = await settleFinanceDepositContractWithDb(environment.DB, {
        contractId: "contract-legacy",
        now: 3_001,
        requestedAction: "early_termination",
        idempotencyKey: "settlement:legacy:original",
        expectedClassId: "class-legacy",
        expectedStudentId: actor.type === "system" ? "student-legacy" : undefined,
        expectedSettlementRevision: actor.type === "teacher" ? 0 : undefined,
        expectedSettlementType: actor.type === "teacher" ? "early_termination" : undefined,
        expectedPayout: actor.type === "teacher" ? 2_100 : undefined,
        actor,
        interventionReason: actor.type === "teacher"
          ? "Legacy retry must not become a teacher intervention"
          : undefined,
        origin: "finance_center",
      });
      return Response.json(result);
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

export default depositSettlementRetryWorker;
