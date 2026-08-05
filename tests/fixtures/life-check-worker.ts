import {
  lifeCheckAuditForRequest,
  lifeCheckOverviewForRequest,
  prepareLifeCheckPayout,
  setLifeCheckRecord,
  updateLifeCheckPayout,
} from "../../lib/life-checks";
import { ApiError } from "../../lib/responses";
import { martAuditForRequest } from "../../lib/mart";

async function jsonBody(request: Request) {
  return request.json() as Promise<Record<string, unknown>>;
}

const lifeCheckWorker = {
  async fetch(request: Request) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/overview") {
        return Response.json(await lifeCheckOverviewForRequest(request));
      }
      if (request.method === "GET" && url.pathname === "/audit") {
        return Response.json(await lifeCheckAuditForRequest(request));
      }
      if (request.method === "GET" && url.pathname === "/mart-audit") {
        return Response.json(await martAuditForRequest(request));
      }
      if (request.method === "PUT" && url.pathname === "/record") {
        return Response.json(await setLifeCheckRecord(request, await jsonBody(request)));
      }
      if (request.method === "POST" && url.pathname === "/payout") {
        return Response.json(await prepareLifeCheckPayout(request, await jsonBody(request)));
      }
      const payoutMatch = /^\/payout\/([^/]+)$/.exec(url.pathname);
      if (request.method === "PATCH" && payoutMatch) {
        return Response.json(await updateLifeCheckPayout(
          request,
          decodeURIComponent(payoutMatch[1]),
          await jsonBody(request),
        ));
      }
      return Response.json({ code: "NOT_FOUND" }, { status: 404 });
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

export default lifeCheckWorker;
