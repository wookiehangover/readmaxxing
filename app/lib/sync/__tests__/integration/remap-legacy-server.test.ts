// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { clear, get, set } from "idb-keyval";
import { BASE, USER, db, ctx, push } from "./push-route-harness";
import { upsertBook } from "~/lib/database/book/book";
import { upsertHighlight } from "~/lib/database/annotation/highlight";
import { upsertNotebook } from "~/lib/database/annotation/notebook";
import { makeAnnotationService } from "~/lib/stores/annotations-store";
import { getUnsyncedChanges } from "../../change-log";
import { pushChangesWithResult } from "../../push";
import * as stores from "../../stores";
import type { ChangeEntry, SyncPushRequest, SyncPushResponse } from "../../types";

beforeEach(async () => {
  await Promise.all(Object.values(stores).map((getter) => clear(getter())));
});

it("retains an older server's equal-clock identity conflict until a genuinely newer edit resolves it", async () => {
  await push(
    [
      {
        id: "canonical-book",
        entity: "book",
        entityId: "canonical",
        operation: "put",
        data: { id: "canonical", fileHash: "hash" },
        timestamp: BASE,
        synced: false,
      },
    ],
    true,
  );
  await upsertNotebook(USER, "canonical", { text: "newer canonical note" }, new Date(BASE + 500));
  const highlight = {
    id: "highlight",
    bookId: "local",
    cfiRange: "range",
    text: "quote",
    color: "yellow",
    createdAt: BASE,
    updatedAt: BASE + 200,
  };
  await set("highlight", highlight, stores.getHighlightStore());
  await set(
    "canonical",
    { bookId: "canonical", content: { text: "newer canonical note" }, updatedAt: BASE + 500 },
    stores.getNotebookStore(),
  );
  await set(
    "local",
    { bookId: "local", content: { text: "older note" }, updatedAt: BASE + 200 },
    stores.getNotebookStore(),
  );
  const changes: ChangeEntry[] = [
    {
      id: "000",
      entity: "book",
      entityId: "local",
      data: { id: "local", fileHash: "hash" },
      timestamp: BASE + 100,
      operation: "put",
      synced: false,
    },
    {
      id: "001",
      entity: "highlight",
      entityId: "highlight",
      data: highlight,
      timestamp: BASE + 200,
      operation: "put",
      synced: false,
    },
    {
      id: "002",
      entity: "notebook",
      entityId: "local",
      data: { bookId: "local", content: { text: "older note" } },
      timestamp: BASE + 200,
      operation: "put",
      synced: false,
    },
  ];
  for (const change of changes) await set(change.id, change, stores.getChangeLogStore());
  // This adapter reproduces the pre-A3 route: direct source-ordered DAL writes,
  // and a dedup response/tombstone without durable server aliases or relocation.
  const fetchMock = vi.fn(async (_url, init) => {
    const response: SyncPushResponse = {
      accepted: [],
      rejected: [],
      serverTimestamp: new Date().toISOString(),
    };
    for (const change of (JSON.parse(init.body) as SyncPushRequest).changes) {
      const data = change.data as Record<string, unknown>;
      try {
        if (change.entity === "book") {
          await upsertBook(USER, {
            id: "local",
            fileHash: "hash",
            updatedAt: new Date(change.timestamp),
            deletedAt: new Date(change.timestamp),
          });
          response.accepted.push({ id: change.id, canonicalId: "canonical" });
          continue;
        }
        if (change.entity === "highlight") {
          await upsertHighlight(USER, {
            ...highlight,
            ...data,
            id: change.entityId,
            bookId: data.bookId as string,
            createdAt: new Date(data.createdAt as number),
            updatedAt: new Date(change.timestamp),
          });
        } else if (change.entity === "notebook") {
          await upsertNotebook(USER, change.entityId, data.content, new Date(change.timestamp));
        }
        response.accepted.push({ id: change.id });
      } catch (error) {
        response.rejected.push({ id: change.id, reason: (error as Error).message });
      }
    }
    return Response.json(response);
  });
  vi.stubGlobal("fetch", fetchMock);
  await pushChangesWithResult(ctx());
  await expect(pushChangesWithResult(ctx())).rejects.toThrow("retained");
  const [retained] = await getUnsyncedChanges();
  expect(retained).toMatchObject({
    id: "001",
    timestamp: BASE + 200,
    data: { bookId: "canonical" },
    failure: { retryable: true },
  });
  expect((await db.query("SELECT book_id, mutation_at FROM readmax.highlight")).rows).toEqual([
    { book_id: "local", mutation_at: new Date(BASE + 200) },
  ]);
  expect(
    (await db.query("SELECT content FROM readmax.notebook WHERE book_id = 'canonical'")).rows,
  ).toEqual([{ content: { text: "newer canonical note" } }]);
  expect(await get("canonical", stores.getNotebookStore())).toMatchObject({
    content: { text: "newer canonical note" },
    updatedAt: BASE + 500,
  });
  vi.resetModules();
  const reloaded = await import("../../push");
  await expect(reloaded.pushChangesWithResult(ctx())).rejects.toThrow("retained");
  expect(fetchMock).toHaveBeenCalledTimes(2);

  vi.spyOn(Date, "now").mockReturnValue(BASE + 1000);
  const service = makeAnnotationService({
    highlightStore: stores.getHighlightStore(),
    notebookStore: stores.getNotebookStore(),
  });
  await service.updateHighlight("highlight", { note: "newer user edit" });
  await vi.waitFor(async () => expect(await getUnsyncedChanges()).toHaveLength(2));
  await expect(reloaded.pushChangesWithResult(ctx())).rejects.toThrow("retained");
  vi.spyOn(Date, "now").mockReturnValue(retained.failure!.nextAttemptAt! + 1000);
  await reloaded.pushChangesWithResult(ctx());
  expect(await getUnsyncedChanges()).toEqual([]);
  expect((await db.query("SELECT book_id, note, mutation_at FROM readmax.highlight")).rows).toEqual(
    [{ book_id: "canonical", note: "newer user edit", mutation_at: new Date(BASE + 1000) }],
  );
});
