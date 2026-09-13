import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAppStore, type AppStore } from "~/lib/themis/store";
import {
  startRepair,
  repairChanged,
  saveRepair,
  repairsReducer,
  clearRepairs,
} from "./repairs-slice";
import { createRepairsSaga } from "./sagas/repairs-saga";
import { authSessionCleared } from "~/lib/themis/auth-session/auth-session-slice";
import type { SyncActions } from "~/lib/sync/use-sync";
const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  fetch: vi.fn(),
  output: vi.fn(),
  download: vi.fn(),
  getBook: vi.fn(),
  getData: vi.fn(),
  replace: vi.fn(),
  hash: vi.fn(),
}));
vi.mock("~/lib/repair/repair-client", () => ({
  startBookRepair: mocks.start,
  fetchBookRepair: mocks.fetch,
  fetchRepairedFile: mocks.output,
  downloadRepairCopy: mocks.download,
}));
vi.mock("~/lib/stores/book-store", () => ({
  BookService: { getBook: mocks.getBook, getBookData: mocks.getData },
}));
vi.mock("~/lib/themis/books/books-sagas", () => ({ replacePersistedBook: mocks.replace }));
vi.mock("~/lib/book-hash", () => ({ computeFileHash: mocks.hash }));
let store: AppStore;
const job = {
  id: "repair",
  bookId: "book",
  sourceHash: "original",
  status: "completed" as const,
  diagnostics: ["Done"],
  error: null,
};
const sync: SyncActions = {
  isActive: false,
  reloadBookFiles: vi.fn(),
  triggerSync: vi.fn(),
  pullChanges: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  store = createAppStore();
  store.init();
  store.runSaga(createRepairsSaga(store));
  mocks.output.mockResolvedValue(new ArrayBuffer(4));
  mocks.getBook.mockResolvedValue({ id: "book", title: "Book" });
  mocks.getData.mockResolvedValue(new ArrayBuffer(3));
});
afterEach(() => store.dispose());
it("preserves references for no-op state updates and clears private diagnostics", () => {
  const state = repairsReducer.initialState;
  expect(repairsReducer(state, repairChanged("book", { error: null }))).toBe(state);
  store.dispatch(repairChanged("book", { job }));
  expect(store.repairsSelectors.selectBookRepair.select(store.state, "book").job).toEqual(job);
  store.dispatch(clearRepairs());
  expect(store.repairsSelectors.selectBookRepair.select(store.state, "book").job).toBeNull();
});
it("starts once on repeated clicks and selects Repair without a second launch", async () => {
  mocks.start.mockResolvedValue(job);
  store.dispatch(startRepair("book"));
  store.dispatch(startRepair("book"));
  await vi.waitFor(() =>
    expect(store.repairsSelectors.selectBookRepair.select(store.state, "book").job).toEqual(job),
  );
  expect(mocks.start).toHaveBeenCalledOnce();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(store.state.readingRail.selections.book).toBe("Repair");
});
it("refuses replacement when the current source changed", async () => {
  mocks.hash.mockResolvedValue("changed");
  store.dispatch(repairChanged("book", { job }));
  store.dispatch(saveRepair("book", "replace", sync));
  await vi.waitFor(() =>
    expect(store.repairsSelectors.selectBookRepair.select(store.state, "book").error).toContain(
      "changed during repair",
    ),
  );
  expect(mocks.replace).not.toHaveBeenCalled();
});
it("downloads a copy without altering the library", async () => {
  store.dispatch(repairChanged("book", { job }));
  store.dispatch(saveRepair("book", "download", sync));
  await vi.waitFor(() => expect(mocks.download).toHaveBeenCalled());
  expect(mocks.replace).not.toHaveBeenCalled();
});
it("cancels polling and clears diagnostics at logout", async () => {
  mocks.start.mockResolvedValue({ ...job, status: "running" });
  store.dispatch(startRepair("book"));
  await vi.waitFor(() =>
    expect(store.repairsSelectors.selectBookRepair.select(store.state, "book").job).not.toBeNull(),
  );
  const signal = mocks.start.mock.calls[0][1] as AbortSignal;
  store.dispatch(authSessionCleared());
  expect(signal.aborted).toBe(true);
  expect(store.state.repairs.byBookId).toEqual({});
});
