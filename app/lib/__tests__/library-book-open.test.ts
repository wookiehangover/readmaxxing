import { describe, expect, it, vi } from "vitest";
import {
  ensureLocalThenOpen,
  refreshBooksCache,
  refreshWorkspaceBooks,
} from "~/lib/library-book-open";
import type { BookMeta } from "~/lib/stores/book-store";
import { booksHydrated } from "~/lib/themis/books/books-slice";
import type { AppStore } from "~/lib/themis/store";

const localBook: BookMeta = {
  id: "book-1",
  title: "Local Book",
  author: "Author",
  coverImage: null,
  format: "epub",
  hasLocalFile: true,
};

const remoteBook: BookMeta = {
  ...localBook,
  title: "Remote Book",
  remoteFileUrl: "https://example.com/book.epub",
  hasLocalFile: false,
};

describe("ensureLocalThenOpen", () => {
  it("downloads and refreshes metadata before opening a remote book", async () => {
    const order: string[] = [];
    const downloadedBook = { ...remoteBook, hasLocalFile: true };

    await ensureLocalThenOpen(remoteBook, {
      downloadBook: async () => {
        order.push("download");
        return { book: downloadedBook, books: [downloadedBook] };
      },
      refreshBooks: () => order.push("refresh"),
      openBook: (book) => {
        order.push("open");
        expect(book).toBe(downloadedBook);
      },
    });

    expect(order).toEqual(["download", "refresh", "open"]);
  });

  it("opens an already-local book without downloading or refreshing", async () => {
    const downloadBook = vi.fn();
    const refreshBooks = vi.fn();
    const openBook = vi.fn();

    await ensureLocalThenOpen(localBook, { downloadBook, refreshBooks, openBook });

    expect(downloadBook).not.toHaveBeenCalled();
    expect(refreshBooks).not.toHaveBeenCalled();
    expect(openBook).toHaveBeenCalledWith(localBook);
  });

  it("does not refresh or open when the download fails", async () => {
    const refreshBooks = vi.fn();
    const openBook = vi.fn();

    await expect(
      ensureLocalThenOpen(remoteBook, {
        downloadBook: async () => {
          throw new Error("network unavailable");
        },
        refreshBooks,
        openBook,
      }),
    ).rejects.toThrow("network unavailable");

    expect(refreshBooks).not.toHaveBeenCalled();
    expect(openBook).not.toHaveBeenCalled();
  });

  it("does not open when the request is cancelled during download", async () => {
    const controller = new AbortController();
    const downloadedBook = { ...remoteBook, hasLocalFile: true };
    const openBook = vi.fn();

    await ensureLocalThenOpen(remoteBook, {
      signal: controller.signal,
      downloadBook: async () => {
        controller.abort();
        return { book: downloadedBook, books: [downloadedBook] };
      },
      refreshBooks: vi.fn(),
      openBook,
    });

    expect(openBook).not.toHaveBeenCalled();
  });
});

describe("book list refresh", () => {
  it("replaces the Themis cache with downloaded metadata", () => {
    const dispatch = vi.fn();

    refreshBooksCache({ dispatch } as Pick<AppStore, "dispatch">, [localBook]);

    expect(dispatch).toHaveBeenCalledWith(booksHydrated([localBook]));
  });

  it("keeps the deprecated ref mirror current and requests a hydrate", async () => {
    const workspace = { booksRef: { current: [] as BookMeta[] } };
    const listener = vi.fn();
    window.addEventListener("sync:entity-updated", listener);

    try {
      refreshWorkspaceBooks(workspace, [localBook]);
      await Promise.resolve();

      expect(workspace.booksRef.current).toEqual([localBook]);
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("sync:entity-updated", listener);
    }
  });
});
