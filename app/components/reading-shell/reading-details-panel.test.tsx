import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BookMeta } from "~/lib/stores/book-store";
import type { Bookmark } from "~/lib/stores/bookmark-store";
import type { ReadingHistoryEntry } from "~/lib/stores/reading-history-store";
import {
  bookmarksHydrated,
  hydrateBookmarksRequested,
} from "~/lib/themis/bookmarks/bookmarks-slice";
import {
  hydrateReadingHistoryRequested,
  readingHistoryHydrated,
} from "~/lib/themis/reading-positions/reading-positions-slice";
import { createAppStore, type AppStore } from "~/lib/themis/store";

const mocks = vi.hoisted(() => ({
  navigateInCluster: vi.fn(),
  openMobileReadingTab: vi.fn(),
  syncVersion: 0,
}));

let store: AppStore;
let dispatch: ReturnType<typeof vi.fn>;

vi.mock("~/lib/context/workspace-context", () => ({
  useWorkspace: () => ({ navigateInCluster: mocks.navigateInCluster }),
}));

vi.mock("~/lib/themis/provider", () => ({ useAppStore: () => store }));

vi.mock("~/hooks/use-sync-listener", () => ({
  useSyncListener: () => mocks.syncVersion,
}));

vi.mock("~/components/reading-shell/mobile-reading-tabs", () => ({
  openMobileReadingTab: mocks.openMobileReadingTab,
}));

vi.mock("~/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-slot="scroll-area" className={className}>
      {children}
    </div>
  ),
}));

vi.mock("~/components/book-grid/cover-image", () => ({
  CoverImage: ({ alt, remoteCoverUrl }: { alt: string; remoteCoverUrl?: string }) => (
    <img alt={alt} src={remoteCoverUrl ?? "blob:cover"} />
  ),
}));

import { ReadingDetailsPanel } from "~/components/reading-shell/reading-details-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const book: BookMeta = {
  id: "book-1",
  title: "Middlemarch",
  author: "George Eliot",
  coverImage: null,
  format: "epub",
};

const historyEntry: ReadingHistoryEntry = {
  id: "history-1",
  bookId: book.id,
  cfi: "epubcfi(/6/4!/4/2/1:0)",
  chapterHref: "chapter-1.xhtml",
  chapterLabel: "Chapter One",
  percentage: 24.6,
  pageIndex: 37,
  totalPages: 150,
  timestamp: new Date("2026-08-20T12:00:00Z").valueOf(),
};

const bookmark: Bookmark = {
  id: "bookmark-1",
  bookId: book.id,
  cfi: "epubcfi(/6/8!/4/2/1:0)",
  label: "A memorable chapter",
  displayPage: 42,
  createdAt: new Date("2026-08-21T12:00:00Z").valueOf(),
};

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function renderPanel(currentBook = book, mobile = false) {
  if (!root) {
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
  }
  act(() => root!.render(<ReadingDetailsPanel book={currentBook} mobile={mobile} />));
  return container!;
}

function findButton(label: string) {
  return Array.from(container!.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(label),
  );
}

beforeEach(() => {
  mocks.navigateInCluster.mockReset();
  mocks.navigateInCluster.mockResolvedValue(undefined);
  mocks.openMobileReadingTab.mockReset();
  mocks.syncVersion = 0;
  store = createAppStore();
  store.init();
  dispatch = vi.fn(store.dispatch);
  Object.defineProperty(store, "dispatch", { configurable: true, value: dispatch });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  store.dispose();
  container?.remove();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
});

describe("ReadingDetailsPanel", () => {
  it("renders book metadata, an existing cover, and useful empty states", () => {
    const currentBook = { ...book, remoteCoverUrl: "https://example.com/cover.jpg" };
    const panel = renderPanel(currentBook);

    expect(panel.querySelector("h2")?.textContent).toBe("Middlemarch");
    expect(panel.textContent).toContain("George Eliot");
    expect(panel.querySelector("img")?.getAttribute("src")).toBe("https://example.com/cover.jpg");
    expect(panel.textContent).toContain("Reading history");
    expect(panel.textContent).toContain("No reading history yet");
    expect(panel.textContent).toContain("Bookmarks");
    expect(panel.textContent).toContain("No bookmarks yet");
    expect(dispatch).toHaveBeenCalledWith(hydrateReadingHistoryRequested(book.id));
    expect(dispatch).toHaveBeenCalledWith(hydrateBookmarksRequested(book.id));
  });

  it("uses the existing cover placeholder when a book has no cover", () => {
    const panel = renderPanel();

    expect(panel.querySelector("img")).toBeNull();
    expect(panel.textContent?.match(/Middlemarch/g)).toHaveLength(2);
  });

  it("renders populated reading-history and bookmark sections with location and date details", () => {
    store.dispatch(readingHistoryHydrated(book.id, [historyEntry]));
    store.dispatch(bookmarksHydrated(book.id, [bookmark]));

    const panel = renderPanel();

    expect(panel.textContent).toContain("Chapter One");
    expect(panel.textContent).toContain("Page 37 of 150");
    expect(panel.textContent).toContain("25%");
    expect(panel.textContent).toContain("A memorable chapter");
    expect(panel.textContent).toContain("Page 42");
    expect(panel.querySelectorAll("time")).toHaveLength(2);
  });

  it("omits missing total-page counts from legacy reading-history entries", () => {
    const legacyEntry = {
      ...historyEntry,
      totalPages: undefined,
    } as unknown as ReadingHistoryEntry;
    store.dispatch(readingHistoryHydrated(book.id, [legacyEntry]));

    const panel = renderPanel();

    expect(panel.textContent).toContain("Page 37");
    expect(panel.textContent).not.toContain("of undefined");
  });

  it("reflects reading history and bookmarks added to the canonical store after mounting", async () => {
    const panel = renderPanel();

    await act(async () => {
      store.dispatch(readingHistoryHydrated(book.id, [historyEntry]));
      store.dispatch(bookmarksHydrated(book.id, [bookmark]));
    });

    expect(panel.textContent).toContain("Chapter One");
    expect(panel.textContent).toContain("A memorable chapter");
  });

  it("navigates EPUB history and bookmarks through the current book cluster", async () => {
    store.dispatch(readingHistoryHydrated(book.id, [historyEntry]));
    store.dispatch(bookmarksHydrated(book.id, [bookmark]));
    renderPanel();

    await act(async () => findButton("Chapter One")?.click());
    await act(async () => findButton("A memorable chapter")?.click());

    expect(mocks.navigateInCluster).toHaveBeenNthCalledWith(1, book.id, historyEntry.cfi);
    expect(mocks.navigateInCluster).toHaveBeenNthCalledWith(2, book.id, bookmark.cfi);
    expect(mocks.openMobileReadingTab).not.toHaveBeenCalled();
  });

  it("navigates PDF page targets and returns mobile readers to Read", async () => {
    const pdfBook: BookMeta = { ...book, format: "pdf" };
    const pdfHistory = { ...historyEntry, cfi: "chapter-1", pageIndex: 12 };
    const pdfBookmark = { ...bookmark, cfi: undefined, label: "Page 28", pageNumber: 28 };
    store.dispatch(readingHistoryHydrated(book.id, [pdfHistory]));
    store.dispatch(bookmarksHydrated(book.id, [pdfBookmark]));
    renderPanel(pdfBook, true);

    await act(async () => findButton("Chapter One")?.click());
    await act(async () => findButton("Page 28")?.click());

    expect(mocks.navigateInCluster).toHaveBeenNthCalledWith(1, book.id, "page:12");
    expect(mocks.navigateInCluster).toHaveBeenNthCalledWith(2, book.id, "page:28");
    expect(mocks.openMobileReadingTab).toHaveBeenCalledTimes(2);
    expect(mocks.openMobileReadingTab).toHaveBeenCalledWith("Read", book.id);
  });

  it("navigates PDF bookmarks that only contain a synced display page", async () => {
    const pdfBook: BookMeta = { ...book, format: "pdf" };
    const pdfBookmark: Bookmark = {
      ...bookmark,
      cfi: undefined,
      label: "Synced PDF page",
      pageNumber: undefined,
      displayPage: 28,
    };
    store.dispatch(bookmarksHydrated(book.id, [pdfBookmark]));
    renderPanel(pdfBook);

    const savedBookmark = findButton("Synced PDF page");
    expect(savedBookmark?.disabled).toBe(false);
    expect(savedBookmark?.textContent).toContain("Page 28");

    await act(async () => savedBookmark?.click());

    expect(mocks.navigateInCluster).toHaveBeenCalledWith(book.id, "page:28");
  });

  it("rehydrates bookmarks when the existing bookmark sync listener changes", () => {
    renderPanel();
    dispatch.mockClear();
    mocks.syncVersion += 1;

    renderPanel();

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(hydrateBookmarksRequested(book.id));
  });
});
