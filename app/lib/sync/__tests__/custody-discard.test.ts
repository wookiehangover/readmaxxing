// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { clear, get, set, update } from "idb-keyval";
import * as stores from "../stores";
import {
  retainCustody,
  bindCustody,
  factsKey,
  type CustodyFacts,
  type CustodyItem,
} from "../custody-journal";
import {
  localRecoveryDetail,
  localRecoverySummaries,
  exportLocalRecovery,
} from "../custody-export";
import { discardLocalRecovery } from "../custody-discard";
import { setCustodyAccount } from "../custody-session";
import { persistBookRemap } from "../remap-journal";

beforeEach(async () => {
  setCustodyAccount(undefined);
  await Promise.all(Object.values(stores).map((store) => clear(store())));
  vi.restoreAllMocks();
});
async function retain(key = "book") {
  return retainCustody({
    source: "files",
    key,
    raw: new Blob(["original bytes"]),
    role: "intended",
  });
}
it("discards only the reviewed signed-out snapshot and preserves siblings and live data", async () => {
  const id = await retain();
  const sibling = await retain();
  await set("book", new Blob(["live bytes"]), stores.getBookDataStore());
  const { version } = await localRecoveryDetail(id);
  await exportLocalRecovery(id);
  expect(await get(id, stores.getCustodyStore())).toBeDefined();
  await discardLocalRecovery({ id, expectedVersion: version });
  expect(await get(id, stores.getCustodyStore())).toBeUndefined();
  expect(await get(factsKey(id), stores.getCustodyStore())).toMatchObject({
    retired: true,
    discarded: true,
  });
  expect((await localRecoverySummaries()).map((item) => item.id)).toContain(sibling);
  expect(await (await get<Blob>("book", stores.getBookDataStore()))!.text()).toBe("live bytes");
});
it.each(["item", "group", "resource"] as const)(
  "rejects a stale review after competing %s binding",
  async (mode) => {
    const id = await retainCustody({
      source: "files",
      key: "book",
      raw: new Blob(["original"]),
      role: "intended",
      operationId: "review",
    });
    const { version } = await localRecoveryDetail(id);
    const claim =
      mode === "item"
        ? id
        : await retainCustody({
            source: "files",
            key: mode === "group" ? "sibling" : "book",
            raw: "sibling",
            role: "intended",
            operationId: mode === "group" ? "review" : "different",
          });
    setCustodyAccount("A");
    expect(await bindCustody(claim, "A")).toBe(true);
    await expect(
      discardLocalRecovery({ id, expectedVersion: version, ownerId: "B" }),
    ).rejects.toThrow();
    await expect(
      discardLocalRecovery({ id, expectedVersion: version, ownerId: "A" }),
    ).rejects.toThrow(/changed/);
    const current = await localRecoveryDetail(id, "A");
    await discardLocalRecovery({ id, expectedVersion: current.version, ownerId: "A" });
    expect(await get(id, stores.getCustodyStore())).toBeUndefined();
  },
);
it.each(["bytes", "receipt", "alias"] as const)(
  "rejects changed %s after review without deleting raw",
  async (change) => {
    const id = await retain();
    const { version } = await localRecoveryDetail(id);
    if (change === "bytes")
      await update<CustodyItem>(
        id,
        (item) => ({ ...item!, raw: new Blob(["modified bytes"]) }),
        stores.getCustodyStore(),
      );
    if (change === "receipt")
      await update<CustodyFacts>(
        factsKey(id),
        (facts) => ({ ...facts, receiptId: "received-json" }),
        stores.getCustodyStore(),
      );
    if (change === "alias") await persistBookRemap("A", "book", "canonical");
    await expect(discardLocalRecovery({ id, expectedVersion: version })).rejects.toThrow();
    expect(await get(id, stores.getCustodyStore())).toBeDefined();
  },
);
it("aborts deletion when auth changes during asynchronous byte comparison", async () => {
  const id = await retain();
  const { version } = await localRecoveryDetail(id);
  const original = Blob.prototype.arrayBuffer;
  vi.spyOn(Blob.prototype, "arrayBuffer").mockImplementationOnce(async function (this: Blob) {
    setCustodyAccount("B");
    return original.call(this);
  });
  await expect(discardLocalRecovery({ id, expectedVersion: version })).rejects.toThrow(
    /Account changed/,
  );
  expect(await get(id, stores.getCustodyStore())).toBeDefined();
});
it("keeps unsupported clone kinds inspectable without claiming a destructive review token", async () => {
  const id = await retainCustody({
    source: "local",
    key: "map",
    raw: new Map([["original", "value"]]),
    role: "intended",
  });
  const detail = await localRecoveryDetail(id);
  expect(detail.item.raw).toEqual(new Map([["original", "value"]]));
  expect(detail.version).toBe("");
  await expect(discardLocalRecovery({ id, expectedVersion: detail.version })).rejects.toThrow(
    /Review/,
  );
  expect(await get(id, stores.getCustodyStore())).toBeDefined();
});
