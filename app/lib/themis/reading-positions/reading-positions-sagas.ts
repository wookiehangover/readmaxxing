import { call, cancel, delay, fork, put, take, takeEvery } from "typed-redux-saga";

import { toTaggedError } from "~/lib/errors";
import { savePositionDualKey } from "~/lib/position-utils";
import { LocationCacheService } from "~/lib/stores/location-cache-store";
import { ReadingHistoryService } from "~/lib/stores/reading-history-store";
import { ReadingPositionService, type PositionRecord } from "~/lib/stores/position-store";
import { getRemotePositionRecord } from "~/lib/stores/remote-position-store";
import {
  checkPositionNudgeRequested,
  flushReadingPositionRequested,
  hydrateLocationCacheRequested,
  hydrateReadingPositionsRequested,
  locationCacheHydrated,
  locationCacheSaved,
  readingHistoryHydrated,
  readingPositionChanged,
  readingPositionsFailed,
  readingPositionsHydrated,
  readingPositionsSaved,
  recordReadingHistoryRequested,
  remoteReadingPositionChecked,
  saveLocationCacheRequested,
} from "~/lib/themis/reading-positions/reading-positions-slice";
import type {
  ReadingPositionRecord,
  ReadingPositionSaveRequest,
  ReadingPositionsFailedCallback,
  ReadingPositionsHydratedCallback,
} from "~/lib/themis/reading-positions/reading-positions-types";

const POSITION_SAVE_DEBOUNCE_MS = 1000;

function toReadingPosition(key: string, record: PositionRecord): ReadingPositionRecord {
  return { key, ...record };
}

async function loadReadingPositions(keys: string[]) {
  const records = await Promise.all(
    keys.map(async (key) => {
      const record = await ReadingPositionService.getPositionRecord(key);
      return record ? toReadingPosition(key, record) : null;
    }),
  );
  return records.filter((record): record is ReadingPositionRecord => record !== null);
}

async function persistReadingPosition(request: ReadingPositionSaveRequest, recordChange: boolean) {
  await savePositionDualKey({
    ...request,
    panelId: request.panelId,
    recordChange,
    savePosition: (key, cfi, options) => ReadingPositionService.savePosition(key, cfi, options),
  });
  return loadReadingPositions(
    request.panelId === undefined ? [request.bookId] : [request.bookId, request.panelId],
  );
}

async function loadLocationCache(bookId: string) {
  return LocationCacheService.getLocations(bookId);
}

async function persistLocationCache(bookId: string, json: string) {
  await LocationCacheService.saveLocations(bookId, json);
  return { bookId, json };
}

async function persistReadingHistory(
  bookId: string,
  data: Parameters<typeof ReadingHistoryService.recordVisit>[1],
) {
  await ReadingHistoryService.recordVisit(bookId, data);
  return ReadingHistoryService.getHistory(bookId);
}

async function checkRemotePosition(bookId: string) {
  const [remote, local] = await Promise.all([
    getRemotePositionRecord(bookId),
    ReadingPositionService.getPositionRecord(bookId),
  ]);
  return { remote, local };
}

function notifyCompleted(callback: ReadingPositionsHydratedCallback | undefined) {
  callback?.();
}

function notifyFailed(callback: ReadingPositionsFailedCallback | undefined, error: string) {
  callback?.(error);
}

export function* hydrateReadingPositionsSaga(
  action: ReturnType<typeof hydrateReadingPositionsRequested>,
) {
  const [keys, onCompleted, onFailed] = action.payload;
  try {
    const positions = yield* call(loadReadingPositions, keys);
    yield* put(readingPositionsHydrated(keys, positions));
    yield* call(notifyCompleted, onCompleted);
  } catch (error) {
    const taggedError = toTaggedError(error);
    yield* put(readingPositionsFailed(keys, taggedError));
    yield* call(notifyFailed, onFailed, taggedError.message);
  }
}

function* persistReadingPositionSaga(request: ReadingPositionSaveRequest, recordChange: boolean) {
  try {
    const positions = yield* call(persistReadingPosition, request, recordChange);
    yield* put(readingPositionsSaved(positions));
  } catch (error) {
    const keys = request.panelId ? [request.bookId, request.panelId] : [request.bookId];
    yield* put(readingPositionsFailed(keys, toTaggedError(error)));
  }
}

export function* readingPositionChangedSaga(action: ReturnType<typeof readingPositionChanged>) {
  const [request] = action.payload;
  yield* persistReadingPositionSaga(request, false);
  yield* delay(POSITION_SAVE_DEBOUNCE_MS);
  yield* persistReadingPositionSaga(request, true);
}

export function* flushReadingPositionSaga(
  action: ReturnType<typeof flushReadingPositionRequested>,
) {
  yield* persistReadingPositionSaga(action.payload[0], true);
}

type PositionSaveTask =
  ReturnType<
    typeof fork<Parameters<typeof readingPositionChangedSaga>, typeof readingPositionChangedSaga>
  > extends Generator<unknown, infer Task, unknown>
    ? Task
    : never;

export function* watchReadingPositionChanges() {
  const pendingByBookId = new Map<string, PositionSaveTask>();
  while (true) {
    const action = yield* take(readingPositionChanged);
    const [request] = action.payload;
    const pending = pendingByBookId.get(request.bookId);
    if (pending) yield* cancel(pending);
    pendingByBookId.set(request.bookId, yield* fork(readingPositionChangedSaga, action));
  }
}

export function* hydrateLocationCacheSaga(
  action: ReturnType<typeof hydrateLocationCacheRequested>,
) {
  const [bookId, onCompleted] = action.payload;
  try {
    const json = yield* call(loadLocationCache, bookId);
    yield* put(locationCacheHydrated(bookId, json));
  } catch (error) {
    yield* put(readingPositionsFailed([bookId], toTaggedError(error)));
    yield* put(locationCacheHydrated(bookId, null));
  }
  yield* call(notifyCompleted, onCompleted);
}

export function* saveLocationCacheSaga(action: ReturnType<typeof saveLocationCacheRequested>) {
  const [bookId, json] = action.payload;
  try {
    const cache = yield* call(persistLocationCache, bookId, json);
    yield* put(locationCacheSaved(cache));
  } catch (error) {
    yield* put(readingPositionsFailed([bookId], toTaggedError(error)));
  }
}

export function* recordReadingHistorySaga(
  action: ReturnType<typeof recordReadingHistoryRequested>,
) {
  const [bookId, data] = action.payload;
  try {
    const history = yield* call(persistReadingHistory, bookId, data);
    yield* put(readingHistoryHydrated(bookId, history));
  } catch (error) {
    yield* put(readingPositionsFailed([bookId], toTaggedError(error)));
  }
}

export function* checkPositionNudgeSaga(action: ReturnType<typeof checkPositionNudgeRequested>) {
  const [bookId] = action.payload;
  try {
    const { remote, local } = yield* call(checkRemotePosition, bookId);
    if (local) yield* put(readingPositionsSaved([toReadingPosition(bookId, local)]));
    yield* put(remoteReadingPositionChecked(bookId, remote ? { bookId, ...remote } : null));
  } catch (error) {
    yield* put(readingPositionsFailed([bookId], toTaggedError(error)));
  }
}

type ReadingPositionsHydrateTask =
  ReturnType<
    typeof fork<Parameters<typeof hydrateReadingPositionsSaga>, typeof hydrateReadingPositionsSaga>
  > extends Generator<unknown, infer Task, unknown>
    ? Task
    : never;

export function* watchReadingPositionHydrates() {
  const pendingByKey = new Map<string, ReadingPositionsHydrateTask>();
  while (true) {
    const action = yield* take(hydrateReadingPositionsRequested);
    const [keys] = action.payload;
    const pending = new Set<ReadingPositionsHydrateTask>();
    for (const key of keys) {
      const task = pendingByKey.get(key);
      if (task) pending.add(task);
    }
    for (const task of pending) yield* cancel(task);
    const task = yield* fork(hydrateReadingPositionsSaga, action);
    for (const key of keys) pendingByKey.set(key, task);
  }
}

export function* readingPositionsSaga() {
  yield* fork(watchReadingPositionHydrates);
  yield* fork(watchReadingPositionChanges);
  yield* takeEvery(flushReadingPositionRequested, flushReadingPositionSaga);
  yield* takeEvery(hydrateLocationCacheRequested, hydrateLocationCacheSaga);
  yield* takeEvery(saveLocationCacheRequested, saveLocationCacheSaga);
  yield* takeEvery(recordReadingHistoryRequested, recordReadingHistorySaga);
  yield* takeEvery(checkPositionNudgeRequested, checkPositionNudgeSaga);
}
