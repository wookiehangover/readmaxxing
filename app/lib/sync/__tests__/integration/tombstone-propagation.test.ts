import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clear, createStore, get, set } from "idb-keyval";
import { recordChange } from "../../change-log";
import { makeSyncEngine } from "../../sync-engine";
import type { ChangeEntry, SyncPullResponse, SyncPushRequest } from "../../types";

vi.mock("@vercel/blob/client", () => ({
  upload: vi.fn(async () => ({ url: "blob://unused" })),
}));

const bookStore = createStore("ebook-reader-db", "books");
const cursorStore = createStore("ebook-reader-sync-cursors", "cursors");
const changeLogStore = createStore("ebook-reader-changelog", "changes");

beforeEach(async () => {
  await Promise.all([clear(bookStore), clear(cursorStore), clear(changeLogStore)]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeRelay() {
  const state: { tombstone: Record<string, unknown> | null; serverTs: string } = {
    tombstone: null,
    serverTs: "2026-04-22T12:00:00.000Z",
  };

  const push = async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string) as SyncPushRequest;
    for (const change of body.changes) {
      if (change.entity !== "book") continue;
      const data = change.data as Record<string, unknown> | null;
      if (data && data.deletedAt != null) state.tombstone = data;
    }
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        accepted: body.changes.map((c: ChangeEntry) => ({ id: c.id })),
        rejected: [],
        serverTimestamp: state.serverTs,
      }),
    } as unknown as Response;
  };

  const pull = async () => {
    const records = state.tombstone ? [state.tombstone] : [];
    const response: SyncPullResponse = {
      serverTimestamp: state.serverTs,
      changes: [{ entity: "book", records, cursor: state.serverTs, hasMore: false }],
    };
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => response,
    } as unknown as Response;
  };

  return { state, push, pull };
}

describe("integration: cross-device tombstone propagation", () => {
  it("device B pulls the tombstone, and a second pull is a no-op", async () => {
    const relay = makeRelay();

    const fetchMock = vi.fn((url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/sync/push")) return relay.push(u, init);
      if (u.includes("/api/sync/pull")) return relay.pull();
      throw new Error(`unexpected fetch url: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const bookId = "book-shared-1";
    const deletedAt = Date.parse(relay.state.serverTs);
    const tombstone = {
      id: bookId,
      title: "Shared",
      author: "A",
      format: "epub",
      fileHash: "shared-hash",
      deletedAt,
      updatedAt: deletedAt,
    };
    await set(bookId, tombstone, bookStore);
    await recordChange({
      entity: "book",
      entityId: bookId,
      operation: "delete",
      data: tombstone,
      timestamp: deletedAt,
    });

    const engineA = makeSyncEngine({ userId: "user-test" });
    await engineA.pushChanges();
    expect(relay.state.tombstone).not.toBeNull();

    await Promise.all([clear(bookStore), clear(cursorStore), clear(changeLogStore)]);
    const liveCopy = {
      id: bookId,
      title: "Shared",
      author: "A",
      format: "epub",
      fileHash: "shared-hash",
      updatedAt: deletedAt - 10_000,
    };
    await set(bookId, liveCopy, bookStore);

    const engineB = makeSyncEngine({ userId: "user-test" });

    await engineB.pullChanges();
    const afterFirstPull = await get<Record<string, unknown>>(bookId, bookStore);
    expect(afterFirstPull).toBeDefined();
    expect(afterFirstPull?.deletedAt).toBe(deletedAt);
    expect(afterFirstPull?.updatedAt).toBe(deletedAt);

    await engineB.pullChanges();
    const afterSecondPull = await get<Record<string, unknown>>(bookId, bookStore);
    expect(afterSecondPull).toEqual(afterFirstPull);
  });
});
