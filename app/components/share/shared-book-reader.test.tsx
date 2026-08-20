import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  epubLifecycle: vi.fn(),
  pdfLifecycle: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("~/hooks/use-epub-lifecycle", () => ({ useEpubLifecycle: mocks.epubLifecycle }));
vi.mock("~/hooks/use-pdf-lifecycle", () => ({ usePdfLifecycle: mocks.pdfLifecycle }));
vi.mock("~/components/reader-settings-menu", () => ({ ReaderFormattingMenu: () => null }));
vi.mock("~/components/workspace-book-reader/epub-reader-chrome", () => ({
  EpubReaderSurface: () => <div data-testid="epub-surface" />,
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
  });
  mocks.pdfLifecycle.mockReset().mockReturnValue({
    toc: [],
    currentPage: 1,
    totalPages: 10,
    loadError: false,
    goToPage: vi.fn(),
    goNext: vi.fn(),
    goPrev: vi.fn(),
  });
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
  });
});
