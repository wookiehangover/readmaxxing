// @vitest-environment node
import { expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  USER,
  OTHER_USER,
  db,
  mocks,
  mutation,
  failNotebookOnce,
  failing,
} from "~/lib/sync/__tests__/integration/push-route-harness";
import { action } from "../api.sync.push";
import { loader as cron } from "../api.cron.sync-delivery";
import { listBookAliases } from "~/lib/database/sync-delivery/aliases";
import {
  getRecovery,
  listRecovery,
  resolveRecovery,
  RecoveryConflict,
} from "~/lib/database/sync-delivery/recovery";
import { receiveBatch } from "~/lib/database/sync-delivery/intake";
import { processDeliveries } from "~/lib/database/sync-delivery/worker";
import { snapshotIdentity } from "~/lib/database/sync-delivery/identity";
import { updateBookBlobUrls } from "~/lib/database/book/book";
const send = async (changes: unknown[]) => {
  const response = await action({
    request: new Request("https://test/api/sync/push", {
      method: "POST",
      body: JSON.stringify({ changes, supportsDurableReceipts: 1 }),
    }),
  });
  return { status: response.status, body: await response.json() };
};
const receipts = async () =>
  (
    await db.query<Record<string, unknown>>(
      "SELECT * FROM readmax.sync_delivery_receipt ORDER BY received_at",
    )
  ).rows;
it("URL publication cannot cross an owner, tombstone or alias fence", async () => {
  await send([mutation("book")]);
  expect(await updateBookBlobUrls("entity", { fileBlobUrl: "foreign" }, OTHER_USER)).toBeNull();
  await db.query("UPDATE readmax.book SET deleted_at=clock_timestamp() WHERE id='entity'");
  expect(await updateBookBlobUrls("entity", { fileBlobUrl: "deleted" }, USER)).toBeNull();
  await db.query("UPDATE readmax.book SET deleted_at=NULL,canonical_id='target' WHERE id='entity'");
  expect(await updateBookBlobUrls("entity", { fileBlobUrl: "alias" }, USER)).toBeNull();
});
it("unresolved root snapshots do not block healthy edits to an existing owned book", async () => {
  await send([mutation("book")]);
  await send([{ ...mutation("book", 1), timestamp: null }]);
  const result = await send([mutation("notebook", 2)]);
  expect(result.body.accepted).toHaveLength(1);
  expect((await db.query("SELECT content FROM readmax.notebook")).rows).toEqual([
    { content: (mutation("notebook", 2).data as { content: unknown }).content },
  ]);
  expect((await receipts()).find((row) => row.change_id === "change-book-1")).toMatchObject({
    state: "needs_resolution",
  });
});
it("retains unsupported, malformed snapshots and snapshotless deletes without invented identities", async () => {
  const entries = [
    { ...mutation("notebook"), data: null },
    { ...mutation("book"), operation: "delete", data: null },
    { ...mutation("chat_session"), data: { title: "standalone" } },
    { ...mutation("chat_message"), data: { sessionId: "session", content: "preserved" } },
    { ...mutation("settings"), operation: "delete", data: null },
    { ...mutation("notebook"), id: "unknown", entity: "unknown", data: { text: "opaque" } },
  ];
  const result = await send(entries);
  expect(result.status).toBe(200);
  expect(await receipts()).toHaveLength(entries.length);
  expect(result.body.accepted.length + result.body.rejected.length).toBe(entries.length);
  expect((await receipts()).find((row) => row.change_id === "unknown")).toMatchObject({
    state: "needs_resolution",
  });
  expect((await send([{ entity: "notebook", data: {} }])).status).toBe(400);
});
it("same-ID differing owned snapshots are retained separately with exactly one response group", async () => {
  const a = mutation("notebook"),
    b = { ...a, data: { bookId: "entity", content: { text: "different" } } };
  const response = await send([a, b]);
  expect(await receipts()).toHaveLength(2);
  expect(response.body.accepted).toEqual([]);
  expect(response.body.rejected).toHaveLength(1);
  expect(response.body.rejected[0].deliveries).toHaveLength(2);
  const replay = await send([a, b]);
  expect(replay.body.rejected).toEqual(response.body.rejected);
  expect(await receipts()).toHaveLength(2);
});
it("same-ID owned/foreign group is omitted in full without custody leakage", async () => {
  const a = mutation("notebook");
  const result = await send([a, { ...a, ownerId: OTHER_USER }]);
  expect(result.status).toBe(503);
  expect(result.body.accepted).toEqual([]);
  expect(result.body.rejected).toEqual([]);
  expect(result.body.notReceived).toEqual([{ id: a.id, code: "not_received" }]);
  expect(await receipts()).toEqual([]);
});
it.each(["highlight", "bookmark", "chat_session", "book"] as const)(
  "rejects a foreign globally-owned %s even if supplied parent looks owned",
  async (entity) => {
    await db.query(
      `INSERT INTO readmax.${entity}(id,user_id${entity === "book" ? "" : ",book_id"}) VALUES('foreign',$1${entity === "book" ? "" : ",'parent'"})`,
      [OTHER_USER],
    );
    const result = await send([{ ...mutation(entity), entityId: "foreign" }]);
    expect(result.status).toBe(503);
    expect(await receipts()).toEqual([]);
  },
);
it("first-binding reserves absent parents across accounts and settings remain account-keyed", async () => {
  await receiveBatch(USER, [{ ...mutation("notebook"), timestamp: null }]);
  const other = await receiveBatch(OTHER_USER, [mutation("book")]);
  expect(other.received).toEqual([]);
  expect(other.notReceived).toHaveLength(1);
  await receiveBatch(USER, [mutation("settings")]);
  await receiveBatch(OTHER_USER, [mutation("settings")]);
  expect((await receipts()).filter((row) => row.entity === "settings")).toHaveLength(2);
});
it("canonical direct writes cannot steal a reserved unresolved identity", async () => {
  await receiveBatch(USER, [{ ...mutation("book"), timestamp: null }]);
  await expect(
    db.query("INSERT INTO readmax.book(id,user_id) VALUES('entity',$1)", [OTHER_USER]),
  ).rejects.toThrow("ownership");
});
it.each(["notebook", "reading_position"])(
  "direct %s writes cannot steal a first-bound absent parent",
  async (table) => {
    await receiveBatch(USER, [{ ...mutation("notebook"), timestamp: null }]);
    await expect(
      db.query(`INSERT INTO readmax.${table}(book_id,user_id) VALUES('entity',$1)`, [OTHER_USER]),
    ).rejects.toThrow("ownership");
  },
);
it("partial transient application commits healthy work and retains failed source, then retries original clock", async () => {
  failNotebookOnce();
  const result = await send([failing, mutation("settings")]);
  expect(result.status).toBe(200);
  expect(result.body.accepted).toHaveLength(1);
  expect(result.body.rejected).toHaveLength(1);
  expect((await receipts()).find((row) => row.change_id === "failed")).toMatchObject({
    state: "retry_pending",
    original_snapshot: snapshotIdentity(failing as unknown as Record<string, unknown>).snapshot,
  });
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 180_000);
  await processDeliveries(USER);
  expect((await db.query("SELECT mutation_at FROM readmax.notebook")).rows).toEqual([
    { mutation_at: new Date(failing.timestamp) },
  ]);
});
it("decision failure rolls back canonical effects and leaves committed intake replayable", async () => {
  const execute = mocks.query.getMockImplementation()!;
  mocks.query.mockImplementation((query) => {
    if (typeof query !== "string" && query.text.includes("SET state="))
      throw new Error("decision storage unavailable");
    return execute(query);
  });
  const result = await send([mutation("book")]);
  expect(result.status).toBe(200);
  expect(result.body.accepted).toEqual([]);
  expect((await db.query("SELECT * FROM readmax.book")).rows).toEqual([]);
  expect((await receipts())[0].state).toBe("received");
  mocks.query.mockImplementation(execute);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
  await processDeliveries(USER);
  expect((await db.query("SELECT * FROM readmax.book")).rows).toHaveLength(1);
  expect((await receipts())[0].state).toBe("applied");
});
it("commit uncertainty never sends a destructive ACK and exact retry reuses committed custody", async () => {
  const execute = mocks.query.getMockImplementation()!;
  let fail = true;
  mocks.query.mockImplementation(async (query) => {
    const result = await execute(query);
    if (query === "COMMIT" && fail) {
      fail = false;
      throw new Error("connection lost after commit");
    }
    return result;
  });
  expect((await send([mutation("notebook")])).status).toBe(503);
  expect(await receipts()).toHaveLength(1);
  expect((await send([mutation("notebook")])).status).toBe(200);
  expect(await receipts()).toHaveLength(1);
});
it("owned malformed alias chains retain evidence without reconciliation; foreign members prevent custody", async () => {
  await db.query(
    "INSERT INTO readmax.book(id,user_id,canonical_id) VALUES('entity',$1,'missing')",
    [USER],
  );
  const result = await send([mutation("notebook")]);
  expect(result.body.rejected).toHaveLength(1);
  expect((await receipts())[0]).toMatchObject({
    state: "needs_resolution",
    reason_code: "invalid_alias",
  });
  expect((await db.query("SELECT * FROM readmax.notebook")).rows).toEqual([]);
});
it("recovery is account-scoped, paginated by changed status and resolution is idempotent and version-checked", async () => {
  await send([{ ...mutation("notebook"), timestamp: null }]);
  const page = await listRecovery(USER, null, 1),
    id = page.receipts[0].receiptId;
  expect(await getRecovery(OTHER_USER, id)).toBeNull();
  expect((await listRecovery(OTHER_USER, null)).receipts).toEqual([]);
  const detail = (await getRecovery(USER, id))!;
  const request = {
    resolutionId: "decision",
    expectedDecisionVersion: detail.decisionVersion,
    expectedCanonicalVersion: detail.canonicalVersion,
    action: "keep_canonical" as const,
  };
  const result = await resolveRecovery(USER, id, request);
  expect(await resolveRecovery(USER, id, request)).toEqual(result);
  await expect(
    resolveRecovery(USER, id, { ...request, resolutionId: "stale" }),
  ).rejects.toBeInstanceOf(RecoveryConflict);
  expect((await listRecovery(USER, page.cursor)).receipts).toMatchObject([
    { receiptId: id, state: "resolved" },
  ]);
  expect((await getRecovery(USER, id))!.originalSnapshot.data).toEqual(mutation("notebook").data);
});
it("recovery cannot overwrite a canonical version changed since the user opened it", async () => {
  await send([{ ...mutation("notebook"), timestamp: null }]);
  const id = String((await receipts())[0].receipt_id);
  const detail = (await getRecovery(USER, id))!;
  await send([mutation("notebook", 1)]);
  await expect(
    resolveRecovery(USER, id, {
      resolutionId: "stale-edit",
      expectedDecisionVersion: detail.decisionVersion,
      expectedCanonicalVersion: detail.canonicalVersion,
      action: "submit_edit",
      newMutation: { ...mutation("notebook", 2), timestamp: Date.now() },
    }),
  ).rejects.toBeInstanceOf(RecoveryConflict);
});
it("alias bootstrap includes old explicit aliases, resumes a fixed high-water, and exposes subsequent redirects", async () => {
  await db.query("INSERT INTO readmax.book(id,user_id) VALUES('target',$1)", [USER]);
  for (const id of ["a", "b", "c"])
    await db.query("INSERT INTO readmax.book(id,user_id,canonical_id) VALUES($1,$2,'target')", [
      id,
      USER,
    ]);
  await db.query("INSERT INTO readmax.book(id,user_id,deleted_at) VALUES('ordinary',$1,NOW())", [
    USER,
  ]);
  const first = await listBookAliases(USER, null, 1);
  expect(first.hasMore).toBe(true);
  expect(first.ownerId).toBe(USER);
  await db.query("INSERT INTO readmax.book(id,user_id,canonical_id) VALUES('later',$1,'target')", [
    USER,
  ]);
  let page = first;
  const aliases = [...first.aliases];
  while (page.hasMore) {
    page = await listBookAliases(USER, page.cursor, 1);
    aliases.push(...page.aliases);
  }
  expect(aliases.some((alias) => alias.fromId === "later" || alias.fromId === "ordinary")).toBe(
    false,
  );
  expect((await listBookAliases(USER, page.cursor)).aliases).toMatchObject([
    { fromId: "later", toId: "target" },
  ]);
  await expect(listBookAliases(OTHER_USER, page.cursor)).rejects.toThrow("cursor");
});
it("unauthenticated cron does no database work", async () => {
  mocks.query.mockClear();
  expect((await cron({ request: new Request("https://test/api/cron/sync-delivery") })).status).toBe(
    401,
  );
  vi.stubEnv("CRON_SECRET", "correct");
  expect(
    (
      await cron({
        request: new Request("https://test/api/cron/sync-delivery", {
          headers: { Authorization: "Bearer wrong" },
        }),
      })
    ).status,
  ).toBe(401);
  expect(mocks.query).not.toHaveBeenCalled();
});
it("fair scheduled worker limits one account to five contributions while other accounts progress", async () => {
  await receiveBatch(
    USER,
    Array.from({ length: 12 }, (_, i) => ({
      ...mutation("notebook", i),
      entityId: `a-${i}`,
      data: { bookId: `a-${i}`, content: { i } },
    })),
  );
  await receiveBatch(OTHER_USER, [
    {
      ...mutation("notebook"),
      entityId: "other",
      data: { bookId: "other", content: { text: "other account" } },
    },
  ]);
  await processDeliveries();
  expect(
    (
      await db.query(
        "SELECT user_id,count(*)::int AS n FROM readmax.notebook GROUP BY user_id ORDER BY user_id",
      )
    ).rows,
  ).toEqual([
    { user_id: USER, n: 5 },
    { user_id: OTHER_USER, n: 1 },
  ]);
});
it("active leases prevent reprocessing and expired leases recover without losing payload", async () => {
  await receiveBatch(USER, [mutation("notebook")]);
  await db.query(
    "UPDATE readmax.sync_delivery_receipt SET lease_token='00000000-0000-4000-8000-000000000099',lease_until=NOW()+INTERVAL '1 minute'",
  );
  expect(await processDeliveries(USER)).toBe(0);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);
  expect(await processDeliveries(USER)).toBe(1);
  expect((await receipts())[0].state).toBe("applied");
});
it("immutable snapshot and alias/binding evidence cannot be overwritten or automatically deleted", async () => {
  await receiveBatch(USER, [mutation("notebook")]);
  await expect(
    db.query("UPDATE readmax.sync_delivery_receipt SET original_snapshot='{}'::jsonb"),
  ).rejects.toThrow("immutable");
  await expect(db.query("DELETE FROM readmax.sync_delivery_receipt")).rejects.toThrow("custody");
  await expect(
    db.query("UPDATE readmax.sync_resource_binding SET account_id=$1", [OTHER_USER]),
  ).rejects.toThrow("immutable");
});
it("additive migration and fresh setup custody schema are identical and migration reruns preserve records", async () => {
  const migration = await readFile("database/migrations/023-sync-delivery-custody.sql", "utf8");
  expect(migration).toBe(await readFile("database/readmax/sync-delivery.sql", "utf8"));
  await receiveBatch(USER, [mutation("notebook")]);
  const before = await receipts();
  await db.exec(migration);
  expect(await receipts()).toEqual(before);
});
it("a worker superseded between claim and application cannot write with its stale lease", async () => {
  await receiveBatch(USER, [mutation("notebook")]);
  const execute = mocks.query.getMockImplementation()!;
  let claimed = false,
    superseded = false;
  mocks.query.mockImplementation(async (query) => {
    const result = await execute(query);
    if (typeof query !== "string" && query.text.includes("SET lease_token=")) claimed = true;
    if (query === "COMMIT" && claimed && !superseded) {
      superseded = true;
      await db.query(
        "UPDATE readmax.sync_delivery_receipt SET lease_token='00000000-0000-4000-8000-000000000098',decision_version=decision_version+1",
      );
    }
    return result;
  });
  await processDeliveries(USER);
  expect((await db.query("SELECT * FROM readmax.notebook")).rows).toEqual([]);
  expect((await receipts())[0]).toMatchObject({ state: "received", decision_version: 1 });
  mocks.query.mockImplementation(execute);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
  await processDeliveries(USER);
  expect((await receipts())[0].state).toBe("applied");
});
it("a second worker invocation materializes no payload while the worker lock is held", async () => {
  await receiveBatch(USER, [mutation("notebook")]);
  const execute = mocks.query.getMockImplementation()!;
  mocks.query.mockImplementation((query) =>
    typeof query !== "string" && query.text.includes("pg_try_advisory_lock")
      ? Promise.resolve({ rows: [{ locked: false }] })
      : execute(query),
  );
  expect(await processDeliveries()).toBe(0);
  expect((await receipts())[0].attempts).toBe(0);
  expect((await db.query("SELECT * FROM readmax.notebook")).rows).toEqual([]);
});
it("canonical effects and alias events roll back when receipt decision persistence fails", async () => {
  await send([{ ...mutation("book"), entityId: "canonical", data: { fileHash: "shared" } }]);
  const execute = mocks.query.getMockImplementation()!;
  mocks.query.mockImplementation((query) => {
    if (typeof query !== "string" && query.text.includes("SET state="))
      throw new Error("decision unavailable");
    return execute(query);
  });
  const result = await send([
    { ...mutation("book"), id: "loser", entityId: "loser", data: { fileHash: "shared" } },
  ]);
  expect(result.body.accepted).toEqual([]);
  expect((await db.query("SELECT id FROM readmax.book ORDER BY id")).rows).toEqual([
    { id: "canonical" },
  ]);
  expect((await db.query("SELECT * FROM readmax.sync_alias_event")).rows).toEqual([]);
  expect((await receipts()).find((row) => row.change_id === "loser")).toMatchObject({
    state: "received",
  });
});
it("alias enumeration refuses foreign target evidence without returning it to the caller", async () => {
  await db.query("INSERT INTO readmax.book(id,user_id) VALUES('foreign',$1)", [OTHER_USER]);
  await db.query("INSERT INTO readmax.book(id,user_id,canonical_id) VALUES('owned',$1,'foreign')", [
    USER,
  ]);
  await expect(listBookAliases(USER, null)).rejects.toThrow("unavailable");
});
it("successful version-checked recovery edit links new custody and retains the original invalid source", async () => {
  await send([{ ...mutation("notebook"), timestamp: null }]);
  const id = String((await receipts())[0].receipt_id);
  const detail = (await getRecovery(USER, id))!;
  await resolveRecovery(USER, id, {
    resolutionId: "edit",
    expectedDecisionVersion: detail.decisionVersion,
    expectedCanonicalVersion: detail.canonicalVersion,
    action: "submit_edit",
    newMutation: { ...mutation("notebook", 1), timestamp: Date.now() },
  });
  const original = (await getRecovery(USER, id))!;
  expect(original.state).toBe("resolved");
  expect(original.sourceClock).toBeNull();
  expect(await receipts()).toHaveLength(2);
});
it("submit edit cannot use the original receipt precondition to overwrite an unrelated target", async () => {
  await send([{ ...mutation("notebook"), timestamp: null }]);
  const id = String((await receipts())[0].receipt_id);
  const detail = (await getRecovery(USER, id))!;
  await expect(
    resolveRecovery(USER, id, {
      resolutionId: "other-target",
      expectedDecisionVersion: detail.decisionVersion,
      expectedCanonicalVersion: detail.canonicalVersion,
      action: "submit_edit",
      newMutation: {
        ...mutation("notebook", 1),
        entityId: "other",
        data: { bookId: "other", content: {} },
        timestamp: Date.now(),
      },
    }),
  ).rejects.toBeInstanceOf(RecoveryConflict);
  expect((await db.query("SELECT * FROM readmax.notebook")).rows).toEqual([]);
  expect(await receipts()).toHaveLength(1);
});
it("restore copy cannot overwrite an existing canonical record through a different alias ID", async () => {
  await send([{ ...mutation("book"), data: { fileHash: "same" } }]);
  await send([{ ...mutation("book"), id: "alias", entityId: "alias", data: { fileHash: "same" } }]);
  await send([{ ...mutation("book"), id: "conflict", timestamp: null }]);
  const id = String((await receipts()).find((row) => row.change_id === "conflict")!.receipt_id);
  const detail = (await getRecovery(USER, id))!;
  await expect(
    resolveRecovery(USER, id, {
      resolutionId: "copy",
      expectedDecisionVersion: detail.decisionVersion,
      expectedCanonicalVersion: detail.canonicalVersion,
      action: "restore_copy",
      newMutation: {
        ...mutation("book", 1),
        entityId: "alias",
        data: { title: "overwrite" },
        timestamp: Date.now(),
      },
    }),
  ).rejects.toBeInstanceOf(RecoveryConflict);
});
it("independent scheduler health reports missing and stalled ticks without processing receipts", async () => {
  const { loader } = await import("../api.cron.sync-delivery-health");
  vi.stubEnv("CRON_SECRET", "health-secret");
  const request = new Request("https://test/api/cron/sync-delivery-health", {
    headers: { Authorization: "Bearer health-secret" },
  });
  expect((await loader({ request })).status).toBe(503);
  await cron({ request });
  expect((await loader({ request })).status).toBe(200);
  await db.query(
    "UPDATE readmax.sync_delivery_scheduler SET last_success=NOW()-INTERVAL '6 minutes'",
  );
  expect((await loader({ request })).status).toBe(503);
});
