import type { AppStoreCore } from "~/lib/themis/store";
import { emptyBookRepair } from "./repairs-slice";

export function createRepairsSelectors(store: AppStoreCore) {
  return {
    selectBookRepair: store.createSelector(
      (state, bookId: string) => state.repairs.byBookId[bookId] ?? emptyBookRepair,
    ),
    selectRepairScopes: store.createSelector((state) =>
      Object.entries(state.readingRail.selections)
        .filter(([, tab]) => tab === "Repair")
        .map(([scope]) => scope),
    ),
  };
}
