import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookMeta } from "~/lib/stores/book-store";
import type { WorkspaceContextValue } from "~/lib/context/workspace-context";

const routeMocks = vi.hoisted(() => ({
  workspace: { openBookRef: { current: null } },
}));

vi.mock("~/lib/context/workspace-context", () => ({
  useWorkspace: () => routeMocks.workspace,
}));
vi.mock("~/components/workspace/library-browse-content", () => ({
  LibraryBrowseContent: () => "Existing library page",
}));

import WorkspaceLibraryRoute, { openBookInWorkspace } from "~/routes/workspace-library";

const book: BookMeta = {
  id: "book-1",
  title: "Test Book",
  author: "Test Author",
  coverImage: null,
  format: "epub",
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("WorkspaceLibraryRoute", () => {
  it("keeps mounting the existing library browse page", () => {
    const root = createRoot(document.body.appendChild(document.createElement("div")));

    act(() => root.render(React.createElement(WorkspaceLibraryRoute)));

    expect(document.body.textContent).toContain("Existing library page");
    act(() => root.unmount());
  });
});

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
