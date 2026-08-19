import { getItem } from "@augmentcode/themis/utils/collections/collection-utils";

import type { AppStoreCore } from "~/lib/themis/store";

export function createWorkspaceRestoreSelectors(store: AppStoreCore) {
  return {
    selectLastOpenedByBookId: store.createSelector(
      (state) => state.workspaceRestore.lastOpenedByBookId,
    ),
    selectLastOpenedAt: store.createSelector(
      (state, bookId: string) => state.workspaceRestore.lastOpenedByBookId[bookId],
    ),
    selectLastOpenedMap: store.createSelector(
      (state) => new Map(Object.entries(state.workspaceRestore.lastOpenedByBookId)),
    ),
    selectFocusedWorkspace: store.createSelector((state) => {
      const focused = state.workspaceRestore.focusedWorkspace;
      if (!focused) return null;
      return {
        order: focused.order,
        activeBookId: focused.activeBookId,
        clusters: focused.order.flatMap((bookId) => {
          const cluster = getItem(focused.clusters, bookId);
          return cluster ? [cluster] : [];
        }),
      };
    }),
    selectWorkspaceRestoreLoading: store.createSelector((state) => state.workspaceRestore.loading),
    selectWorkspaceRestoreError: store.createSelector((state) => state.workspaceRestore.error),
  };
}
