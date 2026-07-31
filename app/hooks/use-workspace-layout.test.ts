import { describe, expect, it, vi } from "vitest";
import {
  consumePendingBookOpen,
  consumePendingClusterActivation,
} from "~/hooks/use-workspace-layout";
import type { BookMeta } from "~/lib/stores/book-store";

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
