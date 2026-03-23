import { createStore, get, set } from "idb-keyval";
import { Context, Effect, Layer } from "effect";
import type { SerializedDockview } from "dockview";
import { WorkspaceError } from "~/lib/errors";

// --- idb-keyval store (lazy-initialized for SSR safety) ---

let _layoutStore: ReturnType<typeof createStore> | null = null;

function getLayoutStore() {
  if (!_layoutStore) _layoutStore = createStore("ebook-reader-workspace", "layout");
  return _layoutStore;
}

// --- Effect Service ---

const LAYOUT_KEY = "dockview-layout";

export class WorkspaceService extends Context.Tag("WorkspaceService")<
  WorkspaceService,
  {
    readonly saveLayout: (layout: SerializedDockview) => Effect.Effect<void, WorkspaceError>;
    readonly getLayout: () => Effect.Effect<SerializedDockview | null, WorkspaceError>;
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
});

