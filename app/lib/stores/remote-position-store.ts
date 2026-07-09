import { get } from "idb-keyval";
import { getRemotePositionStore } from "~/lib/sync/stores";

export interface RemotePositionRecord {
  cfi: string;
  updatedAt: number;
}

export async function getRemotePositionRecord(
  bookId: string,
): Promise<RemotePositionRecord | null> {
  const raw = await get<unknown>(bookId, getRemotePositionStore());
  if (!raw || typeof raw !== "object" || !("cfi" in raw)) return null;

  const record = raw as Partial<RemotePositionRecord>;
  if (typeof record.cfi !== "string") return null;

  return {
    cfi: record.cfi,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
  };
}