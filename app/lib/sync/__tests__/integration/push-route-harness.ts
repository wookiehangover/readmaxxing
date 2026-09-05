// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { SQLQuery } from "pg-sql";
import { beforeAll, afterAll, beforeEach, afterEach, expect, vi } from "vitest";
import { clear } from "idb-keyval";
import { getChangeLogStore } from "../../stores";
import type { ChangeEntry, EntityType, SyncPushResponse, SyncPullResponse } from "../../types";

const hoisted = vi.hoisted(() => ({ query: vi.fn() }));
export const mocks = hoisted;
vi.mock("~/lib/database/pool", () => ({
  getPool: () => ({
    query: hoisted.query,
    connect: async () => ({ query: hoisted.query, release: () => {} }),
  }),
}));
vi.mock("~/lib/database/auth-middleware", () => ({
  requireAuth: async () => ({ userId: "00000000-0000-4000-8000-000000000001" }),
}));
vi.mock("~/lib/database/user/user", () => ({ upsertUser: async () => {} }));
vi.mock("../../file-uploads", () => ({ uploadPendingFiles: async () => {} }));
import { action } from "~/routes/api.sync.push";
import { loader } from "~/routes/api.sync.pull";

export const USER = "00000000-0000-4000-8000-000000000001";
export const OTHER_USER = "00000000-0000-4000-8000-000000000002";
export const BASE = Date.now() - 60_000;
export const ENTITIES = [
  "book",
  "highlight",
  "bookmark",
  "chat_session",
  "notebook",
  "position",
  "settings",
] as const;
export const DELETABLE = ["book", "highlight", "bookmark", "chat_session"] as const;
export const TABLES = {
  book: "book",
  highlight: "highlight",
  bookmark: "bookmark",
  chat_session: "chat_session",
  notebook: "notebook",
  position: "reading_position",
  settings: "user_settings",
};
export let db: PGlite;

export function mutation(entity: EntityType, version = 0): ChangeEntry {
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
export const failing = {
  ...mutation("notebook"),
  id: "failed",
  entityId: "failure-book",
  data: { bookId: "failure-book", content: {} },
};
export async function push(changes: ChangeEntry[], capable = false) {
  const response = await action({
    request: new Request("https://test/api/sync/push", {
      method: "POST",
      body: JSON.stringify({ changes, ...(capable ? { supportsRetryableRejections: true } : {}) }),
    }),
  });
  return { status: response.status, body: (await response.json()) as SyncPushResponse };
}
export async function row(entity: (typeof ENTITIES)[number]) {
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
export function failNotebookOnce() {
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
export const ctx = () => ({
  fileUploadContext: { userId: USER, uploadRetryState: new Map() },
  isStopped: () => false,
  scheduleFollowUpPush: vi.fn(),
});
export function routeFetch() {
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) =>
    action({ request: new Request("https://test/api/sync/push", init) }),
  );
}
export async function pull(entity: EntityType, cursor?: string) {
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
