import { createStore, get, set, del, keys } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import type { SerializedDockview } from "dockview-react";
import { WorkspaceError, DecodeError } from "~/lib/errors";

// --- Schema ---

/**
 * SerializedDockview is an external type we don't deeply validate.
 * We only check that it's a non-null object with expected top-level shape.
 */
const decodeLayout = (raw: unknown): SerializedDockview => {
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

export interface FocusedWorkspaceCluster {
  bookId: string;
  bookTitle: string;
  bookFormat?: string;
  hasChat: boolean;
  hasNotebook: boolean;
  activeTab: "book" | "chat" | "notebook";
}

export interface FocusedWorkspaceState {
  order: string[];
  activeBookId: string | null;
  clusters: FocusedWorkspaceCluster[];
}

const decodeFocusedWorkspaceState = (raw: unknown): FocusedWorkspaceState => {
  if (!raw || typeof raw !== "object") throw new Error("Invalid focused workspace state");
  const state = raw as Record<string, unknown>;
  if (
    !Array.isArray(state.order) ||
    state.order.some((id) => typeof id !== "string") ||
    (state.activeBookId !== null && typeof state.activeBookId !== "string") ||
    !Array.isArray(state.clusters) ||
    state.clusters.some((value) => {
      if (!value || typeof value !== "object") return true;
      const cluster = value as Record<string, unknown>;
      return (
        typeof cluster.bookId !== "string" ||
        typeof cluster.bookTitle !== "string" ||
        (cluster.bookFormat !== undefined && typeof cluster.bookFormat !== "string") ||
        typeof cluster.hasChat !== "boolean" ||
        typeof cluster.hasNotebook !== "boolean" ||
        !["book", "chat", "notebook"].includes(String(cluster.activeTab))
      );
    })
  ) {
    throw new Error("Invalid focused workspace state");
  }
  return state as unknown as FocusedWorkspaceState;
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

export interface WorkspaceServiceStores {
  readonly layoutStore: UseStore;
  readonly lastOpenedStore: UseStore;
}

export function makeWorkspaceService(stores: WorkspaceServiceStores) {
  const { layoutStore, lastOpenedStore } = stores;

  // One-time migration: adopt any legacy focused-mode layout into the single
  // layout slot and drop the obsolete per-mode keys. Idempotent — once the
  // legacy keys are deleted this becomes a no-op.
  const migrateLegacyLayout = async () => {
    try {
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
    } catch (cause) {
      throw new WorkspaceError({ operation: "migrateLegacyLayout", cause });
    }
  };

  return {
    async saveLayout(layout: SerializedDockview) {
      try {
        await set(LAYOUT_KEY, layout, layoutStore);
      } catch (cause) {
        throw new WorkspaceError({ operation: "saveLayout", cause });
      }
    },

    async clearLayout() {
      try {
        await del(LAYOUT_KEY, layoutStore);
      } catch (cause) {
        throw new WorkspaceError({ operation: "clearLayout", cause });
      }
    },

    async getLayout() {
      await migrateLegacyLayout();
      let raw: unknown;
      try {
        raw = await get(LAYOUT_KEY, layoutStore);
      } catch (cause) {
        throw new WorkspaceError({ operation: "getLayout", cause });
      }
      if (!raw) return null;
      try {
        return decodeLayout(raw);
      } catch (cause) {
        console.warn(new DecodeError({ operation: "getLayout", cause }));
        try {
          await del(LAYOUT_KEY, layoutStore);
        } catch (clearCause) {
          throw new WorkspaceError({ operation: "clearInvalidLayout", cause: clearCause });
        }
        return null;
      }
    },

    async saveFocusedState(state: FocusedWorkspaceState) {
      try {
        await set(FOCUSED_STATE_KEY, state, layoutStore);
      } catch (cause) {
        throw new WorkspaceError({ operation: "saveFocusedState", cause });
      }
    },

    async clearFocusedState() {
      try {
        await del(FOCUSED_STATE_KEY, layoutStore);
      } catch (cause) {
        throw new WorkspaceError({ operation: "clearFocusedState", cause });
      }
    },

    async getFocusedState() {
      let raw: unknown;
      try {
        raw = await get(FOCUSED_STATE_KEY, layoutStore);
      } catch (cause) {
        throw new WorkspaceError({ operation: "getFocusedState", cause });
      }
      if (!raw) return null;
      try {
        return decodeFocusedWorkspaceState(raw);
      } catch (cause) {
        console.warn(new DecodeError({ operation: "getFocusedState", cause }));
        try {
          await del(FOCUSED_STATE_KEY, layoutStore);
        } catch (clearCause) {
          throw new WorkspaceError({ operation: "clearInvalidFocusedState", cause: clearCause });
        }
        return null;
      }
    },

    async saveLastOpened(bookId: string, timestamp: number) {
      try {
        await set(bookId, timestamp, lastOpenedStore);
      } catch (cause) {
        throw new WorkspaceError({ operation: "saveLastOpened", cause });
      }
    },

    async getLastOpenedMap() {
      try {
        const allKeys = await keys(lastOpenedStore);
        const map = new Map<string, number>();
        for (const key of allKeys) {
          if (typeof key !== "string") continue;
          const timestamp = await get<unknown>(key, lastOpenedStore);
          if (typeof timestamp !== "number") continue;
          map.set(key, timestamp);
        }
        return map;
      } catch (cause) {
        throw new WorkspaceError({ operation: "getLastOpenedMap", cause });
      }
    },
  };
}

export const WorkspaceService = makeWorkspaceService({
  layoutStore: getLayoutStore(),
  lastOpenedStore: getLastOpenedStore(),
});
