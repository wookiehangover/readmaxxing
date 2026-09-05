import { entries, get } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import {
  getChapterUploadCacheStore,
  remapChapterUploadCache,
} from "~/lib/stores/chapter-upload-cache-store";
import { isFurtherAlong } from "~/lib/position-compare";
import { isWellFormedEntry } from "./idb-entry";
import { appendOnlyMerge, setUnionMerge } from "./merge";
import { moveRemapRecord } from "./remap-records";
import { remapBookmarkId } from "./remap-references";
import type { ChangeEntry } from "./types";
import {
  getActiveSessionStore,
  getBookmarkStore,
  getBookDataStore,
  getBookStore,
  getChatSessionStore,
  getHighlightStore,
  getNotebookStore,
  getPositionStore,
  getRemotePositionStore,
} from "./stores";

export interface RemapStores {
  readonly bookStore: UseStore;
  readonly bookDataStore: UseStore;
  readonly positionStore: UseStore;
  readonly remotePositionStore?: UseStore;
  readonly highlightStore: UseStore;
  readonly bookmarkStore: UseStore;
  readonly notebookStore: UseStore;
  readonly chatSessionStore: UseStore;
  readonly activeSessionStore: UseStore;
  readonly chapterUploadCacheStore?: UseStore;
}

let _defaults: RemapStores | null = null;
export function getDefaultRemapStores(): RemapStores {
  if (!_defaults) {
    _defaults = {
      bookStore: getBookStore(),
      bookDataStore: getBookDataStore(),
      positionStore: getPositionStore(),
      remotePositionStore: getRemotePositionStore(),
      highlightStore: getHighlightStore(),
      bookmarkStore: getBookmarkStore(),
      notebookStore: getNotebookStore(),
      chatSessionStore: getChatSessionStore(),
      activeSessionStore: getActiveSessionStore(),
      chapterUploadCacheStore: getChapterUploadCacheStore(),
    };
  }
  return _defaults;
}

interface ChatMessageLike {
  id: string;
  [k: string]: unknown;
}

interface ChatSessionLike {
  id: string;
  bookId: string;
  messages: ChatMessageLike[];
  updatedAt: number;
  [k: string]: unknown;
}

function mergeSessionArrays(a: ChatSessionLike[], b: ChatSessionLike[]): ChatSessionLike[] {
  const byId = new Map<string, ChatSessionLike>();
  for (const s of a) byId.set(s.id, s);
  for (const s of b) {
    const existing = byId.get(s.id);
    if (!existing) {
      byId.set(s.id, s);
      continue;
    }
    const existingMessageIds = new Set((existing.messages ?? []).map((message) => message.id));
    const messages = appendOnlyMerge<ChatMessageLike>(
      existing.messages ?? [],
      (s.messages ?? []).filter((message) => !existingMessageIds.has(message.id)),
      (m) => m.id,
    );
    const winner = s.updatedAt > existing.updatedAt ? s : existing;
    byId.set(s.id, { ...winner, messages });
  }
  return Array.from(byId.values());
}

type LocalRecord = Record<string, unknown>;

function newer(source: LocalRecord, target?: LocalRecord): LocalRecord {
  return !target || Number(source.updatedAt ?? 0) > Number(target.updatedAt ?? 0) ? source : target;
}

function positionWinner(source: LocalRecord, target?: LocalRecord): LocalRecord {
  if (!target) return source;
  if (isFurtherAlong(String(source.cfi), String(target.cfi))) return source;
  if (isFurtherAlong(String(target.cfi), String(source.cfi))) return target;
  return newer(source, target);
}

export interface RemapOptions {
  /** Durable outbox write must finish before removing a surviving local snapshot. */
  retainReplay?: (
    entry: Pick<ChangeEntry, "entity" | "entityId" | "operation" | "data" | "timestamp">,
  ) => Promise<void>;
  checkActive?: () => void;
}

/** Idempotent per-database moves. Production callers first persist an owned journal intent. */
export async function remapBookId(
  fromId: string,
  toId: string,
  stores: RemapStores = getDefaultRemapStores(),
  options: RemapOptions = {},
): Promise<boolean> {
  if (!fromId || !toId || fromId === toId) return false;
  let changed = false;
  const remap = { fromId, toId };
  const replay = (entity: ChangeEntry["entity"], entityId: string) =>
    options.retainReplay &&
    ((data: LocalRecord) =>
      options.retainReplay!({
        entity,
        entityId,
        data,
        operation: data.deletedAt != null ? "delete" : "put",
        timestamp: Number(data.updatedAt ?? data.createdAt ?? 0),
      }));
  const move = async <T>(
    store: UseStore,
    from: string,
    to: string,
    merge: (source: T, target: T | undefined) => T | undefined,
    extra: Parameters<typeof moveRemapRecord<T>>[4] = {},
  ) => {
    changed =
      (await moveRemapRecord(store, from, to, merge, {
        checkActive: options.checkActive,
        ...extra,
      })) || changed;
  };

  await move<ArrayBuffer>(stores.bookDataStore, fromId, toId, (source, target) => target ?? source);
  await move<LocalRecord>(stores.positionStore, fromId, toId, positionWinner, {
    prepare: replay("position", fromId),
  });
  if (stores.remotePositionStore) {
    await move<LocalRecord>(stores.remotePositionStore, fromId, toId, positionWinner);
  }
  await move<LocalRecord>(
    stores.notebookStore,
    fromId,
    toId,
    (source, target) => newer({ ...source, bookId: toId }, target),
    { prepare: replay("notebook", fromId) },
  );

  for (const entry of await entries<string, LocalRecord>(stores.highlightStore)) {
    if (!isWellFormedEntry(entry)) continue;
    const [id, record] = entry;
    if (record?.bookId !== fromId) continue;
    await move<LocalRecord>(
      stores.highlightStore,
      id,
      id,
      (source) => ({ ...source, bookId: toId }),
      {
        matches: (source) => source.bookId === fromId,
        prepare: replay("highlight", id),
      },
    );
  }
  for (const entry of await entries<string, LocalRecord>(stores.bookmarkStore)) {
    if (!isWellFormedEntry(entry)) continue;
    const [id, record] = entry;
    if (record?.bookId !== fromId) continue;
    const canonicalId = remapBookmarkId(id, remap);
    await move<LocalRecord>(
      stores.bookmarkStore,
      id,
      canonicalId,
      (source, target) => {
        const rewritten = { ...source, id: canonicalId, bookId: toId };
        if (!target || id === canonicalId) return rewritten;
        return setUnionMerge([target], [rewritten], (item) => String(item.id))[0];
      },
      {
        matches: (source) => source.bookId === fromId,
        prepare: replay("bookmark", id),
      },
    );
  }

  await move<ChatSessionLike[]>(
    stores.chatSessionStore,
    fromId,
    toId,
    (source, target) =>
      mergeSessionArrays(
        target ?? [],
        source.map((s) => ({ ...s, bookId: toId })),
      ),
    {
      prepare:
        options.retainReplay &&
        (async (sessions) => {
          for (const session of sessions) {
            await replay("chat_session", session.id)!(session);
          }
          // Messages are server-authored and cannot be republished through
          // sync/push. Their IDs and cached content move with their session.
        }),
    },
  );
  await move<string>(stores.activeSessionStore, fromId, toId, (source, target) => target ?? source);
  if (stores.chapterUploadCacheStore) {
    if ((await get(fromId, stores.chapterUploadCacheStore)) !== undefined) {
      options.checkActive?.();
      await remapChapterUploadCache(fromId, toId, stores.chapterUploadCacheStore);
      changed = true;
    }
  }

  // The alias marker is local bookkeeping, not a new source mutation. Keep its
  // clock, and do not use its synthetic tombstone to delete the canonical book.
  await move<LocalRecord>(
    stores.bookStore,
    fromId,
    toId,
    (source, target) => {
      // Canonical metadata comes from the server. A losing alias is not a
      // newer rename/restore, even if its local mutation clock is higher.
      if (!target) return undefined;
      return {
        ...target,
        hasLocalFile: target?.hasLocalFile || source.hasLocalFile,
        coverImage: target?.coverImage ?? source.coverImage,
      };
    },
    {
      matches: (source) => source.canonicalId !== toId,
      keepSource: (source) => ({
        ...source,
        canonicalId: toId,
        deletedAt: source.deletedAt ?? source.updatedAt ?? 0,
      }),
    },
  );
  return changed;
}
