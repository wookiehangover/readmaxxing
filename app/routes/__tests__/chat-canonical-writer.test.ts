// @vitest-environment node
import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { clear } from "idb-keyval";
import type { SQLQuery } from "pg-sql";
import { withEpubServerDom } from "~/lib/epub/server-dom";
import { extractBookChapters, type BookChapter } from "~/lib/epub/epub-text-extract";
import { getNotebookHighlightIds } from "~/lib/chat/highlight-tools";
import * as stores from "~/lib/sync/stores";
import { pullChanges } from "~/lib/sync/pull";
import { pushChangesWithResult } from "~/lib/sync/push";
import type { ChangeEntry } from "~/lib/sync/types";
import {
  BASE,
  USER,
  OTHER_USER,
  db,
  push,
  ctx,
  mocks,
} from "~/lib/sync/__tests__/integration/push-route-harness";

type Tool = { execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
const captured = vi.hoisted(() => ({
  chapters: [] as BookChapter[],
  tools: null as Record<string, Tool> | null,
  done: null as Promise<unknown> | null,
}));
vi.mock("ai", () => ({
  tool: (definition: unknown) => definition,
  isStepCount: () => () => false,
  generateId: () => "chat-highlight",
  convertToModelMessages: async (messages: unknown) => messages,
  createUIMessageStream: ({ execute }: { execute: (context: unknown) => Promise<unknown> }) => {
    captured.done = execute({ writer: { merge: () => {} } });
    return {};
  },
  createUIMessageStreamResponse: () => new Response("fixture chat stream"),
  streamText: (options: { tools: Record<string, Tool> }) => {
    captured.tools = options.tools;
    return { toUIMessageStream: () => ({}) };
  },
}));
vi.mock("@ai-sdk/gateway", () => ({ gateway: () => ({}) }));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: { tools: { webSearch_20250305: () => ({}) } } }));
vi.mock("resumable-stream", () => ({ createResumableStreamContext: () => ({}) }));
vi.mock("@vercel/functions", () => ({ waitUntil: () => {} }));
vi.mock("~/lib/database/book/book-chapters", () => ({
  getBookChaptersForUser: async () => ({ chapters: captured.chapters }),
}));

function book(id: string, hash: string, version = 0): ChangeEntry {
  return {
    id: `${id}-${version}`,
    entity: "book",
    entityId: id,
    operation: "put",
    timestamp: BASE + version,
    synced: false,
    data: { id, title: id, fileHash: hash },
  };
}

async function startChat(
  options: { secondary?: boolean; chapters?: BookChapter[]; fileUrl?: string } = {},
) {
  captured.chapters = options.chapters ?? [
    {
      index: 0,
      spineStart: 0,
      spineEnd: 0,
      title: "Test chapter",
      text: "test chapter text",
      segments: [{ href: "chapter.xhtml", spineIndex: 0, start: 0, end: 17 }],
    },
  ];
  captured.tools = null;
  vi.doMock("~/lib/database/auth-middleware", () => ({
    getSessionFromRequest: async () => ({ userId: USER }),
    requireAuth: async () => ({ userId: USER }),
  }));
  const { action } = await import("~/routes/api.chat");
  expect(
    (
      await push(
        [
          {
            ...book("a", "first"),
            data: { ...(book("a", "first").data as object), remoteFileUrl: options.fileUrl },
          },
          book("c", "target"),
          ...(options.secondary ? [book("b", "secondary")] : []),
          {
            id: "session",
            entity: "chat_session",
            entityId: "s",
            operation: "put",
            timestamp: BASE,
            synced: false,
            data: { bookId: "a", title: "session" },
          },
        ],
        true,
      )
    ).body.rejected,
  ).toEqual([]);
  const response = await action({
    request: new Request("https://test/api/chat", {
      method: "POST",
      body: JSON.stringify({
        bookId: "a",
        bookIds: options.secondary ? ["a", "b"] : ["a"],
        sessionId: "s",
        message: { id: "m", role: "user", parts: [{ type: "text", text: "save notes" }] },
      }),
    }),
  } as Parameters<typeof action>[0]);
  expect(response.status).toBe(200);
  await captured.done;
  expect(captured.tools).not.toBeNull();
  return captured.tools!;
}

async function remapAndSeedCanonicalNotes() {
  expect((await push([book("a", "target", 10)], true)).body.accepted[0].canonicalId).toBe("c");
  expect(
    (
      await push(
        [
          {
            id: "canonical-notebook",
            entity: "notebook",
            entityId: "c",
            operation: "put",
            timestamp: BASE + 20,
            synced: false,
            data: {
              bookId: "c",
              content: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "canonical existing notes" }],
                  },
                ],
              },
            },
          },
        ],
        true,
      )
    ).body.rejected,
  ).toEqual([]);
}

it.each(["append_to_notes", "edit_notes"])(
  "an active %s tool resolves after dedup and preserves the canonical notebook",
  async (tool) => {
    const tools = await startChat();
    await remapAndSeedCanonicalNotes();
    const result = await tools[tool].execute(
      tool === "append_to_notes"
        ? { text: "late chat addition" }
        : { code: 'notebook.append("late chat addition");' },
    );
    expect(result[tool === "append_to_notes" ? "appended" : "executed"]).toBe(true);
    const notebooks = (
      await db.query<{ book_id: string; content: unknown }>(
        "SELECT book_id, content FROM readmax.notebook",
      )
    ).rows;
    expect(notebooks).toEqual([{ book_id: "c", content: expect.any(Object) }]);
    expect(JSON.stringify(notebooks[0].content)).toContain("canonical existing notes");
    expect(JSON.stringify(notebooks[0].content)).toContain("late chat addition");
    expect(result.bookId).toBe("c");
  },
);

it("preserves canonical content through actual client pull and replay after a late chat append", async () => {
  const tools = await startChat();
  await remapAndSeedCanonicalNotes();
  expect((await tools.append_to_notes.execute({ text: "late addition" })).appended).toBe(true);
  const { action: syncAction } = await import("~/routes/api.sync.push");
  const { loader: syncPull } = await import("~/routes/api.sync.pull");
  await Promise.all(Object.values(stores).map((getStore) => clear(getStore())));
  vi.stubGlobal("window", { dispatchEvent: () => {} });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) =>
    url.startsWith("/api/sync/pull")
      ? syncPull({ request: new Request(new URL(url, "https://test"), init) })
      : syncAction({ request: new Request("https://test/api/sync/push", init) }),
  );
  await pullChanges({ userId: USER, isStopped: () => false });
  await pushChangesWithResult(ctx());
  const rows = (
    await db.query<{ book_id: string; content: unknown }>(
      "SELECT book_id, content FROM readmax.notebook",
    )
  ).rows;
  expect(rows).toEqual([{ book_id: "c", content: expect.any(Object) }]);
  expect(JSON.stringify(rows[0].content)).toContain("canonical existing notes");
  expect(JSON.stringify(rows[0].content)).toContain("late addition");
});

it("keeps canonical tool references on a remapped secondary book", async () => {
  const tools = await startChat({ secondary: true });
  expect((await push([book("b", "target", 10)], true)).body.accepted[0].canonicalId).toBe("c");
  const first = await tools.append_to_notes.execute({ bookId: "b", text: "secondary notes" });
  expect(first.bookId).toBe("c");
  await push([book("d", "final", 20), book("c", "final", 30)], true);
  const second = await tools.read_notes.execute({ bookId: first.bookId });
  expect(second.bookId).toBe("d");
  expect(second.content).toContain("secondary notes");
  expect((await db.query("SELECT book_id FROM readmax.notebook")).rows).toEqual([{ book_id: "d" }]);
});

async function seedHighlight() {
  expect(
    (
      await push(
        [
          {
            id: "highlight-change",
            entity: "highlight",
            entityId: "h",
            operation: "put",
            timestamp: BASE + 5,
            synced: false,
            data: {
              bookId: "a",
              text: "highlight text",
              cfiRange: "epubcfi(/6/2!/4/2/1:0)",
              createdAt: BASE,
            },
          },
        ],
        true,
      )
    ).body.rejected,
  ).toEqual([]);
}

it("attaches, lists and deletes a relocated highlight against the current canonical notebook", async () => {
  const tools = await startChat();
  await seedHighlight();
  await remapAndSeedCanonicalNotes();
  const attached = await tools.attach_highlight.execute({ highlightId: "h" });
  expect(attached).toMatchObject({ attached: true, bookId: "c" });
  expect(await tools.attach_highlight.execute({ highlightId: "h" })).toMatchObject({
    attached: false,
    alreadyPresent: true,
    bookId: "c",
  });
  const row = (
    await db.query<{ content: unknown }>("SELECT content FROM readmax.notebook WHERE book_id='c'")
  ).rows[0];
  expect(JSON.stringify(row.content)).toContain("canonical existing notes");
  expect([...getNotebookHighlightIds(row.content)]).toEqual(["h"]);
  expect(await tools.list_highlights.execute({ bookId: "a" })).toMatchObject({
    bookId: "c",
    highlights: [{ id: "h", inNotebook: true }],
  });
  expect(await tools.delete_highlight.execute({ highlightId: "h" })).toEqual({
    bookId: "c",
    deleted: true,
    inNotebook: true,
  });
  expect(await tools.list_highlights.execute({ bookId: "a" })).toEqual({
    bookId: "c",
    highlights: [],
  });
  const highlight = (
    await db.query<{ book_id: string; deleted_at: Date }>(
      "SELECT book_id, deleted_at FROM readmax.highlight WHERE id='h'",
    )
  ).rows[0];
  expect(highlight).toEqual({ book_id: "c", deleted_at: expect.any(Date) });
  // An equal-clock stale put must not undo the tool's tombstone.
  expect(
    (
      await push(
        [
          {
            id: "stale-highlight",
            entity: "highlight",
            entityId: "h",
            operation: "put",
            timestamp: (highlight.deleted_at as Date).getTime(),
            synced: false,
            data: { bookId: "a", text: "old" },
          },
        ],
        true,
      )
    ).body.rejected,
  ).toEqual([]);
  expect(
    (await db.query<{ deleted_at: Date }>("SELECT deleted_at FROM readmax.highlight WHERE id='h'"))
      .rows[0].deleted_at,
  ).toEqual(highlight.deleted_at);
});

it.each(["append_to_notes", "edit_notes", "attach_highlight"])(
  "%s does not invent a clock to overwrite a newer canonical notebook",
  async (tool) => {
    const tools = await startChat();
    await seedHighlight();
    await remapAndSeedCanonicalNotes();
    const future = new Date(Date.now() + 60_000);
    await db.query("UPDATE readmax.notebook SET mutation_at=$1 WHERE book_id='c'", [future]);
    const before = (await db.query("SELECT * FROM readmax.notebook")).rows;
    const result = await tools[tool].execute(
      tool === "append_to_notes"
        ? { text: "late" }
        : tool === "edit_notes"
          ? { code: 'notebook.append("late");' }
          : { highlightId: "h" },
    );
    expect(
      result[
        tool === "append_to_notes" ? "appended" : tool === "edit_notes" ? "executed" : "attached"
      ],
    ).toBe(false);
    expect((await db.query("SELECT * FROM readmax.notebook")).rows).toEqual(before);
  },
);

it.each(["deleted", "foreign"])(
  "active tools cannot write through a %s canonical target",
  async (state) => {
    const tools = await startChat();
    await seedHighlight();
    await remapAndSeedCanonicalNotes();
    if (state === "deleted")
      await push([{ ...book("c", "target", 30), operation: "delete" }], true);
    else await db.query("UPDATE readmax.book SET user_id=$1 WHERE id='c'", [OTHER_USER]);
    const before = (await db.query("SELECT * FROM readmax.notebook")).rows;
    expect((await tools.append_to_notes.execute({ text: "late" })).appended).toBe(false);
    expect((await tools.edit_notes.execute({ code: 'notebook.append("late");' })).executed).toBe(
      false,
    );
    expect((await tools.attach_highlight.execute({ highlightId: "h" })).attached).toBe(false);
    expect((await db.query("SELECT * FROM readmax.notebook")).rows).toEqual(before);
  },
);

it("rolls back alias reconciliation when the tool notebook write fails", async () => {
  const tools = await startChat();
  await remapAndSeedCanonicalNotes();
  // A lingering legacy row must be reconciled in the same transaction as the tool write.
  await db.query(
    "INSERT INTO readmax.notebook (user_id,book_id,content,updated_at,mutation_at) VALUES ($1,'a','{}',$2,$2)",
    [USER, new Date(BASE)],
  );
  const before = (await db.query("SELECT * FROM readmax.notebook ORDER BY book_id")).rows;
  const execute = mocks.query.getMockImplementation()!;
  mocks.query.mockImplementation((query: SQLQuery | string) => {
    if (
      typeof query !== "string" &&
      query.text.includes("INSERT INTO readmax.notebook") &&
      query.values.some((value) => typeof value === "string" && value.includes("failing addition"))
    )
      throw new Error("temporary tool failure");
    return execute(query);
  });
  expect((await tools.append_to_notes.execute({ text: "failing addition" })).appended).toBe(false);
  expect((await db.query("SELECT * FROM readmax.notebook ORDER BY book_id")).rows).toEqual(before);
  mocks.query.mockImplementation(execute);
  expect((await tools.append_to_notes.execute({ text: "recovered addition" })).appended).toBe(true);
  expect((await db.query("SELECT book_id FROM readmax.notebook")).rows).toEqual([{ book_id: "c" }]);
});

it.each([false, true])(
  "resolves a highlight after actual EPUB loading with canonical deletion=%s",
  async (deleted) => {
    const data = Uint8Array.from(await readFile("e2e/fixtures/test-book.epub")).buffer;
    const chapters = await withEpubServerDom(() => extractBookChapters(data));
    const tools = await startChat({ chapters, fileUrl: "https://fixture.test/book.epub" });
    let fetched = false;
    vi.stubGlobal("fetch", async () => {
      fetched = true;
      // This is the suspended file request inside the real retained tool.
      // There must be no owner transaction held across this network boundary.
      const queryTexts = mocks.query.mock.calls.map(([q]) =>
        typeof q === "string" ? q : (q as SQLQuery).text,
      );
      expect(queryTexts.filter((q) => q === "BEGIN").length).toBe(
        queryTexts.filter((q) => q === "COMMIT" || q === "ROLLBACK").length,
      );
      await remapAndSeedCanonicalNotes();
      if (deleted) await push([{ ...book("c", "target", 30), operation: "delete" }], true);
      return new Response(data);
    });
    const result = await tools.create_highlight.execute({
      text: "quick brown fox jumps over the lazy dog",
      chapterIndex: chapters[0].index,
    });
    expect(fetched).toBe(true);
    if (deleted) {
      expect(result).toMatchObject({ created: false, error: "persist_failed" });
      expect((await db.query("SELECT id FROM readmax.highlight")).rows).toEqual([]);
    } else {
      expect(result).toMatchObject({ created: true, bookId: "c", highlight: { bookId: "c" } });
      expect((await db.query("SELECT book_id FROM readmax.highlight")).rows).toEqual([
        { book_id: "c" },
      ]);
    }
  },
);

it("does not infer an alias from an ordinary deletion with a matching hash", async () => {
  const tools = await startChat();
  await push([{ ...book("a", "first", 10), operation: "delete" }], true);
  await push([book("c", "first", 20)], true);
  expect((await tools.append_to_notes.execute({ text: "late" })).appended).toBe(false);
  expect((await db.query("SELECT book_id FROM readmax.notebook")).rows).toEqual([]);
  expect(
    (
      await db.query<{ canonical_id: string | null }>(
        "SELECT canonical_id FROM readmax.book WHERE id='a'",
      )
    ).rows[0].canonical_id,
  ).toBeNull();
});
