import { describe, expect, it, vi } from "vitest";
import {
  ensureLocalThenOpen,
  refreshBooksCache,
  refreshWorkspaceBooks,
} from "~/lib/library-book-open";
import type { BookMeta } from "~/lib/stores/book-store";
import { booksHydrated, downloadBookForOpenRequested } from "~/lib/themis/books/books-slice";
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
  it("dispatches a download and opens the downloaded metadata on success", async () => {
    const order: string[] = [];
    const downloadedBook = { ...remoteBook, hasLocalFile: true };
    const store = {
      dispatch: vi.fn((action: ReturnType<typeof downloadBookForOpenRequested>) => {
        order.push("dispatch");
        void action.payload[1](downloadedBook);
        return action;
      }),
    } as unknown as Pick<AppStore, "dispatch">;

    await ensureLocalThenOpen(remoteBook, {
      store,
      openBook: (book) => {
        order.push("open");
        expect(book).toBe(downloadedBook);
      },
    });

    expect(order).toEqual(["dispatch", "open"]);
    expect(store.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.any(Array) }),
    );
    expect((store.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][0].payload[0]).toBe(
      remoteBook.id,
    );
  });

  it("opens an already-local book without dispatching a download", async () => {
    const store = { dispatch: vi.fn() } as unknown as Pick<AppStore, "dispatch">;
    const openBook = vi.fn();

    await ensureLocalThenOpen(localBook, { store, openBook });

    expect(store.dispatch).not.toHaveBeenCalled();
    expect(openBook).toHaveBeenCalledWith(localBook);
  });

  it("rejects and does not open when the download fails", async () => {
    const store = {
      dispatch: vi.fn((action: ReturnType<typeof downloadBookForOpenRequested>) => {
        action.payload[2]("network unavailable");
        return action;
      }),
    } as unknown as Pick<AppStore, "dispatch">;
    const openBook = vi.fn();

    await expect(
      ensureLocalThenOpen(remoteBook, {
        store,
        openBook,
      }),
    ).rejects.toThrow("network unavailable");

    expect(openBook).not.toHaveBeenCalled();
  });

  it("does not open when unmount aborts a pending download", async () => {
    const controller = new AbortController();
    const downloadedBook = { ...remoteBook, hasLocalFile: true };
    const openBook = vi.fn();
    let completeDownload: ((book: BookMeta) => void | Promise<void>) | undefined;
    const store = {
      dispatch: vi.fn((action: ReturnType<typeof downloadBookForOpenRequested>) => {
        completeDownload = action.payload[1];
        return action;
      }),
    } as unknown as Pick<AppStore, "dispatch">;

    const pendingOpen = ensureLocalThenOpen(remoteBook, {
      store,
      signal: controller.signal,
      openBook,
    });
    controller.abort();
    await pendingOpen;
    await completeDownload?.(downloadedBook);

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
