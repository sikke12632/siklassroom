import { settleDueDepositContracts } from "../../lib/finance-deposits";
import { financeAuditForRequest } from "../../lib/finance-audit";

type TestEnvironment = {
  DB: D1Database;
};

const depositMaturityBackoffWorker = {
  async fetch(request: Request, environment: TestEnvironment) {
    if (new URL(request.url).pathname === "/audit") {
      return Response.json(await financeAuditForRequest(request));
    }
    const input = await request.json() as { now?: unknown; limit?: unknown };
    const now = Number(input.now);
    const limit = Number(input.limit);
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(limit)) {
      return Response.json({ code: "INVALID_TEST_INPUT" }, { status: 400 });
    }
    return Response.json(await settleDueDepositContracts(environment.DB, {
      now,
      limit,
    }));
  },
};

export default depositMaturityBackoffWorker;
