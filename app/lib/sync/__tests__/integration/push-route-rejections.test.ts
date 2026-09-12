// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { clear } from "idb-keyval";
import { USER, BASE, db, mocks, ctx, mutation } from "./push-route-harness";
import { action } from "~/routes/api.sync.push";
import { processEntry } from "~/lib/database/sync-delivery/apply";
import { processDeliveries } from "~/lib/database/sync-delivery/worker";
import { getRecovery } from "~/lib/database/sync-delivery/recovery";
import { pushChangesWithResult } from "../../push";
import { recordChange, getUnsyncedChanges } from "../../change-log";
import { getCustodyStore, getBookRemapStore } from "../../stores";
import { setCustodyAccount } from "../../custody-session";
beforeEach(async () => {
  await clear(getCustodyStore());
  await clear(getBookRemapStore());
  setCustodyAccount(USER);
});
function connect(capable = true) {
  const responses: Response[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    if (!capable) delete request.supportsDurableReceipts;
    const response = await action({
      request: new Request("https://test/api/sync/push", {
        ...init,
        body: JSON.stringify(request),
      }),
    });
    responses.push(response.clone());
    return response;
  });
  return responses;
}
function failOnce(entity: string, error: unknown) {
  const execute = mocks.query.getMockImplementation()!;
  let pending = true;
  const table = entity === "position" ? "reading_position" : entity;
  mocks.query.mockImplementation((query) => {
    if (
      pending &&
      typeof query !== "string" &&
      query.text.includes(`INSERT INTO readmax.${table}`)
    ) {
      pending = false;
      throw error;
    }
    return execute(query);
  });
}
it.each(["notebook", "highlight", "bookmark", "position"] as const)(
  "new client records durable %s receipt before retiring transport and worker later applies original snapshot",
  async (entity) => {
    const change = await recordChange({
      ...mutation(entity),
      entityId: "failed-book",
      data: { ...(mutation(entity).data as object), bookId: "failed-book" },
    });
    const healthy = await recordChange({ ...mutation("settings"), timestamp: BASE + 1 });
    failOnce(entity, new Error("connection terminated"));
    const responses = connect();
    await pushChangesWithResult(ctx());
    expect(responses[0].status).toBe(200);
    expect(await responses[0].json()).toMatchObject({
      accepted: [{ id: healthy.id }],
      rejected: [{ id: change.id, retryable: true, deliveries: [{ state: "retry_pending" }] }],
    });
    expect(await getUnsyncedChanges(USER)).toEqual([]);
    const receipt = (
      await db.query<{ receipt_id: string }>(
        "SELECT receipt_id FROM readmax.sync_delivery_receipt WHERE change_id=$1",
        [change.id],
      )
    ).rows[0];
    expect((await getRecovery(USER, receipt.receipt_id))!.originalSnapshot.data).toEqual(
      change.data,
    );
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 180_000);
    await processDeliveries(USER);
    expect((await getRecovery(USER, receipt.receipt_id))!.state).toBe("applied");
  },
);
it("fallback without receipt metadata retains transient local failure through reload and delayed retry", async () => {
  const change = await recordChange(mutation("notebook"));
  failOnce("notebook", new Error("temporary outage"));
  const responses = connect(false);
  await expect(pushChangesWithResult(ctx())).rejects.toThrow("Push incomplete");
  expect(await getUnsyncedChanges(USER)).toMatchObject([
    { id: change.id, failure: { retryable: true } },
  ]);
  vi.resetModules();
  const { pushChangesWithResult: reload } = await import("../../push");
  await expect(reload(ctx())).rejects.toThrow("Push incomplete");
  expect(responses).toHaveLength(1);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 180_000);
  await reload(ctx());
  expect(await getUnsyncedChanges(USER)).toEqual([]);
  expect(responses).toHaveLength(2);
});
it.each([true, false])(
  "unsupported legacy messages have durable recovery while old-compatible arrays preserve meaning (receipts=%s)",
  async (capable) => {
    const change = await recordChange({
      ...mutation("chat_message"),
      data: { sessionId: "session", content: "unsupported text" },
    });
    const responses = connect(capable);
    if (capable) await pushChangesWithResult(ctx());
    else await expect(pushChangesWithResult(ctx())).rejects.toThrow("Push incomplete");
    expect(await responses[0].json()).toMatchObject({
      accepted: [],
      rejected: [{ id: change.id, retryable: false }],
    });
    expect(
      (
        await db.query(
          "SELECT state,original_snapshot->'data' AS data FROM readmax.sync_delivery_receipt",
        )
      ).rows,
    ).toEqual([{ state: "needs_resolution", data: change.data }]);
    if (!capable)
      expect(await getUnsyncedChanges(USER)).toMatchObject([{ failure: { retryable: false } }]);
  },
);
it("invalid operation and missing content are rejected by application before any DAL call", async () => {
  mocks.query.mockClear();
  expect(
    await processEntry(USER, { ...mutation("notebook"), operation: "invalid" as "put" }),
  ).toMatchObject({ accepted: false, retryable: false });
  expect(await processEntry(USER, { ...mutation("notebook"), data: null })).toMatchObject({
    accepted: false,
    retryable: false,
  });
  expect(mocks.query).not.toHaveBeenCalled();
});
it.each([true, false])(
  "unclassified application failures retain custody for capable and unchanged callers (receipts=%s)",
  async (capable) => {
    const entry = mutation("notebook");
    failOnce("notebook", null);
    const response = await action({
      request: new Request("https://test/api/sync/push", {
        method: "POST",
        body: JSON.stringify({
          changes: [entry],
          ...(capable ? { supportsDurableReceipts: 1 } : {}),
        }),
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      accepted: [],
      rejected: [{ id: entry.id, retryable: true }],
    });
    expect((await db.query("SELECT state FROM readmax.sync_delivery_receipt")).rows).toEqual([
      { state: "retry_pending" },
    ]);
  },
);
