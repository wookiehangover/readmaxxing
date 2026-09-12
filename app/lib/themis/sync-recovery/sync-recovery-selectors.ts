import { getItem, getItems } from "@augmentcode/themis/utils/collections/collection-utils";
import type { AppStoreCore } from "../store";

export function createSyncRecoverySelectors(store: AppStoreCore) {
  return {
    selectRecoveryState: store.createSelector((state) => state.syncRecovery),
    selectRecoveryItems: store.createSelector((state) => getItems(state.syncRecovery.items)),
    selectRecoveryItem: store.createSelector((state) =>
      state.syncRecovery.selectedId
        ? getItem(state.syncRecovery.items, state.syncRecovery.selectedId)
        : undefined,
    ),
  };
}
