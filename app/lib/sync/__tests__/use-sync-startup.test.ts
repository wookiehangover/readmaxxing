import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { clear, get, set } from "idb-keyval";
import * as stores from "../stores";
import * as initialSync from "../initial-sync";
import * as syncEngine from "../sync-engine";
import { getUnsyncedChanges, recordChange } from "../change-log";
import { useSync } from "../use-sync";
import { AppStoreProvider, useAppStore } from "~/lib/themis/provider";
import type { AppStore } from "~/lib/themis/store";
import { authSessionResolved } from "~/lib/themis/auth-session/auth-session-slice";
import { AuthProvider } from "~/lib/context/auth-context";
import { DEMO_BOOK_ID, DEMO_CHAT_SESSION } from "~/lib/onboarding/demo-content";

vi.mock("~/lib/auth-service", () => ({
  authService: { getSession: async () => ({ user: { id: "reader", displayName: "Reader" } }) },
}));
vi.mock("../file-uploads", () => ({ uploadPendingFiles: async () => {} }));

beforeEach(async () => {
  await Promise.all(Object.values(stores).map((store) => clear(store())));
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await set(
    DEMO_BOOK_ID,
    {
      id: DEMO_BOOK_ID,
      title: "Gatsby",
      author: "F. Scott Fitzgerald",
      coverImage: null,
      format: "epub",
      fileHash: "gatsby",
      updatedAt: 100,
    },
    stores.getBookStore(),
  );
  await set(DEMO_BOOK_ID, new Uint8Array([1, 2, 3]).buffer, stores.getBookDataStore());
  await set(DEMO_BOOK_ID, [DEMO_CHAT_SESSION], stores.getChatSessionStore());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

let currentStore: AppStore;

function Harness() {
  currentStore = useAppStore();
  useSync();
  return null;
}

function renderHarness() {
  return createElement(
    AppStoreProvider,
    null,
    createElement(AuthProvider, null, createElement(Harness)),
  );
}

it.each([true, false])(
  "pulls existing cloud books through actual auth while adoption push stays unresolved (seeded conversation: %s)",
  async (hasSeededConversation) => {
    if (!hasSeededConversation) {
      await set(
        DEMO_BOOK_ID,
        [{ ...DEMO_CHAT_SESSION, id: "user-session", title: "My conversation" }],
        stores.getChatSessionStore(),
      );
      await set(DEMO_BOOK_ID, DEMO_CHAT_SESSION.id, stores.getActiveSessionStore());
    }
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        paths.push(String(url));
        if (String(url).startsWith("/api/sync/pull"))
          return Response.json({
            changes: [
              {
                entity: "book",
                records: [{ id: "cloud", title: "Existing cloud", updatedAt: 300 }],
                cursor: new Date().toISOString(),
              },
            ],
          });
        await gate;
        return new Response(null, { status: 503 });
      }),
    );
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => {
        root.render(renderHarness());
      });
      await vi.waitFor(() => expect(paths).toContain("/api/sync/push"));
      await vi.waitFor(async () =>
        expect(await get("cloud", stores.getBookStore())).toMatchObject({
          title: "Existing cloud",
        }),
      );
      expect(paths.find((path) => !path.startsWith("/api/sync/book-aliases"))).toMatch(
        /^\/api\/sync\/pull/,
      );
      const pending = await getUnsyncedChanges();
      expect(pending.some((change) => change.entity === "book" && !change.synced)).toBe(true);
      expect(await get("demo-adoption", stores.getSyncFlagsStore())).toMatchObject({
        ownerId: "reader",
      });
      if (!hasSeededConversation) {
        const intent = await get<{ bookId: string }>("demo-adoption", stores.getSyncFlagsStore());
        expect(await get(intent!.bookId, stores.getActiveSessionStore())).toBe("user-session");
        expect(await get(intent!.bookId, stores.getChatSessionStore())).toEqual([
          {
            ...DEMO_CHAT_SESSION,
            id: "user-session",
            title: "My conversation",
            bookId: intent!.bookId,
          },
        ]);
      }
    } finally {
      await act(async () => {
        root.unmount();
      });
      release();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  },
);

it("keeps authenticated cloud startup and reserved local evidence when optional adoption has no conversations", async () => {
  await set(DEMO_BOOK_ID, [], stores.getChatSessionStore());
  const pending = await recordChange({
    entity: "book",
    entityId: DEMO_BOOK_ID,
    operation: "put",
    data: await get(DEMO_BOOK_ID, stores.getBookStore()),
    timestamp: 100,
  });
  const fetch = vi.fn(async (url) => {
    expect(String(url)).toMatch(/^\/api\/sync\/pull/);
    return Response.json({
      changes: [
        {
          entity: "book",
          records: [{ id: "cloud", title: "Existing cloud", updatedAt: 300 }],
          cursor: new Date().toISOString(),
        },
      ],
    });
  });
  vi.stubGlobal("fetch", fetch);
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => {
      root.render(renderHarness());
    });
    await vi.waitFor(async () =>
      expect(await get("cloud", stores.getBookStore())).toMatchObject({ title: "Existing cloud" }),
    );
    expect(currentStore.authSessionSelectors.selectIsAuthenticated.select(currentStore.state)).toBe(
      true,
    );
    expect(currentStore.authSessionSelectors.selectAuthError.select(currentStore.state)).toBeNull();
    expect(await get("demo-adoption", stores.getSyncFlagsStore())).toBeUndefined();
    expect(await get(DEMO_BOOK_ID, stores.getBookStore())).toMatchObject({
      id: DEMO_BOOK_ID,
      title: "Gatsby",
      updatedAt: 100,
    });
    expect(await get(DEMO_BOOK_ID, stores.getBookDataStore())).toEqual(
      new Uint8Array([1, 2, 3]).buffer,
    );
    expect(await getUnsyncedChanges()).toContainEqual(pending);
  } finally {
    await act(async () => {
      root.unmount();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
});

it("does not publish or restart an unmounted engine when its real initial scan finishes late", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const scan = initialSync.runInitialSyncIfNeeded;
  vi.spyOn(initialSync, "runInitialSyncIfNeeded").mockImplementation(async () => {
    await gate;
    await scan();
  });
  const makeEngine = syncEngine.makeSyncEngine;
  const starts = vi.fn();
  vi.spyOn(syncEngine, "makeSyncEngine").mockImplementation((config) => {
    const engine = makeEngine(config);
    const start = engine.startSync;
    engine.startSync = () => {
      starts();
      start();
    };
    return engine;
  });
  const fetch = vi.fn(async () => Response.json({ changes: [] }));
  vi.stubGlobal("fetch", fetch);
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(renderHarness());
  });
  await vi.waitFor(() => expect(initialSync.runInitialSyncIfNeeded).toHaveBeenCalled());
  await act(async () => {
    root.unmount();
  });
  release();
  await vi.waitFor(async () =>
    expect(await get("initial-sync-complete", stores.getSyncFlagsStore())).toBe(true),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(starts).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect((await getUnsyncedChanges()).length).toBeGreaterThan(0);
});

it("keeps a replaced account's late initialization and auth-expiry callback from restarting or clearing the new engine", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const scan = initialSync.runInitialSyncIfNeeded;
  vi.spyOn(initialSync, "runInitialSyncIfNeeded").mockImplementationOnce(async () => {
    await gate;
    await scan();
  });
  const makeEngine = syncEngine.makeSyncEngine;
  const starts: string[] = [];
  const configs: syncEngine.SyncEngineConfig[] = [];
  vi.spyOn(syncEngine, "makeSyncEngine").mockImplementation((config) => {
    configs.push(config);
    const engine = makeEngine(config);
    const start = engine.startSync;
    engine.startSync = () => {
      starts.push(config.userId);
      start();
    };
    return engine;
  });
  let pulls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (String(url).startsWith("/api/sync/book-aliases"))
        return new Response(null, { status: 503 });
      expect(String(url)).toMatch(/^\/api\/sync\/pull/);
      pulls++;
      return Response.json({ changes: [] });
    }),
  );
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => {
      root.render(renderHarness());
    });
    await vi.waitFor(() => expect(configs).toHaveLength(1));
    await act(async () => {
      currentStore.dispatch(
        authSessionResolved({ id: "different-reader", displayName: "Other reader" }),
      );
    });
    await vi.waitFor(() => expect(starts).toEqual(["different-reader"]));
    await vi.waitFor(() => expect(pulls).toBe(1));
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(starts).toEqual(["different-reader"]);
    configs[0].onAuthExpired?.();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await vi.waitFor(() => expect(pulls).toBeGreaterThan(1));
    expect((await getUnsyncedChanges()).every((change) => change.ownerId === "reader")).toBe(true);
  } finally {
    await act(async () => {
      root.unmount();
    });
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
});
