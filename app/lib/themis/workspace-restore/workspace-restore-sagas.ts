import { Effect } from "effect";
import { call, put, takeEvery, takeLatest } from "typed-redux-saga";

import { AppRuntime } from "~/lib/effect-runtime";
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
  return AppRuntime.runPromise(
    WorkspaceService.pipe(
      Effect.andThen((service) =>
        Effect.all({
          lastOpened: service.getLastOpenedMap(),
          focusedWorkspace: service.getFocusedState(),
        }),
      ),
      Effect.map(({ lastOpened, focusedWorkspace }) => ({
        lastOpenedByBookId: Object.fromEntries(lastOpened),
        focusedWorkspace,
      })),
    ),
  );
}

async function persistLastOpened(bookId: string, timestamp: number) {
  return AppRuntime.runPromise(
    WorkspaceService.pipe(Effect.andThen((service) => service.saveLastOpened(bookId, timestamp))),
  );
}

async function persistFocusedWorkspace(focusedWorkspace: FocusedWorkspaceState | null) {
  return AppRuntime.runPromise(
    WorkspaceService.pipe(
      Effect.andThen((service) =>
        focusedWorkspace ? service.saveFocusedState(focusedWorkspace) : service.clearFocusedState(),
      ),
    ),
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function* hydrateWorkspaceRestoreSaga() {
  try {
    const { lastOpenedByBookId, focusedWorkspace } = yield* call(loadWorkspaceRestore);
    yield* put(workspaceRestoreHydrated(lastOpenedByBookId, focusedWorkspace));
  } catch (error) {
    yield* put(workspaceRestoreHydrateFailed(errorMessage(error)));
  }
}

export function* recordBookOpenedSaga(action: ReturnType<typeof recordBookOpened>) {
  const [bookId] = action.payload;
  const timestamp = Date.now();
  try {
    yield* call(persistLastOpened, bookId, timestamp);
    yield* put(bookOpenedRecorded(bookId, timestamp));
  } catch (error) {
    yield* put(workspaceRestoreUpdateFailed(errorMessage(error)));
  }
}

export function* saveFocusedWorkspaceSaga(action: ReturnType<typeof saveFocusedWorkspace>) {
  const [focusedWorkspace] = action.payload;
  try {
    yield* call(persistFocusedWorkspace, focusedWorkspace);
    yield* put(focusedWorkspaceSaved(focusedWorkspace));
  } catch (error) {
    yield* put(workspaceRestoreUpdateFailed(errorMessage(error)));
  }
}

export function* workspaceRestoreSaga() {
  yield* takeLatest(hydrateWorkspaceRestore, hydrateWorkspaceRestoreSaga);
  yield* takeEvery(recordBookOpened, recordBookOpenedSaga);
  yield* takeLatest(saveFocusedWorkspace, saveFocusedWorkspaceSaga);
}
