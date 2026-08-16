import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MART_SCHEMA_STATEMENTS } from "../lib/mart-schema";

test("runtime mart schema stays aligned with the D1 migration", async () => {
  const migration = await readFile(
    new URL("../drizzle/0035_mart_center.sql", import.meta.url),
    "utf8",
  );
  const expected = migration
    .replace(/\r\n?/g, "\n")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => statement
      .replace(/^CREATE VIEW /, "CREATE VIEW IF NOT EXISTS ")
      .replace(/^CREATE TABLE /, "CREATE TABLE IF NOT EXISTS ")
      .replace(/^CREATE UNIQUE INDEX /, "CREATE UNIQUE INDEX IF NOT EXISTS ")
      .replace(/^CREATE INDEX /, "CREATE INDEX IF NOT EXISTS ")
      .replace(/^CREATE TRIGGER /, "CREATE TRIGGER IF NOT EXISTS "));
  assert.deepEqual([...MART_SCHEMA_STATEMENTS], expected);
});
