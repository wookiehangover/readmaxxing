// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { clear, get, entries } from "idb-keyval";
import { USER, OTHER_USER, db, mutation, push } from "./push-route-harness";
import { receiveBatch } from "~/lib/database/sync-delivery/intake";
import { getRecovery } from "~/lib/database/sync-delivery/recovery";
import { action } from "~/routes/api.sync.recovery.$receiptId.resolve";
import { prepareRecoveryResolution, submitRecoveryResolution } from "../../recovery-mutations";
import { getUnsyncedChanges } from "../../change-log";
import {
  getCustodyStore,
  getBookRemapStore,
  getNotebookStore,
  getChangeLogStore,
} from "../../stores";
import { setCustodyAccount } from "../../custody-session";
import { retainCustody, factsKey } from "../../custody-journal";
import { localRecoveryDetail } from "../../custody-export";

beforeEach(async () => {
  setCustodyAccount(USER);
  await Promise.all(
    [getCustodyStore(), getBookRemapStore(), getNotebookStore(), getChangeLogStore()].map((store) =>
      clear(store),
    ),
  );
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    expect(new Headers(init.headers).get("X-Recovery-Owner")).toBe(USER);
    return action({
      request: new Request(`https://test${url}`, init),
      params: { receiptId: url.split("/").at(-2) },
    });
  });
});
afterEach(() => vi.unstubAllGlobals());
async function retainedNotebook() {
  await push([mutation("book"), mutation("notebook")]);
  const receipt = await receiveBatch(USER, [{ ...mutation("notebook", 2), timestamp: null }]);
  return (await getRecovery(USER, receipt.received[0].receiptId))!;
}
it("retains a genuine new edit privately, applies through server preconditions and preserves original bytes", async () => {
  const detail = await retainedNotebook();
  const original = await retainCustody({
    source: "files",
    key: "original",
    raw: new Blob(["not covered by metadata"]),
    role: "intended",
    ownerId: USER,
  });
  const id = await prepareRecoveryResolution({
    ownerId: USER,
    detail,
    action: "submit_edit",
    data: { ...detail.canonical.data, content: "user recovered notebook", bookId: "wrong-target" },
  });
  const saved = (await localRecoveryDetail(id, USER)).item.raw as {
    request: {
      newMutation: { id: string; timestamp: number; entityId: string; data: { bookId: string } };
    };
  };
  expect(saved.request.newMutation.id).not.toBe(detail.changeId);
  expect(saved.request.newMutation.timestamp).toBeGreaterThan(Date.now() - 5000);
  expect(saved.request.newMutation.entityId).toBe(detail.canonical.entityId);
  expect(saved.request.newMutation.data.bookId).toBe(detail.canonical.entityId);
  expect(await getUnsyncedChanges()).toEqual([]);
  expect(await get("entity", getNotebookStore())).toBeUndefined();
  const result = await submitRecoveryResolution({ ownerId: USER, submissionId: id });
  expect(result.state).toBe("resolved");
  expect(
    (await db.query("SELECT content FROM readmax.notebook WHERE book_id='entity'")).rows,
  ).toEqual([{ content: "user recovered notebook" }]);
  expect((await getRecovery(USER, detail.receiptId))!.originalSnapshot).toEqual(
    detail.originalSnapshot,
  );
  expect(await get(original, getCustodyStore())).toBeDefined();
  expect(await get(factsKey(original), getCustodyStore())).not.toHaveProperty("retired", true);
  expect(await get("entity", getNotebookStore())).toBeUndefined();
});
it("canonical conflict rolls back SQL and retains the prepared edit without a blind push", async () => {
  const detail = await retainedNotebook();
  const id = await prepareRecoveryResolution({
    ownerId: USER,
    detail,
    action: "submit_edit",
    data: { content: "stale reviewed edit" },
  });
  await db.query("UPDATE readmax.notebook SET content=$1::jsonb WHERE book_id='entity'", [
    JSON.stringify("new canonical"),
  ]);
  await expect(submitRecoveryResolution({ ownerId: USER, submissionId: id })).rejects.toThrow(
    /changed/,
  );
  expect((await db.query("SELECT content FROM readmax.notebook")).rows).toEqual([
    { content: "new canonical" },
  ]);
  expect((await db.query("SELECT * FROM readmax.sync_delivery_resolution")).rows).toEqual([]);
  expect(await getUnsyncedChanges()).toEqual([]);
  expect(await get(id, getCustodyStore())).toBeDefined();
});
it("retries the same durable identity after an unknown committed outcome", async () => {
  const detail = await retainedNotebook();
  const id = await prepareRecoveryResolution({
    ownerId: USER,
    detail,
    action: "submit_edit",
    data: { content: "only one edit" },
  });
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (...args: Parameters<typeof fetch>) => {
    await realFetch(...args);
    throw new Error("lost response");
  });
  await expect(submitRecoveryResolution({ ownerId: USER, submissionId: id })).rejects.toThrow(
    "lost response",
  );
  vi.stubGlobal("fetch", realFetch);
  expect((await submitRecoveryResolution({ ownerId: USER, submissionId: id })).state).toBe(
    "resolved",
  );
  expect((await db.query("SELECT * FROM readmax.sync_delivery_resolution")).rows).toHaveLength(1);
  expect(await get(id, getCustodyStore())).toBeDefined();
});
it("rejects foreign account and generation changes before publishing success", async () => {
  const detail = await retainedNotebook();
  const id = await prepareRecoveryResolution({ ownerId: USER, detail, action: "keep_canonical" });
  setCustodyAccount(OTHER_USER);
  await expect(
    submitRecoveryResolution({ ownerId: OTHER_USER, submissionId: id }),
  ).rejects.toThrow();
  setCustodyAccount(USER);
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (...args: Parameters<typeof fetch>) => {
    const response = await realFetch(...args);
    setCustodyAccount(OTHER_USER);
    return response;
  });
  await expect(submitRecoveryResolution({ ownerId: USER, submissionId: id })).rejects.toThrow(
    /Account changed/,
  );
  expect(
    (await entries(getCustodyStore())).filter(
      ([key]) => Array.isArray(key) && key[0] === "recovery-result",
    ),
  ).toEqual([]);
  expect(await get(id, getCustodyStore())).toBeDefined();
});
it("retains non-JSON user edit bytes before refusing lossy submission", async () => {
  const detail = await retainedNotebook();
  const id = await prepareRecoveryResolution({
    ownerId: USER,
    detail,
    action: "submit_edit",
    data: { content: "edited", originalFile: new Blob(["new draft bytes"]) },
  });
  await expect(submitRecoveryResolution({ ownerId: USER, submissionId: id })).rejects.toThrow(
    /local export/,
  );
  const raw = (await localRecoveryDetail(id, USER)).item.raw as {
    request: { newMutation: { data: { originalFile: Blob } } };
  };
  expect(await raw.request.newMutation.data.originalFile.text()).toBe("new draft bytes");
  expect(await getUnsyncedChanges()).toEqual([]);
  expect((await db.query("SELECT * FROM readmax.sync_delivery_resolution")).rows).toEqual([]);
});
it("retains a separate user copy under a genuinely new target identity", async () => {
  await push([mutation("book")]);
  const receipt = await receiveBatch(USER, [{ ...mutation("book", 2), timestamp: null }]);
  const detail = (await getRecovery(USER, receipt.received[0].receiptId))!;
  const id = await prepareRecoveryResolution({
    ownerId: USER,
    detail,
    action: "restore_copy",
    data: { ...detail.canonical.data, title: "recovered separate copy", fileHash: null },
  });
  const raw = (await localRecoveryDetail(id, USER)).item.raw as {
    request: { newMutation: { entityId: string } };
  };
  const target = raw.request.newMutation.entityId;
  expect(target).not.toBe(detail.canonical.entityId);
  expect((await submitRecoveryResolution({ ownerId: USER, submissionId: id })).state).toBe(
    "resolved",
  );
  expect((await db.query("SELECT title FROM readmax.book WHERE id=$1", [target])).rows).toEqual([
    { title: "recovered separate copy" },
  ]);
  expect((await db.query("SELECT id FROM readmax.book")).rows).toHaveLength(2);
});
it("rejects a mismatched response account before caching resolution success", async () => {
  const detail = await retainedNotebook();
  const id = await prepareRecoveryResolution({ ownerId: USER, detail, action: "keep_canonical" });
  vi.stubGlobal("fetch", async () =>
    Response.json({ ...detail, ownerId: OTHER_USER, state: "resolved" }),
  );
  await expect(submitRecoveryResolution({ ownerId: USER, submissionId: id })).rejects.toThrow(
    /Invalid recovery response/,
  );
  expect(await get(["recovery-result", id], getCustodyStore())).toBeUndefined();
  expect(await get(id, getCustodyStore())).toBeDefined();
});
it("rejects a detail from another account before retaining a new draft", async () => {
  const detail = await retainedNotebook();
  const before = await entries(getCustodyStore());
  await expect(
    prepareRecoveryResolution({
      ownerId: USER,
      detail: { ...detail, ownerId: OTHER_USER },
      action: "submit_edit",
      data: { content: "foreign detail" },
    }),
  ).rejects.toThrow(/account changed/);
  expect(await entries(getCustodyStore())).toEqual(before);
});
