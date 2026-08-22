import { describe, expect, it } from "vitest";

import {
  bookOpenedRecorded,
  hydrateWorkspaceRestore,
  workspaceRestoreHydrated,
  workspaceRestoreReducer,
} from "~/lib/themis/workspace-restore/workspace-restore-slice";

describe("workspaceRestoreReducer", () => {
  it("hydrates last-opened timestamps", () => {
    const loading = workspaceRestoreReducer(undefined, hydrateWorkspaceRestore());
    const hydrated = workspaceRestoreReducer(loading, workspaceRestoreHydrated({ "book-1": 123 }));

    expect(hydrated.loading).toBe(false);
    expect(hydrated.lastOpenedByBookId).toEqual({ "book-1": 123 });
    expect(JSON.parse(JSON.stringify(hydrated))).toEqual(hydrated);
  });

  it("preserves books opened before hydration completes", () => {
    const loading = workspaceRestoreReducer(undefined, hydrateWorkspaceRestore());
    const opened = workspaceRestoreReducer(loading, bookOpenedRecorded("book-1", 456));
    const hydrated = workspaceRestoreReducer(opened, workspaceRestoreHydrated({}));

    expect(hydrated.loading).toBe(false);
    expect(hydrated.lastOpenedByBookId).toEqual({ "book-1": 456 });
  });

  it("keeps the newer timestamp from hydrated and existing entries", () => {
    const olderExisting = workspaceRestoreReducer(undefined, bookOpenedRecorded("book-1", 100));
    const newerExisting = workspaceRestoreReducer(olderExisting, bookOpenedRecorded("book-2", 400));
    const hydrated = workspaceRestoreReducer(
      newerExisting,
      workspaceRestoreHydrated({ "book-1": 300, "book-2": 200, "book-3": 500 }),
    );

    expect(hydrated.lastOpenedByBookId).toEqual({
      "book-1": 300,
      "book-2": 400,
      "book-3": 500,
    });
    expect(newerExisting.lastOpenedByBookId).toEqual({ "book-1": 100, "book-2": 400 });
  });

  it("updates last-opened only after the persisted success action", () => {
    const state = workspaceRestoreReducer(undefined, bookOpenedRecorded("book-1", 456));
    const unchanged = workspaceRestoreReducer(state, bookOpenedRecorded("book-1", 456));

    expect(state.lastOpenedByBookId).toEqual({ "book-1": 456 });
    expect(unchanged).toBe(state);
  });

  it("keeps identity for unknown actions", () => {
    const state = workspaceRestoreReducer(undefined, { type: "unknown" });
    expect(workspaceRestoreReducer(state, { type: "unknown" })).toBe(state);
  });
});
