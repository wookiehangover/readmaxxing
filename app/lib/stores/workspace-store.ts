import { createStore, get, set, del, entries } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { Context, Effect, Layer, Schema } from "effect";
import type { SerializedDockview } from "dockview";
import { WorkspaceError, DecodeError } from "~/lib/errors";
import type { LayoutMode } from "~/lib/settings";

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

/**
 * Legacy single-key layout storage. Before layout modes were introduced, the
 * serialized dockview state was saved here. On first read after the mode
 * upgrade, the value is migrated into the freeform slot (see design decision
 * in the spec) and the legacy key is deleted.
 */
const LEGACY_LAYOUT_KEY = "dockview-layout";
const layoutKey = (mode: LayoutMode) => `dockview-layout-${mode}`;

export class WorkspaceService extends Context.Tag("WorkspaceService")<
  WorkspaceService,
  {
    readonly saveLayout: (
      mode: LayoutMode,
      layout: SerializedDockview,
    ) => Effect.Effect<void, WorkspaceError>;
    readonly getLayout: (
      mode: LayoutMode,
    ) => Effect.Effect<SerializedDockview | null, WorkspaceError | DecodeError>;
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

  // One-time migration: move any legacy single-key layout into the freeform
  // slot. Idempotent — once the legacy key is deleted this becomes a no-op.
  const migrateLegacyLayout = Effect.tryPromise({
    try: async () => {
      const legacy = await get<unknown>(LEGACY_LAYOUT_KEY, layoutStore);
      if (legacy === undefined) return;
      const existing = await get<unknown>(layoutKey("freeform"), layoutStore);
      if (existing === undefined) {
        await set(layoutKey("freeform"), legacy, layoutStore);
      }
      await del(LEGACY_LAYOUT_KEY, layoutStore);
    },
    catch: (cause) => new WorkspaceError({ operation: "migrateLegacyLayout", cause }),
  });

  return {
    saveLayout: (mode: LayoutMode, layout: SerializedDockview) =>
      Effect.tryPromise({
        try: () => set(layoutKey(mode), layout, layoutStore),
        catch: (cause) => new WorkspaceError({ operation: "saveLayout", cause }),
      }),

    getLayout: (mode: LayoutMode) =>
      Effect.gen(function* () {
        yield* migrateLegacyLayout;
        const raw = yield* Effect.tryPromise({
          try: () => get<unknown>(layoutKey(mode), layoutStore),
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
