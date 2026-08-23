import { filterItems, getItem } from "@augmentcode/themis/utils/collections/collection-utils";

import { isFurtherAlong } from "~/lib/position-compare";
import type { AppStoreCore } from "~/lib/themis/store";

function hasReachedPosition(positionCfi: string, targetCfi: string): boolean {
  return positionCfi === targetCfi || isFurtherAlong(positionCfi, targetCfi);
}

export function createReadingPositionsSelectors(store: AppStoreCore) {
  return {
    selectPosition: store.createSelector((state, key: string) =>
      getItem(state.readingPositions.positions, key),
    ),
    selectLocationCache: store.createSelector((state, bookId: string) =>
      getItem(state.readingPositions.locationCaches, bookId),
    ),
    selectReadingHistory: store.createSelector((state, bookId: string) =>
      filterItems(
        state.readingPositions.history,
        (entry): entry is typeof entry => entry.bookId === bookId,
      ),
    ),
    selectPositionNudge: store.createSelector((state, bookId: string) => {
      const local = getItem(state.readingPositions.positions, bookId);
      const remote = getItem(state.readingPositions.remotePositions, bookId);
      if (!local || !remote || !isFurtherAlong(remote.cfi, local.cfi)) return null;

      const previouslyReachedRemote = filterItems(
        state.readingPositions.history,
        (entry): entry is typeof entry => entry.bookId === bookId,
      ).some((entry) => hasReachedPosition(entry.cfi, remote.cfi));
      return previouslyReachedRemote ? null : remote;
    }),
    selectReadingPositionError: store.createSelector(
      (state, key: string) => state.readingPositions.errorsByKey[key] ?? null,
    ),
  };
}
