import { get, set } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { PositionError } from "~/lib/errors";
import { recordChange } from "~/lib/sync/change-log";
import { getPositionStore } from "~/lib/sync/stores";

// --- Types ---

/** New position record with LWW timestamp. */
export interface PositionRecord {
  cfi: string;
  updatedAt: number;
  /**
   * Section-local progression [0, 1] from the navigator at save time.
   * Used to restore the exact paginated column after refresh (CFI geometry alone
   * is too easy to land one page early/late).
   */
  localProgression?: number;
  /** Spine index at save time; paired with localProgression for restore. */
  spineIndex?: number;
}

// --- idb-keyval store imported from ~/lib/sync/stores ---

/**
 * Migrate a raw IDB value to PositionRecord.
 * Old format: plain string CFI. New format: { cfi, updatedAt, ... }.
 */
function migratePosition(raw: unknown): PositionRecord | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    // Legacy plain-string format — treat as { cfi, updatedAt: 0 }
    return { cfi: raw, updatedAt: 0 };
  }
  if (typeof raw === "object" && "cfi" in raw) {
    const rec = raw as PositionRecord;
    return {
      cfi: rec.cfi,
      updatedAt: rec.updatedAt ?? 0,
      ...(typeof rec.localProgression === "number"
        ? { localProgression: rec.localProgression }
        : {}),
      ...(typeof rec.spineIndex === "number" ? { spineIndex: rec.spineIndex } : {}),
    };
  }
  return null;
}

/**
 * Options for {@link ReadingPositionService.savePosition}.
 *
 * `recordChange` controls whether the write is appended to the sync changelog.
 * Defaults to `true`. Set to `false` for local-only writes such as the
 * panel-specific mirror saved by `savePositionDualKey` — panel ids are
 * device-local UUIDs that no other device can ever consume, so syncing them
 * just doubles every page-turn push for zero benefit.
 */
export interface SavePositionOptions {
  readonly recordChange?: boolean;
  readonly localProgression?: number;
  readonly spineIndex?: number;
}

export interface PositionServiceStores {
  readonly positionStore: UseStore;
}

export function makePositionService(stores: PositionServiceStores) {
  const { positionStore } = stores;
  const pendingLocalOnlyChanges = new Map<string, PositionRecord>();

  const enqueuePositionChange = (bookId: string, record: PositionRecord) => {
    recordChange({
      entity: "position",
      entityId: bookId,
      operation: "put",
      data: record,
      timestamp: record.updatedAt,
    }).catch(console.error);
  };

  return {
    async savePosition(bookId: string, cfi: string, options?: SavePositionOptions) {
      try {
        const shouldRecordChange = options?.recordChange !== false;
        const localProgression =
          typeof options?.localProgression === "number" && Number.isFinite(options.localProgression)
            ? Math.min(1, Math.max(0, options.localProgression))
            : undefined;
        const spineIndex =
          typeof options?.spineIndex === "number" &&
          Number.isInteger(options.spineIndex) &&
          options.spineIndex >= 0
            ? options.spineIndex
            : undefined;
        // Short-circuit no-op writes: if the stored CFI (and layout fields)
        // match exactly, skip the IDB write, and only record a sync changelog
        // when this matches a pending local-only save.
        const existing = migratePosition(await get<unknown>(bookId, positionStore));
        if (
          existing &&
          existing.cfi === cfi &&
          existing.localProgression === localProgression &&
          existing.spineIndex === spineIndex
        ) {
          const pending = pendingLocalOnlyChanges.get(bookId);
          if (shouldRecordChange && pending?.cfi === cfi) {
            pendingLocalOnlyChanges.delete(bookId);
            enqueuePositionChange(bookId, pending);
          }
          return;
        }

        const record: PositionRecord = {
          cfi,
          updatedAt: Date.now(),
          ...(localProgression !== undefined ? { localProgression } : {}),
          ...(spineIndex !== undefined ? { spineIndex } : {}),
        };
        await set(bookId, record, positionStore);
        if (shouldRecordChange) {
          pendingLocalOnlyChanges.delete(bookId);
          enqueuePositionChange(bookId, record);
        } else {
          pendingLocalOnlyChanges.set(bookId, record);
        }
      } catch (cause) {
        throw new PositionError({ operation: "savePosition", bookId, cause });
      }
    },

    async getPosition(bookId: string) {
      try {
        const raw = await get<unknown>(bookId, positionStore);
        const record = migratePosition(raw);
        return record?.cfi ?? null;
      } catch (cause) {
        throw new PositionError({ operation: "getPosition", bookId, cause });
      }
    },

    async getPositionRecord(bookId: string) {
      try {
        const raw = await get<unknown>(bookId, positionStore);
        return migratePosition(raw);
      } catch (cause) {
        throw new PositionError({ operation: "getPositionRecord", bookId, cause });
      }
    },
  };
}

export const ReadingPositionService = makePositionService({ positionStore: getPositionStore() });
