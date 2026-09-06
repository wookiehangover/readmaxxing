import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clear, entries, get, set } from "idb-keyval";
import { DEMO_BOOK_ID, DEMO_CHAT_SESSION } from "./demo-content";
import { persistAdoptedDemoContent } from "./adopt-demo";
import { getUnsyncedChanges, recordChange } from "~/lib/sync/change-log";
import * as stores from "~/lib/sync/stores";
import type { BookMeta } from "~/lib/stores/book-store";
import type { SyncPushRequest } from "~/lib/sync/types";
import { authSessionSaga } from "~/lib/themis/auth-session/auth-session-sagas";
import { refreshAuthSessionRequested } from "~/lib/themis/auth-session/auth-session-slice";
import { booksSaga } from "~/lib/themis/books/books-sagas";
import { createAppStore } from "~/lib/themis/store";
import { makeSyncEngine } from "~/lib/sync/sync-engine";

vi.mock("~/lib/auth-service", () => ({
  authService: {
    getSession: async () => ({ user: { id: "disposable-reader", displayName: "Reader" } }),
  },
}));

vi.mock("~/lib/sync/file-uploads", () => ({ uploadPendingFiles: async () => {} }));
vi.mock("~/lib/sync/book-chapter-uploads", () => ({ ensureBookChaptersUploaded: async () => {} }));

const owner = "disposable-reader";

beforeEach(async () => {
  await Promise.all(Object.values(stores).map((store) => clear(store())));
  await Promise.all([
    set(
      DEMO_BOOK_ID,
      {
        id: DEMO_BOOK_ID,
        title: "The Great Gatsby",
        author: "F. Scott Fitzgerald",
        coverImage: null,
        format: "epub",
        fileHash: "gatsby",
        updatedAt: 100,
      },
      stores.getBookStore(),
    ),
    set(DEMO_BOOK_ID, new Uint8Array([1, 2, 3]).buffer, stores.getBookDataStore()),
    set(
      DEMO_BOOK_ID,
      { bookId: DEMO_BOOK_ID, content: { text: "My notes" }, updatedAt: 110 },
      stores.getNotebookStore(),
    ),
    set(DEMO_BOOK_ID, { cfi: "page:12", updatedAt: 120 }, stores.getPositionStore()),
    set(DEMO_BOOK_ID, [DEMO_CHAT_SESSION], stores.getChatSessionStore()),
    set(DEMO_BOOK_ID, DEMO_CHAT_SESSION.id, stores.getActiveSessionStore()),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function ownedBooks() {
  return (await entries<string, BookMeta>(stores.getBookStore()))
    .map(([, book]) => book)
    .filter((book) => book.id !== DEMO_BOOK_ID && !book.deletedAt);
}

describe("demo adoption with real durable sync", () => {
  it("starts an existing account pull without waiting for an adoption network save", async () => {
    let release!: () => void;
    const network = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).startsWith("/api/sync/pull"))
          return Response.json({
            changes: [
              {
                entity: "book",
                records: [
                  {
                    id: "cloud-book",
                    title: "Cloud library",
                    author: "Reader",
                    format: "epub",
                    updatedAt: 300,
                  },
                ],
                cursor: new Date().toISOString(),
              },
            ],
          });
        await network;
        return new Response(null, { status: 503 });
      }),
    );
    const app = createAppStore();
    app.init();
    app.runSaga(booksSaga);
    app.runSaga(authSessionSaga);
    const engine = makeSyncEngine({ userId: owner });
    try {
      app.dispatch(refreshAuthSessionRequested());
      await vi.waitFor(() =>
        expect(app.authSessionSelectors.selectIsAuthenticated.select(app.state)).toBe(true),
      );
      await engine.pullChanges();
      expect(await get("cloud-book", stores.getBookStore())).toMatchObject({
        title: "Cloud library",
      });
      app.dispatch(refreshAuthSessionRequested());
      await vi.waitFor(() =>
        expect(app.authSessionSelectors.selectAuthLoading.select(app.state)).toBe(false),
      );
      expect(await ownedBooks()).toHaveLength(2);
    } finally {
      release();
      engine.stopSync();
      app.dispose();
    }
  });
  it.each([401, 503])("keeps one adopted identity across reload after HTTP %s", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status })),
    );
    await expect(persistAdoptedDemoContent(owner)).rejects.toThrow();
    const first = await ownedBooks();
    expect(first).toHaveLength(1);
    const pending = await getUnsyncedChanges();
    vi.resetModules();
    const reloaded = await import("./adopt-demo");
    await expect(reloaded.persistAdoptedDemoContent(owner)).rejects.toThrow();
    expect((await ownedBooks()).map((book) => book.id)).toEqual(first.map((book) => book.id));
    expect((await getUnsyncedChanges()).map((change) => change.id)).toEqual(
      pending.map((change) => change.id),
    );
  });

  it("preserves reserved pending edits and highlights through failed adoption", async () => {
    const original = await recordChange({
      entity: "notebook",
      entityId: DEMO_BOOK_ID,
      operation: "put",
      data: { bookId: DEMO_BOOK_ID, content: { text: "Unflushed notes" }, updatedAt: 130 },
      timestamp: 130,
    });
    await set(
      "highlight",
      { id: "highlight", bookId: DEMO_BOOK_ID, text: "green light", updatedAt: 140 },
      stores.getHighlightStore(),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    await expect(persistAdoptedDemoContent(owner)).rejects.toThrow();
    const [book] = await ownedBooks();
    expect(await get("highlight", stores.getHighlightStore())).toMatchObject({
      bookId: book.id,
      text: "green light",
    });
    expect(await getUnsyncedChanges()).toContainEqual(
      expect.objectContaining({
        id: original.id,
        entityId: book.id,
        timestamp: 130,
        synced: false,
        data: expect.objectContaining({ content: { text: "Unflushed notes" } }),
      }),
    );
  });

  it("preserves newer canonical metadata and tombstones during deduplication", async () => {
    const canonical = { id: "canonical", title: "My edition", updatedAt: 900, deletedAt: 900 };
    await set("canonical", canonical, stores.getBookStore());
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const { changes } = JSON.parse(init.body) as SyncPushRequest;
        return Response.json({
          accepted: changes.map((change) => ({
            id: change.id,
            ...(change.entity === "book" ? { canonicalId: "canonical" } : {}),
          })),
          rejected: [],
          serverTimestamp: new Date().toISOString(),
        });
      }),
    );
    await persistAdoptedDemoContent(owner).catch(() => {});
    expect(await get("canonical", stores.getBookStore())).toMatchObject(canonical);
  });
});
