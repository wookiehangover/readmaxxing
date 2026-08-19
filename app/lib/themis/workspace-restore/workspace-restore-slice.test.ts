import { getItem } from "@augmentcode/themis/utils/collections/collection-utils";
import { describe, expect, it } from "vitest";

import {
  bookOpenedRecorded,
  focusedWorkspaceSaved,
  hydrateWorkspaceRestore,
  workspaceRestoreHydrated,
  workspaceRestoreReducer,
} from "~/lib/themis/workspace-restore/workspace-restore-slice";

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
      activeTab: "book" as const,
    },
  ],
};

describe("workspaceRestoreReducer", () => {
  it("hydrates last-opened timestamps and a normalized focused snapshot", () => {
    const loading = workspaceRestoreReducer(undefined, hydrateWorkspaceRestore());
    const hydrated = workspaceRestoreReducer(
      loading,
      workspaceRestoreHydrated({ "book-1": 123 }, focusedWorkspace),
    );

    expect(hydrated.loading).toBe(false);
    expect(hydrated.lastOpenedByBookId).toEqual({ "book-1": 123 });
    expect(getItem(hydrated.focusedWorkspace!.clusters, "book-1")).toEqual(
      focusedWorkspace.clusters[0],
    );
    expect(JSON.parse(JSON.stringify(hydrated))).toEqual(hydrated);
  });

  it("updates last-opened only after the persisted success action", () => {
    const state = workspaceRestoreReducer(undefined, bookOpenedRecorded("book-1", 456));
    const unchanged = workspaceRestoreReducer(state, bookOpenedRecorded("book-1", 456));

    expect(state.lastOpenedByBookId).toEqual({ "book-1": 456 });
    expect(unchanged).toBe(state);
  });

  it("stores and clears focused restore snapshots", () => {
    const saved = workspaceRestoreReducer(undefined, focusedWorkspaceSaved(focusedWorkspace));
    const cleared = workspaceRestoreReducer(saved, focusedWorkspaceSaved(null));

    expect(saved.focusedWorkspace?.order).toEqual(["book-1"]);
    expect(cleared.focusedWorkspace).toBeNull();
  });

  it("keeps identity for unknown actions", () => {
    const state = workspaceRestoreReducer(undefined, { type: "unknown" });
    expect(workspaceRestoreReducer(state, { type: "unknown" })).toBe(state);
  });
});
