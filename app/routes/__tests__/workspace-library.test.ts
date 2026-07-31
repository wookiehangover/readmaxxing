import { describe, expect, it, vi } from "vitest";
import { openBookInWorkspace } from "~/routes/workspace-library";
import type { BookMeta } from "~/lib/stores/book-store";
import type { WorkspaceContextValue } from "~/lib/context/workspace-context";

const book: BookMeta = {
  id: "book-1",
  title: "Test Book",
  author: "Test Author",
  coverImage: null,
  format: "epub",
};

describe("openBookInWorkspace", () => {
  it("immediately hands a local book to the pending-safe workspace handler", () => {
    const openBook = vi.fn();
    const workspace = {
      openBookRef: { current: openBook },
    } as Pick<WorkspaceContextValue, "openBookRef">;

    openBookInWorkspace(book, workspace);

    expect(openBook).toHaveBeenCalledWith(book);
  });

  it("does not hand off a cancelled open", () => {
    const controller = new AbortController();
    controller.abort();
    const workspace = {
      openBookRef: { current: vi.fn() },
    } as Pick<WorkspaceContextValue, "openBookRef">;

    openBookInWorkspace(book, workspace, controller.signal);

    expect(workspace.openBookRef.current).not.toHaveBeenCalled();
  });
});
