// @vitest-environment node
import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  USER,
  OTHER_USER,
  BASE,
  db,
  mutation,
  push,
  mocks,
} from "~/lib/sync/__tests__/integration/push-route-harness";
import { receiveBatch } from "~/lib/database/sync-delivery/intake";
import {
  getRecovery,
  resolveRecovery,
  RecoveryConflict,
} from "~/lib/database/sync-delivery/recovery";
import { canonicalJSON } from "~/lib/database/sync-delivery/identity";
import { loader } from "../api.sync.recovery.$receiptId";
import { action as resolve } from "../api.sync.recovery.$receiptId.resolve";
import type { EntityType } from "~/lib/sync/types";
const retain = async (entity: EntityType, entityId = "entity") => {
  const result = await receiveBatch(USER, [
    { ...mutation(entity), id: "retained", entityId, timestamp: null },
  ]);
  return result.received[0].receiptId;
};
const detail = async (id: string) =>
  loader({
    request: new Request("https://test/api/sync/recovery/" + id),
    params: { receiptId: id },
  });

it.each([
  "book",
  "notebook",
  "position",
  "highlight",
  "bookmark",
  "chat_session",
  "settings",
] as const)(
  "%s detail exposes current mutation-facing content and matching version",
  async (entity) => {
    await push([mutation(entity)]);
    const id = await retain(entity);
    const response = await detail(id);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.canonical).toMatchObject({
      entity,
      entityId: "entity",
      status: "present",
      version: body.canonicalVersion,
    });
    expect(body.canonical.data).not.toHaveProperty("user_id");
    expect(body.canonical.data).not.toHaveProperty("mutation_at");
    const field = {
      book: "title",
      notebook: "content",
      position: "cfi",
      highlight: "text",
      bookmark: "label",
      chat_session: "title",
      settings: "theme",
    }[entity];
    expect(body.canonical.data[field]).toEqual(
      (mutation(entity).data as Record<string, unknown>)[field],
    );
    if (entity !== "settings") expect(body.canonical.data.updatedAt).toBe(BASE);
    if (entity === "book")
      expect(body.canonical.data.remoteFileUrl).toBe("https://blob.test/0.epub");
    expect(
      mocks.query.mock.calls.some(([query]) => query === "BEGIN ISOLATION LEVEL REPEATABLE READ"),
    ).toBe(true);
  },
);

it("alias detail targets canonical content, retains the source and rejects a stale displayed version", async () => {
  await push([
    { ...mutation("book"), data: { title: "canonical", fileHash: "same" } },
    { ...mutation("book", 1), entityId: "alias", data: { title: "source", fileHash: "same" } },
  ]);
  const id = await retain("book", "alias");
  const before = (await getRecovery(USER, id))!;
  expect(before.canonical).toMatchObject({
    entityId: "entity",
    status: "present",
    data: { title: "canonical" },
  });
  expect(before.originalSnapshot.entityId).toBe("alias");
  const record = (
    await db.query<{ value: Record<string, unknown> }>(
      "SELECT to_jsonb(t) AS value FROM readmax.book t WHERE id='entity'",
    )
  ).rows[0].value;
  expect(before.canonical.version).toBe(
    createHash("sha256")
      .update(canonicalJSON({ id: "entity", record }))
      .digest("hex"),
  );
  await push([{ ...mutation("book", 2), data: { title: "changed" } }]);
  await expect(
    resolveRecovery(USER, id, {
      resolutionId: "stale",
      action: "keep_canonical",
      expectedDecisionVersion: before.decisionVersion,
      expectedCanonicalVersion: before.canonical.version,
    }),
  ).rejects.toBeInstanceOf(RecoveryConflict);
  const after = (await getRecovery(USER, id))!;
  expect(after.canonical.data).toMatchObject({ title: "changed" });
  expect(after.canonical.version).not.toBe(before.canonical.version);
  expect(after.state).toBe(before.state);
});

it("reports an ordinary tombstone without inferring an alias and distinguishes missing content", async () => {
  await push([mutation("book"), { ...mutation("book", 1), operation: "delete", data: null }]);
  const deleted = (await getRecovery(USER, await retain("book")))!;
  expect(deleted.canonical).toMatchObject({
    entityId: "entity",
    status: "deleted",
    data: { title: "old" },
  });
  expect(deleted.canonical.data!.deletedAt).toBeTypeOf("number");
  const missing = (await getRecovery(USER, await retain("notebook", "absent")))!;
  expect(missing.canonical).toMatchObject({ entityId: "absent", status: "missing", data: null });
});

it("missing or cyclic authoritative alias targets have no editable canonical content", async () => {
  await push([mutation("book")]);
  const id = await retain("book");
  await db.query("UPDATE readmax.book SET canonical_id='missing' WHERE id='entity'");
  expect((await getRecovery(USER, id))!.canonical).toMatchObject({
    entityId: null,
    status: "unavailable",
    data: null,
  });
  await db.query("UPDATE readmax.book SET canonical_id='entity' WHERE id='entity'");
  expect((await getRecovery(USER, id))!.canonical).toMatchObject({
    entityId: null,
    status: "unavailable",
    data: null,
  });
});

it("foreign receipt or authoritative alias ownership returns generic404 for detail and resolution", async () => {
  const foreign = await receiveBatch(OTHER_USER, [{ ...mutation("settings"), timestamp: null }]);
  expect((await detail(foreign.received[0].receiptId)).status).toBe(404);
  await push([mutation("book")]);
  const id = await retain("book");
  const before = (await getRecovery(USER, id))!;
  await db.query("INSERT INTO readmax.book(id,user_id,title) VALUES('foreign',$1,'secret')", [
    OTHER_USER,
  ]);
  await db.query("UPDATE readmax.book SET canonical_id='foreign' WHERE id='entity'");
  const denied = await detail(id);
  expect(denied.status).toBe(404);
  expect(await denied.json()).toEqual({ error: "Not found" });
  const resolved = await resolve({
    request: new Request("https://test", {
      method: "POST",
      body: JSON.stringify({
        resolutionId: "foreign",
        action: "keep_canonical",
        expectedDecisionVersion: before.decisionVersion,
        expectedCanonicalVersion: before.canonicalVersion,
      }),
    }),
    params: { receiptId: id },
  });
  expect(resolved.status).toBe(404);
});

it("unsupported legacy messages can still display their owned canonical content", async () => {
  await push([mutation("chat_session")]);
  await db.query(
    "INSERT INTO readmax.chat_message(id,session_id,role,content) VALUES('message','entity','user','current text')",
  );
  const id = await retain("chat_message", "message");
  expect((await getRecovery(USER, id))!.canonical).toMatchObject({
    entity: "chat_message",
    entityId: "message",
    status: "present",
    data: { sessionId: "entity", content: "current text" },
  });
});
