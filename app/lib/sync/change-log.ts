import { createStore, get, set, del, entries } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { ulid } from "ulid";
import { isWellFormedEntry } from "./idb-entry";
import type { ChangeEntry } from "./types";

let _changeLogStore: ReturnType<typeof createStore> | null = null;
let positionPushTimer: ReturnType<typeof setTimeout> | null = null;

function getChangeLogStore(): UseStore {
  if (!_changeLogStore) _changeLogStore = createStore("ebook-reader-changelog", "changes");
  return _changeLogStore;
}

function isUnsyncedChangeEntry(entry: unknown): entry is ChangeEntry {
  return (
    !!entry &&
    typeof entry === "object" &&
    "id" in entry &&
    "synced" in entry &&
    typeof entry.id === "string" &&
    entry.synced === false
  );
}

function isSyncedChangeEntry(entry: unknown): entry is ChangeEntry {
  return !!entry && typeof entry === "object" && "synced" in entry && entry.synced === true;
}

function isNonNullIDBValidKey(key: unknown): key is IDBValidKey {
  return key !== null && key !== undefined;
}

export async function recordChange(
  entry: Omit<ChangeEntry, "id" | "synced">,
): Promise<ChangeEntry> {
  const change: ChangeEntry = {
    ...entry,
    id: ulid(),
    synced: false,
  };
  await set(change.id, change, getChangeLogStore());
  if (typeof window !== "undefined") {
    if (entry.entity === "position") {
      if (positionPushTimer) clearTimeout(positionPushTimer);
      positionPushTimer = setTimeout(() => {
        positionPushTimer = null;
        window.dispatchEvent(new CustomEvent("sync:push-needed"));
      }, 5000);
    } else {
      queueMicrotask(() => {
        window.dispatchEvent(new CustomEvent("sync:push-needed"));
      });
    }
  }
  return change;
}

export async function getUnsyncedChanges(): Promise<ChangeEntry[]> {
  const all = await entries<string, ChangeEntry>(getChangeLogStore());
  return all
    .filter(isWellFormedEntry)
    .map(([, value]) => value)
    .filter(isUnsyncedChangeEntry)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function markSynced(ids: string[]): Promise<void> {
  const store = getChangeLogStore();
  await Promise.all(
    ids.map(async (id) => {
      const entry = await get<ChangeEntry>(id, store);
      if (entry) {
        await set(id, { ...entry, synced: true }, store);
      }
    }),
  );
}

export async function clearSyncedChanges(): Promise<number> {
  const store = getChangeLogStore();
  const all = await entries<string, ChangeEntry>(store);
  const synced = all.filter(
    (entry): entry is [string, ChangeEntry] =>
      isWellFormedEntry(entry) && isNonNullIDBValidKey(entry[0]) && isSyncedChangeEntry(entry[1]),
  );
  await Promise.all(synced.map(([key]) => del(key, store)));
  return synced.length;
}
