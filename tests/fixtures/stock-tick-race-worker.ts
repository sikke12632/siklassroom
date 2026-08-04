import { processFinanceStockMarketTicks } from "../../lib/finance-stocks";

type TestEnvironment = {
  DB: D1Database;
};

function wrapPreparedStatement(
  statement: D1PreparedStatement,
  afterAll?: () => Promise<void>,
): D1PreparedStatement {
  return new Proxy(statement, {
    get(target, property) {
      if (property === "bind") {
        return (...values: unknown[]) => wrapPreparedStatement(
          target.bind(...values),
          afterAll,
        );
      }
      if (property === "all" && afterAll) {
        return async (...values: unknown[]) => {
          const result = await Reflect.apply(target.all, target, values);
          await afterAll();
          return result;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function databaseWithOverlappingTick(
  db: D1Database,
  runInnerTick: () => Promise<void>,
): D1Database {
  let injected = false;
  return new Proxy(db, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => {
          const isDueMarketQuery = query.includes("FROM finance_stock_markets market")
            && query.includes("market.next_tick_at <= ?");
          return wrapPreparedStatement(
            target.prepare(query),
            isDueMarketQuery
              ? async () => {
                if (injected) return;
                injected = true;
                await runInnerTick();
              }
              : undefined,
          );
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const stockTickRaceWorker = {
  async fetch(request: Request, environment: TestEnvironment) {
    const input = await request.json() as { now?: unknown; limit?: unknown };
    const now = Number(input.now);
    const limit = Number(input.limit);
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(limit)) {
      return Response.json({ code: "INVALID_TEST_INPUT" }, { status: 400 });
    }

    let innerResult: Awaited<ReturnType<typeof processFinanceStockMarketTicks>> | null = null;
    let innerState: Record<string, unknown> | null = null;
    let innerRuns = 0;
    const racingDatabase = databaseWithOverlappingTick(
      environment.DB,
      async () => {
        innerRuns += 1;
        innerResult = await processFinanceStockMarketTicks(environment.DB, {
          now,
          limit,
        });
        innerState = await environment.DB.prepare(
          `SELECT stock.current_price, stock.previous_price, stock.revision,
                  market.next_tick_at,
                  (SELECT COUNT(*) FROM finance_stock_events event
                   WHERE event.stock_id = stock.id
                     AND event.action IN ('automatic_tick', 'news_tick')) AS tick_event_count,
                  (SELECT MAX(event.revision) FROM finance_stock_events event
                   WHERE event.stock_id = stock.id) AS maximum_event_revision
           FROM finance_stocks stock
           JOIN finance_stock_markets market ON market.class_id = stock.class_id
           ORDER BY stock.class_id LIMIT 1`,
        ).first<Record<string, unknown>>();
      },
    );
    const outerResult = await processFinanceStockMarketTicks(racingDatabase, {
      now,
      limit,
    });
    if (!innerResult || !innerState) {
      return Response.json({ code: "INNER_TICK_NOT_INJECTED" }, { status: 500 });
    }
    return Response.json({ innerRuns, innerResult, innerState, outerResult });
  },
};

export default stockTickRaceWorker;
