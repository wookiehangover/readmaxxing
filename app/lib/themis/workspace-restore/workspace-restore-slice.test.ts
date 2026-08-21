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
