import { describe, it, expect, vi } from "vitest";
import { createStore, entries, set } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import {
  WorkspaceService as LiveWorkspaceService,
  makeWorkspaceService,
} from "~/lib/stores/workspace-store";

type WorkspaceService = typeof LiveWorkspaceService;
let currentService = LiveWorkspaceService;
const WorkspaceService = {
  pipe: <A>(operation: (service: WorkspaceService) => Promise<A>) => operation(currentService),
};
const Layer = {
  succeed: (_tag: unknown, service: WorkspaceService) => {
    currentService = service;
    return undefined;
  },
};
namespace Effect {
  export type Effect<A, _E = never, _R = never> = Promise<A>;
}
const Effect = {
  andThen: <A>(operation: (service: WorkspaceService) => Promise<A>) => operation,
  provide: <A>(promise: Promise<A>, _layer: unknown) => promise,
  runPromise: <A>(promise: Promise<A>) => promise,
};

vi.mock("idb-keyval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("idb-keyval")>();
  return { ...actual, entries: vi.fn(actual.entries) };
});

let testCounter = 0;

function makeTestStores(): { lastOpenedStore: UseStore } {
  const suffix = `ws-test-${++testCounter}-${Date.now()}`;
  const lastOpenedStore = createStore(`last-opened-db-${suffix}`, "last-opened");
  return { lastOpenedStore };
}

function makeTestLayer(stores = makeTestStores()) {
  return Layer.succeed(WorkspaceService, makeWorkspaceService(stores));
}

describe("WorkspaceService", () => {
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

    it("does not use the idb-keyval entries fast path for last-opened timestamps", async () => {
      const stores = makeTestStores();
      const layer = makeTestLayer(stores);
      const run = <A, E>(e: Effect.Effect<A, E, WorkspaceService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      await set("book-1", 1000, stores.lastOpenedStore);
      await set("bad-timestamp", "not-a-number", stores.lastOpenedStore);
      await set("book-2", 2000, stores.lastOpenedStore);
      vi.mocked(entries).mockRejectedValueOnce(
        new TypeError("Cannot read properties of undefined (reading '0')"),
      );

      const map = await run(WorkspaceService.pipe(Effect.andThen((s) => s.getLastOpenedMap())));

      expect(entries).not.toHaveBeenCalled();
      expect(Array.from(map.entries())).toEqual([
        ["book-1", 1000],
        ["book-2", 2000],
      ]);
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
