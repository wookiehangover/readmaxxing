import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

import type { TaggedError } from "~/lib/errors";
import type { WorkspaceRestoreState } from "~/lib/themis/workspace-restore/workspace-restore-types";

export const hydrateWorkspaceRestore = createAction("workspaceRestore/hydrate");
export const workspaceRestoreHydrated = createAction<[lastOpenedByBookId: Record<string, number>]>(
  "workspaceRestore/hydrated",
);
export const workspaceRestoreHydrateFailed = createAction<[error: TaggedError]>(
  "workspaceRestore/hydrateFailed",
);
export const recordBookOpened = createAction<[bookId: string]>("workspaceRestore/recordBookOpened");
export const bookOpenedRecorded = createAction<[bookId: string, timestamp: number]>(
  "workspaceRestore/bookOpenedRecorded",
);
export const workspaceRestoreUpdateFailed = createAction<[error: TaggedError]>(
  "workspaceRestore/updateFailed",
);

export const workspaceRestoreInitialState: WorkspaceRestoreState = {
  lastOpenedByBookId: {},
  loading: false,
  error: null,
};

const reducer = createReducer<WorkspaceRestoreState>(workspaceRestoreInitialState);

reducer.with(hydrateWorkspaceRestore, (state) => ({ ...state, loading: true, error: null }));
reducer.with(workspaceRestoreHydrated, (state, { payload: [lastOpenedByBookId] }) => {
  const mergedLastOpenedByBookId = { ...lastOpenedByBookId };
  for (const [bookId, timestamp] of Object.entries(state.lastOpenedByBookId)) {
    mergedLastOpenedByBookId[bookId] = Math.max(
      timestamp,
      mergedLastOpenedByBookId[bookId] ?? timestamp,
    );
  }

  return {
    ...state,
    lastOpenedByBookId: mergedLastOpenedByBookId,
    loading: false,
    error: null,
  };
});
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
reducer.with(workspaceRestoreUpdateFailed, (state, { payload: [error] }) => ({
  ...state,
  error,
}));

export const workspaceRestoreReducer = reducer;
