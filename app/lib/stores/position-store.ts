import { get, set } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { PositionError } from "~/lib/errors";
import { recordChange } from "~/lib/sync/change-log";
import { getPositionStore } from "~/lib/sync/stores";

export interface PositionRecord {
  cfi: string;
  updatedAt: number;
  localProgression?: number;
  spineIndex?: number;
}

function migratePosition(raw: unknown): PositionRecord | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
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
        const existing = migratePosition(await get<unknown>(bookId, positionStore));
        if (existing?.cfi === cfi) {
          const pending = pendingLocalOnlyChanges.get(bookId);
          const layoutMatches =
            existing.localProgression === localProgression && existing.spineIndex === spineIndex;
          const record: PositionRecord = layoutMatches
            ? existing
            : {
                cfi,
                updatedAt: existing.updatedAt,
                ...(localProgression !== undefined ? { localProgression } : {}),
                ...(spineIndex !== undefined ? { spineIndex } : {}),
              };
          if (!layoutMatches) {
            await set(bookId, record, positionStore);
            if (pending?.cfi === cfi) pendingLocalOnlyChanges.set(bookId, record);
          }
          if (shouldRecordChange && pending?.cfi === cfi) {
            pendingLocalOnlyChanges.delete(bookId);
            enqueuePositionChange(bookId, record);
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
