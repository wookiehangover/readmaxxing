// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { clear, get, set } from "idb-keyval";
import { unzipSync, strFromU8 } from "fflate";
import * as stores from "~/lib/sync/stores";
import { retainCustody, bindCustody } from "~/lib/sync/custody-journal";
import { setCustodyAccount } from "~/lib/sync/custody-session";
import { localRecoveryDetail } from "~/lib/sync/custody-export";
import { prepareRecoveryDownload, prepareRecoveryView, inspectRaw } from "./recovery-artifacts";
import type { RecoveryItem } from "./sync-recovery-types";

const item = (id: string): RecoveryItem => ({
  id: `device:${id}`,
  source: "device",
  sourceId: id,
  entity: "files",
  entityId: "book",
  state: "needs-account-binding",
  reason: "intended",
  recordedAt: "2026-01-01",
  receiptId: null,
});
beforeEach(async () => {
  setCustodyAccount(undefined);
  await Promise.all(Object.values(stores).map((store) => clear(store())));
  vi.restoreAllMocks();
});
it("exports exact byte attachments and distinct invalid values without retiring the source", async () => {
  const raw = {
    text: "original text <script>unsafe()</script>",
    clock: NaN,
    negativeZero: -0,
    absent: undefined,
    blob: new Blob([new Uint8Array([0, 1, 2, 255])], { type: "application/epub+zip" }),
  };
  const id = await retainCustody({ source: "files", key: "book", role: "intended", raw });
  const result = await prepareRecoveryDownload(item(id), undefined, () => {});
  const archive = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  expect([...archive["original-1.bin"]]).toEqual([0, 1, 2, 255]);
  const manifest = JSON.parse(strFromU8(archive["manifest.json"]));
  expect(manifest.version).toBe(1);
  expect(manifest.nodes[0].properties).toContainEqual(["clock", { type: "number", value: "NaN" }]);
  expect(manifest.nodes[0].properties).toContainEqual([
    "negativeZero",
    { type: "number", value: "-0" },
  ]);
  expect(manifest.nodes[0].properties).toContainEqual(["absent", { type: "undefined" }]);
  expect(manifest.attachments[0]).toMatchObject({
    path: "original-1.bin",
    size: 4,
    mime: "application/epub+zip",
  });
  expect(manifest.attachments[0].checksum).toMatch(/^[a-f0-9]{64}$/);
  const exact = await prepareRecoveryDownload(item(id), undefined, () => {}, 0);
  expect([...new Uint8Array(await exact.blob.arrayBuffer())]).toEqual([0, 1, 2, 255]);
  const preview = await prepareRecoveryView(item(id), undefined, () => {});
  expect(await preview.blob.text()).toContain("&lt;script&gt;");
  expect(await preview.blob.text()).not.toContain("<script>");
  expect(preview.attachmentCount).toBe(1);
  expect((await localRecoveryDetail(id)).item.raw).toMatchObject({ text: raw.text });
});
it("retains unsupported kinds and gives an inspectable explanation instead of lossy export", async () => {
  const id = await retainCustody({
    source: "notes",
    key: "book",
    role: "intended",
    raw: { value: new Map([["text", "unique"]]) },
  });
  await expect(prepareRecoveryDownload(item(id), undefined, () => {})).rejects.toThrow(
    "Unsupported raw kind Map",
  );
  expect(await (await prepareRecoveryView(item(id), undefined, () => {})).blob.text()).toContain(
    "Unsupported",
  );
  expect(await get(id, stores.getCustodyStore())).toBeDefined();
});
it("withholds prepared bytes when a different tab binds the resource during Blob reads", async () => {
  const id = await retainCustody({
    source: "files",
    key: "book",
    role: "intended",
    raw: new Blob(["secret"]),
  });
  const original = Blob.prototype.arrayBuffer;
  vi.spyOn(Blob.prototype, "arrayBuffer").mockImplementationOnce(async function (this: Blob) {
    await set(["resource", "files", "book"], "other-account", stores.getCustodyStore());
    return original.call(this);
  });
  await expect(prepareRecoveryDownload(item(id), undefined, () => {})).rejects.toThrow(
    "unavailable",
  );
  expect(await get(id, stores.getCustodyStore())).toBeDefined();
});
it("withholds prepared content after auth generation or selection changes", async () => {
  const id = await retainCustody({
    source: "files",
    key: "book",
    role: "intended",
    raw: new Blob(["secret"]),
  });
  const original = Blob.prototype.arrayBuffer;
  vi.spyOn(Blob.prototype, "arrayBuffer").mockImplementationOnce(async function (this: Blob) {
    setCustodyAccount("other-account");
    return original.call(this);
  });
  await expect(prepareRecoveryDownload(item(id), undefined, () => {})).rejects.toThrow(
    "Account changed",
  );
  expect(await get(id, stores.getCustodyStore())).toBeDefined();
  setCustodyAccount(undefined);
  await expect(
    prepareRecoveryView(item(id), undefined, () => {
      throw new Error("closed");
    }),
  ).rejects.toThrow("closed");
});
it("hides account-bound device entries while signed out or under another account", async () => {
  const id = await retainCustody({
    source: "files",
    key: "book",
    role: "intended",
    raw: new Blob(["private"]),
  });
  setCustodyAccount("owner");
  await bindCustody(id, "owner");
  setCustodyAccount(undefined);
  await expect(prepareRecoveryView(item(id), undefined, () => {})).rejects.toThrow("unavailable");
  setCustodyAccount("other");
  await expect(prepareRecoveryDownload(item(id), "other", () => {})).rejects.toThrow("unavailable");
  expect(await get(id, stores.getCustodyStore())).toBeDefined();
});
it("inspection preserves raw type distinctions", () => {
  // Sparse holes are intentionally distinct from present undefined values.
  const sparse: unknown[] = [];
  sparse.length = 2;
  const text = inspectRaw({
    zero: -0,
    infinity: Infinity,
    nan: NaN,
    undefined: undefined,
    array: sparse,
  });
  expect(text).toContain('"zero": -0');
  expect(text).toContain('"infinity": Infinity');
  expect(text).toContain('"nan": NaN');
  expect(text).toContain('"undefined": undefined');
  expect(text).toContain("Array(length=2)");
});
