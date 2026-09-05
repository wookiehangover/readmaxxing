import { entries, promisifyRequest, update } from "idb-keyval";
import { assignRemapOwners, remapQueuedChanges, retainRemapReplay } from "./change-log";
import { getDefaultRemapStores, remapBookId, type RemapStores } from "./remap";
import type { BookIdRemap } from "./remap-references";
import { getBookRemapStore } from "./stores";

export interface BookRemapIntent extends BookIdRemap {
  ownerId: string;
  complete: boolean;
}

const intentKey = (ownerId: string, fromId: string) => JSON.stringify([ownerId, fromId]);
// Notifications cannot be committed with IDB. Republish on the first recovery
// in each runtime, including a crash after completion but before dispatch.
const publishedRemaps = new Set<string>();

export async function persistBookRemap(
  ownerId: string,
  fromId: string,
  toId: string,
): Promise<void> {
  if (!ownerId || !fromId || !toId || fromId === toId) return;
  let invalid: Error | undefined;
  try {
    await getBookRemapStore()("readwrite", (store) => {
      const values = store.getAll();
      const keys = store.getAllKeys();
      keys.onsuccess = () => {
        try {
          const byId = new Map<string, string>();
          for (const [index, intent] of (values.result as BookRemapIntent[]).entries()) {
            const ownedKey = intentKey(ownerId, intent.fromId);
            if (keys.result[index] === ownedKey && intent.ownerId !== ownerId) {
              throw new Error("Book remap owner mismatch; evidence retained");
            }
            if (intent.ownerId !== ownerId) continue;
            if (keys.result[index] !== ownedKey) {
              throw new Error("Invalid owned remap identity; evidence retained");
            }
            byId.set(intent.fromId, intent.toId);
          }
          const target = resolveTarget(toId, byId, fromId);
          const previousTarget = resolveTarget(fromId, byId);
          if (previousTarget === target) return;
          // Aliases are permanent: later authoritative A→D after A→C proves
          // the old terminal C moved to D. Keep A→C and append C→D atomically,
          // so surviving C data and stale producers retain their recovery path.
          // Resolving both ends also makes delayed A→C responses harmless.
          store.put(
            { ownerId, fromId: previousTarget, toId: target, complete: false },
            intentKey(ownerId, previousTarget),
          );
        } catch (error) {
          invalid = error as Error;
          store.transaction.abort();
        }
      };
      return promisifyRequest(store.transaction);
    });
  } catch (error) {
    throw invalid ?? error;
  }
}

export async function getBookRemaps(ownerId?: string): Promise<BookRemapIntent[]> {
  const all = await entries<string, BookRemapIntent>(getBookRemapStore());
  return all.flatMap(([key, entry]) =>
    entry?.ownerId &&
    (!ownerId || entry.ownerId === ownerId) &&
    key === intentKey(entry.ownerId, entry.fromId) &&
    entry.fromId &&
    entry.toId
      ? [entry]
      : [],
  );
}

function resolveTarget(id: string, byId: Map<string, string>, forbidden?: string): string {
  const seen = new Set(forbidden ? [forbidden] : []);
  for (;;) {
    if (seen.has(id)) throw new Error("Cyclic canonical book identity; remap evidence retained");
    seen.add(id);
    const next = byId.get(id);
    if (!next) return id;
    id = next;
  }
}

function resolveRemaps(intents: BookRemapIntent[]): BookIdRemap[] {
  const byId = new Map(intents.map((intent) => [intent.fromId, intent.toId]));
  return intents.map(({ fromId, toId }) => ({ fromId, toId: resolveTarget(toId, byId, fromId) }));
}

function publishRemap(key: string, bookIdRemap: BookIdRemap, isStopped?: () => boolean): void {
  if (typeof window === "undefined") return;
  queueMicrotask(() => {
    if (isStopped?.()) return;
    for (const entity of [
      "book",
      "position",
      "highlight",
      "bookmark",
      "notebook",
      "chat_session",
    ] as const) {
      window.dispatchEvent(
        new CustomEvent("sync:entity-updated", {
          detail: entity === "book" ? { entity, bookIdRemap } : { entity },
        }),
      );
    }
    publishedRemaps.add(key);
  });
}

/** Kept after migration: stale tabs/producers can still append old IDs at any time. */
export async function resumeBookRemaps(
  ownerId: string,
  options: { isStopped?: () => boolean; stores?: RemapStores } = {},
): Promise<void> {
  const checkActive = () => {
    if (options.isStopped?.()) throw new Error("Book remap stopped; recovery intent retained");
  };
  checkActive();
  const allIntents = await getBookRemaps();
  await assignRemapOwners(allIntents);
  const intents = allIntents.filter((intent) => intent.ownerId === ownerId);
  if (!intents.length) return;
  const remaps = resolveRemaps(intents);
  let queued = await remapQueuedChanges(ownerId, remaps);
  const notifications: Array<{ key: string; remap: BookIdRemap }> = [];
  for (const [index, remap] of remaps.entries()) {
    checkActive();
    let moved = false;
    let anotherPass: boolean;
    do {
      const passMoved = await remapBookId(
        remap.fromId,
        remap.toId,
        options.stores ?? getDefaultRemapStores(),
        { checkActive, retainReplay: (change) => retainRemapReplay(ownerId, remap, change) },
      );
      // A stale producer may have written a source key we already visited.
      const passQueued = await remapQueuedChanges(ownerId, remaps);
      moved ||= passMoved;
      queued ||= passQueued;
      anotherPass = passMoved || passQueued;
    } while (anotherPass);
    checkActive();
    await update<BookRemapIntent>(
      intentKey(ownerId, remap.fromId),
      (intent) => {
        if (!intent || intent.ownerId !== ownerId) throw new Error("Missing owned remap intent");
        return { ...intent, complete: true };
      },
      getBookRemapStore(),
    );
    const key = JSON.stringify([ownerId, remap.fromId, remap.toId]);
    if (moved || queued || !intents[index].complete || !publishedRemaps.has(key)) {
      notifications.push({ key, remap });
    }
  }
  checkActive();
  for (const { key, remap } of notifications) publishRemap(key, remap, options.isStopped);
}
