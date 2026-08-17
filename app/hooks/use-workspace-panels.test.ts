import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DockviewApi } from "dockview-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingBookOpenOnWorkspaceExit,
  deferBookOpenUntilWorkspaceReady,
  useWorkspacePanels,
  type UseWorkspacePanelsParams,
  type UseWorkspacePanelsResult,
} from "~/hooks/use-workspace-panels";
import type { BookMeta } from "~/lib/stores/book-store";

vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

const book: BookMeta = {
  id: "book-a",
  title: "Book A",
  author: "Author A",
  coverImage: null,
  format: "epub",
};

function renderWorkspacePanels(api: DockviewApi): UseWorkspacePanelsResult {
  let result: UseWorkspacePanelsResult | undefined;
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const params = {
    apiRef: { current: api },
    ws: {} as UseWorkspacePanelsParams["ws"],
    isMobileRef: { current: false },
    focusedClustersRef: { current: new Map() },
    focusedOrderRef: { current: [] },
    pendingOpenBookRef: { current: null },
    layoutReadyRef: { current: true },
    isWorkspaceRouteRef: { current: true },
  } satisfies UseWorkspacePanelsParams;

  function Harness() {
    result = useWorkspacePanels(params);
    return null;
  }

  act(() => root.render(React.createElement(Harness)));
  if (!result) throw new Error("useWorkspacePanels did not return a result");
  return result;
}

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots.length = 0;
  document.body.innerHTML = "";
});

describe("openOutline", () => {
  it("focuses the existing outline panel", () => {
    const focus = vi.fn();
    const addPanel = vi.fn();
    const api = {
      panels: [{ id: `outline-${book.id}`, focus }],
      groups: [],
      addPanel,
    } as unknown as DockviewApi;

    renderWorkspacePanels(api).openOutline(book);

    expect(focus).toHaveBeenCalledOnce();
    expect(addPanel).not.toHaveBeenCalled();
  });

  it("adds a new outline panel to the book's right group", () => {
    const group = {
      element: { getBoundingClientRect: () => ({ left: 0, right: 400 }) },
    };
    const bookPanel = {
      id: `book-${book.id}`,
      params: { bookId: book.id },
      group,
    };
    const addPanel = vi.fn();
    const api = {
      panels: [bookPanel],
      groups: [group],
      addPanel,
    } as unknown as DockviewApi;

    renderWorkspacePanels(api).openOutline(book);

    expect(addPanel).toHaveBeenCalledWith({
      id: `outline-${book.id}`,
      component: "outline",
      title: `Outline: ${book.title}`,
      params: { bookId: book.id, bookTitle: book.title },
      renderer: "always",
      position: { referencePanel: bookPanel.id, direction: "right" },
    });
  });
});

describe("deferBookOpenUntilWorkspaceReady", () => {
  it("queues before navigating when the workspace is not active", () => {
    const pending = { current: null as BookMeta | null };
    const navigate = vi.fn(() => {
      expect(pending.current).toBe(book);
    });

    const deferred = deferBookOpenUntilWorkspaceReady(book, {
      layoutReadyRef: { current: false },
      isWorkspaceRouteRef: { current: false },
      pendingOpenBookRef: pending,
      navigate,
    });

    expect(deferred).toBe(true);
    expect(pending.current).toBe(book);
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("queues without navigating while the workspace layout is restoring", () => {
    const pending = { current: null as BookMeta | null };
    const navigate = vi.fn();

    const deferred = deferBookOpenUntilWorkspaceReady(book, {
      layoutReadyRef: { current: false },
      isWorkspaceRouteRef: { current: true },
      pendingOpenBookRef: pending,
      navigate,
    });

    expect(deferred).toBe(true);
    expect(pending.current).toBe(book);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("takes the immediate-open path without a dockview instance", () => {
    const pending = { current: book as BookMeta | null };
    const isWorkspaceRouteRef = { current: false };
    isWorkspaceRouteRef.current = true;
    const navigate = vi.fn();

    const deferred = deferBookOpenUntilWorkspaceReady(book, {
      layoutReadyRef: { current: true },
      isWorkspaceRouteRef,
      pendingOpenBookRef: pending,
      navigate,
    });

    expect(deferred).toBe(false);
    expect(pending.current).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("clearPendingBookOpenOnWorkspaceExit", () => {
  it("preserves a book queued during the transition into the workspace", () => {
    const pending = { current: book as BookMeta | null };

    clearPendingBookOpenOnWorkspaceExit(false, true, pending);

    expect(pending.current).toBe(book);
  });

  it("clears a pending book only when leaving the workspace", () => {
    const pending = { current: book as BookMeta | null };

    clearPendingBookOpenOnWorkspaceExit(true, false, pending);

    expect(pending.current).toBeNull();
  });
});
