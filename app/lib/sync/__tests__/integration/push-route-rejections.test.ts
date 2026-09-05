// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import type { SQLQuery } from "pg-sql";
import { clear, entries } from "idb-keyval";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getUnsyncedChanges, recordChange, markSynced, clearSyncedChanges } from "../../change-log";
import { pushChangesWithResult } from "../../push";
import { getChangeLogStore } from "../../stores";
import type { ChangeEntry, SyncPushRequest } from "../../types";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  auth: vi.fn(),
  highlight: vi.fn(),
  bookmark: vi.fn(),
  position: vi.fn(),
}));
vi.mock("~/lib/database/pool", () => ({ getPool: () => ({ query: mocks.query }) }));
vi.mock("~/lib/database/auth-middleware", () => ({ requireAuth: mocks.auth }));
vi.mock("~/lib/database/book/book", () => ({
  upsertBook: vi.fn(),
  softDeleteBook: vi.fn(),
  findBookByUserAndHash: vi.fn(),
  insertTombstonedBook: vi.fn(),
  getBookByIdForUser: vi.fn(),
  updateBookBlobUrls: vi.fn(),
}));
vi.mock("~/lib/database/annotation/highlight", () => ({
  upsertHighlight: mocks.highlight,
  softDeleteHighlight: vi.fn(),
}));
vi.mock("~/lib/database/bookmark/bookmark", () => ({
  upsertBookmark: mocks.bookmark,
  softDeleteBookmark: vi.fn(),
}));
vi.mock("~/lib/database/book/reading-position", () => ({ upsertPosition: mocks.position }));
vi.mock("~/lib/database/chat/chat-session", () => ({
  upsertSession: vi.fn(),
  softDeleteSession: vi.fn(),
}));
vi.mock("~/lib/database/settings/user-settings", () => ({ upsertSettings: vi.fn() }));
vi.mock("~/lib/database/user/user", () => ({ upsertUser: vi.fn() }));
vi.mock("../../file-uploads", () => ({ uploadPendingFiles: vi.fn(async () => undefined) }));
import { action, processEntry } from "~/routes/api.sync.push";

let db: PGlite;
let now: number;
const ctx = () => ({
  fileUploadContext: { userId: "user", uploadRetryState: new Map() },
  isStopped: () => false,
  scheduleFollowUpPush: vi.fn(),
});
const queue = (bookId: string, entity: ChangeEntry["entity"] = "notebook") =>
  recordChange({
    entity,
    entityId: bookId,
    operation: "put",
    timestamp: now,
    data: {
      bookId,
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: bookId }] }],
      },
    },
  });
function request(body: SyncPushRequest) {
  return new Request("https://test/api/sync/push", { method: "POST", body: JSON.stringify(body) });
}
function routeFetch() {
  const responses: Response[] = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const response = await action({ request: request(JSON.parse(init!.body as string)) });
    responses.push(response.clone());
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, responses };
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE SCHEMA readmax;
    CREATE TABLE readmax.notebook (
      user_id text, book_id text, content jsonb, updated_at timestamptz, mutation_at timestamptz,
      PRIMARY KEY (user_id, book_id)
    );`);
}, 30_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await clear(getChangeLogStore());
  await db.exec("TRUNCATE readmax.notebook");
  vi.resetAllMocks();
  vi.stubEnv("DATABASE_URL", "postgres://unused");
  mocks.auth.mockResolvedValue({ userId: "user" });
  mocks.query.mockImplementation((query: SQLQuery) => db.query(query.text, query.values));
  now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sync route to durable outbox", () => {
  it.each(["notebook", "highlight", "bookmark", "position"] as const)(
    "retains a transient %s DAL rejection and accepts it after reload/recovery",
    async (entity) => {
      const change = await queue("failed-book", entity);
      now += 1;
      const healthy = await queue("healthy-book");
      const dal = entity === "notebook" ? mocks.query : mocks[entity];
      dal.mockRejectedValueOnce(new Error("connection terminated unexpectedly"));
      const { fetchMock, responses } = routeFetch();
      await expect(pushChangesWithResult(ctx())).rejects.toThrow("Push incomplete");
      expect(responses[0].status).toBe(200);
      expect(await responses[0].json()).toMatchObject({
        accepted: [{ id: healthy.id }],
        rejected: [{ id: change.id, retryable: true }],
      });
      expect(await getUnsyncedChanges()).toEqual([
        expect.objectContaining({
          ...change,
          failure: expect.objectContaining({
            reason: "connection terminated unexpectedly",
            retryable: true,
          }),
        }),
      ]);
      expect(await db.query("SELECT book_id FROM readmax.notebook")).toMatchObject({
        rows: [{ book_id: "healthy-book" }],
      });
      // Recreate module state without clearing fake-IDB, as on page reload.
      vi.resetModules();
      const { pushChangesWithResult: reloadedPush } = await import("../../push");
      const [retained] = await getUnsyncedChanges();
      await expect(reloadedPush(ctx())).rejects.toThrow("Push incomplete");
      expect(fetchMock).toHaveBeenCalledOnce();
      now = retained.failure!.nextAttemptAt!;
      await reloadedPush(ctx());
      expect(await entries(getChangeLogStore())).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      if (entity === "notebook") {
        const rows = await db.query<{ content: unknown }>(
          "SELECT content FROM readmax.notebook WHERE book_id = 'failed-book'",
        );
        expect(rows.rows[0].content).toEqual((change.data as { content: unknown }).content);
      }
    },
  );

  it("returns 503 to legacy clients after partial success; replay is idempotent and preserves newer notebook content", async () => {
    const failed = await queue("fails-once");
    const accepted = await queue("accepted-first-time");
    mocks.query.mockRejectedValueOnce(new Error("temporary database failure"));
    const legacyBody = { changes: [failed, accepted] };
    const first = await action({ request: request(legacyBody) });
    expect(first.status).toBe(503);
    // This is the old client's destructive 2xx handling. On 503 it must not run.
    if (first.ok) {
      const result = await first.json();
      await markSynced(
        [...result.accepted, ...result.rejected].map((entry: { id: string }) => entry.id),
      );
      await clearSyncedChanges();
    }
    expect(await getUnsyncedChanges()).toHaveLength(2);
    const saved = (await db.query("SELECT * FROM readmax.notebook")).rows;
    expect(saved).toHaveLength(1);
    const replay = await action({ request: request(legacyBody) });
    expect(replay.status).toBe(200);
    expect((await replay.json()).rejected).toEqual([]);
    expect(
      (await db.query("SELECT * FROM readmax.notebook WHERE book_id = 'accepted-first-time'")).rows,
    ).toEqual(saved);
    const newer = {
      ...accepted,
      id: "new-edit",
      timestamp: now + 1,
      data: { bookId: accepted.entityId, content: { type: "doc", content: [] } },
    };
    await action({ request: request({ changes: [newer] }) });
    await action({ request: request(legacyBody) });
    expect(
      (await db.query("SELECT content FROM readmax.notebook WHERE book_id = 'accepted-first-time'"))
        .rows,
    ).toEqual([{ content: { type: "doc", content: [] } }]);
    expect((await db.query("SELECT * FROM readmax.notebook")).rows).toHaveLength(2);
  });

  it.each([true, undefined])(
    "classifies explicitly unsupported mutations as permanent (capability=%s)",
    async (supportsRetryableRejections) => {
      const change = await queue("message", "chat_message");
      const response = await action({
        request: request({ changes: [change], supportsRetryableRejections }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        accepted: [],
        rejected: [{ id: change.id, retryable: false }],
      });
      expect(mocks.query).not.toHaveBeenCalled();
    },
  );

  it("retains an explicit permanent route rejection with diagnostic data", async () => {
    const change = await queue("unsupported", "chat_message");
    routeFetch();
    await expect(pushChangesWithResult(ctx())).rejects.toThrow("not accepted");
    expect(await getUnsyncedChanges()).toEqual([
      expect.objectContaining({
        ...change,
        failure: expect.objectContaining({ retryable: false, attempts: 1 }),
      }),
    ]);
  });

  it("classifies invalid operation/data without calling a DAL", async () => {
    const change = await queue("invalid");
    expect(await processEntry("user", { ...change, operation: "invalid" as "put" })).toMatchObject({
      accepted: false,
      retryable: false,
    });
    expect(await processEntry("user", { ...change, data: null })).toMatchObject({
      accepted: false,
      retryable: false,
    });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

it.each([true, undefined])(
  "treats unknown DAL exceptions as retryable for an all-rejected batch (capability=%s)",
  async (supportsRetryableRejections) => {
    const change = await queue("unknown-failure");
    mocks.query.mockRejectedValueOnce(null);
    const response = await action({
      request: request({ changes: [change], supportsRetryableRejections }),
    });
    expect(response.status).toBe(supportsRetryableRejections ? 200 : 503);
    expect(await response.json()).toMatchObject({
      accepted: [],
      rejected: [{ id: change.id, reason: "Internal error", retryable: true }],
    });
  },
);
