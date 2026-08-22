import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runPromise: vi.fn() }));

vi.mock("~/lib/stores/workspace-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/stores/workspace-store")>();
  return {
    ...actual,
    WorkspaceService: new Proxy(actual.WorkspaceService, { get: () => mocks.runPromise }),
  };
});

import { workspaceRestoreSaga } from "~/lib/themis/workspace-restore/workspace-restore-sagas";
import {
  hydrateWorkspaceRestore,
  recordBookOpened,
} from "~/lib/themis/workspace-restore/workspace-restore-slice";
import { createAppStore, type AppStore } from "~/lib/themis/store";

const stores: AppStore[] = [];

function startStore() {
  const store = createAppStore();
  stores.push(store);
  store.init();
  store.runSaga(workspaceRestoreSaga);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  mocks.runPromise.mockReset();
  vi.restoreAllMocks();
});

describe("workspaceRestoreSaga", () => {
  it("hydrates last-opened timestamps from IDB", async () => {
    mocks.runPromise.mockResolvedValueOnce(new Map([["book-1", 123]]));
    const store = startStore();

    store.dispatch(hydrateWorkspaceRestore());

    await vi.waitFor(() =>
      expect(store.workspaceRestoreSelectors.selectLastOpenedAt.select(store.state, "book-1")).toBe(
        123,
      ),
    );
  });

  it("updates last-opened only after persistence succeeds", async () => {
    vi.spyOn(Date, "now").mockReturnValue(789);
    mocks.runPromise.mockResolvedValueOnce(undefined);
    const store = startStore();

    store.dispatch(recordBookOpened("book-1"));

    await vi.waitFor(() =>
      expect(store.workspaceRestoreSelectors.selectLastOpenedAt.select(store.state, "book-1")).toBe(
        789,
      ),
    );
    expect(mocks.runPromise).toHaveBeenCalledOnce();
  });
});
