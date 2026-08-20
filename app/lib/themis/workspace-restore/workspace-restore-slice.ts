import { createCollection } from "@augmentcode/themis/utils/collections/collection-utils";
import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

import type { FocusedWorkspaceCluster, FocusedWorkspaceState } from "~/lib/stores/workspace-store";
import type { WorkspaceRestoreState } from "~/lib/themis/workspace-restore/workspace-restore-types";

export const hydrateWorkspaceRestore = createAction("workspaceRestore/hydrate");
export const workspaceRestoreHydrated = createAction<
  [lastOpenedByBookId: Record<string, number>, focusedWorkspace: FocusedWorkspaceState | null]
>("workspaceRestore/hydrated");
export const workspaceRestoreHydrateFailed = createAction<[error: string]>(
  "workspaceRestore/hydrateFailed",
);
export const recordBookOpened = createAction<[bookId: string]>("workspaceRestore/recordBookOpened");
export const bookOpenedRecorded = createAction<[bookId: string, timestamp: number]>(
  "workspaceRestore/bookOpenedRecorded",
);
export const saveFocusedWorkspace = createAction<[focusedWorkspace: FocusedWorkspaceState | null]>(
  "workspaceRestore/saveFocusedWorkspace",
);
export const focusedWorkspaceSaved = createAction<[focusedWorkspace: FocusedWorkspaceState | null]>(
  "workspaceRestore/focusedWorkspaceSaved",
);
export const workspaceRestoreUpdateFailed = createAction<[error: string]>(
  "workspaceRestore/updateFailed",
);

export const workspaceRestoreInitialState: WorkspaceRestoreState = {
  lastOpenedByBookId: {},
  focusedWorkspace: null,
  loading: false,
  error: null,
};

function normalizeFocusedWorkspace(
  focusedWorkspace: FocusedWorkspaceState | null,
): WorkspaceRestoreState["focusedWorkspace"] {
  if (!focusedWorkspace) return null;
  return {
    order: [...focusedWorkspace.order],
    activeBookId: focusedWorkspace.activeBookId,
    clusters: createCollection<FocusedWorkspaceCluster, "bookId">("bookId", [
      ...focusedWorkspace.clusters,
    ]),
  };
}

const reducer = createReducer<WorkspaceRestoreState>(workspaceRestoreInitialState);

reducer.with(hydrateWorkspaceRestore, (state) => ({ ...state, loading: true, error: null }));
reducer.with(
  workspaceRestoreHydrated,
  (state, { payload: [lastOpenedByBookId, focusedWorkspace] }) => ({
    ...state,
    lastOpenedByBookId,
    focusedWorkspace: normalizeFocusedWorkspace(focusedWorkspace),
    loading: false,
    error: null,
  }),
);
reducer.with(workspaceRestoreHydrateFailed, (state, { payload: [error] }) => ({
  ...state,
  loading: false,
  error,
}));
reducer.with(bookOpenedRecorded, (state, { payload: [bookId, timestamp] }) => {
  if (state.lastOpenedByBookId[bookId] === timestamp) return state;
  return {
    ...state,
    lastOpenedByBookId: { ...state.lastOpenedByBookId, [bookId]: timestamp },
    error: null,
  };
});
reducer.with(focusedWorkspaceSaved, (state, { payload: [focusedWorkspace] }) => ({
  ...state,
  focusedWorkspace: normalizeFocusedWorkspace(focusedWorkspace),
  error: null,
}));
reducer.with(workspaceRestoreUpdateFailed, (state, { payload: [error] }) => ({
  ...state,
  error,
}));

export const workspaceRestoreReducer = reducer;
