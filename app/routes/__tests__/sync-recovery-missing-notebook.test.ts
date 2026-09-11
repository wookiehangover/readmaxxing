// @vitest-environment node
import { expect, it } from "vitest";
import {
  USER,
  OTHER_USER,
  db,
  mutation,
  push,
} from "~/lib/sync/__tests__/integration/push-route-harness";
import { action as admit } from "../api.sync.recovery";
import { action as resolve } from "../api.sync.recovery.$receiptId.resolve";
import { getRecovery } from "~/lib/database/sync-delivery/recovery";
import type { RecoveryDetail } from "~/lib/sync/delivery-types";

async function prepare(parent = true) {
  if (parent) await push([mutation("book")]);
  const response = await admit({
    request: new Request("https://test/api/sync/recovery", {
      method: "POST",
      headers: { "X-Recovery-Owner": USER },
      body: JSON.stringify({
        admissionId: "local-notebook",
        source: { installation: "profile", itemId: "item", version: "1" },
        snapshot: {
          ...mutation("notebook"),
          id: "retained",
          timestamp: null,
          data: {
            bookId: "entity",
            content: { type: "doc", content: [{ type: "text", text: "retained original" }] },
          },
        },
      }),
    }),
  });
  expect(response.status).toBe(200);
  const detail = (await response.json()) as RecoveryDetail;
  expect(detail.canonical.status).toBe("missing");
  const body = {
    action: "submit_edit",
    resolutionId: "reviewed-choice",
    expectedDecisionVersion: detail.decisionVersion,
    expectedCanonicalVersion: detail.canonicalVersion,
    newMutation: {
      ...mutation("notebook"),
      id: "new-reviewed-edit",
      timestamp: Date.now(),
      data: detail.originalSnapshot.data,
    },
  };
  const submit = (owner = USER) =>
    resolve({
      params: { receiptId: detail.receiptId },
      request: new Request("https://test", {
        method: "POST",
        headers: { "X-Recovery-Owner": owner },
        body: JSON.stringify(body),
      }),
    });
  return { detail, body, submit };
}
async function assertOriginal(detail: RecoveryDetail, state = "needs_resolution") {
  const row = (
    await db.query<{ original_snapshot: unknown; state: string; source_clock: unknown }>(
      "SELECT original_snapshot,state,source_clock FROM readmax.sync_delivery_receipt WHERE receipt_id=$1",
      [detail.receiptId],
    )
  ).rows[0];
  expect(row).toEqual({ original_snapshot: detail.originalSnapshot, state, source_clock: null });
}

it("creates only a genuinely new reviewed notebook, retaining the exact original through lost ACK replay", async () => {
  const { detail, body, submit } = await prepare();
  const response = await submit();
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result).toMatchObject({ receiptId: detail.receiptId, state: "resolved", ownerId: USER });
  const created = (
    await db.query<{ content: unknown; mutation_at: Date }>(
      "SELECT content,mutation_at FROM readmax.notebook",
    )
  ).rows;
  expect(created).toEqual([
    {
      content: (body.newMutation.data as { content: unknown }).content,
      mutation_at: new Date(body.newMutation.timestamp),
    },
  ]);
  expect(await (await submit()).json()).toEqual(result);
  expect((await db.query("SELECT * FROM readmax.notebook")).rows).toHaveLength(1);
  await assertOriginal(detail, "resolved");
});

it.each(["deleted before review", "deleted after review", "missing"])(
  "rejects a %s parent without creating a notebook or resolving custody",
  async (state) => {
    const prepared = await prepare(state !== "missing");
    if (state !== "missing") await push([{ ...mutation("book", 1), operation: "delete" }]);
    if (state === "deleted before review") {
      const current = (await getRecovery(USER, prepared.detail.receiptId))!;
      prepared.body.expectedCanonicalVersion = current.canonicalVersion;
      prepared.body.expectedDecisionVersion = current.decisionVersion;
    }
    expect((await prepared.submit()).status).toBe(409);
    expect((await db.query("SELECT * FROM readmax.notebook")).rows).toEqual([]);
    expect((await db.query("SELECT * FROM readmax.sync_delivery_resolution")).rows).toEqual([]);
    expect(
      (
        await db.query(
          "SELECT * FROM readmax.sync_delivery_receipt WHERE change_id='new-reviewed-edit'",
        )
      ).rows,
    ).toEqual([]);
    await assertOriginal(prepared.detail);
  },
);

it("rejects a notebook created after review even if the recovery edit has a later clock", async () => {
  const { detail, submit, body } = await prepare();
  await push([mutation("notebook")]);
  body.newMutation.timestamp = Date.now() + 1000;
  const existing = await db.query("SELECT * FROM readmax.notebook");
  expect((await submit()).status).toBe(409);
  expect(await db.query("SELECT * FROM readmax.notebook")).toEqual(existing);
  await assertOriginal(detail);
});

it.each(["owned", "foreign"])(
  "rejects a parent alias changed to an %s target after review",
  async (owner) => {
    const { detail, submit } = await prepare();
    await db.query("INSERT INTO readmax.book(id,user_id,title) VALUES('new-target',$1,'current')", [
      owner === "owned" ? USER : OTHER_USER,
    ]);
    await db.query("UPDATE readmax.book SET canonical_id='new-target' WHERE id='entity'");
    expect((await submit()).status).toBe(owner === "owned" ? 409 : 404);
    expect((await db.query("SELECT * FROM readmax.notebook")).rows).toEqual([]);
    await assertOriginal(detail);
  },
);

it("rejects stale account selection before changing the retained notebook", async () => {
  const { detail, submit } = await prepare();
  expect((await submit(OTHER_USER)).status).toBe(409);
  expect((await db.query("SELECT * FROM readmax.notebook")).rows).toEqual([]);
  await assertOriginal(detail);
});
