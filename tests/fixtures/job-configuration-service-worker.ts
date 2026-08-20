import {
  applyCurrentJobConfiguration,
  applyDraftJobPlanForTarget,
  loadJobOverview,
  saveNextJobPlan,
} from "../../lib/job-configurations";
import { database } from "../../lib/database";
import { saveJobDraft } from "../../lib/job-storage";
import { ApiError } from "../../lib/responses";

type TestRequest = {
  action?: unknown;
  input?: Record<string, unknown>;
};

const jobConfigurationServiceWorker = {
  async fetch(request: Request) {
    try {
      const body = await request.json() as TestRequest;
      const input = body.input ?? {};
      if (body.action === "overview") {
        if (typeof input.classId !== "string") {
          return Response.json({ code: "INVALID_TEST_INPUT" }, { status: 400 });
        }
        return Response.json(await loadJobOverview(input.classId));
      }
      if (body.action === "save-plan") {
        return Response.json(await saveNextJobPlan(input as Parameters<typeof saveNextJobPlan>[0]));
      }
      if (body.action === "apply-plan") {
        return Response.json(await applyDraftJobPlanForTarget(
          input as Parameters<typeof applyDraftJobPlanForTarget>[0],
        ));
      }
      if (body.action === "apply-current") {
        return Response.json(await applyCurrentJobConfiguration(
          input as Parameters<typeof applyCurrentJobConfiguration>[0],
        ));
      }
      if (body.action === "save-legacy-draft") {
        return Response.json(await saveJobDraft(
          input as Parameters<typeof saveJobDraft>[0],
        ));
      }
      if (body.action === "test-query" && typeof input.sql === "string") {
        const values = Array.isArray(input.values) ? input.values : [];
        const result = await database().prepare(input.sql).bind(...values).all();
        return Response.json({ results: result.results });
      }
      if (body.action === "test-run" && typeof input.sql === "string") {
        const values = Array.isArray(input.values) ? input.values : [];
        const result = await database().prepare(input.sql).bind(...values).run();
        return Response.json({ success: result.success, meta: result.meta });
      }
      if (body.action === "test-exec" && typeof input.sql === "string") {
        const db = database();
        const statements = input.sql
          .split(";")
          .map((sql) => sql.trim())
          .filter(Boolean)
          .map((sql) => db.prepare(sql));
        const results = await db.batch(statements);
        return Response.json({ success: results.every((result) => result.success) });
      }
      return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    } catch (error) {
      if (error instanceof ApiError) {
        return Response.json(
          {
            code: error.code,
            error: error.message,
            impact: "impact" in error ? error.impact : undefined,
          },
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

export default jobConfigurationServiceWorker;
