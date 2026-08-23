import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  epubLifecycle: vi.fn(),
  pdfLifecycle: vi.fn(),
  updateSettings: vi.fn(),
  epubToolbar: vi.fn(),
  pdfView: vi.fn(),
}));

vi.mock("~/hooks/use-epub-lifecycle", () => ({ useEpubLifecycle: mocks.epubLifecycle }));
vi.mock("~/hooks/use-pdf-lifecycle", () => ({ usePdfLifecycle: mocks.pdfLifecycle }));
vi.mock("~/components/workspace-book-reader/epub-reader-chrome", () => ({
  EpubReaderSurface: () => <div data-testid="epub-surface" />,
  EpubReaderToolbar: (props: unknown) => {
    mocks.epubToolbar(props);
    return <div data-testid="epub-reader-toolbar" />;
  },
}));
vi.mock("~/components/workspace-pdf-reader/pdf-reader-view", () => ({
  PdfReaderView: (props: unknown) => {
    mocks.pdfView(props);
    return <div data-testid="pdf-reader-view" />;
  },
}));
vi.mock("~/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("~/hooks/use-toolbar-auto-hide", () => ({
  useToolbarAutoHide: () => ({
    toolbarVisible: true,
    showToolbar: vi.fn(),
    showToolbarPersistent: vi.fn(),
    toggleToolbar: vi.fn(),
    resetToolbarTimer: vi.fn(),
  }),
}));
vi.mock("~/lib/settings", () => ({
  useResolvedTheme: () => "dark",
  useSettings: () => [
    {
      theme: "system",
      colorTheme: "default",
      readerLayout: "single",
      pdfLayout: "fit-height",
      sidebarCollapsed: false,
      zenMode: false,
      libraryView: "grid",
      standardEbooksView: "grid",
      workspaceSortBy: "recent",
      focusedSplitRatio: 0.5,
      fontFamily: "Literata",
      fontSize: 100,
      fontWeight: 400,
      lineHeight: 1.6,
      textAlign: undefined,
    },
    mocks.updateSettings,
  ],
}));

import { SharedBookReader } from "~/components/share/shared-book-reader";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mocks.epubLifecycle.mockReset().mockReturnValue({
    toc: [],
    currentPage: 1,
    totalPages: 10,
    loadError: false,
    navigateToTocHref: vi.fn(),
    navigationInProgressRef: { current: false },
    markNavigationInProgress: vi.fn(),
    currentChapterLabel: "Chapter One",
  });
  mocks.pdfLifecycle.mockReset().mockReturnValue({
    toc: [],
    currentPage: 1,
    totalPages: 10,
    loadError: false,
    goToPage: vi.fn(),
    goNext: vi.fn(),
    goPrev: vi.fn(),
    bookProgress: 10,
  });
  mocks.epubToolbar.mockReset();
  mocks.pdfView.mockReset();
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("SharedBookReader", () => {
  it("opens EPUB shares in spread mode without persisting viewer positions", async () => {
    const arrayBuffer = new ArrayBuffer(4);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => arrayBuffer });
    vi.stubGlobal("fetch", fetchMock);

    act(() =>
      root.render(
        <SharedBookReader
          shareId="share-1"
          fileUrl="/signed/epub"
          format="epub"
          currentCfi="epubcfi(/6/4!/4/2)"
        />,
      ),
    );

    const config = mocks.epubLifecycle.mock.calls[0]![0];
    expect(config).toMatchObject({
      bookId: "share:share-1",
      initialPosition: "epubcfi(/6/4!/4/2)",
      persistPosition: false,
      readerLayout: "spread",
      theme: "dark",
    });
    await expect(config.loadData()).resolves.toBe(arrayBuffer);
    expect(fetchMock).toHaveBeenCalledWith("/signed/epub");
    expect(mocks.epubToolbar).toHaveBeenCalledOnce();
    const toolbarProps = mocks.epubToolbar.mock.calls[0]![0];
    expect(toolbarProps).toMatchObject({
      book: {
        id: "share:share-1",
        title: "",
        author: "",
        coverImage: null,
        format: "epub",
      },
      readOnly: true,
      localSettings: { readerLayout: "spread" },
    });
    expect(toolbarProps).not.toHaveProperty("panelApi");
    expect(toolbarProps).not.toHaveProperty("toolbarVisible");
    expect(toolbarProps).not.toHaveProperty("onOpenNotebook");
    expect(toolbarProps).not.toHaveProperty("onOpenChat");
    expect(toolbarProps).not.toHaveProperty("onBookmarkPage");
  });

  it("opens PDF shares at the shared page without persisting viewer positions", async () => {
    const arrayBuffer = new ArrayBuffer(4);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => arrayBuffer });
    vi.stubGlobal("fetch", fetchMock);

    act(() =>
      root.render(
        <SharedBookReader
          shareId="share-2"
          fileUrl="/signed/pdf"
          format="pdf"
          currentCfi="page:12"
        />,
      ),
    );

    const config = mocks.pdfLifecycle.mock.calls[0]![0];
    expect(config).toMatchObject({
      bookId: "share:share-2",
      initialPosition: "page:12",
      persistPosition: false,
      pdfLayout: "fit-height",
    });
    await expect(config.loadData()).resolves.toBe(arrayBuffer);
    expect(fetchMock).toHaveBeenCalledWith("/signed/pdf");
    expect(mocks.pdfView).toHaveBeenCalledOnce();
    const viewProps = mocks.pdfView.mock.calls[0]![0];
    expect(viewProps).toMatchObject({
      book: {
        id: "share:share-2",
        title: "",
        author: "",
        coverImage: null,
        format: "pdf",
      },
      readOnly: true,
      localSettings: { pdfLayout: "fit-height" },
    });
    expect(viewProps).not.toHaveProperty("panelApi");
    expect(viewProps).not.toHaveProperty("onBookmarkPage");
    expect(viewProps).not.toHaveProperty("onOpenNotebook");
    expect(viewProps).not.toHaveProperty("onOpenChat");
  });
});
