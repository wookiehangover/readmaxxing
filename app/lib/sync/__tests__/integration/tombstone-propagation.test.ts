import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clear, createStore, get, set } from "idb-keyval";
import { recordChange } from "../../change-log";
import { makeSyncEngine } from "../../sync-engine";
import type { ChangeEntry, SyncPullResponse, SyncPushRequest } from "../../types";

// Cross-device relay tests exercise both push and pull. Stub the blob client
// so the fire-and-forget uploadPendingFiles pass cannot touch the network.
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

// Minimal mocked server relay: stores the canonical tombstone pushed by
// device A, replays it to device B on pull. Per-entity cursor advance on
// the client side naturally rate-limits re-delivery.
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

// Scenario 4: cross-device tombstone propagation de-duplicates.
describe("integration: cross-device tombstone propagation", () => {
  it("device B pulls the tombstone, and a second pull is a no-op", async () => {
    const relay = makeRelay();

    // Route fetch based on URL so one test can exercise push and pull.
    const fetchMock = vi.fn((url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/sync/push")) return relay.push(u, init);
      if (u.includes("/api/sync/pull")) return relay.pull();
      throw new Error(`unexpected fetch url: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    // --- Device A ---
    // Seed a book, soft-delete it (set deletedAt + updatedAt), queue the
    // change, and push to the relay. The relay captures the tombstone.
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

    // --- Device B ---
    // Reset the shared IDB to represent a separate device that has not yet
    // applied the delete. Seed a live (non-deleted) copy of the same book.
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

    // First pull: tombstone wins LWW and is applied.
    await engineB.pullChanges();
    const afterFirstPull = await get<Record<string, unknown>>(bookId, bookStore);
    expect(afterFirstPull).toBeDefined();
    expect(afterFirstPull?.deletedAt).toBe(deletedAt);
    expect(afterFirstPull?.updatedAt).toBe(deletedAt);

    // Second pull of the same tombstone: idempotent, no duplicate side-effects.
    await engineB.pullChanges();
    const afterSecondPull = await get<Record<string, unknown>>(bookId, bookStore);
    expect(afterSecondPull).toEqual(afterFirstPull);
  });
});
