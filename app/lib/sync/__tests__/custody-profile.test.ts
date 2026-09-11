// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { clear, get, set } from "idb-keyval";

async function modules() {
  const session = await import("../custody-session");
  const journal = await import("../custody-journal");
  const recovery = await import("../custody-export");
  return { ...session, ...journal, ...recovery };
}
beforeEach(async () => {
  vi.resetModules();
  const stores = await import("../stores");
  await Promise.all(Object.values(stores).map((store) => clear(store())));
});

it("keeps truly unbound bytes discoverable and exportable through logout and reload", async () => {
  let api = await modules();
  const id = await api.retainCustody({
    source: "files",
    key: "book",
    raw: new Blob(["only surviving bytes"], { type: "application/epub+zip" }),
    role: "intended",
  });
  const original = (await api.localRecoveryDetail(id)).item;
  api.setCustodyAccount("A");
  api.setCustodyAccount(undefined);
  expect(await api.unboundPartition()).not.toBe(original.partition);
  vi.resetModules();
  api = await modules();
  expect(await api.localRecoverySummaries()).toContainEqual(
    expect.objectContaining({
      id,
      ownerId: undefined,
      provenance: "authored-unbound",
      status: "needs-account-binding",
    }),
  );
  expect((await api.localRecoveryDetail(id)).item.partition).toBe(original.partition);
  const exported = await api.exportLocalRecovery(id);
  expect(new TextDecoder().decode(exported.attachments[0].bytes)).toBe("only surviving bytes");
  expect(exported.manifest.partition).toBe(original.partition);
  api.setCustodyAccount("B");
  expect(await api.localRecoverySummaries("B")).toContainEqual(
    expect.objectContaining({ id, ownerId: undefined }),
  );
});

it("keeps foreign-bound snapshots and sibling resource bindings hidden after logout", async () => {
  let api = await modules();
  const old = await api.retainCustody({
    source: "files",
    key: "book",
    raw: new Blob(["old"]),
    role: "intended",
  });
  const bound = await api.retainCustody({
    source: "files",
    key: "book",
    raw: new Blob(["new"]),
    role: "intended",
  });
  api.setCustodyAccount("A");
  expect(await api.bindCustody(bound, "A")).toBe(true);
  api.setCustodyAccount(undefined);
  await api.unboundPartition();
  vi.resetModules();
  api = await modules();
  const stores = await import("../stores");
  for (const owner of [undefined, "B"]) {
    api.setCustodyAccount(owner);
    expect(await api.localRecoverySummaries(owner)).toEqual([]);
    for (const id of [old, bound]) {
      await expect(api.localRecoveryDetail(id, owner)).rejects.toThrow("unavailable");
      await expect(api.exportLocalRecovery(id, owner)).rejects.toThrow("unavailable");
      expect(await get(id, stores.getCustodyStore())).toBeDefined();
    }
  }
  api.setCustodyAccount("A");
  expect((await api.localRecoverySummaries("A")).map(({ id }) => id)).toEqual(
    expect.arrayContaining([old, bound]),
  );
  expect(
    new TextDecoder().decode((await api.exportLocalRecovery(old, "A")).attachments[0].bytes),
  ).toBe("old");
});

it("does not enumerate unbound history from a different installation", async () => {
  const api = await modules();
  const id = await api.retainCustody({
    source: "files",
    key: "book",
    raw: new Blob(["different profile"]),
    role: "intended",
  });
  const stores = await import("../stores");
  await set(
    "profile-unbound-epoch",
    `unbound:${crypto.randomUUID()}:${crypto.randomUUID()}`,
    stores.getCustodyStore(),
  );
  expect(await api.localRecoverySummaries()).toEqual([]);
  await expect(api.localRecoveryDetail(id)).rejects.toThrow("unavailable");
  await expect(api.exportLocalRecovery(id)).rejects.toThrow("unavailable");
  expect(await get(id, stores.getCustodyStore())).toBeDefined();
});
