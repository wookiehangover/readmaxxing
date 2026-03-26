import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { createStore, set, get, entries } from "idb-keyval";
import { WorkspaceService } from "~/lib/workspace-store";
import type { SerializedDockview } from "dockview";
import { WorkspaceError } from "~/lib/errors";

let testCounter = 0;

function makeTestLayer() {
  const suffix = `ws-test-${++testCounter}-${Date.now()}`;
  const layoutStore = createStore(`layout-db-${suffix}`, "layout");
  const lastOpenedStore = createStore(`last-opened-db-${suffix}`, "last-opened");

  const LAYOUT_KEY = "dockview-layout";

  return Layer.succeed(WorkspaceService, {
    saveLayout: (layout: SerializedDockview) =>
      Effect.tryPromise({
        try: () => set(LAYOUT_KEY, layout, layoutStore),
        catch: (cause) => new WorkspaceError({ operation: "saveLayout", cause }),
      }),
    getLayout: () =>
      Effect.tryPromise({
        try: async () => {
          const layout = await get<SerializedDockview>(LAYOUT_KEY, layoutStore);
          return layout ?? null;
        },
        catch: (cause) => new WorkspaceError({ operation: "getLayout", cause }),
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
  });
}

function makeLayout(overrides: Partial<SerializedDockview> = {}): SerializedDockview {
  return {
    grid: { root: { type: "branch", data: [] }, width: 800, height: 600, orientation: 0 },
    panels: {},
    activeGroup: undefined,
    ...overrides,
  } as SerializedDockview;
}

describe("WorkspaceService", () => {
  describe("saveLayout + getLayout", () => {
    it("saves and retrieves a layout", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, WorkspaceService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      const layout = makeLayout();
      await run(WorkspaceService.pipe(Effect.andThen((s) => s.saveLayout(layout))));
      const result = await run(WorkspaceService.pipe(Effect.andThen((s) => s.getLayout())));
      expect(result).not.toBeNull();
      expect(result!.grid).toEqual(layout.grid);
      expect(result!.panels).toEqual(layout.panels);
    });

    it("returns null when no layout saved", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, WorkspaceService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      const result = await run(WorkspaceService.pipe(Effect.andThen((s) => s.getLayout())));
      expect(result).toBeNull();
    });

    it("overwrites an existing layout", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, WorkspaceService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      const layout1 = makeLayout({ panels: { "panel-1": {} } } as any);
      const layout2 = makeLayout({ panels: { "panel-2": {} } } as any);
      await run(WorkspaceService.pipe(Effect.andThen((s) => s.saveLayout(layout1))));
      await run(WorkspaceService.pipe(Effect.andThen((s) => s.saveLayout(layout2))));
      const result = await run(WorkspaceService.pipe(Effect.andThen((s) => s.getLayout())));
      expect(result!.panels).toEqual({ "panel-2": {} });
    });
  });

  describe("saveLastOpened + getLastOpenedMap", () => {
    it("saves and retrieves last-opened timestamps", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, WorkspaceService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      const ts = Date.now();
      await run(WorkspaceService.pipe(Effect.andThen((s) => s.saveLastOpened("book-1", ts))));
      const map = await run(WorkspaceService.pipe(Effect.andThen((s) => s.getLastOpenedMap())));
      expect(map).toBeInstanceOf(Map);
      expect(map.size).toBe(1);
      expect(map.get("book-1")).toBe(ts);
    });

    it("returns empty map when nothing saved", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, WorkspaceService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      const map = await run(WorkspaceService.pipe(Effect.andThen((s) => s.getLastOpenedMap())));
      expect(map).toBeInstanceOf(Map);
      expect(map.size).toBe(0);
    });

    it("tracks multiple books", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, WorkspaceService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      const ts1 = 1000;
      const ts2 = 2000;
      await run(WorkspaceService.pipe(Effect.andThen((s) => s.saveLastOpened("book-1", ts1))));
      await run(WorkspaceService.pipe(Effect.andThen((s) => s.saveLastOpened("book-2", ts2))));
      const map = await run(WorkspaceService.pipe(Effect.andThen((s) => s.getLastOpenedMap())));
      expect(map.size).toBe(2);
      expect(map.get("book-1")).toBe(ts1);
      expect(map.get("book-2")).toBe(ts2);
    });

    it("overwrites timestamp for same book", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, WorkspaceService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      await run(WorkspaceService.pipe(Effect.andThen((s) => s.saveLastOpened("book-1", 1000))));
      await run(WorkspaceService.pipe(Effect.andThen((s) => s.saveLastOpened("book-1", 2000))));
      const map = await run(WorkspaceService.pipe(Effect.andThen((s) => s.getLastOpenedMap())));
      expect(map.size).toBe(1);
      expect(map.get("book-1")).toBe(2000);
    });
  });
});
