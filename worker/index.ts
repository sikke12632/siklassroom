/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { settleDueDepositContracts } from "../lib/finance-deposits";
import { processFinanceStockMarketTicks } from "../lib/finance-stocks";
import { processDueFundingCampaigns } from "../lib/finance-funding";
import { processPendingFinancePayroll } from "../lib/finance-payroll";

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

const FINANCE_AUTOMATION_PHASES = 4;

async function runScheduledFinanceAutomation(db: D1Database, now: number) {
  const phase = Math.floor(now / 60_000) % FINANCE_AUTOMATION_PHASES;
  if (phase === 0) {
    const result = await settleDueDepositContracts(db, { now, limit: 2 });
    if (result.failed > 0 || result.deferred > 0 || result.retrySchedulingFailed > 0) {
      console.error("finance deposit maturity processing incomplete", result);
    }
    return;
  }
  if (phase === 1) {
    const result = await processFinanceStockMarketTicks(db, { now, limit: 2, newsLimit: 2 });
    if (result.failed > 0 || result.retrySchedulingFailed > 0) {
      console.error("finance stock tick processing incomplete", result);
    }
    return;
  }
  if (phase === 2) {
    const result = await processDueFundingCampaigns(db, {
      now,
      limit: 1,
      refundLimit: 1,
    });
    if (result.failed > 0) {
      console.error("finance funding processing incomplete", result);
    }
    return;
  }
  const result = await processPendingFinancePayroll();
  if (result.remaining > 0 || result.failed > 0) {
    console.error("finance payroll processing will continue", result);
  }
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

function securedResponse(request: Request, response: Response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  if (!headers.has("Content-Security-Policy")) {
    headers.set(
      "Content-Security-Policy",
      "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
    );
  }
  if (!headers.has("Referrer-Policy")) {
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  }
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    headers.set("Cache-Control", "no-store");
  }
  if (url.protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const response = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      return securedResponse(request, response);
    }

    return securedResponse(request, await handler.fetch(request, env, ctx));
  },

  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const now = Math.max(Date.now(), controller.scheduledTime);
    ctx.waitUntil(runScheduledFinanceAutomation(env.DB, now).catch((error) => {
      console.error("finance scheduled automation failed", error);
    }));
  },
};

export default worker;
