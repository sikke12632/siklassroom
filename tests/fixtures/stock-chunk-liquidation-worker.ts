import {
  cancelFinanceStockLiquidation,
  liquidateFinanceStockHolding,
} from "../../lib/finance-stocks";
import { runtimeEnv } from "../../lib/database";
import { ApiError } from "../../lib/responses";

type PauseHook = {
  id: string;
  point:
    | "after_root_read"
    | "after_trade_idempotency_read"
    | "before_operation_insert";
  matched: boolean;
  released: boolean;
  release: () => void;
};

let pauseHook: PauseHook | null = null;
let databaseWrapped = false;

function armPauseHook(
  id: string,
  point: PauseHook["point"],
) {
  if (pauseHook) {
    throw new Error(`A liquidation pause hook is already active: ${pauseHook.id}`);
  }
  const hook: PauseHook = {
    id,
    point,
    matched: false,
    released: false,
    release: () => {
      hook.released = true;
    },
  };
  pauseHook = hook;
}

function isRootOperationLookup(query: string) {
  return query.includes("FROM finance_stock_liquidation_operations operation")
    && query.includes("operation.root_idempotency_key = ?");
}

function isTradeIdempotencyLookup(query: string) {
  return query.includes("FROM finance_stock_trades trade")
    && query.includes("trade.idempotency_key = ?");
}

async function pauseAt(
  point: PauseHook["point"],
  query: string,
) {
  const hook = pauseHook;
  const matches = point === "after_root_read"
    ? isRootOperationLookup(query)
    : point === "after_trade_idempotency_read"
      ? isTradeIdempotencyLookup(query)
      : query.includes("INSERT INTO finance_stock_liquidation_operations");
  if (!hook || hook.point !== point || hook.matched || !matches) return;
  hook.matched = true;
  while (!hook.released) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  if (pauseHook === hook) pauseHook = null;
}

function wrapPreparedStatement(
  statement: D1PreparedStatement,
  query: string,
): D1PreparedStatement {
  return new Proxy(statement, {
    get(target, property) {
      if (property === "bind") {
        return (...values: unknown[]) => wrapPreparedStatement(
          target.bind(...values),
          query,
        );
      }
      if (property === "first") {
        return async (...args: unknown[]) => {
          const first = Reflect.get(target, property, target) as (
            ...firstArgs: unknown[]
          ) => Promise<unknown>;
          const result = await first.apply(target, args);
          await pauseAt("after_root_read", query);
          await pauseAt("after_trade_idempotency_read", query);
          return result;
        };
      }
      if (property === "run") {
        return async (...args: unknown[]) => {
          await pauseAt("before_operation_insert", query);
          const run = Reflect.get(target, property, target) as (
            ...runArgs: unknown[]
          ) => Promise<unknown>;
          return run.apply(target, args);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as D1PreparedStatement;
}

function installDatabasePauseProxy() {
  if (databaseWrapped) return;
  const runtime = runtimeEnv();
  const database = runtime.DB;
  if (!database) throw new Error("The liquidation test database is unavailable.");
  runtime.DB = new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => wrapPreparedStatement(target.prepare(query), query);
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as D1Database;
  databaseWrapped = true;
}

const stockChunkLiquidationWorker = {
  async fetch(request: Request) {
    try {
      installDatabasePauseProxy();
      const url = new URL(request.url);
      if (url.pathname === "/test/pause-status") {
        const id = url.searchParams.get("id");
        const hook = pauseHook;
        return Response.json({
          active: Boolean(hook && hook.id === id),
          matched: Boolean(hook && hook.id === id && hook.matched),
        });
      }
      if (url.pathname === "/test/pause-release") {
        const id = url.searchParams.get("id");
        const hook = pauseHook;
        if (!hook || hook.id !== id) {
          return Response.json({ released: false }, { status: 404 });
        }
        hook.release();
        return Response.json({ released: true });
      }
      const input = await request.json() as Record<string, unknown>;
      const pauseAfterRootRead = request.headers.get(
        "x-test-pause-after-root-read",
      );
      const pauseBeforeOperationInsert = request.headers.get(
        "x-test-pause-before-operation-insert",
      );
      const pauseAfterTradeIdempotencyRead = request.headers.get(
        "x-test-pause-after-trade-idempotency-read",
      );
      if (
        Number(Boolean(pauseAfterRootRead))
          + Number(Boolean(pauseBeforeOperationInsert))
          + Number(Boolean(pauseAfterTradeIdempotencyRead))
        > 1
      ) {
        throw new Error("Only one liquidation pause point can be armed per request.");
      }
      if (pauseAfterRootRead) {
        armPauseHook(pauseAfterRootRead, "after_root_read");
      } else if (pauseBeforeOperationInsert) {
        armPauseHook(pauseBeforeOperationInsert, "before_operation_insert");
      } else if (pauseAfterTradeIdempotencyRead) {
        armPauseHook(
          pauseAfterTradeIdempotencyRead,
          "after_trade_idempotency_read",
        );
      }
      const result = input.action === "cancel"
        ? await cancelFinanceStockLiquidation(
            request,
            input.operationId,
            input,
          )
        : await liquidateFinanceStockHolding(
            request,
            "stock-chunked",
            input,
          );
      if (request.headers.get("x-test-drop-response-after-commit") === "1") {
        return Response.json(
          { code: "SIMULATED_LIQUIDATION_RESPONSE_LOSS" },
          { status: 504 },
        );
      }
      return Response.json(result, { status: 201 });
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

export default stockChunkLiquidationWorker;
