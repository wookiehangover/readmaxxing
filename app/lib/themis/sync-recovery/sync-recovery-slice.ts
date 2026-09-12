import { createCollection } from "@augmentcode/themis/utils/collections/collection-utils";
import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
import {
  authSessionCleared,
  authSessionFailed,
  authSessionResolved,
  logoutRequested,
  refreshAuthSessionRequested,
} from "../auth-session/auth-session-slice";
import type {
  RecoveryCommand,
  RecoveryItem,
  RecoveryView,
  SyncRecoveryState,
} from "./sync-recovery-types";

export const refreshRecovery = createAction<[includeServer?: boolean]>("syncRecovery/refresh");
export const selectRecovery = createAction<[id: string | null]>("syncRecovery/select");
export const runRecoveryCommand =
  createAction<
    [command: RecoveryCommand, viewToken: string, attachment?: number, targetBookId?: string]
  >("syncRecovery/runCommand");
export const recoveryLoaded =
  createAction<[items: RecoveryItem[], error: string | null]>("syncRecovery/loaded");
export const recoveryViewLoaded = createAction<[view: RecoveryView]>("syncRecovery/viewLoaded");
export const recoveryCommandStarted = createAction("syncRecovery/commandStarted");
export const recoveryCommandFinished = createAction<[notice: string]>(
  "syncRecovery/commandFinished",
);
export const recoveryFailed = createAction<[error: string]>("syncRecovery/failed");

export const recoveryInitialState: SyncRecoveryState = {
  items: createCollection<RecoveryItem, "id">("id"),
  selectedId: null,
  view: null,
  loading: false,
  busy: false,
  error: null,
  notice: null,
};
export const syncRecoveryReducer = createReducer<SyncRecoveryState>(recoveryInitialState);
syncRecoveryReducer.with(refreshRecovery, (state) => ({ ...state, loading: true, error: null }));
syncRecoveryReducer.with(recoveryLoaded, (state, { payload: [items, error] }) => ({
  ...state,
  items: createCollection<RecoveryItem, "id">("id", items),
  loading: false,
  error,
}));
syncRecoveryReducer.with(selectRecovery, (state, { payload: [selectedId] }) => ({
  ...state,
  selectedId,
  view: null,
  busy: !!selectedId,
  error: null,
  notice: selectedId ? null : state.notice,
}));
syncRecoveryReducer.with(recoveryViewLoaded, (state, { payload: [view] }) => ({
  ...state,
  view,
  busy: false,
}));
syncRecoveryReducer.with(recoveryCommandStarted, (state) => ({
  ...state,
  busy: true,
  error: null,
  notice: null,
}));
syncRecoveryReducer.with(recoveryCommandFinished, (state, { payload: [notice] }) => ({
  ...state,
  busy: false,
  notice,
}));
syncRecoveryReducer.with(recoveryFailed, (state, { payload: [error] }) => ({
  ...state,
  busy: false,
  loading: false,
  error,
}));
syncRecoveryReducer.with(authSessionResolved, () => recoveryInitialState);
syncRecoveryReducer.with(authSessionCleared, () => recoveryInitialState);
syncRecoveryReducer.with(authSessionFailed, () => recoveryInitialState);
syncRecoveryReducer.with(logoutRequested, () => recoveryInitialState);
syncRecoveryReducer.with(refreshAuthSessionRequested, () => recoveryInitialState);
