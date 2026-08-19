import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { LIFE_CHECK_SCHEMA_STATEMENTS } from "../lib/life-check-schema";

test("runtime life-check schema keeps the base migration and overlays effective permissions", async () => {
  const migration = await readFile(
    new URL("../drizzle/0036_life_checks.sql", import.meta.url),
    "utf8",
  );
  const runtime = [...LIFE_CHECK_SCHEMA_STATEMENTS].join("\n");
  for (const name of [
    "life_check_series",
    "life_check_records",
    "life_check_events",
    "life_check_payouts",
    "life_check_payout_events",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${name}`));
    assert.match(runtime, new RegExp(`CREATE TABLE IF NOT EXISTS ${name}`));
  }
  for (const trigger of [
    "life_check_records_insert_guard",
    "life_check_records_update_guard",
    "life_check_payouts_insert_guard",
    "life_check_payouts_update_guard",
    "life_check_payout_events_insert_guard",
  ]) {
    assert.match(runtime, new RegExp(`DROP TRIGGER IF EXISTS ${trigger}`));
    assert.match(runtime, new RegExp(`CREATE TRIGGER IF NOT EXISTS ${trigger}`));
  }
  assert.match(runtime, /student_effective_permissions/);
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
