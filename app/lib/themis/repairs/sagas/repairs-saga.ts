import { call, cancel, delay, fork, put, takeEvery } from "typed-redux-saga";
import type { RepairTask } from "../repairs-types";
import { set } from "idb-keyval";
import { computeFileHash } from "~/lib/book-hash";
import { BookService } from "~/lib/stores/book-store";
import { getRepairBackupsStore } from "~/lib/sync/stores";
import {
  downloadRepairCopy,
  fetchBookRepair,
  fetchRepairedFile,
  startBookRepair,
} from "~/lib/repair/repair-client";
import { replacePersistedBook } from "~/lib/themis/books/books-sagas";
import { bookUpdated } from "~/lib/themis/books/books-slice";
import { authSessionCleared } from "~/lib/themis/auth-session/auth-session-slice";
import {
  readingRailRestored,
  selectReadingRailTab,
} from "~/lib/themis/reading-rail/reading-rail-slice";
import type { AppStore } from "~/lib/themis/store";
import {
  clearRepairs,
  repairChanged,
  resumeRepair,
  saveRepair,
  startRepair,
} from "../repairs-slice";

export function createRepairsSaga(store: AppStore) {
  const running = new Map<string, RepairTask>();
  function* monitor(bookId: string, start: boolean) {
    const controller = new AbortController();
    try {
      if (start) {
        yield* put(repairChanged(bookId, { operation: "starting", error: null, replaced: false }));
      }
      let job = yield* call(start ? startBookRepair : fetchBookRepair, bookId, controller.signal);
      yield* put(repairChanged(bookId, { job, operation: null, error: null }));
      while (job?.status === "running") {
        yield* delay(2000);
        job = yield* call(fetchBookRepair, bookId, controller.signal);
        yield* put(repairChanged(bookId, { job }));
      }
    } catch (error) {
      yield* put(
        repairChanged(bookId, {
          operation: null,
          error: error instanceof Error ? error.message : "Could not connect to the repair agent.",
        }),
      );
    } finally {
      controller.abort();
    }
  }
  function* launch(bookId: string, start: boolean) {
    if (running.get(bookId)?.isRunning()) return;
    const task = yield* fork(monitor, bookId, start);
    running.set(bookId, task);
    if (start) yield* put(selectReadingRailTab(bookId, "Repair"));
  }
  function* restore() {
    const scopes = yield* store.repairsSelectors.selectRepairScopes.effect();
    for (const scope of scopes) yield* call(launch, scope, false);
  }
  function* save({ payload: [bookId, mode, sync] }: ReturnType<typeof saveRepair>) {
    const state = yield* store.repairsSelectors.selectBookRepair.effect(bookId);
    if (
      state.operation ||
      state.job?.status !== "completed" ||
      (mode === "replace" && state.replaced)
    )
      return;
    yield* put(repairChanged(bookId, { operation: "saving", error: null }));
    try {
      const data = yield* call(fetchRepairedFile, bookId, state.job.id);
      const book = yield* call(BookService.getBook, bookId);
      if (mode === "download") yield* call(downloadRepairCopy, data, book.title);
      else {
        const original = yield* call(BookService.getBookData, bookId);
        const currentHash = yield* call(computeFileHash, original);
        if (currentHash !== state.job.sourceHash)
          throw new Error("This book changed during repair. Save a copy or run repair again.");
        yield* call(
          set,
          state.job.id,
          { bookId, data: original, metadata: book },
          getRepairBackupsStore(),
        );
        const updated = yield* call(replacePersistedBook, {
          bookId,
          file: { name: "repaired.epub", arrayBuffer: async () => data },
          remoteCoverUrl: book.remoteCoverUrl,
          syncActive: sync.isActive,
          reloadBookFiles: sync.reloadBookFiles,
        });
        yield* put(bookUpdated(updated));
        yield* put(repairChanged(bookId, { replaced: true }));
      }
    } catch (error) {
      yield* put(
        repairChanged(bookId, {
          error: error instanceof Error ? error.message : "Could not save repaired book.",
        }),
      );
    } finally {
      yield* put(repairChanged(bookId, { operation: null }));
    }
  }
  return function* repairsSaga() {
    yield* takeEvery(startRepair, function* ({ payload: [bookId] }) {
      yield* call(launch, bookId, true);
    });
    yield* takeEvery(resumeRepair, function* ({ payload: [bookId] }) {
      yield* call(launch, bookId, false);
    });
    yield* takeEvery(selectReadingRailTab, function* ({ payload: [scope, tab] }) {
      if (tab === "Repair") yield* call(launch, scope, false);
    });
    yield* takeEvery(readingRailRestored, restore);
    yield* takeEvery(saveRepair, function* (action) {
      const key = `save:${action.payload[0]}`;
      if (running.get(key)?.isRunning()) return;
      running.set(key, yield* fork(save, action));
    });
    yield* takeEvery(authSessionCleared, function* () {
      for (const task of running.values()) yield* cancel(task);
      running.clear();
      yield* put(clearRepairs());
    });
    yield* call(restore);
  };
}
