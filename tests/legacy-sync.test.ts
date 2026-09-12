import { beforeEach, expect, it, vi } from "vitest";
import { clear, get, set } from "idb-keyval";
import {
  BASE,
  db,
  mocks,
  push,
  ctx,
} from "../app/lib/sync/__tests__/integration/push-route-harness";
import { action } from "../app/routes/api.sync.push";
import { loader as cron } from "../app/routes/api.cron.sync-delivery";
import {
  getBookStore,
  getBookDataStore,
  getNotebookStore,
  getHighlightStore,
  getChangeLogStore,
} from "../app/lib/sync/stores";
// @ts-expect-error Immutable historical module resolved by the dedicated Vitest config.
import * as mainPush from "@legacy-main/lib/sync/push";
// @ts-expect-error Immutable historical module resolved by the dedicated Vitest config.
import * as mainLog from "@legacy-main/lib/sync/change-log";
// @ts-expect-error Immutable historical module resolved by the dedicated Vitest config.
import * as mainAnnotations from "@legacy-main/lib/stores/annotations-store";
// @ts-expect-error Immutable historical module resolved by the dedicated Vitest config.
import * as baselinePush from "@legacy-baseline/lib/sync/push";
// @ts-expect-error Immutable historical module resolved by the dedicated Vitest config.
import * as baselineLog from "@legacy-baseline/lib/sync/change-log";
// @ts-expect-error Immutable historical module resolved by the dedicated Vitest config.
import * as baselineAnnotations from "@legacy-baseline/lib/stores/annotations-store";
const upload = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error("No external upload in regression");
  }),
);
vi.mock("@vercel/blob/client", () => ({ upload }));
const clients = [
  {
    name: "main",
    push: mainPush.pushChangesWithResult,
    log: mainLog,
    annotations: mainAnnotations,
  },
  {
    name: "baseline",
    push: baselinePush.pushChangesWithResult,
    log: baselineLog,
    annotations: baselineAnnotations,
  },
];
const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const book = (id: string, timestamp = BASE) => ({
  id: `root-${id}`,
  entity: "book" as const,
  entityId: id,
  operation: "put" as const,
  synced: false,
  timestamp,
  data: { id, title: id, format: "epub", fileHash: id },
});
const receipts = async () =>
  (
    await db.query<{
      original_snapshot: Record<string, unknown>;
      state: string;
      reason_code: string;
    }>(
      "SELECT original_snapshot,state,reason_code FROM readmax.sync_delivery_receipt ORDER BY received_at",
    )
  ).rows;
beforeEach(async () => {
  await Promise.all(
    [getBookStore(), getBookDataStore(), getNotebookStore(), getHighlightStore()].map((store) =>
      clear(store),
    ),
  );
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  upload.mockClear();
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) =>
    action({ request: new Request("https://test/api/sync/push", init) }),
  );
});
for (const client of clients) {
  it(`${client.name}: C1 real future notebook producer retires only after custody; cron later applies original clock`, async () => {
    const timestamp = Date.now() + 600_000;
    const service = client.annotations.makeAnnotationService({
      highlightStore: getHighlightStore(),
      notebookStore: getNotebookStore(),
    });
    await service.saveNotebook({
      bookId: "future",
      content: doc("saved future edit"),
      updatedAt: timestamp,
    });
    await vi.waitFor(async () => expect(await client.log.getUnsyncedChanges()).toHaveLength(1));
    const [sent] = await client.log.getUnsyncedChanges();
    await client.push(ctx());
    expect(await client.log.getUnsyncedChanges()).toEqual([]);
    expect(await receipts()).toMatchObject([
      { original_snapshot: { id: sent.id, data: sent.data, timestamp }, state: "waiting_clock" },
    ]);
    expect((await db.query("SELECT * FROM readmax.notebook")).rows).toEqual([]);
    vi.spyOn(Date, "now").mockReturnValue(timestamp);
    vi.stubEnv("CRON_SECRET", "test-secret");
    expect(
      (
        await cron({
          request: new Request("https://test/api/cron/sync-delivery", {
            headers: { Authorization: "Bearer test-secret" },
          }),
        })
      ).status,
    ).toBe(200);
    expect((await db.query("SELECT content,mutation_at FROM readmax.notebook")).rows).toEqual([
      { content: doc("saved future edit"), mutation_at: new Date(timestamp) },
    ]);
    expect((await receipts())[0].state).toBe("applied");
  });
  it(`${client.name}: retained book takes three actual retries; file and cover bytes stay local`, async () => {
    const sent = await client.log.recordChange(book("future-book", Date.now() + 600_000));
    const cover = new Blob([new Uint8Array([7, 8, 9])], { type: "image/png" });
    await set("future-book", { ...sent.data, coverImage: cover }, getBookStore());
    await set("future-book", new Uint8Array([1, 2, 3]).buffer, getBookDataStore());
    for (let i = 0; i < 3; i++) {
      await client.push(ctx());
      expect(await client.log.getUnsyncedChanges()).toHaveLength(i < 2 ? 1 : 0);
    }
    expect(await receipts()).toHaveLength(1);
    expect((await receipts())[0].state).toBe("waiting_clock");
    expect(new Uint8Array((await get<ArrayBuffer>("future-book", getBookDataStore()))!)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(
      new Uint8Array(await (await get("future-book", getBookStore())).coverImage.arrayBuffer()),
    ).toEqual(new Uint8Array([7, 8, 9]));
    expect(upload).not.toHaveBeenCalled();
    expect((await db.query("SELECT * FROM readmax.book")).rows).toEqual([]);
  });
  it(`${client.name}: C2 full fifty conflicts drain and later healthy and resolving edits proceed`, async () => {
    for (let i = 0; i < 50; i++)
      await client.log.recordChange({
        entity: "notebook",
        entityId: `notes-${i}`,
        operation: "put",
        data: { bookId: `notes-${i}`, content: doc(`conflict-${i}`) },
        timestamp: null,
      });
    await client.log.recordChange(book("healthy"));
    await client.log.recordChange({
      entity: "notebook",
      entityId: "notes-0",
      operation: "put",
      data: { bookId: "notes-0", content: doc("later valid edit") },
      timestamp: BASE,
    });
    await client.push(ctx());
    expect(await client.log.getUnsyncedChanges()).toHaveLength(2);
    await client.push(ctx());
    expect(await client.log.getUnsyncedChanges()).toEqual([]);
    expect((await receipts()).filter((row) => row.state === "needs_resolution")).toHaveLength(50);
    expect(
      (await db.query("SELECT content FROM readmax.notebook WHERE book_id='notes-0'")).rows,
    ).toEqual([{ content: doc("later valid edit") }]);
  });
  it(`${client.name}: DB custody failure preserves old outbox; lost ACK deduplicates exact snapshot`, async () => {
    await client.log.recordChange({
      entity: "notebook",
      entityId: "notes",
      operation: "put",
      data: { bookId: "notes", content: doc("preserve") },
      timestamp: BASE,
    });
    const execute = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation((query) => {
      if (
        typeof query !== "string" &&
        query.text.includes("INSERT INTO readmax.sync_delivery_receipt")
      )
        throw new Error("storage unavailable");
      return execute(query);
    });
    await expect(client.push(ctx())).rejects.toThrow();
    expect(await client.log.getUnsyncedChanges()).toHaveLength(1);
    expect(await receipts()).toEqual([]);
    mocks.query.mockImplementation(execute);
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      await action({ request: new Request("https://test/api/sync/push", init) });
      throw new Error("ACK lost");
    });
    await expect(client.push(ctx())).rejects.toThrow("ACK lost");
    expect(await client.log.getUnsyncedChanges()).toHaveLength(1);
    expect(await receipts()).toHaveLength(1);
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) =>
      action({ request: new Request("https://test/api/sync/push", init) }),
    );
    await client.push(ctx());
    expect(await client.log.getUnsyncedChanges()).toEqual([]);
    expect(await receipts()).toHaveLength(1);
  });
  it(`${client.name}: old response can erase shared failure bookkeeping but retained payload remains retrievable`, async () => {
    const sent = await client.log.recordChange({
      entity: "notebook",
      entityId: "failed",
      operation: "put",
      data: { bookId: "failed", content: doc("shared content") },
      timestamp: null,
    });
    await set(
      sent.id,
      {
        ...sent,
        failure: { reason: "previous failure", retryable: true, attempts: 3, lastAttemptAt: BASE },
      },
      getChangeLogStore(),
    );
    await client.push(ctx());
    expect(await get(sent.id, getChangeLogStore())).toBeUndefined();
    expect((await receipts())[0].original_snapshot.data).toEqual(sent.data);
  });
}
it("historical 1.1 MB valid notebook and more than 64 MiB retained history have no new admission cap", async () => {
  await push([
    {
      id: "large",
      entity: "notebook",
      entityId: "large",
      operation: "put",
      synced: false,
      timestamp: BASE,
      data: { bookId: "large", content: { text: "x".repeat(1_100_000) } },
    },
  ]);
  expect(
    (
      await db.query(
        "SELECT length(content->>'text') AS n FROM readmax.notebook WHERE book_id='large'",
      )
    ).rows,
  ).toEqual([{ n: 1_100_000 }]);
  for (let i = 0; i < 132; i++)
    await action({
      request: new Request("https://test/api/sync/push", {
        method: "POST",
        body: JSON.stringify({
          changes: [
            {
              id: "revision",
              entity: "notebook",
              entityId: "retained",
              operation: "put",
              timestamp: null,
              data: { bookId: "retained", content: { i, text: "x".repeat(512_000) } },
            },
          ],
        }),
      }),
    });
  expect(
    (
      await db.query<{ n: number; bytes: string }>(
        "SELECT count(*)::int AS n,sum(payload_bytes)::text AS bytes FROM readmax.sync_delivery_receipt WHERE change_id='revision'",
      )
    ).rows,
  ).toEqual([{ n: 132, bytes: expect.any(String) }]);
  expect(
    Number(
      (
        await db.query<{ bytes: string }>(
          "SELECT sum(payload_bytes)::text AS bytes FROM readmax.sync_delivery_receipt",
        )
      ).rows[0].bytes,
    ),
  ).toBeGreaterThan(64 * 1024 * 1024);
}, 120_000);
