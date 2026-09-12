// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { clear, get, set, entries } from "idb-keyval";
import * as stores from "../stores";
import { equalRaw } from "../raw-snapshot";
import { retainCustody, listCustody, bindCustody } from "../custody-journal";
import { custodySet } from "../custody-write";
import { setCustodyAccount } from "../custody-session";
import { exportLocalRecovery } from "../custody-export";
import { makeAnnotationService } from "~/lib/stores/annotations-store";

beforeEach(async () => {
  vi.restoreAllMocks();
  setCustodyAccount(undefined);
  await Promise.all(Object.values(stores).map((store) => clear(store())));
});

it("preserves reused raw revisions with exact bytes, invalid numbers, absent values and graph topology", async () => {
  const values = [
    new Blob(["one"]),
    new Blob(["two"]),
    NaN,
    null,
    Infinity,
    -Infinity,
    undefined,
    {},
    { a: undefined },
    -0,
    0,
  ];
  const ids = [];
  for (const raw of values)
    ids.push(
      await retainCustody({
        source: "test",
        key: "same",
        raw,
        role: "before",
        operationId: "same",
      }),
    );
  expect(new Set(ids).size).toBe(values.length);
  expect(
    await retainCustody({
      source: "test",
      key: "same",
      raw: new Blob(["one"]),
      role: "before",
      operationId: "same",
    }),
  ).toBe(ids[0]);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(await equalRaw(cyclic, structuredClone(cyclic))).toBe(true);
  const sparse: unknown[] = [];
  sparse.length = 2;
  sparse[1] = 1;
  expect(await equalRaw(sparse, [undefined, 1])).toBe(false);
  expect(await equalRaw(new Uint8Array([1]), new Int8Array([1]))).toBe(false);
  const shared = {};
  expect(await equalRaw([shared, shared], [{}, {}])).toBe(false);
  const exported = await exportLocalRecovery(ids[0]);
  expect(Buffer.from(exported.attachments[0].bytes).toString()).toBe("one");
  expect(exported.attachments[0].checksum).toHaveLength(64);
});

it("clones before caller mutation and first binds atomically without rebinding", async () => {
  const raw = { content: "original" };
  const pending = retainCustody({ source: "notebook", key: "book", raw, role: "intended" });
  raw.content = "changed";
  const id = await pending;
  expect((await listCustody())[0].item.raw).toEqual({ content: "original" });
  const results = await Promise.all([bindCustody(id, "A"), bindCustody(id, "B")]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await listCustody()).toEqual([]);
  expect(await listCustody(results[0] ? "B" : "A")).toEqual([]);
});

it("aborts actual producer persistence when private custody fails", async () => {
  const store = stores.getNotebookStore();
  await set("book", { bookId: "book", content: { text: "before" }, updatedAt: 1 }, store);
  const custody = stores.getCustodyStore();
  vi.spyOn(stores, "getCustodyStore").mockReturnValue((mode, callback) => {
    if (mode === "readwrite") throw new Error("quota");
    return custody(mode, callback);
  });
  const service = makeAnnotationService({
    notebookStore: store,
    highlightStore: stores.getHighlightStore(),
  });
  await expect(
    service.saveNotebook({ bookId: "book", content: { text: "after" }, updatedAt: 2 }),
  ).rejects.toThrow();
  expect(await get("book", store)).toMatchObject({ content: { text: "before" } });
  expect(await entries(stores.getChangeLogStore())).toEqual([]);
});

it("retains both byte revisions and rejects an account change during preparation", async () => {
  setCustodyAccount("A");
  await custodySet("book", new Uint8Array([1]).buffer, stores.getBookDataStore());
  await custodySet("book", new Uint8Array([2]).buffer, stores.getBookDataStore());
  const raw = (await listCustody("A"))
    .map(({ item }) => item.raw)
    .filter((value) => value instanceof ArrayBuffer);
  expect(raw.some((value) => new Uint8Array(value as ArrayBuffer)[0] === 1)).toBe(true);
  expect(raw.some((value) => new Uint8Array(value as ArrayBuffer)[0] === 2)).toBe(true);
  const pending = custodySet("book", new Uint8Array([3]).buffer, stores.getBookDataStore());
  setCustodyAccount("B");
  await expect(pending).rejects.toThrow();
  expect(new Uint8Array((await get<ArrayBuffer>("book", stores.getBookDataStore()))!)[0]).toBe(2);
});

it("retains an explicitly stored undefined preimage before replacing it", async () => {
  await set("invalid", undefined, stores.getNotebookStore());
  await custodySet("invalid", { content: "valid" }, stores.getNotebookStore());
  const snapshots = await listCustody();
  expect(snapshots.some(({ item }) => item.role === "before" && item.raw === undefined)).toBe(true);
  expect(await get("invalid", stores.getNotebookStore())).toEqual({ content: "valid" });
});

it("rechecks both remap preimages and preserves every raced revision before cleanup", async () => {
  const { moveRemapRecord } = await import("../remap-records");
  const store = stores.getNotebookStore();
  type Revision = { text: string; clock: number };
  await set("source", { text: "source one", clock: 1 }, store);
  await set("target", { text: "target one", clock: 2 }, store);
  let raced = false;
  await moveRemapRecord<Revision>(
    store,
    "source",
    "target",
    (source, target) => (!target || source.clock > target.clock ? source : target),
    {
      prepare: async () => {
        if (raced) return;
        raced = true;
        await set("source", { text: "source two", clock: 3 }, store);
        await set("target", { text: "target two", clock: 4 }, store);
      },
    },
  );
  expect(await get("source", store)).toBeUndefined();
  expect(await get("target", store)).toEqual({ text: "target two", clock: 4 });
  const before = (await listCustody())
    .filter(({ item }) => item.role === "before")
    .map(({ item }) => item.raw);
  expect(before).toEqual(
    expect.arrayContaining([
      { text: "source one", clock: 1 },
      { text: "source two", clock: 3 },
      { text: "target one", clock: 2 },
      { text: "target two", clock: 4 },
    ]),
  );
});

it("keeps unbound partition identity across reload and rotates it after logout", async () => {
  const { unboundPartition } = await import("../custody-session");
  const before = await unboundPartition();
  vi.resetModules();
  const reloaded = await import("../custody-session");
  expect(await reloaded.unboundPartition()).toBe(before);
  reloaded.setCustodyAccount("A");
  reloaded.setCustodyAccount(undefined);
  const after = await reloaded.unboundPartition();
  expect(after).not.toBe(before);
  expect(after.split(":")[1]).toBe(before.split(":")[1]);
});

it("exports shared typed-view backing bytes and file metadata without loss", async () => {
  const buffer = new Uint8Array([9, 1, 2, 8]).buffer;
  const raw = {
    buffer,
    view: new Uint8Array(buffer, 1, 2),
    file: new File(["file bytes"], "reader.epub", {
      type: "application/epub+zip",
      lastModified: 123,
    }),
  };
  const id = await retainCustody({ source: "test", key: "export", raw, role: "before" });
  const exported = await exportLocalRecovery(id);
  expect(exported.manifest.nodes).toContainEqual(
    expect.objectContaining({ type: "Uint8Array", byteOffset: 1, byteLength: 2 }),
  );
  expect(exported.manifest.nodes).toContainEqual(
    expect.objectContaining({ type: "File", name: "reader.epub", lastModified: 123 }),
  );
  expect(
    exported.attachments.some(({ bytes }) => Buffer.from(bytes).equals(Buffer.from([9, 1, 2, 8]))),
  ).toBe(true);
});
