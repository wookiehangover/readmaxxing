// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { SQLQuery } from "pg-sql";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("../../pool", () => ({
  getPool: () => ({ query, connect: async () => ({ query, release: () => {} }) }),
}));
import {
  claimReadingIngestUnitWithLease,
  completeReadingIngestUnit,
  getLatestReadingAgentUsage,
  insertReadingIngestUnit,
  releaseReadingIngestUnit,
} from "../reading-artifact";

let db: PGlite;
const userId = "00000000-0000-4000-8000-000000000001";
const quality = [
  {
    bullet: "Mara leaves.",
    bulletIndex: 0,
    relevance: 1,
    accuracy: 0.5,
    consistency: 1,
    rating: 0.5,
    attempt: 1,
    accepted: false,
  },
];
const usage = {
  input: 140,
  output: 20,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 160,
  costTotal: 0,
  model: "generator, typesafe-ai/jev",
  source: "ai-sdk",
  quality,
};

beforeAll(async () => {
  db = new PGlite();
  query.mockImplementation((value: SQLQuery | string) =>
    typeof value === "string" ? db.query(value) : db.query(value.text, value.values),
  );
  await db.exec("CREATE SCHEMA readmax; CREATE TABLE readmax.user (id UUID PRIMARY KEY)");
  await db.exec(await readFile("database/readmax/reading-artifacts.sql", "utf8"));
  // Exercise migration from the old schema, then its idempotent replay.
  await db.exec(
    "ALTER TABLE readmax.reading_agent_usage DROP COLUMN quality; ALTER TABLE readmax.reading_ingest_unit DROP COLUMN previous_page, DROP COLUMN next_page",
  );
  const migration = await readFile(
    "database/migrations/021-outline-quality-and-context.sql",
    "utf8",
  );
  await db.exec(migration);
  await db.exec(migration);
  await db.query("INSERT INTO readmax.user (id) VALUES ($1)", [userId]);
}, 30_000);

afterAll(async () => {
  await db?.close();
});

it("persists context and rating history on completion and provider failure", async () => {
  for (const outcome of ["done", "error"]) {
    const unit = await insertReadingIngestUnit({
      userId,
      bookId: "book",
      fingerprint: outcome,
      unitKind: "pdf-page",
      locator: outcome,
      text: "Mara leaves home.",
      previousPage: "Mara packs.",
      nextPage: "She locks the door.",
    });
    const claim = await claimReadingIngestUnitWithLease(unit!.id);
    expect(claim?.unit).toMatchObject({
      previousPage: "Mara packs.",
      nextPage: "She locks the door.",
    });
    if (outcome === "done") await completeReadingIngestUnit(claim!, [], usage);
    else await releaseReadingIngestUnit(claim!, "Jev unavailable", usage);
    expect(await getLatestReadingAgentUsage(userId)).toMatchObject({ quality, model: usage.model });
    const state = await db.query<{ status: string; attempt_count: number }>(
      "SELECT status, attempt_count FROM readmax.reading_ingest_unit WHERE id = $1",
      [unit!.id],
    );
    expect(state.rows[0]).toEqual({
      status: outcome === "done" ? "done" : "pending",
      attempt_count: outcome === "done" ? 0 : 1,
    });
  }
});
