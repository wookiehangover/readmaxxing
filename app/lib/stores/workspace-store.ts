import { createStore, get, set, entries } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { Context, Effect, Layer, Schema } from "effect";
import type { SerializedDockview } from "dockview";
import { WorkspaceError, DecodeError } from "~/lib/errors";

// --- Schema ---

/**
 * SerializedDockview is an external type we don't deeply validate.
 * We only check that it's a non-null object with expected top-level shape.
 */
const SerializedDockviewSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown });

const decodeLayout = (raw: unknown): SerializedDockview => {
  Schema.decodeUnknownSync(SerializedDockviewSchema)(raw);
  return raw as SerializedDockview;
};

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
    readonly getLayout: () => Effect.Effect<
      SerializedDockview | null,
      WorkspaceError | DecodeError
    >;
    readonly saveLastOpened: (
      bookId: string,
      timestamp: number,
    ) => Effect.Effect<void, WorkspaceError>;
    readonly getLastOpenedMap: () => Effect.Effect<Map<string, number>, WorkspaceError>;
  }
>() {}

export interface WorkspaceServiceStores {
  readonly layoutStore: UseStore;
  readonly lastOpenedStore: UseStore;
}

export function makeWorkspaceService(stores: WorkspaceServiceStores): WorkspaceService["Type"] {
  const { layoutStore, lastOpenedStore } = stores;
  return {
    saveLayout: (layout: SerializedDockview) =>
      Effect.tryPromise({
        try: () => set(LAYOUT_KEY, layout, layoutStore),
        catch: (cause) => new WorkspaceError({ operation: "saveLayout", cause }),
      }),

    getLayout: () =>
      Effect.gen(function* () {
        const raw = yield* Effect.tryPromise({
          try: () => get<unknown>(LAYOUT_KEY, layoutStore),
          catch: (cause) => new WorkspaceError({ operation: "getLayout", cause }),
        });
        if (!raw) return null;
        return yield* Effect.try({
          try: () => decodeLayout(raw),
          catch: (cause) => new DecodeError({ operation: "getLayout", cause }),
        });
      }),

    saveLastOpened: (bookId: string, timestamp: number) =>
      Effect.tryPromise({
        try: () => set(bookId, timestamp, lastOpenedStore),
        catch: (cause) => new WorkspaceError({ operation: "saveLastOpened", cause }),
      }),

    getLastOpenedMap: () =>
      Effect.tryPromise({
        try: async () => {
          const all = await entries<string, number>(lastOpenedStore);
          return new Map(all);
        },
        catch: (cause) => new WorkspaceError({ operation: "getLastOpenedMap", cause }),
      }),
  };
}

export const WorkspaceServiceLive = Layer.sync(WorkspaceService, () =>
  makeWorkspaceService({ layoutStore: getLayoutStore(), lastOpenedStore: getLastOpenedStore() }),
);
