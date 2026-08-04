/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { settleDueDepositContracts } from "../lib/finance-deposits";
import { processFinanceStockMarketTicks } from "../lib/finance-stocks";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledController {
  cron: string;
  scheduledTime: number;
  noRetry(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },

  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const now = Math.max(Date.now(), controller.scheduledTime);
    ctx.waitUntil(
      Promise.allSettled([
        settleDueDepositContracts(env.DB, { now, limit: 100 }),
        processFinanceStockMarketTicks(env.DB, { now, limit: 100 }),
      ]).then(([depositResult, stockResult]) => {
        if (depositResult.status === "rejected") {
          console.error("finance deposit maturity processing failed", depositResult.reason);
        } else if (
          depositResult.value.failed > 0
          || depositResult.value.deferred > 0
          || depositResult.value.retrySchedulingFailed > 0
        ) {
          console.error("finance deposit maturity processing incomplete", {
            due: depositResult.value.due,
            settled: depositResult.value.settled,
            failed: depositResult.value.failed,
            deferred: depositResult.value.deferred,
            retrySchedulingFailed: depositResult.value.retrySchedulingFailed,
          });
        }
        if (stockResult.status === "rejected") {
          console.error("finance stock tick processing failed", stockResult.reason);
        } else if (stockResult.value.failed > 0) {
          console.error("finance stock tick processing incomplete", stockResult.value);
        }
      }),
    );
  },
};

export default worker;
