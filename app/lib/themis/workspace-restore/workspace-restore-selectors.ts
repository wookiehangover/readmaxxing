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
    selectWorkspaceRestoreLoading: store.createSelector((state) => state.workspaceRestore.loading),
    selectWorkspaceRestoreError: store.createSelector((state) => state.workspaceRestore.error),
  };
}
