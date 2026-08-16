import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { LIFE_CHECK_SCHEMA_STATEMENTS } from "../lib/life-check-schema";

test("runtime life-check schema stays aligned with the D1 migration", async () => {
  const migration = await readFile(
    new URL("../drizzle/0036_life_checks.sql", import.meta.url),
    "utf8",
  );
  const expected = migration
    .replace(/\r\n?/g, "\n")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => statement.replace(/;$/, ""));
  assert.deepEqual([...LIFE_CHECK_SCHEMA_STATEMENTS], expected);
});

test("record trigger races return a recoverable stale response instead of an internal error", async () => {
  const source = await readFile(new URL("../lib/life-checks.ts", import.meta.url), "utf8");
  for (const code of [
    "LIFE_CHECK_RECORD_SCOPE_DENIED",
    "LIFE_CHECK_RECORD_STALE_OR_DENIED",
    "LIFE_CHECK_EVENT_STATE_INVALID",
  ]) {
    assert.match(source, new RegExp(`message\\.includes\\(\"${code}\"\\)`));
  }
  assert.match(source, /if \(isRecordIntegrityFailure\(error\)\) \{[\s\S]*"LIFE_CHECK_STALE"/);
});
