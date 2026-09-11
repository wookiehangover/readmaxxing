// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { clear, get } from "idb-keyval";
import * as stores from "../stores";
import { makeAnnotationService } from "~/lib/stores/annotations-store";
import { getUnsyncedChanges, recordChange } from "../change-log";
import { listCustody } from "../custody-journal";
import { setCustodyAccount } from "../custody-session";
import { receiveJournalRevision, restoreJournalChanges } from "../delivery-journal";
import { deliveryFingerprint } from "../delivery-fingerprint";
import type { DeliveryReference } from "../delivery-types";
import { pushChangesWithResult } from "../push";
vi.mock("../file-uploads", () => ({ uploadPendingFiles: async () => {} }));
const receipt = (payloadFingerprint: string): DeliveryReference => ({
  receiptId: "receipt",
  fingerprintVersion: 1,
  payloadFingerprint,
  state: "needs_resolution",
  reasonCode: "conflict",
  decisionVersion: 1,
});
const ctx = {
  fileUploadContext: { userId: "A", uploadRetryState: new Map() },
  isStopped: () => false,
  scheduleFollowUpPush: () => {},
};
beforeEach(async () => {
  vi.restoreAllMocks();
  setCustodyAccount(undefined);
  await Promise.all(Object.values(stores).map((store) => clear(store())));
  setCustodyAccount("A");
});

it("recovers actual notebook publication interrupted after persistence but before the shared outbox write", async () => {
  const log = stores.getChangeLogStore();
  vi.spyOn(stores, "getChangeLogStore").mockReturnValue((mode, callback) => {
    if (mode === "readwrite") throw new Error("projection interrupted");
    return log(mode, callback);
  });
  const service = makeAnnotationService({
    notebookStore: stores.getNotebookStore(),
    highlightStore: stores.getHighlightStore(),
  });
  await expect(
    service.saveNotebook({ bookId: "book", content: { text: "new revision" }, updatedAt: 10 }),
  ).rejects.toThrow();
  expect(await get("book", stores.getNotebookStore())).toMatchObject({
    content: { text: "new revision" },
  });
  vi.restoreAllMocks();
  expect(await getUnsyncedChanges()).toEqual([]);
  await restoreJournalChanges("A", () => false);
  expect(await getUnsyncedChanges()).toEqual([
    expect.objectContaining({
      entity: "notebook",
      timestamp: 10,
      data: { bookId: "book", content: { text: "new revision" }, updatedAt: 10 },
    }),
  ]);
});

it("accepts only exact receipts and leaves raw invalid values and attachments recoverable", async () => {
  const change = await recordChange({
    entity: "book",
    entityId: "book",
    operation: "put",
    timestamp: NaN,
    data: { id: "book", coverImage: new Blob(["original bytes"]), absent: undefined },
  });
  const fingerprint = await deliveryFingerprint(change);
  expect(await receiveJournalRevision("A", change, receipt("wrong"), fingerprint)).toBe(false);
  expect(
    (await listCustody("A")).some(
      ({ item }) =>
        item.raw && typeof item.raw === "object" && "id" in item.raw && item.raw.id === change.id,
    ),
  ).toBe(true);
  expect(await receiveJournalRevision("A", change, receipt(fingerprint), fingerprint)).toBe(true);
  const retained = (await listCustody("A")).find(({ item }) => item.role === "transport")!;
  expect(retained.facts.receiptId).toBe("receipt");
  const raw = retained.item.raw as typeof change;
  expect(Number.isNaN(raw.timestamp)).toBe(true);
  expect(await (raw.data as { coverImage: Blob }).coverImage.text()).toBe("original bytes");
  expect(Object.hasOwn(raw.data as object, "absent")).toBe(true);
});

it("retires exact delivered data and does not recapture the acknowledged notebook as undo history", async () => {
  const service = makeAnnotationService({
    notebookStore: stores.getNotebookStore(),
    highlightStore: stores.getHighlightStore(),
  });
  await service.saveNotebook({ bookId: "book", content: { text: "one" }, updatedAt: 1 });
  const [change] = await getUnsyncedChanges();
  const fingerprint = await deliveryFingerprint(change);
  await receiveJournalRevision("A", change, receipt(fingerprint), fingerprint);
  expect(await listCustody("A")).toEqual([]);
  await service.saveNotebook({ bookId: "book", content: { text: "two" }, updatedAt: 2 });
  expect((await listCustody("A")).some(({ item }) => item.role === "before")).toBe(false);
  expect(await get("book", stores.getNotebookStore())).toMatchObject({ content: { text: "two" } });
});

it("a mismatched receipt cannot clear the shared projection and a foreign session cannot replay it", async () => {
  const change = await recordChange({
    entity: "notebook",
    entityId: "book",
    operation: "put",
    data: { bookId: "book", content: { text: "retained" } },
    timestamp: 1,
  });
  vi.stubGlobal("fetch", async () =>
    Response.json({ accepted: [{ id: change.id, deliveries: [receipt("wrong")] }], rejected: [] }),
  );
  await expect(pushChangesWithResult(ctx)).rejects.toThrow();
  expect(await get(change.id, stores.getChangeLogStore())).toMatchObject({ synced: false });
  await clear(stores.getChangeLogStore());
  setCustodyAccount("B");
  await restoreJournalChanges("B", () => false);
  expect(await getUnsyncedChanges()).toEqual([]);
  expect(await listCustody("B")).toEqual([]);
  setCustodyAccount("A");
  expect(await listCustody("A")).not.toEqual([]);
});

it("refuses outgoing copies of another account's stored entity even without ownerId metadata", async () => {
  const { custodySet } = await import("../custody-write");
  await custodySet(
    "owned",
    { bookId: "owned", content: { text: "A content" }, updatedAt: 1 },
    stores.getNotebookStore(),
  );
  setCustodyAccount("B");
  await expect(
    recordChange({
      entity: "notebook",
      entityId: "owned",
      operation: "put",
      data: { bookId: "owned", content: { text: "A content" } },
      timestamp: 1,
    }),
  ).rejects.toThrow("Foreign");
  expect(await getUnsyncedChanges()).toEqual([]);
  expect(await listCustody("B")).toEqual([]);
  expect(await get("owned", stores.getNotebookStore())).toMatchObject({
    content: { text: "A content" },
  });
});

it("retains non-JSON raw locally while draining healthy outgoing records", async () => {
  const raw: Record<string, unknown> = { text: "cyclic local" };
  raw.self = raw;
  const cyclic = await recordChange({
    entity: "notebook",
    entityId: "cyclic",
    operation: "put",
    timestamp: 1,
    data: raw,
  });
  const healthy = await recordChange({
    entity: "notebook",
    entityId: "healthy",
    operation: "put",
    timestamp: 2,
    data: { content: "healthy" },
  });
  const received: unknown[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    received.push(...body.changes);
    return Response.json({
      accepted: body.changes.map(({ id }: { id: string }) => ({ id })),
      rejected: [],
    });
  });
  await expect(pushChangesWithResult(ctx)).rejects.toThrow("retained");
  expect(received).toEqual([healthy]);
  expect(await get(healthy.id, stores.getChangeLogStore())).toBeUndefined();
  expect(await get(cyclic.id, stores.getChangeLogStore())).toMatchObject({
    failure: { retryable: false },
  });
  const retained = (await listCustody("A")).find(
    ({ item }) => item.role === "transport" && (item.raw as { id?: string }).id === cyclic.id,
  )!;
  const data = (retained.item.raw as typeof cyclic).data as typeof raw;
  expect(data.self).toBe(data);
  expect(retained.facts.receiptId).toBeUndefined();
});
