import { call, put, takeEvery, takeLatest } from "typed-redux-saga";

import { toTaggedError } from "~/lib/errors";
import { WorkspaceService } from "~/lib/stores/workspace-store";
import {
  bookOpenedRecorded,
  hydrateWorkspaceRestore,
  recordBookOpened,
  workspaceRestoreHydrateFailed,
  workspaceRestoreHydrated,
  workspaceRestoreUpdateFailed,
} from "~/lib/themis/workspace-restore/workspace-restore-slice";

async function loadWorkspaceRestore() {
  const lastOpened = await WorkspaceService.getLastOpenedMap();
  return Object.fromEntries(lastOpened);
}

async function persistLastOpened(bookId: string, timestamp: number) {
  return WorkspaceService.saveLastOpened(bookId, timestamp);
}

export function* hydrateWorkspaceRestoreSaga() {
  try {
    const lastOpenedByBookId = yield* call(loadWorkspaceRestore);
    yield* put(workspaceRestoreHydrated(lastOpenedByBookId));
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

export function* workspaceRestoreSaga() {
  yield* takeLatest(hydrateWorkspaceRestore, hydrateWorkspaceRestoreSaga);
  yield* takeEvery(recordBookOpened, recordBookOpenedSaga);
}
