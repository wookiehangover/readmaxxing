// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("~/lib/database/pool", () => ({ getPool: () => ({ query }) }));
import {
  appendRepairDiagnostic,
  createRepairJob,
  finishRepairJob,
  getRepairJob,
  readRepairOutput,
} from "./repair-jobs.server";
let db: PGlite;
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
beforeAll(async () => {
  db = new PGlite();
  await db.exec('CREATE SCHEMA readmax; CREATE TABLE readmax."user" (id uuid PRIMARY KEY);');
  await db.exec(await readFile("database/migrations/021-book-repair.sql", "utf8"));
  await db.query('INSERT INTO readmax."user" VALUES ($1), ($2)', [owner, other]);
  query.mockImplementation((sql: string, params: unknown[]) => db.query(sql, params));
});
beforeEach(async () => {
  await db.exec("DELETE FROM readmax.book_repair");
});
afterAll(async () => {
  await db.close();
});
it("allows one running job per user and isolates diagnostics and output", async () => {
  const job = await createRepairJob(owner, "book", "hash");
  expect(job).not.toBeNull();
  expect(await createRepairJob(owner, "different-book", "hash")).toBeNull();
  expect(await createRepairJob(other, "book", "hash")).not.toBeNull();
  expect(await getRepairJob(other, "book", job!.id)).toBeNull();
  await appendRepairDiagnostic(job!.id, "Rendered all chapters");
  expect((await getRepairJob(owner, "book"))?.diagnostics).toEqual(["Rendered all chapters"]);
  await finishRepairJob(job!.id, Buffer.from("result"), null);
  expect(await readRepairOutput(other, "book", job!.id)).toBeNull();
  expect(Buffer.from((await readRepairOutput(owner, "book", job!.id))!).toString()).toBe("result");
  expect(await createRepairJob(owner, "different-book", "hash")).not.toBeNull();
});
it("expires abandoned work and refuses late completion", async () => {
  const job = await createRepairJob(owner, "book", "hash");
  await db.query(
    "UPDATE readmax.book_repair SET expires_at = now() - interval '1 second' WHERE id = $1",
    [job!.id],
  );
  await finishRepairJob(job!.id, Buffer.from("late"), null);
  expect((await getRepairJob(owner, "book"))?.status).toBe("failed");
  expect(await readRepairOutput(owner, "book", job!.id)).toBeNull();
  expect(await createRepairJob(owner, "book", "hash")).not.toBeNull();
});
