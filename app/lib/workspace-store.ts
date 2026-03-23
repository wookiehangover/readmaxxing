import { createStore, get, set, entries } from "idb-keyval";
import { Context, Effect, Layer } from "effect";
import type { SerializedDockview } from "dockview";
import { WorkspaceError } from "~/lib/errors";

// --- idb-keyval stores (lazy-initialized for SSR safety) ---

let _layoutStore: ReturnType<typeof createStore> | null = null;

function getLayoutStore() {
  if (!_layoutStore) _layoutStore = createStore("ebook-reader-workspace", "layout");
  return _layoutStore;
}

let _lastOpenedStore: ReturnType<typeof createStore> | null = null;

function getLastOpenedStore() {
  if (!_lastOpenedStore) _lastOpenedStore = createStore("workspace-last-opened-db", "last-opened");
  return _lastOpenedStore;
}

// --- Effect Service ---

const LAYOUT_KEY = "dockview-layout";

export class WorkspaceService extends Context.Tag("WorkspaceService")<
  WorkspaceService,
  {
    readonly saveLayout: (layout: SerializedDockview) => Effect.Effect<void, WorkspaceError>;
    readonly getLayout: () => Effect.Effect<SerializedDockview | null, WorkspaceError>;
    readonly saveLastOpened: (bookId: string, timestamp: number) => Effect.Effect<void, WorkspaceError>;
    readonly getLastOpenedMap: () => Effect.Effect<Map<string, number>, WorkspaceError>;
  }
>() {}

export const WorkspaceServiceLive = Layer.succeed(WorkspaceService, {
  saveLayout: (layout: SerializedDockview) =>
    Effect.tryPromise({
      try: () => set(LAYOUT_KEY, layout, getLayoutStore()),
      catch: (cause) => new WorkspaceError({ operation: "saveLayout", cause }),
    }),

  getLayout: () =>
    Effect.tryPromise({
      try: async () => {
        const layout = await get<SerializedDockview>(LAYOUT_KEY, getLayoutStore());
        return layout ?? null;
      },
      catch: (cause) => new WorkspaceError({ operation: "getLayout", cause }),
    }),

  saveLastOpened: (bookId: string, timestamp: number) =>
    Effect.tryPromise({
      try: () => set(bookId, timestamp, getLastOpenedStore()),
      catch: (cause) => new WorkspaceError({ operation: "saveLastOpened", cause }),
    }),

  getLastOpenedMap: () =>
    Effect.tryPromise({
      try: async () => {
        const all = await entries<string, number>(getLastOpenedStore());
        return new Map(all);
      },
      catch: (cause) => new WorkspaceError({ operation: "getLastOpenedMap", cause }),
    }),
});

