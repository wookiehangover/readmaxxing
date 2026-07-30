import { describe, expect, it, vi } from "vitest";
import { ensureLocalThenOpen } from "~/lib/library-book-open";
import type { BookMeta } from "~/lib/stores/book-store";

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
