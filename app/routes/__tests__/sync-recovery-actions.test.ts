// @vitest-environment node
import { expect, it } from "vitest";
import { USER, db, mutation, push } from "~/lib/sync/__tests__/integration/push-route-harness";
import { receiveBatch } from "~/lib/database/sync-delivery/intake";
import {
  getRecovery,
  resolveRecovery,
  RecoveryConflict,
} from "~/lib/database/sync-delivery/recovery";

const book = (id: string, title: string, fileHash = "same-hash") => ({
  ...mutation("book"),
  id: `change-${id}`,
  entityId: id,
  data: { title, fileHash },
});
const retain = async () => {
  const intake = await receiveBatch(USER, [{ ...book("source", "saved source"), timestamp: null }]);
  return (await getRecovery(USER, intake.received[0].receiptId))!;
};

it.each(["restore_copy", "submit_edit"] as const)(
  "%s rejects alias coverage and rolls back all attempted effects",
  async (action) => {
    await push([book("canonical", "canonical content")]);
    if (action === "submit_edit") await push([book("source", "alias")]);
    const detail = await retain();
    const before = (await db.query("SELECT * FROM readmax.book ORDER BY id")).rows;
    const aliases = (await db.query("SELECT * FROM readmax.sync_alias_event ORDER BY revision"))
      .rows;
    await expect(
      resolveRecovery(USER, detail.receiptId, {
        resolutionId: "explicit-action",
        action,
        expectedDecisionVersion: detail.decisionVersion,
        expectedCanonicalVersion: detail.canonicalVersion,
        newMutation: {
          ...book(action === "restore_copy" ? "requested-copy" : "source", "recovered content"),
          id: "new-mutation",
          timestamp: Date.now(),
        },
      }),
    ).rejects.toBeInstanceOf(RecoveryConflict);
    expect(await getRecovery(USER, detail.receiptId)).toEqual(detail);
    expect((await db.query("SELECT * FROM readmax.book ORDER BY id")).rows).toEqual(before);
    expect(
      (await db.query("SELECT * FROM readmax.sync_alias_event ORDER BY revision")).rows,
    ).toEqual(aliases);
    expect(
      (await db.query("SELECT * FROM readmax.sync_delivery_receipt WHERE change_id='new-mutation'"))
        .rows,
    ).toEqual([]);
    expect((await db.query("SELECT * FROM readmax.sync_delivery_resolution")).rows).toEqual([]);
  },
);

it("an obsolete explicit edit cannot resolve custody without applying its content", async () => {
  await push([{ ...book("source", "newer canonical content"), timestamp: Date.now() + 60_000 }]);
  const detail = await retain();
  await expect(
    resolveRecovery(USER, detail.receiptId, {
      resolutionId: "obsolete-edit",
      action: "submit_edit",
      expectedDecisionVersion: detail.decisionVersion,
      expectedCanonicalVersion: detail.canonicalVersion,
      newMutation: {
        ...book("source", "obsolete edit"),
        id: "new-mutation",
        timestamp: Date.now(),
      },
    }),
  ).rejects.toBeInstanceOf(RecoveryConflict);
  expect(await getRecovery(USER, detail.receiptId)).toEqual(detail);
  expect((await db.query("SELECT title FROM readmax.book WHERE id='source'")).rows).toEqual([
    { title: "newer canonical content" },
  ]);
});

it("a performed copy creates its requested identity and resolves idempotently", async () => {
  await push([book("canonical", "canonical content")]);
  const detail = await retain();
  const request = {
    resolutionId: "copy",
    action: "restore_copy" as const,
    expectedDecisionVersion: detail.decisionVersion,
    expectedCanonicalVersion: detail.canonicalVersion,
    newMutation: {
      ...book("requested-copy", "copied content", "different-hash"),
      timestamp: Date.now(),
    },
  };
  const resolved = await resolveRecovery(USER, detail.receiptId, request);
  expect(resolved).toMatchObject({ state: "resolved" });
  expect(await resolveRecovery(USER, detail.receiptId, request)).toEqual(resolved);
  expect(
    (
      await db.query(
        "SELECT title,canonical_id,deleted_at FROM readmax.book WHERE id='requested-copy'",
      )
    ).rows,
  ).toEqual([{ title: "copied content", canonical_id: null, deleted_at: null }]);
  expect((await getRecovery(USER, detail.receiptId))!.originalSnapshot).toEqual(
    detail.originalSnapshot,
  );
});
