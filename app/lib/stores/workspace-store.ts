import { createStore, get, set, del, keys } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { Context, Effect, Layer, Schema } from "effect";
import type { SerializedDockview } from "dockview-react";
import { WorkspaceError, DecodeError } from "~/lib/errors";

// --- Schema ---

/**
 * SerializedDockview is an external type we don't deeply validate.
 * We only check that it's a non-null object with expected top-level shape.
 */
const SerializedDockviewSchema = Schema.Struct({
  grid: Schema.Unknown,
  panels: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

const decodeLayout = (raw: unknown): SerializedDockview => {
  Schema.decodeUnknownSync(SerializedDockviewSchema)(raw);
  if (
    !raw ||
    typeof raw !== "object" ||
    !Object.hasOwn(raw, "grid") ||
    !Object.hasOwn(raw, "panels")
  ) {
    throw new Error("Invalid serialized dockview layout");
  }
  return raw as SerializedDockview;
};

const FocusedWorkspaceClusterSchema = Schema.Struct({
  bookId: Schema.String,
  bookTitle: Schema.String,
  bookFormat: Schema.optional(Schema.String),
  hasChat: Schema.Boolean,
  hasNotebook: Schema.Boolean,
  activeTab: Schema.Literal("book", "chat", "notebook"),
});

const FocusedWorkspaceStateSchema = Schema.Struct({
  order: Schema.Array(Schema.String),
  activeBookId: Schema.NullOr(Schema.String),
  clusters: Schema.Array(FocusedWorkspaceClusterSchema),
});

export type FocusedWorkspaceCluster = typeof FocusedWorkspaceClusterSchema.Type;
export type FocusedWorkspaceState = typeof FocusedWorkspaceStateSchema.Type;

const decodeFocusedWorkspaceState = (raw: unknown): FocusedWorkspaceState => {
  const decoded = Schema.decodeUnknownSync(FocusedWorkspaceStateSchema)(raw);
  return decoded as FocusedWorkspaceState;
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
 * Single-key layout storage. The serialized dockview state for the (only)
 * focused layout is saved here.
 */
const LAYOUT_KEY = "dockview-layout";
const FOCUSED_STATE_KEY = "focused-workspace-state";
/**
 * Legacy per-mode layout key used before the freeform mode was removed. On
 * first read the focused-mode layout is migrated into `LAYOUT_KEY` and the
 * per-mode keys are deleted. Idempotent once cleaned up.
 */
const LEGACY_FOCUSED_LAYOUT_KEY = "dockview-layout-focused";
const LEGACY_FREEFORM_LAYOUT_KEY = "dockview-layout-freeform";

export class WorkspaceService extends Context.Tag("WorkspaceService")<
  WorkspaceService,
  {
    readonly saveLayout: (layout: SerializedDockview) => Effect.Effect<void, WorkspaceError>;
    readonly getLayout: () => Effect.Effect<
      SerializedDockview | null,
      WorkspaceError | DecodeError
    >;
    readonly saveFocusedState: (
      state: FocusedWorkspaceState,
    ) => Effect.Effect<void, WorkspaceError>;
    readonly getFocusedState: () => Effect.Effect<
      FocusedWorkspaceState | null,
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

  // One-time migration: adopt any legacy focused-mode layout into the single
  // layout slot and drop the obsolete per-mode keys. Idempotent — once the
  // legacy keys are deleted this becomes a no-op.
  const migrateLegacyLayout = Effect.tryPromise({
    try: async () => {
      const legacyFocused = await get<unknown>(LEGACY_FOCUSED_LAYOUT_KEY, layoutStore);
      if (legacyFocused !== undefined) {
        const existing = await get<unknown>(LAYOUT_KEY, layoutStore);
        if (existing === undefined) {
          await set(LAYOUT_KEY, legacyFocused, layoutStore);
        }
        await del(LEGACY_FOCUSED_LAYOUT_KEY, layoutStore);
      }
      const legacyFreeform = await get<unknown>(LEGACY_FREEFORM_LAYOUT_KEY, layoutStore);
      if (legacyFreeform !== undefined) {
        await del(LEGACY_FREEFORM_LAYOUT_KEY, layoutStore);
      }
    },
    catch: (cause) => new WorkspaceError({ operation: "migrateLegacyLayout", cause }),
  });

  return {
    saveLayout: (layout: SerializedDockview) =>
      Effect.tryPromise({
        try: () => set(LAYOUT_KEY, layout, layoutStore),
        catch: (cause) => new WorkspaceError({ operation: "saveLayout", cause }),
      }),

    getLayout: () =>
      Effect.gen(function* () {
        yield* migrateLegacyLayout;
        const raw = yield* Effect.tryPromise({
          try: () => get<unknown>(LAYOUT_KEY, layoutStore),
          catch: (cause) => new WorkspaceError({ operation: "getLayout", cause }),
        });
        if (!raw) return null;
        return yield* Effect.try({
          try: () => decodeLayout(raw),
          catch: (cause) => new DecodeError({ operation: "getLayout", cause }),
        }).pipe(
          Effect.catchAll(() =>
            Effect.tryPromise({
              try: () => del(LAYOUT_KEY, layoutStore),
              catch: (cause) => new WorkspaceError({ operation: "clearInvalidLayout", cause }),
            }).pipe(Effect.as(null)),
          ),
        );
      }),

    saveFocusedState: (state: FocusedWorkspaceState) =>
      Effect.tryPromise({
        try: () => set(FOCUSED_STATE_KEY, state, layoutStore),
        catch: (cause) => new WorkspaceError({ operation: "saveFocusedState", cause }),
      }),

    getFocusedState: () =>
      Effect.gen(function* () {
        const raw = yield* Effect.tryPromise({
          try: () => get<unknown>(FOCUSED_STATE_KEY, layoutStore),
          catch: (cause) => new WorkspaceError({ operation: "getFocusedState", cause }),
        });
        if (!raw) return null;
        return yield* Effect.try({
          try: () => decodeFocusedWorkspaceState(raw),
          catch: (cause) => new DecodeError({ operation: "getFocusedState", cause }),
        }).pipe(
          Effect.catchAll(() =>
            Effect.tryPromise({
              try: () => del(FOCUSED_STATE_KEY, layoutStore),
              catch: (cause) =>
                new WorkspaceError({ operation: "clearInvalidFocusedState", cause }),
            }).pipe(Effect.as(null)),
          ),
        );
      }),

    saveLastOpened: (bookId: string, timestamp: number) =>
      Effect.tryPromise({
        try: () => set(bookId, timestamp, lastOpenedStore),
        catch: (cause) => new WorkspaceError({ operation: "saveLastOpened", cause }),
      }),

    getLastOpenedMap: () =>
      Effect.tryPromise({
        try: async () => {
          const allKeys = await keys(lastOpenedStore);
          const map = new Map<string, number>();
          for (const key of allKeys) {
            if (typeof key !== "string") continue;
            const timestamp = await get<unknown>(key, lastOpenedStore);
            if (typeof timestamp !== "number") continue;
            map.set(key, timestamp);
          }
          return map;
        },
        catch: (cause) => new WorkspaceError({ operation: "getLastOpenedMap", cause }),
      }),
  };
}

export const WorkspaceServiceLive = Layer.sync(WorkspaceService, () =>
  makeWorkspaceService({ layoutStore: getLayoutStore(), lastOpenedStore: getLastOpenedStore() }),
);
