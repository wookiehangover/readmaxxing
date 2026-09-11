// @vitest-environment node
import { expect, it } from "vitest";
import {
  USER,
  OTHER_USER,
  db,
  mutation,
  mocks,
} from "~/lib/sync/__tests__/integration/push-route-harness";
import { receiveBatch } from "~/lib/database/sync-delivery/intake";
import { getRecovery } from "~/lib/database/sync-delivery/recovery";
import { loader as list } from "../api.sync.recovery";
import { loader as detail } from "../api.sync.recovery.$receiptId";
import { loader as exportReceipt } from "../api.sync.recovery.$receiptId.export";
import { action as resolve } from "../api.sync.recovery.$receiptId.resolve";
import type { RecoveryResolution } from "~/lib/sync/delivery-types";

async function retained(account = USER) {
  const result = await receiveBatch(account, [{ ...mutation("settings"), timestamp: null }]);
  return (await getRecovery(account, result.received[0].receiptId))!;
}
function request(ownerId?: string, body?: RecoveryResolution) {
  return new Request("https://test/api/sync/recovery", {
    method: body ? "POST" : "GET",
    headers: ownerId === undefined ? {} : { "X-Recovery-Owner": ownerId },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
function resolution(before: Awaited<ReturnType<typeof retained>>): RecoveryResolution {
  return {
    resolutionId: "owner-fenced-choice",
    action: "keep_canonical",
    expectedDecisionVersion: before.decisionVersion,
    expectedCanonicalVersion: before.canonicalVersion,
  };
}

it.each([undefined, "", OTHER_USER])(
  "refuses resolution with captured owner %s before reading or changing recovery",
  async (ownerId) => {
    // The current cookie authenticates USER; a stale tab still holds OTHER_USER.
    const before = await retained();
    const foreign = await retained(OTHER_USER);
    const queryCount = mocks.query.mock.calls.length;
    const response = await resolve({
      request: request(ownerId, resolution(before)),
      params: { receiptId: before.receiptId },
    });
    expect(response.status).toBe(ownerId ? 409 : 400);
    expect(mocks.query).toHaveBeenCalledTimes(queryCount);
    if (ownerId) expect(await response.json()).toMatchObject({ code: "account_changed" });
    expect(await getRecovery(USER, before.receiptId)).toEqual(before);
    expect(await getRecovery(OTHER_USER, foreign.receiptId)).toEqual(foreign);
    expect((await db.query("SELECT * FROM readmax.sync_delivery_resolution")).rows).toEqual([]);
  },
);

it.each([list, detail, exportReceipt])(
  "rejects a mismatching captured account before a recovery read",
  async (loader) => {
    const before = await retained();
    const queryCount = mocks.query.mock.calls.length;
    const response = await loader({
      request: request(OTHER_USER),
      params: { receiptId: before.receiptId },
    });
    expect(response.status).toBe(409);
    expect(mocks.query).toHaveBeenCalledTimes(queryCount);
    expect(await response.json()).toEqual({
      error: "Recovery account changed",
      code: "account_changed",
    });
  },
);

it("echoes authenticated ownership on list, detail, export and original-receipt decisions", async () => {
  const before = await retained();
  const foreign = await retained(OTHER_USER);
  for (const loader of [list, detail, exportReceipt]) {
    const response = await loader({
      request: request(USER),
      params: { receiptId: before.receiptId },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ownerId).toBe(USER);
    if (body.receipts) {
      expect(body.receipts).toHaveLength(1);
      expect(body.receipts[0]).toMatchObject({ ownerId: USER, receiptId: before.receiptId });
    }
  }
  const apply = () =>
    resolve({
      request: request(USER, resolution(before)),
      params: { receiptId: before.receiptId },
    });
  const response = await apply();
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result).toMatchObject({ ownerId: USER, receiptId: before.receiptId, state: "resolved" });
  expect(await (await apply()).json()).toEqual(result);
  // Resolution receipts created before the owner field was introduced remain replayable.
  await db.query("UPDATE readmax.sync_delivery_resolution SET result=result-'ownerId'");
  expect(await (await apply()).json()).toEqual(result);
  expect(await getRecovery(OTHER_USER, foreign.receiptId)).toEqual(foreign);
  const denied = await resolve({
    request: request(USER, resolution(foreign)),
    params: { receiptId: foreign.receiptId },
  });
  // Use a fresh resolution identity so this exercises foreign receipt lookup.
  expect(denied.status).toBe(409);
  const foreignResponse = await resolve({
    request: request(USER, { ...resolution(foreign), resolutionId: "foreign-choice" }),
    params: { receiptId: foreign.receiptId },
  });
  expect(foreignResponse.status).toBe(404);
});
