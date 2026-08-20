import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

import type { AuthUser } from "~/lib/auth-service";
import type { TaggedError } from "~/lib/errors";
import type {
  AuthLogoutCompletedCallback,
  AuthOperationFailedCallback,
  AuthRegistrationCompletedCallback,
  AuthSessionState,
  AuthSignInCompletedCallback,
  MagicLinkCompletedCallback,
  PasskeyRegistrationCompletedCallback,
  PasskeysCompletedCallback,
} from "~/lib/themis/auth-session/auth-session-types";

export const refreshAuthSessionRequested = createAction("authSession/refreshRequested");
export const authSessionResolved = createAction<[user: AuthUser | null]>("authSession/resolved");
export const authSessionFailed = createAction<[error: TaggedError]>("authSession/failed");
export const authOperationFailed = createAction<[error: TaggedError]>(
  "authSession/operationFailed",
);
export const logoutRequested = createAction<
  [onCompleted: AuthLogoutCompletedCallback, onFailed: AuthOperationFailedCallback]
>("authSession/logoutRequested");
export const authSessionCleared = createAction("authSession/cleared");
export const registerRequested = createAction<
  [
    displayName: string | undefined,
    onCompleted: AuthRegistrationCompletedCallback,
    onFailed: AuthOperationFailedCallback,
  ]
>("authSession/registerRequested");
export const signInRequested = createAction<
  [onCompleted: AuthSignInCompletedCallback, onFailed: AuthOperationFailedCallback]
>("authSession/signInRequested");
export const generateMagicLinkRequested = createAction<
  [onCompleted: MagicLinkCompletedCallback, onFailed: AuthOperationFailedCallback]
>("authSession/generateMagicLinkRequested");
export const listPasskeysRequested = createAction<
  [onCompleted: PasskeysCompletedCallback, onFailed: AuthOperationFailedCallback]
>("authSession/listPasskeysRequested");
export const addPasskeyRequested = createAction<
  [onCompleted: PasskeyRegistrationCompletedCallback, onFailed: AuthOperationFailedCallback]
>("authSession/addPasskeyRequested");
export const renamePasskeyRequested = createAction<
  [
    id: string,
    name: string | null,
    onCompleted: AuthLogoutCompletedCallback,
    onFailed: AuthOperationFailedCallback,
  ]
>("authSession/renamePasskeyRequested");
export const removePasskeyRequested = createAction<
  [id: string, onCompleted: AuthLogoutCompletedCallback, onFailed: AuthOperationFailedCallback]
>("authSession/removePasskeyRequested");

export const authSessionInitialState: AuthSessionState = {
  user: null,
  loading: true,
  error: null,
};

const reducer = createReducer<AuthSessionState>(authSessionInitialState);

reducer.with(authSessionResolved, (state, { payload: [user] }) =>
  state.user === user && !state.loading && state.error === null
    ? state
    : { user, loading: false, error: null },
);
reducer.with(authSessionFailed, (state, { payload: [error] }) =>
  state.user === null && !state.loading && state.error === error
    ? state
    : { user: null, loading: false, error },
);
reducer.with(authOperationFailed, (state, { payload: [error] }) =>
  state.error === error ? state : { ...state, error },
);
reducer.with(authSessionCleared, (state) =>
  state.user === null && !state.loading && state.error === null
    ? state
    : { user: null, loading: false, error: null },
);

export const authSessionReducer = reducer;
