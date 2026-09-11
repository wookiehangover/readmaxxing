import { beforeEach, expect, it, vi } from "vitest";
import { clear, get, set, entries } from "idb-keyval";
import {
  BASE,
  USER,
  OTHER_USER,
  db,
  push,
  ctx,
} from "../app/lib/sync/__tests__/integration/push-route-harness";
import { action } from "../app/routes/api.sync.push";
import { loader as pullRoute } from "../app/routes/api.sync.pull";
import { loader as aliasesRoute } from "../app/routes/api.sync.book-aliases";
import { pushChangesWithResult } from "../app/lib/sync/push";
import { pullChanges } from "../app/lib/sync/pull";
import { runInitialSyncIfNeeded } from "../app/lib/sync/initial-sync";
import { getBookRemaps } from "../app/lib/sync/remap-journal";
import { listCustody } from "../app/lib/sync/custody-journal";
import { setCustodyAccount } from "../app/lib/sync/custody-session";
import * as stores from "../app/lib/sync/stores";
import { getCursor, clearAllCursors } from "../app/lib/sync/sync-cursors";
// @ts-expect-error Frozen actual client modules from immutable refs, resolved by historical config.
import * as oldMainPull from "@legacy-main/lib/sync/pull";
// @ts-expect-error Frozen actual client modules from immutable refs, resolved by historical config.
import * as oldBasePull from "@legacy-baseline/lib/sync/pull";
// @ts-expect-error Frozen actual client modules from immutable refs, resolved by historical config.
import * as oldMainPush from "@legacy-main/lib/sync/push";
// @ts-expect-error Frozen actual client modules from immutable refs, resolved by historical config.
import * as oldBasePush from "@legacy-baseline/lib/sync/push";
// @ts-expect-error Frozen actual client modules from immutable refs, resolved by historical config.
import * as oldMainAnnotations from "@legacy-main/lib/stores/annotations-store";
// @ts-expect-error Frozen actual client modules from immutable refs, resolved by historical config.
import * as oldBaseAnnotations from "@legacy-baseline/lib/stores/annotations-store";

const clients = [
  {
    name: "main",
    pull: oldMainPull.pullChanges,
    push: oldMainPush.pushChangesWithResult,
    annotations: oldMainAnnotations,
  },
  {
    name: "baseline",
    pull: oldBasePull.pullChanges,
    push: oldBasePush.pushChangesWithResult,
    annotations: oldBaseAnnotations,
  },
];
const context = { userId: USER, isStopped: () => false };
const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const root = (id: string, hash = "shared") => ({
  id: `root-${id}`,
  entity: "book" as const,
  entityId: id,
  operation: "put" as const,
  synced: false,
  timestamp: BASE,
  data: { id, title: id, fileHash: hash, format: "epub" },
});
const connected = async (url: string, init?: RequestInit) => {
  const request = new Request(new URL(url, "https://test"), init);
  if (url.startsWith("/api/sync/book-aliases")) return aliasesRoute({ request });
  if (url.startsWith("/api/sync/pull")) return pullRoute({ request });
  return action({ request });
};
beforeEach(async () => {
  setCustodyAccount(undefined);
  await Promise.all(Object.values(stores).map((getter) => clear(getter())));
  await clearAllCursors();
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  vi.stubGlobal("fetch", connected);
});

for (const client of clients) {
  it(`${client.name}: consumed alias cursor upgrades with tombstoned no-hash source, unqueued notebook and exact byte custody`, async () => {
    await push([root("canonical"), root("source")]);
    await set(
      "source",
      { id: "source", deletedAt: BASE, updatedAt: BASE, coverImage: new Blob(["source cover"]) },
      stores.getBookStore(),
    );
    await set(
      "source",
      { bookId: "source", content: doc("surviving source"), updatedAt: BASE + 1 },
      stores.getNotebookStore(),
    );
    await set("source", new Uint8Array([1, 2]).buffer, stores.getBookDataStore());
    await set("canonical", new Uint8Array([9, 8]).buffer, stores.getBookDataStore());
    await client.pull({ isStopped: () => false });
    const consumed = await getCursor("book");
    expect(consumed).toBeTruthy();
    expect(await getBookRemaps(USER)).toEqual([]);
    expect(await get("source", stores.getNotebookStore())).toMatchObject({
      content: doc("surviving source"),
    });
    await set("initial-sync-complete", true, stores.getSyncFlagsStore());
    await runInitialSyncIfNeeded();
    await pullChanges(context);
    await pushChangesWithResult(ctx());
    expect(await getCursor("book")).toBe(consumed);
    expect(await getBookRemaps(USER)).toMatchObject([
      { fromId: "source", toId: "canonical", complete: true },
    ]);
    expect(
      (await db.query("SELECT content FROM readmax.notebook WHERE book_id='canonical'")).rows,
    ).toEqual([{ content: doc("surviving source") }]);
    expect(await get("source", stores.getNotebookStore())).toBeUndefined();
    const bytes = (await listCustody(USER))
      .map(({ item }) => item.raw)
      .filter((raw) => raw instanceof ArrayBuffer) as ArrayBuffer[];
    expect(bytes.some((raw) => new Uint8Array(raw)[0] === 1)).toBe(true);
    expect(
      new Uint8Array((await get<ArrayBuffer>("canonical", stores.getBookDataStore()))!),
    ).toEqual(new Uint8Array([9, 8]));
  });

  it(`${client.name}: completed recovery still discovers a later alias consumed by an old tab`, async () => {
    await push([root("canonical"), root("source")]);
    await client.pull({ isStopped: () => false });
    await pullChanges(context);
    const first = await get<{ cursor: string; complete: boolean }>(
      ["aliases", 1, USER],
      stores.getAliasProgressStore(),
    );
    expect(first?.complete).toBe(true);
    await push([root("late")]);
    await set(
      "late",
      { bookId: "late", content: doc("late source"), updatedAt: BASE + 5 },
      stores.getNotebookStore(),
    );
    await client.pull({ isStopped: () => false });
    await pullChanges(context);
    await pushChangesWithResult(ctx());
    expect((await getBookRemaps(USER)).some((remap) => remap.fromId === "late")).toBe(true);
    expect(
      (await db.query("SELECT content FROM readmax.notebook WHERE book_id='canonical'")).rows,
    ).toEqual([{ content: doc("late source") }]);
    expect(
      (await get<{ cursor: string }>(["aliases", 1, USER], stores.getAliasProgressStore()))?.cursor,
    ).not.toBe(first?.cursor);
  });

  it(`${client.name}: real old response deletes a shared revised ID but private revision reaches SQL`, async () => {
    const old = client.annotations.makeAnnotationService({
      notebookStore: stores.getNotebookStore(),
      highlightStore: stores.getHighlightStore(),
    });
    await old.saveNotebook({ bookId: "book", content: doc("old submitted"), updatedAt: BASE });
    await vi.waitFor(async () => expect(await entries(stores.getChangeLogStore())).toHaveLength(1));
    const [id] = (await entries(stores.getChangeLogStore()))[0];
    let release!: () => void;
    let received!: () => void;
    const atServer = new Promise<void>((resolve) => {
      received = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const response = await connected(url, init);
      received();
      await waiting;
      return response;
    });
    const oldPush = client.push(ctx());
    await atServer;
    const { custodyUpdate } = await import("../app/lib/sync/custody-write");
    await custodyUpdate<Record<string, unknown>>(
      id,
      (current) => ({
        ...current,
        data: { bookId: "book", content: doc("updated same ID") },
        timestamp: BASE + 1,
        revision: 1,
      }),
      stores.getChangeLogStore(),
      { ownerId: USER },
    );
    release();
    await oldPush;
    expect(await get(id, stores.getChangeLogStore())).toBeUndefined();
    vi.stubGlobal("fetch", connected);
    await pushChangesWithResult(ctx());
    const rows = (
      await db.query<{ original_snapshot: { data: { content: unknown } } }>(
        "SELECT original_snapshot FROM readmax.sync_delivery_receipt",
      )
    ).rows;
    expect(rows.map((row) => row.original_snapshot.data.content)).toEqual(
      expect.arrayContaining([doc("old submitted"), doc("updated same ID")]),
    );
  });
}

it("page interruption resumes; ordinary deletion and foreign response never become aliases", async () => {
  await push([root("canonical"), root("one"), root("two")]);
  let page = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (!url.startsWith("/api/sync/book-aliases")) return connected(url, init);
    if (++page === 2) throw new Error("page interrupted");
    return connected(url.replace("limit=100", "limit=1"), init);
  });
  await expect(pullChanges(context)).rejects.toThrow("page interrupted");
  const checkpoint = await get<{ complete: boolean }>(
    ["aliases", 1, USER],
    stores.getAliasProgressStore(),
  );
  expect(checkpoint?.complete).toBe(false);
  expect(await get("canonical", stores.getBookStore())).toBeTruthy(); // healthy pull still ran
  vi.stubGlobal("fetch", connected);
  await pullChanges(context);
  expect(
    (await get<{ complete: boolean }>(["aliases", 1, USER], stores.getAliasProgressStore()))
      ?.complete,
  ).toBe(true);
  await push([
    root("ordinary", "different"),
    {
      ...root("ordinary", "different"),
      id: "delete-ordinary",
      operation: "delete",
      timestamp: BASE + 10,
    },
  ]);
  await pullChanges(context);
  expect((await getBookRemaps(USER)).some((remap) => remap.fromId === "ordinary")).toBe(false);
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) =>
    url.startsWith("/api/sync/book-aliases")
      ? Response.json({
          ownerId: OTHER_USER,
          aliases: [{ fromId: "foreign", toId: "canonical", version: "100" }],
          cursor: "foreign",
          hasMore: false,
        })
      : connected(url, init),
  );
  await expect(pullChanges(context)).rejects.toThrow("owner mismatch");
  expect((await getBookRemaps(USER)).some((remap) => remap.fromId === "foreign")).toBe(false);
});
