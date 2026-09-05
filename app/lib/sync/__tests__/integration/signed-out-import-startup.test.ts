import type { UIMessage } from "@ai-sdk/react";
import { BlobError } from "@vercel/blob";
import { upload } from "@vercel/blob/client";
import { clear, createStore, get, set } from "idb-keyval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatTransport } from "~/components/chat/chat-utils";
import type { BookChapter } from "~/lib/epub/epub-text-extract";
import { BookService, type BookMeta } from "~/lib/stores/book-store";
import {
  getChapterUploadCacheStore,
  isChaptersUploaded,
} from "~/lib/stores/chapter-upload-cache-store";
import { ChatService } from "~/lib/stores/chat-store";
import { ensureBookChaptersUploaded } from "../../book-chapter-uploads";
import { getUnsyncedChanges } from "../../change-log";
import { runInitialSyncIfNeeded } from "../../initial-sync";
import {
  getActiveSessionStore,
  getBookDataStore,
  getBookStore,
  getBookmarkStore,
  getChatSessionStore,
  getHighlightStore,
  getNotebookStore,
  getPositionStore,
  getSyncFlagsStore,
} from "../../stores";
import { makeSyncEngine, type SyncEngine } from "../../sync-engine";
import type { SyncPushRequest, SyncPushResponse } from "../../types";

vi.mock("@vercel/blob/client", () => ({ upload: vi.fn() }));

const changeLogStore = createStore("ebook-reader-changelog", "changes");
const uploadMock = vi.mocked(upload);
const activeEngines = new Set<SyncEngine>();

interface RequestRecord {
  url: string;
  status: number;
}

interface PushRecord {
  body: SyncPushRequest;
  acceptedBookIds: string[];
  rejectedBookIds: string[];
}

function makeServer(options: { rejectFirstBookPush?: boolean } = {}) {
  const requests: RequestRecord[] = [];
  const pushes: PushRecord[] = [];
  const books = new Set<string>();
  const sessions = new Set<string>();
  const chapters = new Set<string>();
  let rejectNextBookPush = options.rejectFirstBookPush ?? false;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.startsWith("/api/sync/pull?")) {
      requests.push({ url, status: 200 });
      return Response.json({ changes: [], serverTimestamp: new Date().toISOString() });
    }

    if (url === "/api/sync/push") {
      const body = JSON.parse(String(init?.body)) as SyncPushRequest;
      const accepted: SyncPushResponse["accepted"] = [];
      const rejected: SyncPushResponse["rejected"] = [];
      const rejectBooks =
        rejectNextBookPush && body.changes.some((change) => change.entity === "book");
      if (rejectBooks) rejectNextBookPush = false;

      for (const change of body.changes) {
        if (change.entity === "book" && rejectBooks) {
          rejected.push({ id: change.id, reason: "database temporarily unavailable" });
          continue;
        }

        if (change.entity === "chat_session") {
          const bookId = (change.data as { bookId: string }).bookId;
          if (!books.has(bookId)) {
            rejected.push({ id: change.id, reason: "book does not exist" });
            continue;
          }
          sessions.add(change.entityId);
        }

        if (change.entity === "book") books.add(change.entityId);
        accepted.push({ id: change.id });
      }

      pushes.push({
        body,
        acceptedBookIds: body.changes
          .filter(
            (change) =>
              change.entity === "book" && accepted.some((entry) => entry.id === change.id),
          )
          .map((change) => change.entityId),
        rejectedBookIds: body.changes
          .filter(
            (change) =>
              change.entity === "book" && rejected.some((entry) => entry.id === change.id),
          )
          .map((change) => change.entityId),
      });
      requests.push({ url, status: 200 });
      return Response.json({ accepted, rejected, serverTimestamp: new Date().toISOString() });
    }

    if (url === "/api/sync/files/upload") {
      const body = JSON.parse(String(init?.body)) as { payload: { clientPayload: string } };
      const { bookId } = JSON.parse(body.payload.clientPayload) as { bookId: string };
      const status = books.has(bookId) ? 200 : 400;
      requests.push({ url, status });
      return Response.json(
        status === 200 ? { bookId } : { error: "Book not found or not owned by user" },
        { status },
      );
    }

    const chaptersMatch = /^\/api\/books\/([^/]+)\/chapters$/.exec(url);
    if (chaptersMatch) {
      const bookId = decodeURIComponent(chaptersMatch[1]);
      const status = books.has(bookId) ? 200 : 404;
      if (status === 200) chapters.add(bookId);
      requests.push({ url, status });
      return Response.json({}, { status });
    }

    const artifactsMatch = /^\/api\/books\/([^/]+)\/artifacts\/ingest$/.exec(url);
    if (artifactsMatch) {
      const bookId = decodeURIComponent(artifactsMatch[1]);
      const status = books.has(bookId) ? 202 : 404;
      requests.push({ url, status });
      return Response.json({}, { status });
    }

    if (url === "/api/chat") {
      const body = JSON.parse(String(init?.body)) as { bookId: string; sessionId: string };
      const status =
        books.has(body.bookId) && chapters.has(body.bookId) && sessions.has(body.sessionId)
          ? 200
          : 404;
      requests.push({ url, status });
      return status === 200
        ? new Response("data: [DONE]\n\n", { status })
        : Response.json({ error: "Book, chapters, or session not found" }, { status });
    }

    throw new Error(`Unexpected request: ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  uploadMock.mockImplementation(async (pathname, _body, uploadOptions) => {
    const response = await fetch(String(uploadOptions.handleUploadUrl), {
      method: "POST",
      body: JSON.stringify({
        type: "blob.generate-client-token",
        payload: { pathname, clientPayload: uploadOptions.clientPayload, multipart: false },
      }),
    });
    if (!response.ok) throw new BlobError("Failed to  retrieve the client token");

    return {
      url: `blob://${pathname}`,
      downloadUrl: `blob://${pathname}?download=1`,
      pathname,
      contentType: "application/epub+zip",
      contentDisposition: 'attachment; filename="book.epub"',
      etag: `etag:${pathname}`,
    };
  });

  return { books, chapters, fetchMock, pushes, requests, sessions };
}

async function importSignedOutBook(bookId: string): Promise<BookMeta> {
  const book = await BookService.saveBook(
    {
      id: bookId,
      title: "Imported while signed out",
      author: "Offline Reader",
      coverImage: null,
      format: "epub",
    },
    new TextEncoder().encode("signed-out book contents").buffer,
  );

  await vi.waitFor(async () => {
    expect((await getUnsyncedChanges()).some((change) => change.entityId === bookId)).toBe(true);
  });

  return book;
}

async function startAuthenticatedSync(userId = "user-after-login"): Promise<SyncEngine> {
  await runInitialSyncIfNeeded();
  const engine = makeSyncEngine({ userId });
  activeEngines.add(engine);
  engine.startSync();
  return engine;
}

beforeEach(async () => {
  localStorage.clear();
  vi.clearAllMocks();
  await Promise.all([
    clear(changeLogStore),
    clear(getBookStore()),
    clear(getBookDataStore()),
    clear(getBookmarkStore()),
    clear(getHighlightStore()),
    clear(getNotebookStore()),
    clear(getPositionStore()),
    clear(getChatSessionStore()),
    clear(getActiveSessionStore()),
    clear(getSyncFlagsStore()),
    clear(getChapterUploadCacheStore()),
  ]);
});

afterEach(() => {
  for (const engine of activeEngines) engine.stopSync();
  activeEngines.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("integration: signed-out book import and authenticated sync startup", () => {
  it("models the live Vercel missing-owner handshake status and JSON error", async () => {
    const server = makeServer();

    const response = await fetch("/api/sync/files/upload", {
      method: "POST",
      body: JSON.stringify({
        type: "blob.generate-client-token",
        payload: { clientPayload: JSON.stringify({ bookId: "missing-book", type: "file" }) },
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Book not found or not owned by user" });
    expect(server.requests).toContainEqual({ url: "/api/sync/files/upload", status: 400 });
  });

  it("accepts imported book metadata before blob upload, reading ingestion, chapter preparation, and chat", async () => {
    const server = makeServer();
    const book = await importSignedOutBook("signed-out-import-book");
    expect(server.fetchMock).not.toHaveBeenCalled();

    const engine = await startAuthenticatedSync();

    await vi.waitFor(async () => {
      expect(server.books.has(book.id)).toBe(true);
      expect((await get<BookMeta>(book.id, getBookStore()))?.remoteFileUrl).toBe(
        `blob://books/user-after-login/${book.id}/book.epub`,
      );
    });

    const firstBookPush = server.pushes.find((push) => push.acceptedBookIds.includes(book.id));
    expect(firstBookPush?.body.changes).toContainEqual(
      expect.objectContaining({ entity: "book", entityId: book.id, operation: "put" }),
    );
    const firstPushIndex = server.requests.findIndex((request) => request.url === "/api/sync/push");
    const uploadRequests = server.requests.filter(
      (request) => request.url === "/api/sync/files/upload",
    );
    expect(uploadRequests.length).toBeGreaterThan(0);
    expect(uploadRequests.every((request) => request.status === 200)).toBe(true);
    expect(firstPushIndex).toBeLessThan(
      server.requests.findIndex((request) => request.url === "/api/sync/files/upload"),
    );

    const artifactResponse = await fetch(`/api/books/${book.id}/artifacts/ingest`, {
      method: "POST",
      body: JSON.stringify({ locator: "chapter-1.xhtml", text: "Visible chapter text" }),
    });
    expect(artifactResponse.status).toBe(202);

    const chapter: BookChapter = {
      index: 0,
      title: "Chapter 1",
      text: "Visible chapter text",
      spineStart: 0,
      spineEnd: 1,
    };
    await ensureBookChaptersUploaded(book.id, { chapters: [chapter], format: "epub" });
    expect(await isChaptersUploaded(book.id)).toBe(true);

    const session = await ChatService.createSession(book.id);
    await vi.waitFor(async () => {
      expect((await getUnsyncedChanges()).some((change) => change.entityId === session.id)).toBe(
        true,
      );
    });
    await engine.pushChanges();
    expect(server.sessions.has(session.id)).toBe(true);

    const transport = createChatTransport({
      sessionId: session.id,
      bookId: book.id,
      visibleTextRef: { current: chapter.text },
      currentChapterRef: { current: chapter.index },
      selectedBookIdsRef: { current: [book.id] },
      getBookContext: () => ({ visibleText: chapter.text, currentChapterIndex: chapter.index }),
    });
    const message: UIMessage = {
      id: "signed-out-import-message",
      role: "user",
      parts: [{ type: "text", text: "Discuss this chapter" }],
    };

    await transport.sendMessages({
      trigger: "submit-message",
      chatId: session.id,
      messageId: undefined,
      messages: [message],
      abortSignal: undefined,
    });

    expect(server.requests).toContainEqual({ url: "/api/chat", status: 200 });
    for (const request of server.requests.filter(
      (entry) =>
        entry.url.includes("/chapters") ||
        entry.url.includes("/artifacts/ingest") ||
        entry.url === "/api/chat",
    )) {
      expect(request.status).toBeGreaterThanOrEqual(200);
      expect(request.status).toBeLessThan(300);
    }
  });

  it("retains rejected imported metadata until authenticated startup accepts the same book changes", async () => {
    const server = makeServer({ rejectFirstBookPush: true });
    const book = await importSignedOutBook("rejected-signed-out-book");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const engine = await startAuthenticatedSync();

    await vi.waitFor(async () => {
      expect((await getUnsyncedChanges()).some((change) => change.failure?.retryable)).toBe(true);
    });
    const retained = (await getUnsyncedChanges()).filter((change) => change.failure?.retryable);
    vi.spyOn(Date, "now").mockReturnValue(
      Math.max(...retained.map((change) => change.failure!.nextAttemptAt!)),
    );
    await engine.pushChanges();

    await vi.waitFor(() => {
      expect(server.pushes.length).toBeGreaterThanOrEqual(2);
      expect(server.books.has(book.id)).toBe(true);
    });

    expect(server.pushes[0].rejectedBookIds).toContain(book.id);
    const rejectedChangeIds = server.pushes[0].body.changes
      .filter((change) => change.entity === "book")
      .map((change) => change.id);
    const acceptedRetry = server.pushes.find((push) => push.acceptedBookIds.includes(book.id));
    expect(acceptedRetry?.body.changes.map((change) => change.id)).toEqual(
      expect.arrayContaining(rejectedChangeIds),
    );

    await engine.triggerManualPush();
    await vi.waitFor(async () => {
      expect((await get<BookMeta>(book.id, getBookStore()))?.remoteFileUrl).toBe(
        `blob://books/user-after-login/${book.id}/book.epub`,
      );
    });

    const pushRequestIndexes = server.requests.flatMap((request, index) =>
      request.url === "/api/sync/push" ? [index] : [],
    );
    const acceptedRetryIndex = server.pushes.findIndex((push) =>
      push.acceptedBookIds.includes(book.id),
    );
    const firstUploadIndex = server.requests.findIndex(
      (request) => request.url === "/api/sync/files/upload",
    );
    expect(acceptedRetryIndex).toBeGreaterThan(0);
    expect(firstUploadIndex).toBeGreaterThan(pushRequestIndexes[acceptedRetryIndex]);
    expect(
      server.requests
        .slice(0, pushRequestIndexes[acceptedRetryIndex])
        .some((request) => request.url === "/api/sync/files/upload"),
    ).toBe(false);
    expect(server.requests).toContainEqual({ url: "/api/sync/files/upload", status: 200 });
    expect(
      (await getUnsyncedChanges()).some((change) => rejectedChangeIds.includes(change.id)),
    ).toBe(false);
  });

  it("recreates metadata for an existing local orphan when initial sync already completed and its queue is empty", async () => {
    const server = makeServer();
    const book = await importSignedOutBook("77490ede-c9b9-46da-a5d6-5c6747b00666");

    await clear(changeLogStore);
    await set("initial-sync-complete", true, getSyncFlagsStore());
    expect(await getUnsyncedChanges()).toEqual([]);
    expect(await get<BookMeta>(book.id, getBookStore())).toMatchObject({
      id: book.id,
      hasLocalFile: true,
    });

    await startAuthenticatedSync();

    await vi.waitFor(() => {
      expect(server.books.has(book.id)).toBe(true);
    });

    const reconciledPush = server.pushes.find((push) => push.acceptedBookIds.includes(book.id));
    expect(reconciledPush?.body.changes).toContainEqual(
      expect.objectContaining({ entity: "book", entityId: book.id, operation: "put" }),
    );
    expect(server.requests).toContainEqual({ url: "/api/sync/files/upload", status: 200 });
    expect(server.requests.findIndex((request) => request.url === "/api/sync/push")).toBeLessThan(
      server.requests.findIndex((request) => request.url === "/api/sync/files/upload"),
    );
  });
});
