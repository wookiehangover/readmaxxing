// @vitest-environment node
import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  USER,
  OTHER_USER,
  mutation,
  push,
  mocks,
  db,
} from "~/lib/sync/__tests__/integration/push-route-harness";
import { action, loader } from "../api.sync.recovery";
import { action as resolve } from "../api.sync.recovery.$receiptId.resolve";
import { getRecovery } from "~/lib/database/sync-delivery/recovery";
import { processDeliveries } from "~/lib/database/sync-delivery/worker";
import type {
  RecoveryAdmission,
  RecoveryDetail,
  RecoveryResolution,
} from "~/lib/sync/delivery-types";

function admission(
  snapshot: Record<string, unknown>,
  admissionId = "admission",
): RecoveryAdmission {
  return {
    admissionId,
    source: { installation: "profile", itemId: "raw-item", version: "raw-revision" },
    snapshot,
  };
}
function admit(body: RecoveryAdmission, owner = USER) {
  return action({
    request: new Request("https://test/api/sync/recovery", {
      method: "POST",
      headers: { "X-Recovery-Owner": owner },
      body: JSON.stringify(body),
    }),
  });
}
function decision(detail: RecoveryDetail, action: RecoveryResolution["action"], extra = {}) {
  return resolve({
    params: { receiptId: detail.receiptId },
    request: new Request("https://test", {
      method: "POST",
      headers: { "X-Recovery-Owner": USER },
      body: JSON.stringify({
        resolutionId: "choice",
        action,
        expectedDecisionVersion: detail.decisionVersion,
        expectedCanonicalVersion: detail.canonicalVersion,
        ...extra,
      }),
    }),
  });
}

it.each([
  "book",
  "notebook",
  "highlight",
  "position",
  "bookmark",
  "chat_session",
  "settings",
] as const)(
  "admits %s into custody without historical application or scheduled work",
  async (entity) => {
    await push([mutation("book"), ...(entity === "book" ? [] : [mutation(entity)])]);
    const snapshot = { ...mutation(entity, 1), timestamp: Date.now(), id: "local-history" };
    const response = await admit(admission(snapshot));
    expect(response.status).toBe(200);
    const detail = (await response.json()) as RecoveryDetail;
    expect(detail).toMatchObject({ ownerId: USER, state: "needs_resolution", nextAttemptAt: null });
    const { synced: _synced, ...original } = snapshot;
    expect(detail.originalSnapshot).toEqual(original);
    expect(detail.sourceClock).toBe(snapshot.timestamp);
    expect(await processDeliveries(USER)).toBe(0);
    expect((await getRecovery(USER, detail.receiptId))!.canonical).toEqual(detail.canonical);
    const result = await decision(detail, "submit_edit", {
      newMutation: { ...snapshot, id: "explicit-new", timestamp: Date.now() },
    });
    expect(result.status).toBe(200);
    expect((await result.json()).state).toBe("resolved");
    expect((await getRecovery(USER, detail.receiptId))!.originalSnapshot).toEqual(original);
  },
);

it.each([null, "bad-clock", undefined])(
  "preserves invalid clock %s until an explicit new edit",
  async (clock) => {
    const snapshot: Record<string, unknown> = { ...mutation("settings"), timestamp: clock };
    if (clock === undefined) delete snapshot.timestamp;
    const detail = (await (await admit(admission(snapshot))).json()) as RecoveryDetail;
    expect(detail.state).toBe("needs_resolution");
    expect(detail.originalSnapshot).toMatchObject({ id: snapshot.id });
    if (clock === undefined) expect(detail.originalSnapshot).not.toHaveProperty("timestamp");
    else expect(detail.originalSnapshot.timestamp).toBe(clock);
    expect(await processDeliveries(USER)).toBe(0);
    const result = await decision(detail, "submit_edit", {
      newMutation: { ...mutation("settings", 1), id: "new-edit", timestamp: Date.now() },
    });
    expect(result.status).toBe(200);
  },
);

it("retains immutable source identity on lost ACK replay and distinct snapshot evidence", async () => {
  const original = admission({ ...mutation("settings"), timestamp: null });
  const before = (await (await admit(original)).json()) as RecoveryDetail;
  expect(await (await admit(original)).json()).toEqual(before);
  const different = { ...original, snapshot: { ...original.snapshot, data: { theme: "changed" } } };
  expect((await admit(different)).status).toBe(409);
  const after = (await (
    await admit({ ...different, admissionId: "second-revision" })
  ).json()) as RecoveryDetail;
  expect(after.receiptId).not.toBe(before.receiptId);
  expect((await db.query("SELECT * FROM readmax.sync_recovery_admission")).rows).toHaveLength(2);
  await expect(
    db.query("UPDATE readmax.sync_recovery_admission SET request='{}'::jsonb"),
  ).rejects.toThrow("immutable");
  expect((await getRecovery(USER, before.receiptId))!.originalSnapshot.data).toEqual({
    theme: "light",
  });
});

it("fences stale accounts before SQL and cannot claim a foreign canonical or first-bound resource", async () => {
  const request = admission({ ...mutation("book"), timestamp: null });
  const count = mocks.query.mock.calls.length;
  expect((await admit(request, OTHER_USER)).status).toBe(409);
  expect(mocks.query).toHaveBeenCalledTimes(count);
  await db.query("INSERT INTO readmax.book(id,user_id,title) VALUES('entity',$1,'private')", [
    OTHER_USER,
  ]);
  expect((await admit(request)).status).toBe(404);
  expect((await db.query("SELECT * FROM readmax.sync_recovery_admission")).rows).toEqual([]);
  await db.query(
    "INSERT INTO readmax.sync_resource_binding(namespace,resource_id,account_id) VALUES('book','bound',$1)",
    [OTHER_USER],
  );
  expect(
    (await admit({ ...request, snapshot: { ...request.snapshot, entityId: "bound" } })).status,
  ).toBe(404);
});

it("rolls back receipt and first binding when admission evidence storage fails", async () => {
  const execute = mocks.query.getMockImplementation()!;
  mocks.query.mockImplementation((query) => {
    if (
      typeof query !== "string" &&
      query.text.includes("INSERT INTO readmax.sync_recovery_admission")
    )
      throw new Error("disk full");
    return execute(query);
  });
  await expect(admit(admission({ ...mutation("book"), timestamp: null }))).rejects.toThrow(
    "disk full",
  );
  expect((await db.query("SELECT * FROM readmax.sync_delivery_receipt")).rows).toEqual([]);
  expect((await db.query("SELECT * FROM readmax.sync_resource_binding")).rows).toEqual([]);
});

it("a projection requiring a new edit cannot be an unchanged retry through recovery or push", async () => {
  const snapshot = {
    ...mutation("settings"),
    recoveryProjection: { requiresNewEdit: true, kind: "local-raw-projection" },
  };
  const detail = (await (await admit(admission(snapshot))).json()) as RecoveryDetail;
  expect((await decision(detail, "retry")).status).toBe(409);
  expect(await processDeliveries(USER)).toBe(0);
  await push([{ ...snapshot, id: "separate-push" }]);
  expect((await db.query("SELECT * FROM readmax.user_settings")).rows).toEqual([]);
  expect(
    (
      await decision(detail, "submit_edit", {
        newMutation: { ...mutation("settings", 1), id: "reviewed-edit", timestamp: Date.now() },
      })
    ).status,
  ).toBe(200);
});

it("file-only target lookup is read-only and resolves only account-owned canonical metadata", async () => {
  await push([
    { ...mutation("book"), data: { title: "live", fileHash: "hash" } },
    { ...mutation("book", 1), entityId: "alias", data: { title: "alias", fileHash: "hash" } },
  ]);
  const lookup = (id: string) =>
    loader({
      request: new Request(`https://test/api/sync/recovery?targetBookId=${id}`, {
        headers: { "X-Recovery-Owner": USER },
      }),
    });
  const before = await db.query("SELECT * FROM readmax.sync_delivery_receipt");
  const target = await (await lookup("alias")).json();
  expect(target).toMatchObject({
    ownerId: USER,
    canonical: { entityId: "entity", status: "present", data: { title: "live" } },
  });
  expect(target).not.toHaveProperty("receiptId");
  expect(await db.query("SELECT * FROM readmax.sync_delivery_receipt")).toEqual(before);
  expect((await (await lookup("missing")).json()).canonical.status).toBe("missing");
  expect(
    (await db.query("SELECT * FROM readmax.sync_resource_binding WHERE resource_id='missing'"))
      .rows,
  ).toEqual([]);
  await db.query("INSERT INTO readmax.book(id,user_id) VALUES('foreign',$1)", [OTHER_USER]);
  expect((await lookup("foreign")).status).toBe(404);
});

it("keeps additive migration and fresh schema parity", async () => {
  expect(await readFile("database/migrations/024-sync-recovery-admission.sql", "utf8")).toBe(
    await readFile("database/readmax/sync-recovery.sql", "utf8"),
  );
});
