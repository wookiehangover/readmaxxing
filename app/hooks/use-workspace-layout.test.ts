import { describe, expect, it, vi } from "vitest";
import {
  consumePendingBookOpen,
  consumePendingClusterActivation,
} from "~/hooks/use-workspace-layout";
import { removeOrphanedPanels, restoreDockviewLayout } from "~/hooks/workspace-layout-restore";
import type { BookMeta } from "~/lib/stores/book-store";
import type { DockviewApi, IDockviewPanel, SerializedDockview } from "dockview-react";

describe("consumePendingClusterActivation", () => {
  const clusters = new Map([
    ["book-a", {}],
    ["book-b", {}],
    ["book-c", {}],
  ]);

  it("selects the pending non-last cluster after a remount", () => {
    const pending = { current: "book-b" as string | null };
    const active = { current: "book-c" as string | null };

    consumePendingClusterActivation(pending, active, clusters);

    expect(active.current).toBe("book-b");
    expect(pending.current).toBeNull();
  });

  it("consumes an activation when the clicked cluster was already active", () => {
    const pending = { current: "book-b" as string | null };
    const active = { current: "book-b" as string | null };

    consumePendingClusterActivation(pending, active, clusters);

    expect(active.current).toBe("book-b");
    expect(pending.current).toBeNull();
  });
});

describe("consumePendingBookOpen", () => {
  const book: BookMeta = {
    id: "book-a",
    title: "Book A",
    author: "Author A",
    coverImage: null,
    format: "epub",
  };

  it("defers a pending open until layout restore consumes it", () => {
    const pending = { current: book as BookMeta | null };
    const openBook = vi.fn();

    expect(openBook).not.toHaveBeenCalled();
    consumePendingBookOpen(pending, openBook);

    expect(openBook).toHaveBeenCalledWith(book);
    expect(pending.current).toBeNull();
  });

  it("does nothing when no book is pending", () => {
    const pending = { current: null as BookMeta | null };
    const openBook = vi.fn();

    consumePendingBookOpen(pending, openBook);

    expect(openBook).not.toHaveBeenCalled();
  });
});

describe("dockview layout restore", () => {
  function panel(id: string, bookId: string) {
    return { id, params: { bookId } } as unknown as IDockviewPanel;
  }

  it("continues orphan cleanup when one panel removal throws", () => {
    const first = panel("book-missing-a", "missing-a");
    const second = panel("book-missing-b", "missing-b");
    const removePanel = vi.fn((candidate: IDockviewPanel) => {
      if (candidate === first) throw new Error("invalid operation");
    });
    const api = { panels: [first, second], removePanel } as Pick<
      DockviewApi,
      "panels" | "removePanel"
    >;

    expect(removeOrphanedPanels(api, new Set())).toBe(false);
    expect(removePanel).toHaveBeenCalledTimes(2);
    expect(removePanel).toHaveBeenLastCalledWith(second);
  });

  it("clears live and stored state after restore failure", async () => {
    const api = {
      fromJSON: vi.fn(() => {
        throw new Error("invalid operation");
      }),
      clear: vi.fn(),
      panels: [],
      removePanel: vi.fn(),
    } as unknown as Pick<DockviewApi, "clear" | "fromJSON" | "panels" | "removePanel">;
    const clearStoredLayout = vi.fn().mockResolvedValue(undefined);

    const restored = await restoreDockviewLayout(
      api,
      { grid: {}, panels: {} } as SerializedDockview,
      new Set(),
      clearStoredLayout,
    );

    expect(restored).toBe(false);
    expect(api.clear).toHaveBeenCalledOnce();
    expect(clearStoredLayout).toHaveBeenCalledOnce();
  });
});
