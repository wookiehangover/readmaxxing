// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { SQLQuery } from "pg-sql";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect, vi } from "vitest";
import { clear } from "idb-keyval";
import { getChangeLogStore } from "../../stores";
import { recordChange, getUnsyncedChanges } from "../../change-log";
import { pushChangesWithResult } from "../../push";
import type { ChangeEntry, EntityType, SyncPushResponse, SyncPullResponse } from "../../types";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("~/lib/database/pool", () => ({
  getPool: () => ({
    query: mocks.query,
    connect: async () => ({ query: mocks.query, release: () => {} }),
  }),
}));
vi.mock("~/lib/database/auth-middleware", () => ({
  requireAuth: async () => ({ userId: "00000000-0000-4000-8000-000000000001" }),
}));
vi.mock("~/lib/database/user/user", () => ({ upsertUser: async () => {} }));
vi.mock("../../file-uploads", () => ({ uploadPendingFiles: async () => {} }));
import { action } from "~/routes/api.sync.push";
import { loader } from "~/routes/api.sync.pull";

const USER = "00000000-0000-4000-8000-000000000001";
const OTHER_USER = "00000000-0000-4000-8000-000000000002";
const BASE = Date.now() - 60_000;
const ENTITIES = [
  "book",
  "highlight",
  "bookmark",
  "chat_session",
  "notebook",
  "position",
  "settings",
] as const;
const DELETABLE = ["book", "highlight", "bookmark", "chat_session"] as const;
const TABLES = {
  book: "book",
  highlight: "highlight",
  bookmark: "bookmark",
  chat_session: "chat_session",
  notebook: "notebook",
  position: "reading_position",
  settings: "user_settings",
};
let db: PGlite;

function mutation(entity: EntityType, version = 0): ChangeEntry {
  return {
    id: `change-${entity}-${version}`,
    entity,
    entityId: "entity",
    operation: "put",
    synced: false,
    timestamp: BASE + version * 1000,
    data:
      entity === "settings"
        ? { theme: version ? "dark" : "light" }
        : {
            bookId: "entity",
            text: version ? "new" : "old",
            title: version ? "new" : "old",
            label: version ? "new" : "old",
            createdAt: BASE,
            content: { type: "doc", content: [{ type: "text", text: version ? "new" : "old" }] },
            cfi: version ? "page:20" : "page:12",
            remoteFileUrl: `https://blob.test/${version}.epub`,
          },
  };
}
const failing = {
  ...mutation("notebook"),
  id: "failed",
  entityId: "failure-book",
  data: { bookId: "failure-book", content: {} },
};
async function push(changes: ChangeEntry[], capable = false) {
  const response = await action({
    request: new Request("https://test/api/sync/push", {
      method: "POST",
      body: JSON.stringify({ changes, ...(capable ? { supportsRetryableRejections: true } : {}) }),
    }),
  });
  return { status: response.status, body: (await response.json()) as SyncPushResponse };
}
async function row(entity: (typeof ENTITIES)[number]) {
  const key =
    entity === "settings"
      ? "user_id"
      : entity === "notebook" || entity === "position"
        ? "book_id"
        : "id";
  return (
    await db.query<Record<string, unknown>>(
      `SELECT * FROM readmax.${TABLES[entity]} WHERE ${key} = $1`,
      [entity === "settings" ? USER : "entity"],
    )
  ).rows[0];
}
async function execute(query: SQLQuery | string) {
  // PGlite is single-connection here; advisory-lock scheduling is covered by the DAL unit tests.
  if (typeof query !== "string" && query.text.includes("pg_advisory_xact_lock"))
    return { rows: [], rowCount: 1 };
  const result =
    typeof query === "string" ? await db.query(query) : await db.query(query.text, query.values);
  return { ...result, rowCount: result.affectedRows ?? result.rows.length };
}
function failNotebookOnce() {
  let fail = true;
  mocks.query.mockImplementation((query: SQLQuery | string) => {
    if (
      fail &&
      typeof query !== "string" &&
      query.text.includes("INSERT INTO readmax.notebook") &&
      query.values.includes("failure-book")
    ) {
      fail = false;
      throw new Error("temporary outage");
    }
    return execute(query);
  });
}
const ctx = () => ({
  fileUploadContext: { userId: USER, uploadRetryState: new Map() },
  isStopped: () => false,
  scheduleFollowUpPush: vi.fn(),
});
function routeFetch() {
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) =>
    action({ request: new Request("https://test/api/sync/push", init) }),
  );
}
async function pull(entity: EntityType, cursor?: string) {
  const url = new URL("https://test/api/sync/pull");
  url.searchParams.set("entityType", entity);
  if (cursor) url.searchParams.set("cursors", JSON.stringify([{ entityType: entity, cursor }]));
  const response = await loader({ request: new Request(url) });
  expect(response.status).toBe(200);
  return (await response.json()) as SyncPullResponse;
}

beforeAll(async () => {
  db = new PGlite();
  for (const path of [
    "database/readmax/core.sql",
    "database/readmax/annotations.sql",
    "database/readmax/chat.sql",
    "database/readmax/settings.sql",
    "database/migrations/008-bookmarks.sql",
    "database/migrations/009-bookmark-display-page.sql",
    "database/migrations/021-sync-mutation-ordering.sql",
  ]) {
    await db.exec(await readFile(path, "utf8"));
  }
  await db.query("INSERT INTO readmax.user (id) VALUES ($1)", [USER]);
  await db.query("INSERT INTO readmax.user (id) VALUES ($1)", [OTHER_USER]);
}, 30_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec(
    "TRUNCATE readmax.book, readmax.highlight, readmax.bookmark, readmax.chat_session, readmax.notebook, readmax.reading_position, readmax.user_settings CASCADE",
  );
  await clear(getChangeLogStore());
  vi.stubEnv("DATABASE_URL", "postgres://unused");
  mocks.query.mockReset().mockImplementation(execute);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each(ENTITIES)(
  "legacy partial-success replay preserves newer %s content and its cursor",
  async (entity) => {
    failNotebookOnce();
    const original = mutation(entity);
    const first = await push([original, failing]);
    expect(first.status).toBe(503);
    expect(first.body.accepted).toContainEqual({ id: original.id });
    expect((await push([mutation(entity, 1)])).status).toBe(200);
    const newer = await row(entity);
    expect(newer.mutation_at).toEqual(new Date(BASE + 1000));
    const expectedContent = {
      book: { title: "new", file_blob_url: "https://blob.test/1.epub" },
      highlight: { text: "new" },
      bookmark: { label: "new" },
      chat_session: { title: "new" },
      notebook: { content: { content: [{ text: "new" }] } },
      position: { cfi: "page:20" },
      settings: { settings: { theme: "dark" } },
    };
    expect(newer).toMatchObject(expectedContent[entity]);
    expect((await push([original, failing])).status).toBe(200);
    expect(await row(entity)).toEqual(newer);
  },
);

it.each(DELETABLE)(
  "legacy partial-success replay preserves a newer %s deletion",
  async (entity) => {
    failNotebookOnce();
    const original = mutation(entity);
    expect((await push([original, failing])).status).toBe(503);
    expect((await push([{ ...mutation(entity, 1), operation: "delete" }])).status).toBe(200);
    const tombstone = await row(entity);
    expect(tombstone.deleted_at).not.toBeNull();
    await push([original, failing]);
    expect(await row(entity)).toEqual(tombstone);
  },
);

it.each(DELETABLE)("replayed %s deletes cannot undo newer restores", async (entity) => {
  await push([mutation(entity)]);
  const deleted = { ...mutation(entity, 1), operation: "delete" as const, data: null };
  await push([deleted]);
  await push([mutation(entity, 2)]);
  const restored = await row(entity);
  expect(restored.deleted_at).toBeNull();
  await push([deleted]);
  expect(await row(entity)).toEqual(restored);
});

it.each(DELETABLE)("%s snapshot mutations preserve the existing owner's row", async (entity) => {
  await push([mutation(entity)]);
  await db.query(`UPDATE readmax.${TABLES[entity]} SET user_id = $1`, [OTHER_USER]);
  const owned = await row(entity);
  await push([mutation(entity, 1)]);
  expect(await row(entity)).toEqual(owned);
  await push([{ ...mutation(entity, 2), operation: "delete" }]);
  expect(await row(entity)).toEqual(owned);
  await push([{ ...mutation(entity, 3), operation: "delete", data: null }]);
  expect(await row(entity)).toEqual(owned);
});

it.each(DELETABLE)(
  "a %s delete snapshot persists before its older create arrives",
  async (entity) => {
    await push([{ ...mutation(entity, 1), operation: "delete" }]);
    const tombstone = await row(entity);
    expect(tombstone.deleted_at).not.toBeNull();
    await push([mutation(entity)]);
    expect(await row(entity)).toEqual(tombstone);
    await push([mutation(entity, 2)]);
    expect((await row(entity)).deleted_at).toBeNull();
  },
);

it.each(DELETABLE)(
  "%s tombstones win timestamp ties; a later restore still works",
  async (entity) => {
    await push([mutation(entity)]);
    await push([{ ...mutation(entity), operation: "delete" }]);
    const tombstone = await row(entity);
    expect(tombstone.deleted_at).not.toBeNull();
    await push([mutation(entity)]);
    expect(await row(entity)).toEqual(tombstone);
    await push([mutation(entity, 1)]);
    expect((await row(entity)).deleted_at).toBeNull();
  },
);

it.each(["highlight", "chat_session"] as const)(
  "retained %s retry cannot overwrite a healthy newer edit",
  async (entity) => {
    const { id: _id, synced: _synced, ...input } = mutation(entity);
    const change = await recordChange(input);
    mocks.query.mockRejectedValueOnce(new Error("temporary outage"));
    routeFetch();
    await expect(pushChangesWithResult(ctx())).rejects.toThrow("Push incomplete");
    const { id: _newId, synced: _newSynced, ...newer } = mutation(entity, 1);
    await recordChange(newer);
    await expect(pushChangesWithResult(ctx())).rejects.toThrow("Push incomplete");
    const saved = await row(entity);
    expect(saved).toMatchObject(entity === "highlight" ? { text: "new" } : { title: "new" });
    const [retained] = await getUnsyncedChanges();
    expect(retained.id).toBe(change.id);
    vi.spyOn(Date, "now").mockReturnValue(retained.failure!.nextAttemptAt!);
    await pushChangesWithResult(ctx());
    expect(await getUnsyncedChanges()).toEqual([]);
    expect(await row(entity)).toEqual(saved);
  },
);

it.each(DELETABLE)("retained %s retry cannot undo a healthy newer deletion", async (entity) => {
  const { id: _id, synced: _synced, ...input } = mutation(entity);
  const change = await recordChange(input);
  mocks.query.mockRejectedValueOnce(new Error("temporary outage"));
  routeFetch();
  await expect(pushChangesWithResult(ctx())).rejects.toThrow("Push incomplete");
  await recordChange({ ...input, operation: "delete", timestamp: BASE + 1000 });
  await expect(pushChangesWithResult(ctx())).rejects.toThrow("Push incomplete");
  const tombstone = await row(entity);
  expect(tombstone.deleted_at).not.toBeNull();
  const [retained] = await getUnsyncedChanges();
  expect(retained.id).toBe(change.id);
  vi.spyOn(Date, "now").mockReturnValue(retained.failure!.nextAttemptAt!);
  await pushChangesWithResult(ctx());
  expect(await getUnsyncedChanges()).toEqual([]);
  expect(await row(entity)).toEqual(tombstone);
});

it.each(ENTITIES)(
  "legacy %s rows retain their ordering when migration is applied",
  async (entity) => {
    await push([mutation(entity)]);
    await db.exec(`ALTER TABLE readmax.${TABLES[entity]} DROP COLUMN mutation_at`);
    await db.query(`UPDATE readmax.${TABLES[entity]} SET updated_at = $1`, [new Date(BASE)]);
    const migration = await readFile("database/migrations/021-sync-mutation-ordering.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);
    const legacy = await row(entity);
    expect(legacy.mutation_at).toBeNull();
    const older = mutation(entity, -1);
    older.data = mutation(entity).data;
    await push([older]);
    expect(await row(entity)).toEqual(legacy);
    await push([mutation(entity, 1)]);
    expect((await row(entity)).mutation_at).toEqual(new Date(BASE + 1000));
  },
);

it.each(["highlight", "bookmark"] as const)(
  "legacy absent %s deletes remain retryable until a target exists",
  async (entity) => {
    const deletion = { ...mutation(entity, 1), data: null, operation: "delete" as const };
    const result = await push([deletion], true);
    expect(result.body.accepted).toEqual([]);
    expect(result.body.rejected).toMatchObject([{ id: deletion.id, retryable: true }]);
    await push([mutation(entity)]);
    expect((await push([deletion])).status).toBe(200);
    expect((await row(entity)).deleted_at).not.toBeNull();
  },
);

it.each(["book", "chat_session"] as const)(
  "legacy absent %s deletes persist without a snapshot",
  async (entity) => {
    await push([{ ...mutation(entity, 1), data: null, operation: "delete" }]);
    const tombstone = await row(entity);
    expect(tombstone.deleted_at).not.toBeNull();
    await push([mutation(entity)]);
    expect(await row(entity)).toEqual(tombstone);
  },
);

it.each(ENTITIES)(
  "a delayed %s update is visible after the prior pull cursor without changing its original clock",
  async (entity) => {
    await push([mutation(entity)]);
    const initial = await pull(entity);
    expect(initial.changes).toHaveLength(1);
    const cursor = initial.changes[0].cursor;
    await push([mutation(entity, 1)]);
    const delta = await pull(entity, cursor);
    expect(delta.changes).toHaveLength(1);
    expect(delta.changes[0].records).toHaveLength(1);
    expect(delta.changes[0].records[0]).toMatchObject({
      updatedAt: new Date(BASE + 1000).toISOString(),
    });
    expect((await pull(entity, delta.changes[0].cursor)).changes).toEqual([]);
  },
);

it("rejects invalid future mutation clocks without poisoning the durable ordering clock", async () => {
  const bad = { ...mutation("highlight"), timestamp: Date.now() + 3_600_000 };
  const result = await push([bad], true);
  expect(result.body.rejected).toMatchObject([{ id: bad.id, retryable: false }]);
  expect(await row("highlight")).toBeUndefined();
});
