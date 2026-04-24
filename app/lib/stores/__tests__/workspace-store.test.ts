import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { createStore, get, set } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { WorkspaceService, makeWorkspaceService } from "~/lib/stores/workspace-store";
import type { SerializedDockview } from "dockview";

let testCounter = 0;

function makeTestStores(): { layoutStore: UseStore; lastOpenedStore: UseStore } {
  const suffix = `ws-test-${++testCounter}-${Date.now()}`;
  const layoutStore = createStore(`layout-db-${suffix}`, "layout");
  const lastOpenedStore = createStore(`last-opened-db-${suffix}`, "last-opened");
  return { layoutStore, lastOpenedStore };
}

function makeTestLayer(stores = makeTestStores()) {
  return Layer.succeed(WorkspaceService, makeWorkspaceService(stores));
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
    it("saves and retrieves a layout for a given mode", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, WorkspaceService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      const layout = makeLayout();
      await run(WorkspaceService.pipe(Effect.andThen((s) => s.saveLayout("focused", layout))));
      const result = await run(
        WorkspaceService.pipe(Effect.andThen((s) => s.getLayout("focused"))),
      );
      expect(result).not.toBeNull();
      expect(result!.grid).toEqual(layout.grid);
      expect(result!.panels).toEqual(layout.panels);
    });

    it("returns null when no layout saved", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, WorkspaceService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      const result = await run(
        WorkspaceService.pipe(Effect.andThen((s) => s.getLayout("focused"))),
      );
      expect(result).toBeNull();
    });

    it("overwrites an existing layout for the same mode", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, WorkspaceService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      const layout1 = makeLayout({ panels: { "panel-1": {} } } as any);
      const layout2 = makeLayout({ panels: { "panel-2": {} } } as any);
      await run(WorkspaceService.pipe(Effect.andThen((s) => s.saveLayout("freeform", layout1))));
      await run(WorkspaceService.pipe(Effect.andThen((s) => s.saveLayout("freeform", layout2))));
      const result = await run(
        WorkspaceService.pipe(Effect.andThen((s) => s.getLayout("freeform"))),
      );
      expect(result!.panels).toEqual({ "panel-2": {} });
    });

    it("persists focused and freeform layouts independently", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, WorkspaceService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      const focused = makeLayout({ panels: { "f-1": {} } } as any);
      const freeform = makeLayout({ panels: { "ff-1": {} } } as any);
      await run(WorkspaceService.pipe(Effect.andThen((s) => s.saveLayout("focused", focused))));
      await run(WorkspaceService.pipe(Effect.andThen((s) => s.saveLayout("freeform", freeform))));
      const f = await run(WorkspaceService.pipe(Effect.andThen((s) => s.getLayout("focused"))));
      const ff = await run(WorkspaceService.pipe(Effect.andThen((s) => s.getLayout("freeform"))));
      expect(f!.panels).toEqual({ "f-1": {} });
      expect(ff!.panels).toEqual({ "ff-1": {} });
    });

    it("migrates a legacy dockview-layout value into the freeform slot", async () => {
      const stores = makeTestStores();
      const legacy = makeLayout({ panels: { legacy: {} } } as any);
      await set("dockview-layout", legacy, stores.layoutStore);
      const layer = makeTestLayer(stores);
      const run = <A, E>(e: Effect.Effect<A, E, WorkspaceService>) =>
        Effect.runPromise(Effect.provide(e, layer));

      const focused = await run(
        WorkspaceService.pipe(Effect.andThen((s) => s.getLayout("focused"))),
      );
      expect(focused).toBeNull();

      const freeform = await run(
        WorkspaceService.pipe(Effect.andThen((s) => s.getLayout("freeform"))),
      );
      expect(freeform!.panels).toEqual({ legacy: {} });

      const legacyAfter = await get("dockview-layout", stores.layoutStore);
      expect(legacyAfter).toBeUndefined();
    });

    it("does not overwrite an existing freeform layout during migration", async () => {
      const stores = makeTestStores();
      const legacy = makeLayout({ panels: { legacy: {} } } as any);
      const existing = makeLayout({ panels: { existing: {} } } as any);
      await set("dockview-layout", legacy, stores.layoutStore);
      await set("dockview-layout-freeform", existing, stores.layoutStore);
      const layer = makeTestLayer(stores);
      const run = <A, E>(e: Effect.Effect<A, E, WorkspaceService>) =>
        Effect.runPromise(Effect.provide(e, layer));

      const freeform = await run(
        WorkspaceService.pipe(Effect.andThen((s) => s.getLayout("freeform"))),
      );
      expect(freeform!.panels).toEqual({ existing: {} });

      const legacyAfter = await get("dockview-layout", stores.layoutStore);
      expect(legacyAfter).toBeUndefined();
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
