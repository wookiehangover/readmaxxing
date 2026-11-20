import { get, set, entries } from "idb-keyval";
import { isFurtherAlong } from "~/lib/position-compare";
import { SYNCED_SETTINGS_KEYS } from "~/lib/settings";
import { removeSessionLocally } from "~/lib/stores/chat-store";
import { isWellFormedEntry } from "./idb-entry";
import { lwwMerge, setUnionMerge } from "./merge";
import { remapBookId } from "./remap";
import {
  serverBookToLocal,
  serverBookmarkToLocal,
  serverChatMessageToLocal,
  serverChatSessionToLocal,
  serverHighlightToLocal,
  serverNotebookToLocal,
  serverPositionToLocal,
  toTimestamp,
  type LocalChatSession,
} from "./server-transforms";
import {
  getBookDataStore,
  getBookStore,
  getBookmarkStore,
  getChatSessionStore,
  getHighlightStore,
  getNotebookStore,
  getRemotePositionStore,
} from "./stores";
import type { EntityType } from "./types";

export async function mergeBookRecord(record: Record<string, unknown>): Promise<void> {
  const store = getBookStore();
  const remoteRecord = serverBookToLocal(record);
  const id = remoteRecord.id as string;
  const remoteHash = remoteRecord.fileHash as string | undefined;
  const remoteDeletedAt = remoteRecord.deletedAt as number | undefined;

  if (!remoteDeletedAt && remoteHash) {
    const allBooks = await entries<string, Record<string, unknown>>(store);
    for (const entry of allBooks) {
      if (!isWellFormedEntry(entry)) continue;
      const [localId, localBook] = entry;
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
            "bookmark",
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
    const hasLocalFileBytes = Boolean(await get<ArrayBuffer>(id, getBookDataStore()));
    const hasLocalCoverBytes = local.coverImage instanceof Blob;

    const remoteFileUrl = remoteRecord.remoteFileUrl as string | undefined;
    const remoteCoverUrl = remoteRecord.remoteCoverUrl as string | undefined;

    await set(
      id,
      {
        ...remoteRecord,
        hasLocalFile: local.hasLocalFile,
        coverImage: local.coverImage ?? remoteRecord.coverImage,
        remoteCoverUrl: remoteCoverUrl ?? (hasLocalCoverBytes ? undefined : local.remoteCoverUrl),
        remoteFileUrl: remoteFileUrl ?? (hasLocalFileBytes ? undefined : local.remoteFileUrl),
      },
      store,
    );
  }
}

export async function mergePositionRecord(record: Record<string, unknown>): Promise<void> {
  const store = getRemotePositionStore();
  const remoteRecord = serverPositionToLocal(record);
  const id = remoteRecord.id;
  const remotePosition = { cfi: remoteRecord.cfi, updatedAt: remoteRecord.updatedAt };
  const existingRemote = await get<Record<string, unknown>>(id, store);

  if (!existingRemote) {
    await set(id, remotePosition, store);
    notifyPositionUpdated();
    return;
  }

  const existingPosition = existingRemote as { cfi: string; updatedAt: number };
  const remoteIsFurther = isFurtherAlong(remotePosition.cfi, existingPosition.cfi);
  const existingIsFurther = isFurtherAlong(existingPosition.cfi, remotePosition.cfi);
  const remoteWins =
    remoteIsFurther ||
    (!existingIsFurther && remotePosition.updatedAt >= existingPosition.updatedAt);
  if (remoteWins) {
    await set(
      id,
      {
        ...remotePosition,
        updatedAt: Math.max(remotePosition.updatedAt, existingPosition.updatedAt),
      },
      store,
    );
    notifyPositionUpdated();
  }
}

function notifyPositionUpdated(): void {
  if (typeof window === "undefined") return;
  queueMicrotask(() => {
    window.dispatchEvent(
      new CustomEvent("sync:entity-updated", { detail: { entity: "position" } }),
    );
  });
}

async function mergeHighlightRecord(record: Record<string, unknown>): Promise<void> {
  const store = getHighlightStore();
  const remoteRecord = serverHighlightToLocal(record);
  const id = remoteRecord.id as string;
  const local = await get<Record<string, unknown>>(id, store);

  if (!local) {
    await set(id, remoteRecord, store);
    return;
  }

  const [merged] = setUnionMerge(
    [local as { deletedAt?: number | null }],
    [remoteRecord as { deletedAt?: number | null }],
    (item) => (item as Record<string, unknown>).id as string,
  );
  if (merged !== local) {
    await set(id, merged, store);
  }
}

export async function mergeBookmarkRecord(record: Record<string, unknown>): Promise<void> {
  const store = getBookmarkStore();
  const remoteRecord = serverBookmarkToLocal(record);
  const id = remoteRecord.id as string;
  const local = await get<Record<string, unknown>>(id, store);

  if (!local) {
    await set(id, remoteRecord, store);
    return;
  }

  const [merged] = setUnionMerge(
    [local as { deletedAt?: number | null }],
    [remoteRecord as { deletedAt?: number | null }],
    (item) => (item as Record<string, unknown>).id as string,
  );
  if (merged !== local) {
    await set(id, merged, store);
  }
}

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

export async function mergeChatSessionRecord(record: Record<string, unknown>): Promise<void> {
  const store = getChatSessionStore();
  const remote = serverChatSessionToLocal(record);
  const bookId = remote.bookId;
  if (!bookId) return;

  const sessions = (await get<LocalChatSession[]>(bookId, store)) ?? [];
  const idx = sessions.findIndex((s) => s.id === remote.id);

  if (remote.deletedAt != null) {
    if (idx < 0) return;
    const local = sessions[idx];
    if (local.updatedAt > remote.updatedAt) return;
    await removeSessionLocally(bookId, remote.id);
    return;
  }

  if (idx < 0) {
    sessions.push(remote);
  } else {
    const local = sessions[idx];
    if (remote.updatedAt > local.updatedAt) {
      sessions[idx] = {
        ...remote,
        messages: local.messages,
      };
    }
  }

  await set(bookId, sessions, store);
}

export async function mergeChatMessageRecord(record: Record<string, unknown>): Promise<void> {
  const store = getChatSessionStore();
  const remoteMsg = serverChatMessageToLocal(record);
  const sessionId = (record.sessionId as string) ?? "";
  if (!sessionId) return;

  const allEntries = await entries<string, LocalChatSession[]>(store);
  for (const entry of allEntries) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const bookId = entry[0];
    const sessions = entry[1];
    if (!Array.isArray(sessions)) continue;
    const sIdx = sessions.findIndex((s) => s && s.id === sessionId);
    if (sIdx < 0) continue;

    const session = sessions[sIdx];
    const exists = session.messages.some((m) => m.id === remoteMsg.id);
    if (!exists) {
      session.messages.push(remoteMsg);
      await set(bookId, sessions, store);
    }
    return;
  }
}

export async function mergeSettingsRecord(record: Record<string, unknown>): Promise<void> {
  const remoteSettings = record.settings as Record<string, unknown> | undefined;
  const remoteUpdatedAt = toTimestamp(record.updatedAt);
  if (!remoteSettings) return;

  const filteredRemote: Record<string, unknown> = {};
  for (const key of SYNCED_SETTINGS_KEYS) {
    if (key in remoteSettings) filteredRemote[key] = remoteSettings[key];
  }

  const STORAGE_KEY = "app-settings";
  let local: Record<string, unknown> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) local = JSON.parse(raw);
  } catch {}

  const localUpdatedAt = typeof local.updatedAt === "number" ? local.updatedAt : 0;

  if (remoteUpdatedAt > localUpdatedAt) {
    const merged = { ...filteredRemote, updatedAt: remoteUpdatedAt };
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
  bookmark: mergeBookmarkRecord,
  notebook: mergeNotebookRecord,
  chat_session: mergeChatSessionRecord,
  chat_message: mergeChatMessageRecord,
  settings: mergeSettingsRecord,
};
