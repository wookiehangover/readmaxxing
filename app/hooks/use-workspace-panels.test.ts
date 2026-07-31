import type { DockviewApi } from "dockview-react";
import { describe, expect, it, vi } from "vitest";
import {
  clearPendingBookOpenOnWorkspaceExit,
  deferBookOpenUntilWorkspaceReady,
} from "~/hooks/use-workspace-panels";
import type { BookMeta } from "~/lib/stores/book-store";

const book: BookMeta = {
  id: "book-a",
  title: "Book A",
  author: "Author A",
  coverImage: null,
  format: "epub",
};

describe("deferBookOpenUntilWorkspaceReady", () => {
  it("queues before navigating when the workspace is not active", () => {
    const pending = { current: null as BookMeta | null };
    const navigate = vi.fn(() => {
      expect(pending.current).toBe(book);
    });

    const deferred = deferBookOpenUntilWorkspaceReady(book, {
      apiRef: { current: null },
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
      apiRef: { current: {} as DockviewApi },
      layoutReadyRef: { current: false },
      isWorkspaceRouteRef: { current: true },
      pendingOpenBookRef: pending,
      navigate,
    });

    expect(deferred).toBe(true);
    expect(pending.current).toBe(book);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("uses current route readiness and takes the immediate-open path", () => {
    const pending = { current: book as BookMeta | null };
    const isWorkspaceRouteRef = { current: false };
    isWorkspaceRouteRef.current = true;
    const navigate = vi.fn();

    const deferred = deferBookOpenUntilWorkspaceReady(book, {
      apiRef: { current: {} as DockviewApi },
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
