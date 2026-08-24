import {
  addItems,
  createCollection,
  filterCollection,
  removeItem,
  upsertItem,
} from "@augmentcode/themis/utils/collections/collection-utils";
import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

import type { TaggedError } from "~/lib/errors";
import type { ReadingHistoryEntry } from "~/lib/stores/reading-history-store";
import type {
  LocationCacheRecord,
  ReadingHistoryVisitData,
  ReadingPositionRecord,
  ReadingPositionSaveRequest,
  ReadingPositionsFailedCallback,
  ReadingPositionsHydratedCallback,
  ReadingPositionsState,
  RemoteReadingPositionRecord,
} from "~/lib/themis/reading-positions/reading-positions-types";

export const hydrateReadingPositionsRequested = createAction<
  [
    keys: string[],
    onCompleted?: ReadingPositionsHydratedCallback,
    onFailed?: ReadingPositionsFailedCallback,
  ]
>("readingPositions/hydrateRequested");
export const readingPositionsHydrated = createAction<
  [keys: string[], positions: ReadingPositionRecord[]]
>("readingPositions/hydrated");
export const readingPositionChanged = createAction<[request: ReadingPositionSaveRequest]>(
  "readingPositions/positionChanged",
);
export const flushReadingPositionRequested = createAction<[request: ReadingPositionSaveRequest]>(
  "readingPositions/flushRequested",
);
export const readingPositionsSaved =
  createAction<[positions: ReadingPositionRecord[]]>("readingPositions/saved");
export const hydrateLocationCacheRequested = createAction<
  [bookId: string, onCompleted?: ReadingPositionsHydratedCallback]
>("readingPositions/hydrateLocationCacheRequested");
export const locationCacheHydrated = createAction<[bookId: string, json: string | null]>(
  "readingPositions/locationCacheHydrated",
);
export const saveLocationCacheRequested = createAction<[bookId: string, json: string]>(
  "readingPositions/saveLocationCacheRequested",
);
export const locationCacheSaved = createAction<[cache: LocationCacheRecord]>(
  "readingPositions/locationCacheSaved",
);
export const hydrateReadingHistoryRequested = createAction<[bookId: string]>(
  "readingPositions/hydrateHistoryRequested",
);
export const recordReadingHistoryRequested = createAction<
  [bookId: string, data: ReadingHistoryVisitData]
>("readingPositions/recordHistoryRequested");
export const readingHistoryHydrated = createAction<
  [bookId: string, history: ReadingHistoryEntry[]]
>("readingPositions/historyHydrated");
export const checkPositionNudgeRequested = createAction<[bookId: string]>(
  "readingPositions/checkNudgeRequested",
);
export const remoteReadingPositionChecked = createAction<
  [bookId: string, position: RemoteReadingPositionRecord | null]
>("readingPositions/remotePositionChecked");
export const readingPositionsFailed =
  createAction<[keys: string[], error: TaggedError]>("readingPositions/failed");

export const readingPositionsInitialState: ReadingPositionsState = {
  positions: createCollection<ReadingPositionRecord, "key">("key"),
  locationCaches: createCollection<LocationCacheRecord, "bookId">("bookId"),
  history: createCollection<ReadingHistoryEntry, "id">("id"),
  remotePositions: createCollection<RemoteReadingPositionRecord, "bookId">("bookId"),
  errorsByKey: {},
};

const reducer = createReducer<ReadingPositionsState>(readingPositionsInitialState);

reducer.with(readingPositionsHydrated, (state, { payload: [keys, positions] }) => {
  const keySet = new Set(keys);
  const retained = filterCollection(
    state.positions,
    (position): position is ReadingPositionRecord => !keySet.has(position.key),
  );
  const errorsByKey = { ...state.errorsByKey };
  for (const key of keys) delete errorsByKey[key];
  return { ...state, positions: addItems(retained, positions), errorsByKey };
});
reducer.with(readingPositionsSaved, (state, { payload: [positions] }) => {
  let collection = state.positions;
  const errorsByKey = { ...state.errorsByKey };
  for (const position of positions) {
    collection = upsertItem(collection, position);
    delete errorsByKey[position.key];
  }
  return { ...state, positions: collection, errorsByKey };
});
reducer.with(locationCacheHydrated, (state, { payload: [bookId, json] }) => ({
  ...state,
  locationCaches:
    json === null
      ? removeItem(state.locationCaches, bookId)
      : upsertItem(state.locationCaches, { bookId, json }),
}));
reducer.with(locationCacheSaved, (state, { payload: [cache] }) => ({
  ...state,
  locationCaches: upsertItem(state.locationCaches, cache),
}));
reducer.with(readingHistoryHydrated, (state, { payload: [bookId, history] }) => ({
  ...state,
  history: addItems(
    filterCollection(
      state.history,
      (entry): entry is ReadingHistoryEntry => entry.bookId !== bookId,
    ),
    history,
  ),
}));
reducer.with(remoteReadingPositionChecked, (state, { payload: [bookId, position] }) => ({
  ...state,
  remotePositions:
    position === null
      ? removeItem(state.remotePositions, bookId)
      : upsertItem(state.remotePositions, position),
}));
reducer.with(readingPositionsFailed, (state, { payload: [keys, error] }) => ({
  ...state,
  errorsByKey: Object.fromEntries([
    ...Object.entries(state.errorsByKey),
    ...keys.map((key) => [key, error]),
  ]),
}));

export const readingPositionsReducer = reducer;
