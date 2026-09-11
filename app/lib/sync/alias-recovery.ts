import { withSyncIdentityLock } from "./sync-lock";
import { get, set } from "idb-keyval";
import { custodySession } from "./custody-session";
import { persistBookRemap, resumeBookRemaps } from "./remap-journal";
import { getAliasProgressStore } from "./stores";
import type { BookAliasPage } from "./delivery-types";

export interface AliasProgress {
  version: 1;
  ownerId: string;
  cursor: string;
  complete: boolean;
}

/** Independent of all legacy cursors/initial flags; a completed scan continues with deltas. */
export async function recoverBookAliases(context: {
  userId: string;
  isStopped: () => boolean;
  onAuthExpired?: () => void;
}): Promise<void> {
  const session = custodySession(context.userId);
  const check = () => {
    session.checkActive();
    if (context.isStopped()) throw new Error("Alias recovery stopped");
  };
  const key = ["aliases", 1, context.userId];
  let progress = await get<AliasProgress>(key, getAliasProgressStore());
  check();
  do {
    const params = new URLSearchParams({ limit: "100" });
    if (progress?.cursor) params.set("cursor", progress.cursor);
    const response = await fetch(`/api/sync/book-aliases?${params}`);
    if (response.status === 401) {
      context.onAuthExpired?.();
      throw new Error("Alias recovery authentication expired");
    }
    if (!response.ok) throw new Error(`Alias recovery failed: ${response.status}`);
    const page: BookAliasPage = await response.json();
    check();
    if (page.ownerId !== context.userId) throw new Error("Alias response owner mismatch");
    if (
      !Array.isArray(page.aliases) ||
      typeof page.cursor !== "string" ||
      typeof page.hasMore !== "boolean" ||
      (page.hasMore && page.cursor === progress?.cursor)
    )
      throw new Error("Invalid alias recovery page");
    for (const alias of page.aliases) {
      if (
        !alias ||
        typeof alias.fromId !== "string" ||
        typeof alias.toId !== "string" ||
        !alias.fromId ||
        !alias.toId ||
        typeof alias.version !== "string"
      )
        throw new Error("Invalid alias evidence");
    }
    await withSyncIdentityLock(async () => {
      check();
      const latest = await get<AliasProgress>(key, getAliasProgressStore());
      if (latest?.cursor !== progress?.cursor) {
        progress = latest;
        return;
      }
      // Entire page is journaled before any cleanup or progress publication.
      for (const alias of page.aliases) {
        check();
        await persistBookRemap(context.userId, alias.fromId, alias.toId);
      }
      check();
      await resumeBookRemaps(context.userId, { isStopped: context.isStopped });
      check();
      progress = {
        version: 1,
        ownerId: context.userId,
        cursor: page.cursor,
        complete: !page.hasMore,
      };
      await set(key, progress, getAliasProgressStore());
    });
  } while (!progress?.complete);
}
