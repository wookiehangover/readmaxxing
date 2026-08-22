import { call, put, takeEvery, takeLatest } from "typed-redux-saga";

import { authService } from "~/lib/auth-service";
import { toTaggedError } from "~/lib/errors";
import { hasUnadoptedDemoBook } from "~/lib/onboarding/adopt-demo";
import {
  addPasskeyRequested,
  authOperationFailed,
  authSessionCleared,
  authSessionFailed,
  authSessionResolved,
  generateMagicLinkRequested,
  listPasskeysRequested,
  logoutRequested,
  registerRequested,
  removePasskeyRequested,
  renamePasskeyRequested,
  refreshAuthSessionRequested,
  signInRequested,
} from "~/lib/themis/auth-session/auth-session-slice";
import { adoptDemoBookRequested } from "~/lib/themis/books/books-slice";

function createDemoAdoptionRequest(userId: string) {
  let onCompleted!: () => void;
  let onFailed!: (error: string) => void;
  const completion = new Promise<void>((resolve, reject) => {
    onCompleted = resolve;
    onFailed = (error) => reject(new Error(error));
  });

  return { action: adoptDemoBookRequested(userId, onCompleted, onFailed), completion };
}

export function* refreshAuthSessionSaga(action: ReturnType<typeof refreshAuthSessionRequested>) {
  const [onCompleted, onFailed] = action.payload;
  try {
    const session = yield* call(authService.getSession);
    if (session.user && (yield* call(hasUnadoptedDemoBook))) {
      const adoption = createDemoAdoptionRequest(session.user.id);
      yield* put(adoption.action);
      yield* call(() => adoption.completion);
    }
    yield* put(authSessionResolved(session.user));
    if (onCompleted) yield* call(onCompleted);
  } catch (cause) {
    yield* put(authSessionFailed(toTaggedError(cause)));
    if (onFailed) yield* call(onFailed, cause);
  }
}

export function* logoutSaga(action: ReturnType<typeof logoutRequested>) {
  const [onCompleted, onFailed] = action.payload;
  try {
    yield* call(authService.logout);
    yield* put(authSessionCleared());
    yield* call(onCompleted);
  } catch (cause) {
    yield* put(authOperationFailed(toTaggedError(cause)));
    yield* call(onFailed, cause);
  }
}

export function* registerSaga(action: ReturnType<typeof registerRequested>) {
  const [displayName, onCompleted, onFailed] = action.payload;
  try {
    const result = yield* call(authService.register, displayName);
    yield* call(onCompleted, result);
  } catch (cause) {
    yield* put(authOperationFailed(toTaggedError(cause)));
    yield* call(onFailed, cause);
  }
}

export function* signInSaga(action: ReturnType<typeof signInRequested>) {
  const [onCompleted, onFailed] = action.payload;
  try {
    const result = yield* call(authService.signIn);
    yield* call(onCompleted, result);
  } catch (cause) {
    yield* put(authOperationFailed(toTaggedError(cause)));
    yield* call(onFailed, cause);
  }
}

export function* generateMagicLinkSaga(action: ReturnType<typeof generateMagicLinkRequested>) {
  const [onCompleted, onFailed] = action.payload;
  try {
    const result = yield* call(authService.generateMagicLink);
    yield* call(onCompleted, result);
  } catch (cause) {
    yield* put(authOperationFailed(toTaggedError(cause)));
    yield* call(onFailed, cause);
  }
}

export function* listPasskeysSaga(action: ReturnType<typeof listPasskeysRequested>) {
  const [onCompleted, onFailed] = action.payload;
  try {
    const result = yield* call(authService.listPasskeys);
    yield* call(onCompleted, result);
  } catch (cause) {
    yield* put(authOperationFailed(toTaggedError(cause)));
    yield* call(onFailed, cause);
  }
}

export function* addPasskeySaga(action: ReturnType<typeof addPasskeyRequested>) {
  const [onCompleted, onFailed] = action.payload;
  try {
    const result = yield* call(authService.addPasskey);
    yield* call(onCompleted, result);
  } catch (cause) {
    yield* put(authOperationFailed(toTaggedError(cause)));
    yield* call(onFailed, cause);
  }
}

export function* renamePasskeySaga(action: ReturnType<typeof renamePasskeyRequested>) {
  const [id, name, onCompleted, onFailed] = action.payload;
  try {
    yield* call(authService.renamePasskey, id, name);
    yield* call(onCompleted);
  } catch (cause) {
    yield* put(authOperationFailed(toTaggedError(cause)));
    yield* call(onFailed, cause);
  }
}

export function* removePasskeySaga(action: ReturnType<typeof removePasskeyRequested>) {
  const [id, onCompleted, onFailed] = action.payload;
  try {
    yield* call(authService.removePasskey, id);
    yield* call(onCompleted);
  } catch (cause) {
    yield* put(authOperationFailed(toTaggedError(cause)));
    yield* call(onFailed, cause);
  }
}

export function* authSessionSaga() {
  yield* takeLatest(refreshAuthSessionRequested, refreshAuthSessionSaga);
  yield* takeEvery(logoutRequested, logoutSaga);
  yield* takeEvery(registerRequested, registerSaga);
  yield* takeEvery(signInRequested, signInSaga);
  yield* takeEvery(generateMagicLinkRequested, generateMagicLinkSaga);
  yield* takeEvery(listPasskeysRequested, listPasskeysSaga);
  yield* takeEvery(addPasskeyRequested, addPasskeySaga);
  yield* takeEvery(renamePasskeyRequested, renamePasskeySaga);
  yield* takeEvery(removePasskeyRequested, removePasskeySaga);
}
