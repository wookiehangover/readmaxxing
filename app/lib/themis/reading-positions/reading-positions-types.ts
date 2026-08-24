import type { Collection } from "@augmentcode/themis/utils/collections/collection-utils";

import type { TaggedError } from "~/lib/errors";
import type {
  ReadingHistoryEntry,
  ReadingHistoryVisitData,
} from "~/lib/stores/reading-history-store";
import type { SavePositionOptions } from "~/lib/stores/position-store";

export interface ReadingPositionRecord {
  key: string;
  cfi: string;
  updatedAt: number;
  localProgression?: number;
  spineIndex?: number;
}

export interface LocationCacheRecord {
  bookId: string;
  json: string;
}

export interface RemoteReadingPositionRecord {
  bookId: string;
  cfi: string;
  updatedAt: number;
}

export interface ReadingPositionSaveRequest {
  panelId?: string;
  bookId: string;
  cfi: string;
  localProgression?: number;
  spineIndex?: number;
}

export type ReadingPositionsHydratedCallback = () => void;
export type ReadingPositionsFailedCallback = (error: string) => void;

export interface ReadingPositionsState {
  positions: Collection<ReadingPositionRecord, "key">;
  locationCaches: Collection<LocationCacheRecord, "bookId">;
  history: Collection<ReadingHistoryEntry, "id">;
  remotePositions: Collection<RemoteReadingPositionRecord, "bookId">;
  errorsByKey: Record<string, TaggedError>;
}

export type { ReadingHistoryVisitData, SavePositionOptions };
