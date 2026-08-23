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
  hydrateReadingHistoryRequested,
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

async function loadReadingHistory(bookId: string) {
  return ReadingHistoryService.getHistory(bookId);
}

async function persistReadingHistory(
  bookId: string,
  data: Parameters<typeof ReadingHistoryService.recordVisit>[1],
) {
  await ReadingHistoryService.recordVisit(bookId, data);
  return loadReadingHistory(bookId);
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
  latestVersionByKey: ReadonlyMap<string, number>,
  requestVersion: number,
) {
  const [keys, onCompleted, onFailed] = action.payload;
  try {
    const positions = yield* call(loadReadingPositions, keys);
    const freshKeys = keys.filter((key) => latestVersionByKey.get(key) === requestVersion);
    if (freshKeys.length > 0) {
      const freshKeySet = new Set(freshKeys);
      yield* put(
        readingPositionsHydrated(
          freshKeys,
          positions.filter((position) => freshKeySet.has(position.key)),
        ),
      );
    }
    yield* call(notifyCompleted, onCompleted);
  } catch (error) {
    const taggedError = toTaggedError(error);
    const freshKeys = keys.filter((key) => latestVersionByKey.get(key) === requestVersion);
    if (freshKeys.length > 0) yield* put(readingPositionsFailed(freshKeys, taggedError));
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

export function* hydrateReadingHistorySaga(
  action: ReturnType<typeof hydrateReadingHistoryRequested>,
  latestVersionByBookId: ReadonlyMap<string, number>,
  requestVersion: number,
) {
  const [bookId] = action.payload;
  try {
    const history = yield* call(loadReadingHistory, bookId);
    if (latestVersionByBookId.get(bookId) === requestVersion) {
      yield* put(readingHistoryHydrated(bookId, history));
    }
  } catch (error) {
    if (latestVersionByBookId.get(bookId) === requestVersion) {
      yield* put(readingPositionsFailed([bookId], toTaggedError(error)));
    }
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

type ReadingHistoryHydrateTask =
  ReturnType<
    typeof fork<Parameters<typeof hydrateReadingHistorySaga>, typeof hydrateReadingHistorySaga>
  > extends Generator<unknown, infer Task, unknown>
    ? Task
    : never;

export function* watchReadingHistoryHydrates(latestVersionByBookId: Map<string, number>) {
  const pendingByBookId = new Map<string, ReadingHistoryHydrateTask>();
  while (true) {
    const action = yield* take(hydrateReadingHistoryRequested);
    const [bookId] = action.payload;
    const requestVersion = (latestVersionByBookId.get(bookId) ?? 0) + 1;
    latestVersionByBookId.set(bookId, requestVersion);
    const pending = pendingByBookId.get(bookId);
    if (pending) yield* cancel(pending);
    pendingByBookId.set(
      bookId,
      yield* fork(hydrateReadingHistorySaga, action, latestVersionByBookId, requestVersion),
    );
  }
}

export function* watchReadingHistoryRecords(latestVersionByBookId: Map<string, number>) {
  while (true) {
    const action = yield* take(recordReadingHistoryRequested);
    const [bookId] = action.payload;
    latestVersionByBookId.set(bookId, (latestVersionByBookId.get(bookId) ?? 0) + 1);
    yield* fork(recordReadingHistorySaga, action);
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

export function* watchReadingPositionHydrates() {
  const latestVersionByKey = new Map<string, number>();
  let nextVersion = 0;
  while (true) {
    const action = yield* take(hydrateReadingPositionsRequested);
    const [keys] = action.payload;
    const requestVersion = ++nextVersion;
    for (const key of keys) latestVersionByKey.set(key, requestVersion);
    yield* fork(hydrateReadingPositionsSaga, action, latestVersionByKey, requestVersion);
  }
}

export function* readingPositionsSaga() {
  const latestHistoryVersionByBookId = new Map<string, number>();
  yield* fork(watchReadingPositionHydrates);
  yield* fork(watchReadingPositionChanges);
  yield* fork(watchReadingHistoryHydrates, latestHistoryVersionByBookId);
  yield* fork(watchReadingHistoryRecords, latestHistoryVersionByBookId);
  yield* takeEvery(flushReadingPositionRequested, flushReadingPositionSaga);
  yield* takeEvery(hydrateLocationCacheRequested, hydrateLocationCacheSaga);
  yield* takeEvery(saveLocationCacheRequested, saveLocationCacheSaga);
  yield* takeEvery(checkPositionNudgeRequested, checkPositionNudgeSaga);
}
