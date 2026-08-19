import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FocusedWorkspaceState } from "~/lib/stores/workspace-store";

const mocks = vi.hoisted(() => ({
  runPromise: vi.fn(),
  restoreLoading: true,
  focusedWorkspace: null as FocusedWorkspaceState | null,
}));

vi.mock("~/lib/stores/book-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/stores/book-store")>();
  return { ...actual, BookService: { ...actual.BookService, getBooks: mocks.runPromise } };
});
vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({
    workspaceRestoreSelectors: {
      selectWorkspaceRestoreLoading: { useValue: () => mocks.restoreLoading },
    },
  }),
}));

import { clientLoader, createInitialFocusedState, WorkspaceRestoreGate } from "~/routes/app-frame";

const books = [
  {
    id: "book-1",
    title: "Current title",
    author: "Author",
    coverImage: null,
    format: "epub" as const,
  },
];

beforeEach(() => {
  mocks.restoreLoading = true;
  mocks.focusedWorkspace = null;
  mocks.runPromise.mockReset();
});

describe("app-frame workspace restore", () => {
  it("keeps the client loader focused on its book-only boundary", async () => {
    mocks.runPromise.mockResolvedValueOnce(books);

    await expect(clientLoader()).resolves.toEqual({ books });
    expect(mocks.runPromise).toHaveBeenCalledOnce();
  });

  it("builds one focused-mode snapshot from selector values", () => {
    const state = createInitialFocusedState(books, {
      order: ["missing", "book-1"],
      activeBookId: "book-1",
      clusters: [
        {
          bookId: "missing",
          bookTitle: "Missing",
          hasChat: false,
          hasNotebook: false,
          activeTab: "book",
        },
        {
          bookId: "book-1",
          bookTitle: "Old title",
          hasChat: true,
          hasNotebook: false,
          activeTab: "chat",
        },
      ],
    });

    expect(state.order).toEqual(["book-1"]);
    expect(state.activeBookId).toBe("book-1");
    expect(state.clusters.get("book-1")).toMatchObject({
      bookTitle: "Current title",
      activeTab: "chat",
    });
  });

  it("mounts the one-time focused initializer only after hydration", () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    let initializerCalls = 0;

    function SnapshotProbe() {
      const [snapshot] = useState(() => {
        initializerCalls += 1;
        return mocks.focusedWorkspace;
      });
      return createElement("div", {
        "data-active-book-id": snapshot?.activeBookId ?? "none",
      });
    }

    const renderGate = () =>
      createElement(WorkspaceRestoreGate, null, createElement(SnapshotProbe));

    act(() => root.render(renderGate()));
    expect(container.textContent).toContain("Loading workspace");
    expect(initializerCalls).toBe(0);

    mocks.focusedWorkspace = {
      order: ["book-1"],
      activeBookId: "book-1",
      clusters: [],
    };
    mocks.restoreLoading = false;
    act(() => root.render(renderGate()));
    expect(container.firstElementChild?.getAttribute("data-active-book-id")).toBe("book-1");
    expect(initializerCalls).toBe(1);

    mocks.focusedWorkspace = {
      order: ["book-2"],
      activeBookId: "book-2",
      clusters: [],
    };
    act(() => root.render(renderGate()));
    expect(container.firstElementChild?.getAttribute("data-active-book-id")).toBe("book-1");
    expect(initializerCalls).toBe(1);

    act(() => root.unmount());
    container.remove();
  });
});
