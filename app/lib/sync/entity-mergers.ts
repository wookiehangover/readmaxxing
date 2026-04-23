import { get, set, entries } from "idb-keyval";
import { removeSessionLocally } from "~/lib/stores/chat-store";
import { lwwMerge, setUnionMerge } from "./merge";
import { remapBookId } from "./remap";
import {
  serverBookToLocal,
  serverChatMessageToLocal,
  serverChatSessionToLocal,
  serverHighlightToLocal,
  serverNotebookToLocal,
  serverPositionToLocal,
  toTimestamp,
  type LocalChatSession,
} from "./server-transforms";
import {
  getBookStore,
  getChatSessionStore,
  getHighlightStore,
  getNotebookStore,
  getPositionStore,
} from "./stores";
import type { EntityType } from "./types";

export async function mergeBookRecord(record: Record<string, unknown>): Promise<void> {
  const store = getBookStore();
  const remoteRecord = serverBookToLocal(record);
  const id = remoteRecord.id as string;
  const remoteHash = remoteRecord.fileHash as string | undefined;
  const remoteDeletedAt = remoteRecord.deletedAt as number | undefined;

  // Cross-device dedup on pull: if the incoming non-deleted book matches
  // an existing local book by fileHash under a different id, remap local
  // references to the incoming canonical id before applying the merge so
  // the UI does not show a duplicate entry until the next push/pull.
  if (!remoteDeletedAt && remoteHash) {
    const allBooks = await entries<string, Record<string, unknown>>(store);
    for (const [localId, localBook] of allBooks) {
      if (!localBook || localId === id) continue;
      if (localBook.deletedAt != null) continue;
      if (localBook.fileHash !== remoteHash) continue;
      await remapBookId(localId, id);
      if (typeof window !== "undefined") {
        queueMicrotask(() => {
          for (const entity of [
            "book",
            "position",
            "highlight",
            "notebook",
            "chat_session",
          ] as const) {
            window.dispatchEvent(new CustomEvent("sync:entity-updated", { detail: { entity } }));
          }
        });
      }
      break;
    }
  }

  const local = await get<Record<string, unknown>>(id, store);

  if (!local) {
    await set(id, remoteRecord, store);
    return;
  }

  const merged = lwwMerge(local as { updatedAt: number }, remoteRecord as { updatedAt: number });
  if (merged === remoteRecord) {
    // Server wins — preserve client-only fields from local record.
    // hasLocalFile and coverImage are never sent to the server, so
    // serverBookToLocal always returns them as undefined/null.
    //
    // remoteCoverUrl / remoteFileUrl: treat nullish server values as
    // "no opinion" and keep the locally-known URL. The server row may
    // have been stamped before this device's upload push landed, or a
    // different device created the book row without uploading blobs
    // yet. Overwriting with undefined would clear URLs we already have
    // and force a redundant re-upload on the next push.
    await set(
      id,
      {
        ...remoteRecord,
        hasLocalFile: local.hasLocalFile,
        coverImage: local.coverImage ?? remoteRecord.coverImage,
        remoteCoverUrl: remoteRecord.remoteCoverUrl ?? local.remoteCoverUrl,
        remoteFileUrl: remoteRecord.remoteFileUrl ?? local.remoteFileUrl,
      },
      store,
    );
  }
}

async function mergePositionRecord(record: Record<string, unknown>): Promise<void> {
  const store = getPositionStore();
  const localRecord = serverPositionToLocal(record);
  const id = localRecord.id;
  const local = await get<Record<string, unknown>>(id, store);

  if (!local) {
    await set(id, localRecord, store);
    return;
  }

  const merged = lwwMerge(local as { updatedAt: number }, localRecord as { updatedAt: number });
  if (merged === localRecord) {
    await set(id, localRecord, store);
  }
}

/**
 * Merge a single highlight record using set-union semantics.
 * If either side has deletedAt, tombstone propagates. Otherwise LWW by updatedAt.
 */
async function mergeHighlightRecord(record: Record<string, unknown>): Promise<void> {
  const store = getHighlightStore();
  const remoteRecord = serverHighlightToLocal(record);
  const id = remoteRecord.id as string;
  const local = await get<Record<string, unknown>>(id, store);

  if (!local) {
    await set(id, remoteRecord, store);
    return;
  }

  // Use setUnionMerge for a single-item merge (handles tombstones correctly)
  const [merged] = setUnionMerge(
    [local as { deletedAt?: number | null }],
    [remoteRecord as { deletedAt?: number | null }],
    (item) => (item as Record<string, unknown>).id as string,
  );
  // Write if the merge result differs from local
  if (merged !== local) {
    await set(id, merged, store);
  }
}

/**
 * Merge a notebook record using LWW by updatedAt.
 */
async function mergeNotebookRecord(record: Record<string, unknown>): Promise<void> {
  const store = getNotebookStore();
  const remoteRecord = serverNotebookToLocal(record);
  const id = remoteRecord.bookId as string;
  const local = await get<Record<string, unknown>>(id, store);

  if (!local) {
    await set(id, remoteRecord, store);
    return;
  }

  const merged = lwwMerge(local as { updatedAt: number }, remoteRecord as { updatedAt: number });
  if (merged === remoteRecord) {
    await set(id, remoteRecord, store);
  }
}

/**
 * Merge a chat session record (LWW for session metadata, tombstone-aware).
 * Chat sessions are stored per-bookId as ChatSession[] in IDB.
 *
 * When the remote row carries `deletedAt`, the session (and its cached
 * messages, which live inside the same IDB array value) is removed from
 * local storage unless the local copy's `updatedAt` is strictly newer —
 * same LWW tie-break as `mergeBookRecord`. The server is the source of
 * truth if the session is ever un-deleted, so losing the local cache is
 * safe.
 */
export async function mergeChatSessionRecord(record: Record<string, unknown>): Promise<void> {
  const store = getChatSessionStore();
  const remote = serverChatSessionToLocal(record);
  const bookId = remote.bookId;
  if (!bookId) return;

  const sessions = (await get<LocalChatSession[]>(bookId, store)) ?? [];
  const idx = sessions.findIndex((s) => s.id === remote.id);

  // Remote tombstone path: propagate the delete to this device.
  if (remote.deletedAt != null) {
    if (idx < 0) return; // nothing to remove locally
    const local = sessions[idx];
    // LWW: a local edit strictly newer than the tombstone wins. Callers that
    // just locally re-created the session at the same millisecond would also
    // lose, but that matches the other LWW mergers in this file.
    if (local.updatedAt > remote.updatedAt) return;
    await removeSessionLocally(bookId, remote.id);
    return;
  }

  if (idx < 0) {
    // New session from server — add it (preserve empty messages array)
    sessions.push(remote);
  } else {
    // LWW merge on metadata only, preserving local messages
    const local = sessions[idx];
    if (remote.updatedAt > local.updatedAt) {
      sessions[idx] = {
        ...remote,
        messages: local.messages, // keep local messages intact
      };
    }
  }

  await set(bookId, sessions, store);
}

/**
 * Merge a chat message record (append-only by message ID).
 * Finds the parent session in IDB and adds the message if not already present.
 */
export async function mergeChatMessageRecord(record: Record<string, unknown>): Promise<void> {
  const store = getChatSessionStore();
  const remoteMsg = serverChatMessageToLocal(record);
  const sessionId = (record.sessionId as string) ?? "";
  if (!sessionId) return;

  // We need to find which bookId this session belongs to.
  // Scan all entries to find the session. This is suboptimal but the chat
  // store is keyed by bookId (not sessionId).
  const allEntries = await entries<string, LocalChatSession[]>(store);
  for (const entry of allEntries) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const bookId = entry[0];
    const sessions = entry[1];
    if (!Array.isArray(sessions)) continue;
    const sIdx = sessions.findIndex((s) => s && s.id === sessionId);
    if (sIdx < 0) continue;

    const session = sessions[sIdx];
    // Append-only: add if not already present by ID.
    // Messages arrive from the server in created_at ASC order, so simply
    // appending preserves the correct sequence without needing a sort
    // (sorting was unreliable because some messages had createdAt of 0).
    const exists = session.messages.some((m) => m.id === remoteMsg.id);
    if (!exists) {
      session.messages.push(remoteMsg);
      // Do NOT advance session.updatedAt here. `updatedAt` is a metadata-only
      // LWW clock for the session row (title, bookId, deletedAt); appending a
      // message must only grow session.messages. Bumping it would poison the
      // LWW clock and cause later server-side title/tombstone merges to lose.
      await set(bookId, sessions, store);
    }
    return;
  }

  // If the session doesn't exist locally yet, the session record may arrive
  // in the same pull batch. The pull loop processes entities in order
  // (chat_session before chat_message), so this is unlikely but harmless.
}

/**
 * Merge a settings record (LWW).
 * Settings live in localStorage, not IDB. After merging, dispatch a custom
 * event so useSettings re-reads.
 */
async function mergeSettingsRecord(record: Record<string, unknown>): Promise<void> {
  const remoteSettings = record.settings as Record<string, unknown> | undefined;
  const remoteUpdatedAt = toTimestamp(record.updatedAt);
  if (!remoteSettings) return;

  const STORAGE_KEY = "app-settings";
  let local: Record<string, unknown> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) local = JSON.parse(raw);
  } catch {
    // corrupt localStorage, overwrite
  }

  const localUpdatedAt = typeof local.updatedAt === "number" ? local.updatedAt : 0;

  if (remoteUpdatedAt > localUpdatedAt) {
    const merged = { ...remoteSettings, updatedAt: remoteUpdatedAt };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    queueMicrotask(() => {
      window.dispatchEvent(new CustomEvent("settings-changed"));
    });
  }
}

export const ENTITY_MERGERS: Partial<
  Record<EntityType, (record: Record<string, unknown>) => Promise<void>>
> = {
  book: mergeBookRecord,
  position: mergePositionRecord,
  highlight: mergeHighlightRecord,
  notebook: mergeNotebookRecord,
  chat_session: mergeChatSessionRecord,
  chat_message: mergeChatMessageRecord,
  settings: mergeSettingsRecord,
};
