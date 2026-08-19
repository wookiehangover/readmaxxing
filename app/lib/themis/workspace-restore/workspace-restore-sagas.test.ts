import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runPromise: vi.fn() }));

vi.mock("~/lib/effect-runtime", () => ({
  AppRuntime: { runPromise: mocks.runPromise },
}));

import { workspaceRestoreSaga } from "~/lib/themis/workspace-restore/workspace-restore-sagas";
import {
  hydrateWorkspaceRestore,
  recordBookOpened,
  saveFocusedWorkspace,
} from "~/lib/themis/workspace-restore/workspace-restore-slice";
import { createAppStore, type AppStore } from "~/lib/themis/store";

const stores: AppStore[] = [];

const focusedWorkspace = {
  order: ["book-1"],
  activeBookId: "book-1",
  clusters: [
    {
      bookId: "book-1",
      bookTitle: "Book One",
      bookFormat: "epub",
      hasChat: true,
      hasNotebook: false,
      activeTab: "chat" as const,
    },
  ],
};

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
  it("hydrates both restore facts from IDB", async () => {
    mocks.runPromise.mockResolvedValueOnce({
      lastOpenedByBookId: { "book-1": 123 },
      focusedWorkspace,
    });
    const store = startStore();

    store.dispatch(hydrateWorkspaceRestore());

    await vi.waitFor(() =>
      expect(store.workspaceRestoreSelectors.selectLastOpenedAt.select(store.state, "book-1")).toBe(
        123,
      ),
    );
    expect(store.workspaceRestoreSelectors.selectFocusedWorkspace.select(store.state)).toEqual(
      focusedWorkspace,
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

  it("updates the focused snapshot only after persistence succeeds", async () => {
    mocks.runPromise.mockResolvedValueOnce(undefined);
    const store = startStore();

    store.dispatch(saveFocusedWorkspace(focusedWorkspace));

    await vi.waitFor(() =>
      expect(store.workspaceRestoreSelectors.selectFocusedWorkspace.select(store.state)).toEqual(
        focusedWorkspace,
      ),
    );
    expect(mocks.runPromise).toHaveBeenCalledOnce();
  });

  it("keeps the focused snapshot unchanged when persistence fails", async () => {
    mocks.runPromise.mockRejectedValueOnce(new Error("IDB unavailable"));
    const store = startStore();

    store.dispatch(saveFocusedWorkspace(focusedWorkspace));

    await vi.waitFor(() =>
      expect(store.workspaceRestoreSelectors.selectWorkspaceRestoreError.select(store.state)).toBe(
        "IDB unavailable",
      ),
    );
    expect(store.workspaceRestoreSelectors.selectFocusedWorkspace.select(store.state)).toBeNull();
  });
});
