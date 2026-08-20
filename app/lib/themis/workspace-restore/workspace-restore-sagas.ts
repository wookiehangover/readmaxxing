import { call, put, takeEvery, takeLatest } from "typed-redux-saga";

import { toTaggedError } from "~/lib/errors";
import { WorkspaceService, type FocusedWorkspaceState } from "~/lib/stores/workspace-store";
import {
  bookOpenedRecorded,
  focusedWorkspaceSaved,
  hydrateWorkspaceRestore,
  recordBookOpened,
  saveFocusedWorkspace,
  workspaceRestoreHydrateFailed,
  workspaceRestoreHydrated,
  workspaceRestoreUpdateFailed,
} from "~/lib/themis/workspace-restore/workspace-restore-slice";

async function loadWorkspaceRestore() {
  const [lastOpened, focusedWorkspace] = await Promise.all([
    WorkspaceService.getLastOpenedMap(),
    WorkspaceService.getFocusedState(),
  ]);
  return { lastOpenedByBookId: Object.fromEntries(lastOpened), focusedWorkspace };
}

async function persistLastOpened(bookId: string, timestamp: number) {
  return WorkspaceService.saveLastOpened(bookId, timestamp);
}

async function persistFocusedWorkspace(focusedWorkspace: FocusedWorkspaceState | null) {
  return focusedWorkspace
    ? WorkspaceService.saveFocusedState(focusedWorkspace)
    : WorkspaceService.clearFocusedState();
}

export function* hydrateWorkspaceRestoreSaga() {
  try {
    const { lastOpenedByBookId, focusedWorkspace } = yield* call(loadWorkspaceRestore);
    yield* put(workspaceRestoreHydrated(lastOpenedByBookId, focusedWorkspace));
  } catch (error) {
    yield* put(workspaceRestoreHydrateFailed(toTaggedError(error)));
  }
}

export function* recordBookOpenedSaga(action: ReturnType<typeof recordBookOpened>) {
  const [bookId] = action.payload;
  const timestamp = Date.now();
  try {
    yield* call(persistLastOpened, bookId, timestamp);
    yield* put(bookOpenedRecorded(bookId, timestamp));
  } catch (error) {
    yield* put(workspaceRestoreUpdateFailed(toTaggedError(error)));
  }
}

export function* saveFocusedWorkspaceSaga(action: ReturnType<typeof saveFocusedWorkspace>) {
  const [focusedWorkspace] = action.payload;
  try {
    yield* call(persistFocusedWorkspace, focusedWorkspace);
    yield* put(focusedWorkspaceSaved(focusedWorkspace));
  } catch (error) {
    yield* put(workspaceRestoreUpdateFailed(toTaggedError(error)));
  }
}

export function* workspaceRestoreSaga() {
  yield* takeLatest(hydrateWorkspaceRestore, hydrateWorkspaceRestoreSaga);
  yield* takeEvery(recordBookOpened, recordBookOpenedSaga);
  yield* takeLatest(saveFocusedWorkspace, saveFocusedWorkspaceSaga);
}
