// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clear, get, set, type UseStore } from "idb-keyval";
import type { SQLQuery } from "pg-sql";
import { BASE, USER, db, mocks, push, routeFetch, ctx } from "./push-route-harness";
import { makeAnnotationService } from "~/lib/stores/annotations-store";
import { action } from "~/routes/api.sync.push";
import { loader } from "~/routes/api.sync.pull";
import { pushChangesWithResult } from "../../push";
import { pullChanges } from "../../pull";
import { getUnsyncedChanges } from "../../change-log";
import { getBookRemaps } from "../../remap-journal";
import { clearAllCursors } from "../../sync-cursors";
import * as stores from "../../stores";
import type { ChangeEntry } from "../../types";

const book = (id: string, timestamp = BASE): ChangeEntry => ({
  id: `root-${id}-${timestamp}`,
  entity: "book",
  entityId: id,
  operation: "put",
  synced: false,
  timestamp,
  data: { id, title: `${id} title`, fileHash: "same-book", format: "epub" },
});
const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

async function clearLocalReader() {
  await Promise.all(Object.values(stores).map((getter) => clear(getter())));
  await clearAllCursors();
}
beforeEach(clearLocalReader);

async function queue(change: ChangeEntry) {
  await set(change.id, change, stores.getChangeLogStore());
}

function connectedFetch() {
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const request = new Request(new URL(url, "https://test"), init);
    return url.startsWith("/api/sync/pull") ? loader({ request }) : action({ request });
  });
}

describe("connected remap, retry, notebook and fresh pull", () => {
  it("delivers same-batch annotations and a newer notebook despite a transient remapped rejection", async () => {
    expect((await push([book("canonical")], true)).body.rejected).toEqual([]);
    const root = { ...book("local", BASE + 100), id: "000-root" };
    await queue(root);
    await set(
      "local",
      { ...(root.data as object), updatedAt: root.timestamp },
      stores.getBookStore(),
    );
    const annotation = makeAnnotationService({
      highlightStore: stores.getHighlightStore(),
      notebookStore: stores.getNotebookStore(),
    });
    await annotation.saveNotebook({
      bookId: "local",
      content: doc("pending notebook"),
      updatedAt: BASE + 200,
    });
    const dependents: Array<[ChangeEntry["entity"], string, Record<string, unknown>, UseStore]> = [
      [
        "highlight",
        "highlight",
        {
          id: "highlight",
          bookId: "local",
          text: "highlight",
          color: "yellow",
          cfiRange: "range",
          createdAt: BASE,
          updatedAt: BASE + 200,
        },
        stores.getHighlightStore(),
      ],
      [
        "bookmark",
        "bookmark:local:page:12",
        {
          id: "bookmark:local:page:12",
          bookId: "local",
          pageNumber: 12,
          label: "bookmark",
          createdAt: BASE,
          updatedAt: BASE + 200,
        },
        stores.getBookmarkStore(),
      ],
      ["position", "local", { cfi: "page:12", updatedAt: BASE + 200 }, stores.getPositionStore()],
    ];
    for (const [entity, entityId, data, store] of dependents) {
      await set(entityId, data, store);
      await queue({
        id: `001-${entity}`,
        entity,
        entityId,
        data,
        timestamp: BASE + 200,
        operation: "put",
        synced: false,
      });
    }
    const session = {
      id: "session",
      bookId: "local",
      title: "Session",
      createdAt: BASE,
      updatedAt: BASE + 200,
      messages: [{ id: "cached", content: "server-authored cached message", createdAt: BASE }],
    };
    await set("local", [session], stores.getChatSessionStore());
    await queue({
      id: "001-session",
      entity: "chat_session",
      entityId: session.id,
      data: session,
      timestamp: BASE + 200,
      operation: "put",
      synced: false,
    });
    await vi.waitFor(async () => expect(await getUnsyncedChanges()).toHaveLength(6));
    const execute = mocks.query.getMockImplementation()!;
    let failed = false;
    mocks.query.mockImplementation((query: SQLQuery | string) => {
      if (
        !failed &&
        typeof query !== "string" &&
        query.text.includes("INSERT INTO readmax.notebook") &&
        query.values.includes("canonical")
      ) {
        failed = true;
        throw new Error("temporary notebook outage");
      }
      return execute(query);
    });
    connectedFetch();
    await expect(pushChangesWithResult(ctx())).rejects.toThrow("retained");
    expect(failed).toBe(true);
    expect((await getUnsyncedChanges()).some((change) => change.entity === "chat_message")).toBe(
      false,
    );
    expect(await get("canonical", stores.getChatSessionStore())).toMatchObject([
      { id: "session", messages: [{ id: "cached" }] },
    ]);
    const rejected = (await getUnsyncedChanges()).find((change) => change.entity === "notebook")!;
    expect(rejected).toMatchObject({
      entityId: "canonical",
      timestamp: BASE + 200,
      failure: { retryable: true },
    });
    expect((await db.query("SELECT * FROM readmax.notebook")).rows).toEqual([]);
    expect((await db.query("SELECT book_id FROM readmax.highlight")).rows).toEqual([
      { book_id: "canonical" },
    ]);

    // A still-mounted producer saves with the old ID while the first snapshot
    // is deferred. Recovery must not promote that older failed snapshot.
    await annotation.saveNotebook({
      bookId: "local",
      content: doc("newer notebook"),
      updatedAt: BASE + 500,
    });
    await vi.waitFor(async () =>
      expect((await getUnsyncedChanges()).some((change) => change.timestamp === BASE + 500)).toBe(
        true,
      ),
    );
    await expect(pushChangesWithResult(ctx())).rejects.toThrow("retained");
    expect(await getUnsyncedChanges()).toEqual([
      expect.objectContaining({ id: rejected.id, timestamp: BASE + 200 }),
    ]);
    vi.spyOn(Date, "now").mockReturnValue(rejected.failure!.nextAttemptAt! + 1000);
    await pushChangesWithResult(ctx());
    expect(await getUnsyncedChanges()).toEqual([]);
    const persisted = (
      await db.query<{ book_id: string; content: unknown; mutation_at: Date }>(
        "SELECT book_id, content, mutation_at FROM readmax.notebook",
      )
    ).rows;
    expect(persisted).toEqual([
      { book_id: "canonical", content: doc("newer notebook"), mutation_at: new Date(BASE + 500) },
    ]);
    expect(await getBookRemaps(USER)).toMatchObject([
      { fromId: "local", toId: "canonical", complete: true },
    ]);

    // A clean reader runs the actual pull route and client mergers, without
    // access to the writer's local alias journal or surviving entity copies.
    await clearLocalReader();
    await pullChanges({ userId: USER, isStopped: () => false });
    expect(await get("local", stores.getNotebookStore())).toBeUndefined();
    expect(await get("canonical", stores.getNotebookStore())).toMatchObject({
      bookId: "canonical",
      content: doc("newer notebook"),
      updatedAt: BASE + 500,
    });
    expect(await get("highlight", stores.getHighlightStore())).toMatchObject({
      bookId: "canonical",
      text: "highlight",
    });
    expect(await get("bookmark:canonical:page:12", stores.getBookmarkStore())).toMatchObject({
      bookId: "canonical",
      label: "bookmark",
    });
    expect(await get("canonical", stores.getRemotePositionStore())).toMatchObject({
      cfi: "page:12",
    });
  });

  it("retries a root alias after lost ACK without changing deleted canonical metadata, then allows direct canonical edits", async () => {
    await push([book("canonical")], true);
    const root = book("local", BASE + 1000);
    await queue(root);
    routeFetch();
    const journalStore = stores.getBookRemapStore();
    let interrupted = false;
    const crashingJournal: UseStore = async (mode, callback) => {
      const result = await journalStore(mode, callback);
      if (mode === "readwrite" && !interrupted) {
        interrupted = true;
        throw new Error("lost root ACK");
      }
      return result;
    };
    vi.spyOn(stores, "getBookRemapStore").mockReturnValue(crashingJournal);
    await expect(pushChangesWithResult(ctx())).rejects.toThrow("lost root ACK");
    expect(await getUnsyncedChanges()).toEqual([root]);
    vi.mocked(stores.getBookRemapStore).mockRestore();
    await push([{ ...book("canonical", BASE + 2000), operation: "delete" }], true);
    const before = (
      await db.query(
        "SELECT title, deleted_at, mutation_at FROM readmax.book WHERE id = 'canonical'",
      )
    ).rows[0];
    vi.resetModules();
    const reloaded = await import("../../push");
    for (let i = 0; i < 3; i++) await reloaded.pushChangesWithResult(ctx());
    expect(await getUnsyncedChanges()).toEqual([]);
    expect(
      (
        await db.query(
          "SELECT title, deleted_at, mutation_at FROM readmax.book WHERE id = 'canonical'",
        )
      ).rows[0],
    ).toEqual(before);
    expect(await getBookRemaps(USER)).toMatchObject([{ complete: true }]);

    const direct = book("canonical", BASE + 3000);
    await queue({ ...direct, data: { ...(direct.data as object), title: "direct edit" } });
    await reloaded.pushChangesWithResult(ctx());
    expect(
      (
        await db.query(
          "SELECT title, deleted_at, mutation_at FROM readmax.book WHERE id = 'canonical'",
        )
      ).rows,
    ).toEqual([{ title: "direct edit", deleted_at: null, mutation_at: new Date(BASE + 3000) }]);
  });

  it("consumes explicit aliases on pull before later pushes, while an ordinary tombstone remains unrelated", async () => {
    await push(
      [
        book("canonical"),
        book("local", BASE + 100),
        { ...book("ordinary", BASE + 200), operation: "delete" },
      ],
      true,
    );
    await set(
      "local",
      { bookId: "local", content: doc("surviving local note"), updatedAt: BASE + 300 },
      stores.getNotebookStore(),
    );
    await set(
      "ordinary",
      { bookId: "ordinary", content: doc("ordinary deleted book note"), updatedAt: BASE + 300 },
      stores.getNotebookStore(),
    );
    connectedFetch();
    await pullChanges({ userId: USER, isStopped: () => false });
    expect(await getBookRemaps(USER)).toMatchObject([{ fromId: "local", toId: "canonical" }]);
    expect(await get("local", stores.getNotebookStore())).toBeUndefined();
    expect(await get("ordinary", stores.getNotebookStore())).toMatchObject({ bookId: "ordinary" });
    await pushChangesWithResult(ctx());
    expect((await db.query("SELECT book_id, content FROM readmax.notebook")).rows).toEqual([
      { book_id: "canonical", content: doc("surviving local note") },
    ]);
  });
});
