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
          const isDueMarketQuery = query.includes("SELECT market.class_id")
            && query.includes("LEFT JOIN finance_stock_tick_retries retry")
            && query.includes("ORDER BY CASE WHEN retry.id IS NULL");
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

type ClassArchivePhase = "after-due" | "before-batch";

function databaseWithClassArchive(
  db: D1Database,
  classId: string,
  now: number,
  phase: ClassArchivePhase,
  onArchive: () => void,
): D1Database {
  let dueLoaded = false;
  let archived = false;
  const archiveClass = async () => {
    if (archived) return;
    archived = true;
    await db.prepare(
      `UPDATE classes SET status = 'archived', updated_at = ?
       WHERE id = ? AND status = 'active'`,
    ).bind(now, classId).run();
    onArchive();
  };
  return new Proxy(db, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => {
          const isDueMarketQuery = query.includes("SELECT market.class_id")
            && query.includes("LEFT JOIN finance_stock_tick_retries retry")
            && query.includes("ORDER BY CASE WHEN retry.id IS NULL");
          return wrapPreparedStatement(
            target.prepare(query),
            isDueMarketQuery
              ? async () => {
                dueLoaded = true;
                if (phase === "after-due") await archiveClass();
              }
              : undefined,
          );
        };
      }
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          if (phase === "before-batch" && dueLoaded) await archiveClass();
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function stockTickState(db: D1Database, classId: string) {
  return db.prepare(
    `SELECT classroom.status AS class_status,
            stock.current_price, stock.previous_price, stock.revision,
            stock.updated_at AS stock_updated_at,
            market.next_tick_at, market.revision AS market_revision,
            market.updated_at AS market_updated_at,
            (SELECT COUNT(*) FROM finance_stock_events event
             WHERE event.stock_id = stock.id
               AND event.action IN ('automatic_tick', 'news_tick')) AS tick_event_count,
            (SELECT MAX(event.revision) FROM finance_stock_events event
             WHERE event.stock_id = stock.id) AS maximum_event_revision,
            (SELECT COUNT(*) FROM finance_stock_tick_retries retry
             WHERE retry.class_id = classroom.id) AS retry_count
     FROM classes classroom
     JOIN finance_stocks stock ON stock.class_id = classroom.id
     JOIN finance_stock_markets market ON market.class_id = classroom.id
     WHERE classroom.id = ?`,
  ).bind(classId).first<Record<string, unknown>>();
}

const stockTickRaceWorker = {
  async fetch(request: Request, environment: TestEnvironment) {
    const input = await request.json() as {
      now?: unknown;
      limit?: unknown;
      mode?: unknown;
      classId?: unknown;
    };
    const now = Number(input.now);
    const limit = Number(input.limit);
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(limit)) {
      return Response.json({ code: "INVALID_TEST_INPUT" }, { status: 400 });
    }
    if (input.mode === "plain") {
      return Response.json(await processFinanceStockMarketTicks(environment.DB, {
        now,
        limit,
      }));
    }
    const classId = typeof input.classId === "string"
      ? input.classId
      : "class-stock-race";
    if (input.mode === "activate") {
      await environment.DB.prepare(
        `UPDATE classes SET status = 'active', updated_at = ?
         WHERE id = ? AND status = 'archived'`,
      ).bind(now, classId).run();
      return Response.json({ state: await stockTickState(environment.DB, classId) });
    }
    if (input.mode === "archive-after-due" || input.mode === "archive-before-batch") {
      let archiveRuns = 0;
      const racingDatabase = databaseWithClassArchive(
        environment.DB,
        classId,
        now,
        input.mode === "archive-after-due" ? "after-due" : "before-batch",
        () => { archiveRuns += 1; },
      );
      const result = await processFinanceStockMarketTicks(racingDatabase, {
        now,
        limit,
      });
      return Response.json({
        archiveRuns,
        result,
        state: await stockTickState(environment.DB, classId),
      });
    }
    if (input.mode === "probe-archive-guards") {
      const errors: string[] = [];
      const attempts = [
        environment.DB.prepare(
          `UPDATE finance_stocks
           SET previous_price = current_price, current_price = current_price + 100,
               revision = revision + 1, updated_by_actor_type = 'system',
               updated_by_teacher_id = NULL, updated_at = ?
           WHERE class_id = ?`,
        ).bind(now, classId),
        environment.DB.prepare(
          `UPDATE finance_stock_markets
           SET next_tick_at = next_tick_at + 1, updated_at = ?
           WHERE class_id = ?`,
        ).bind(now, classId),
        environment.DB.prepare(
          `INSERT INTO finance_stock_events (
             id, class_id, stock_id, revision, action, reason,
             idempotency_key, payload_hash, previous_snapshot_json,
             stock_snapshot_json, actor_type, actor_teacher_id, created_at
           )
           SELECT 'archived-system-event-probe', stock.class_id, stock.id,
                  stock.revision, 'automatic_tick', 'Archived class probe',
                  'stock:archived:system:event:probe', 'hash:archived:system:event:probe',
                  '{"price":1000}',
                  json_object('marketRevision', market.revision),
                  'system', NULL, ?
           FROM finance_stocks stock
           JOIN finance_stock_markets market ON market.class_id = stock.class_id
           WHERE stock.class_id = ?`,
        ).bind(now, classId),
      ];
      for (const statement of attempts) {
        try {
          await statement.run();
          errors.push("WRITE_ACCEPTED");
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      return Response.json({
        errors,
        state: await stockTickState(environment.DB, classId),
      });
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
        innerState = await stockTickState(environment.DB, classId);
      },
    );
    const outerResult = await processFinanceStockMarketTicks(racingDatabase, {
      now,
      limit,
    });
    if (!innerResult || !innerState) {
      return Response.json({ code: "INNER_TICK_NOT_INJECTED" }, { status: 500 });
    }
    return Response.json({
      innerRuns,
      innerResult,
      innerState,
      outerResult,
      finalState: await stockTickState(environment.DB, classId),
    });
  },
};

export default stockTickRaceWorker;
