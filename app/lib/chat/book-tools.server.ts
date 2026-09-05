import type { PoolClient } from "pg";
import type { JSONContent } from "@tiptap/react";
import {
  resolveCanonicalBook,
  withBookOwnerTransaction,
} from "~/lib/database/book/canonical-book-write";
import {
  getNotebookForUser,
  getNotebookMarkdownForUser,
  upsertNotebook,
} from "~/lib/database/annotation/notebook";
import {
  getHighlightsByUser,
  softDeleteHighlight,
  upsertHighlight,
  type UpsertHighlightData,
} from "~/lib/database/annotation/highlight";
import { markdownToTiptapJsonServer } from "~/lib/editor/markdown-to-tiptap-server";
import { runEditNotesInSandbox } from "~/lib/editor/notebook-sdk-server";
import {
  appendHighlightReferenceToContent,
  getNotebookHighlightIds,
  listLiveHighlightsForBook,
  normalizeCfiRange,
} from "./highlight-tools";

async function currentBookId(
  client: PoolClient,
  userId: string,
  bookId: string,
  allowDeleted = false,
) {
  const book = await resolveCanonicalBook(client, userId, bookId);
  if (!book || (!allowDeleted && book.deletedAt)) throw new Error("Book not found or deleted");
  return book.id;
}

/** Match a returned canonical ID to the selected book context that produced it. */
export async function resolveChatBookTarget(
  userId: string,
  requestedId: string,
  selectedIds: string[],
) {
  return withBookOwnerTransaction(userId, async (client) => {
    const requested = await resolveCanonicalBook(client, userId, requestedId);
    if (!requested) return undefined;
    for (const id of selectedIds) {
      const canonical = await resolveCanonicalBook(client, userId, id);
      if (canonical?.id === requested.id) return id;
    }
    return undefined;
  });
}

export async function readChatNotes(userId: string, requestedBookId: string) {
  return withBookOwnerTransaction(userId, async (client) => {
    const bookId = await currentBookId(client, userId, requestedBookId, true);
    const content = await getNotebookMarkdownForUser(userId, bookId, client);
    return { bookId, content: content || "(No notes yet)" };
  });
}

export async function appendChatNotes(userId: string, requestedBookId: string, text: string) {
  const appendedNodes = (markdownToTiptapJsonServer(text).content ?? []) as JSONContent[];
  let bookId = requestedBookId;
  try {
    return await withBookOwnerTransaction(userId, async (client) => {
      bookId = await currentBookId(client, userId, requestedBookId);
      if (!appendedNodes.length) return { bookId, appended: false, text, appendedNodes: [] };
      const existing = await getNotebookForUser(userId, bookId, client);
      const existingDoc = existing?.content as JSONContent | null | undefined;
      const updatedContent: JSONContent = {
        type: "doc",
        content: [...(existingDoc?.content ?? []), ...appendedNodes],
      };
      const row = await upsertNotebook(userId, bookId, updatedContent, new Date(), client);
      if (!row) {
        return {
          bookId,
          appended: false,
          text,
          appendedNodes: [],
          ...(existing
            ? {
                updatedContent: existing.content as JSONContent,
                updatedAt: existing.updatedAt.getTime(),
              }
            : {}),
          error: "append_to_notes: server already has a newer notebook; ignoring this edit",
        };
      }
      return {
        bookId,
        appended: true,
        text,
        appendedNodes,
        updatedContent,
        updatedAt: row.updatedAt.getTime(),
      };
    });
  } catch (error) {
    console.error("append_to_notes: failed to persist notebook:", error);
    return {
      bookId,
      appended: false,
      text,
      appendedNodes: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function editChatNotes(userId: string, requestedBookId: string, code: string) {
  let bookId = requestedBookId;
  try {
    return await withBookOwnerTransaction(userId, async (client) => {
      bookId = await currentBookId(client, userId, requestedBookId);
      const existing = await getNotebookForUser(userId, bookId, client);
      const content = (existing?.content as JSONContent | null) ?? { type: "doc", content: [] };
      // This is bounded local sandbox execution, not an AI or network request.
      // Keep its read and write in one transaction so a concurrent remap/edit
      // cannot make the prepared document stale before it is stored.
      const result = await runEditNotesInSandbox(content, code, { timeoutMs: 1500 });
      if (!result.ok) return { bookId, executed: false, error: result.error };
      const row = await upsertNotebook(userId, bookId, result.updatedContent, new Date(), client);
      if (!row)
        return {
          bookId,
          executed: false,
          error: "edit_notes: server already has a newer notebook; ignoring this edit",
        };
      return {
        bookId,
        executed: true,
        updatedContent: result.updatedContent,
        updatedAt: row.updatedAt.getTime(),
      };
    });
  } catch (error) {
    console.error("edit_notes: failed to persist updated notebook:", error);
    return {
      bookId,
      executed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Anchor/file work is completed by the caller before acquiring this lock. */
export async function createChatHighlight(userId: string, highlight: UpsertHighlightData) {
  return withBookOwnerTransaction(userId, async (client) => {
    const bookId = await currentBookId(client, userId, highlight.bookId);
    const row = await upsertHighlight(userId, { ...highlight, bookId }, client);
    if (!row) throw new Error("Highlight was not created");
    return row;
  });
}

export async function listChatHighlights(userId: string, requestedBookId: string) {
  return withBookOwnerTransaction(userId, async (client) => {
    const bookId = await currentBookId(client, userId, requestedBookId, true);
    const highlights = await getHighlightsByUser(userId, undefined, client);
    const notebook = await getNotebookForUser(userId, bookId, client);
    return {
      bookId,
      highlights: listLiveHighlightsForBook(
        highlights,
        bookId,
        getNotebookHighlightIds(notebook?.content),
      ),
    };
  });
}

export async function attachChatHighlight(userId: string, highlightId: string) {
  try {
    return await withBookOwnerTransaction(userId, async (client) => {
      const highlights = await getHighlightsByUser(userId, undefined, client);
      const highlight = highlights.find(
        (candidate) => candidate.id === highlightId && candidate.deletedAt === null,
      );
      if (!highlight) return { attached: false, reason: "highlight not found or deleted" };
      const bookId = await currentBookId(client, userId, highlight.bookId);
      if (!normalizeCfiRange(highlight.cfiRange))
        return { bookId, attached: false, reason: "highlight has no resolvable CFI" };
      const notebook = await getNotebookForUser(userId, bookId, client);
      if (getNotebookHighlightIds(notebook?.content).has(highlightId))
        return { bookId, attached: false, alreadyPresent: true };
      const updatedContent = appendHighlightReferenceToContent(notebook?.content, highlight);
      if (!updatedContent)
        return { bookId, attached: false, reason: "highlight has no resolvable CFI" };
      const row = await upsertNotebook(userId, bookId, updatedContent, new Date(), client);
      if (!row)
        return {
          bookId,
          attached: false,
          error: "attach_highlight: server already has a newer notebook; ignoring this edit",
        };
      return { bookId, attached: true, updatedAt: row.updatedAt.getTime() };
    });
  } catch (error) {
    console.error("attach_highlight: failed to persist updated notebook:", error);
    return { attached: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function deleteChatHighlight(userId: string, highlightId: string) {
  return withBookOwnerTransaction(userId, async (client) => {
    const highlights = await getHighlightsByUser(userId, undefined, client);
    const highlight = highlights.find((candidate) => candidate.id === highlightId);
    if (!highlight) return { deleted: false, inNotebook: false };
    const bookId = await currentBookId(client, userId, highlight.bookId, true);
    const notebook = await getNotebookForUser(userId, bookId, client);
    const inNotebook = getNotebookHighlightIds(notebook?.content).has(highlightId);
    const deleted = await softDeleteHighlight(userId, highlightId, undefined, client);
    return { bookId, deleted, inNotebook };
  });
}
