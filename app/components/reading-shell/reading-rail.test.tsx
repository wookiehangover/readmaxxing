import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readingLocation = {
  chapterLabel: "Part III, Chapter VII",
  currentPage: 283,
  totalPages: 1164,
};

const tocEntries = [{ label: "Chapter One", href: "chapter-1.xhtml" }];
const navigateToToc = vi.hoisted(() => vi.fn());
const themis = vi.hoisted(() => {
  const books = [
    {
      id: "book-1",
      title: "The Power Broker",
      author: "Robert Caro",
      coverImage: null,
      format: "epub" as "epub" | "pdf",
    },
    {
      id: "book-2",
      title: "Middlemarch",
      author: "George Eliot",
      coverImage: null,
      format: "epub" as "epub" | "pdf",
    },
  ];
  const activeSession = {
    id: "session-1",
    bookId: "book-1",
    title: "New chat",
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  };
  return {
    books,
    store: {
      dispatch: vi.fn(),
      booksSelectors: {
        selectBookById: {
          useValue: (bookId: string) => books.find((book) => book.id === bookId),
        },
      },
      annotationsSelectors: {
        selectNotebookByBookId: {
          useValue: () => ({ content: { type: "doc", content: [] } }),
        },
        selectAnnotationsLoaded: { useValue: () => true },
      },
      chatSessionsSelectors: {
        selectActiveSessionByBook: { useValue: () => activeSession },
        selectChatSessionsLoaded: { useValue: () => true },
        selectChatSessionsError: { useValue: () => null },
        selectRecentSessionsByBook: { useValue: () => [activeSession] },
      },
    },
  };
});

const workspace = vi.hoisted(() => ({
  activeClusterBookIdRef: { current: "book-1" as string | null },
  subscribeClusterChanges: () => () => {},
  subscribeReadingLocations: () => () => {},
  getReadingLocation: () => readingLocation,
  findTocForBook: () => tocEntries,
  findTocNavigationForBook: () => navigateToToc,
  pendingChatPromptMap: { current: new Map() },
  notebookEditorCallbackMap: { current: new Map() },
  notebookContentChangeMap: { current: new Map() },
  notebookCallbackMap: { current: new Map() },
  chatContextMap: { current: new Map() },
  pendingHighlightPillMap: { current: new Map() },
  removeHighlightAnnotationForBook: vi.fn(),
  dockviewApi: { current: null },
  navigateInCluster: vi.fn(),
}));

vi.mock("~/lib/context/workspace-context", () => ({
  useWorkspace: () => workspace,
  useOptionalWorkspace: () => workspace,
}));
vi.mock("~/lib/themis/provider", () => ({ useAppStore: () => themis.store }));
vi.mock("~/lib/context/auth-context", () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));
vi.mock("~/lib/context/reading-chat-menu-context", () => ({
  useReadingChatMenuActions: () => null,
  useReadingChatMenuRegistration: () => null,
}));
vi.mock("~/components/share-dialog", () => ({ ShareDialog: () => null }));
vi.mock("~/hooks/use-sync-listener", () => ({ useSyncListener: () => 0 }));
vi.mock("~/lib/stores/book-store", () => ({
  BookService: {
    getBook: vi.fn(async (bookId: string) => themis.books.find((book) => book.id === bookId)),
    getBookData: vi.fn(async () => new ArrayBuffer(8)),
  },
}));
vi.mock("~/components/ui/scroll-area", () => ({
  ScrollArea: ({
    children,
    className,
    hideScrollbar,
  }: {
    children: React.ReactNode;
    className?: string;
    hideScrollbar?: boolean;
  }) => (
    <div data-slot="scroll-area" className={className}>
      <div data-slot="scroll-area-viewport">{children}</div>
      {!hideScrollbar && <div data-slot="scroll-area-scrollbar" />}
    </div>
  ),
}));
vi.mock("~/components/tiptap-editor", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  return {
    TiptapEditor: ReactModule.forwardRef(function MockTiptapEditor(
      { compact }: { compact?: boolean },
      ref: React.ForwardedRef<unknown>,
    ) {
      ReactModule.useImperativeHandle(ref, () => ({ setContent() {} }));
      return <div data-testid="production-editor" data-compact={compact} />;
    }),
  };
});
vi.mock("~/lib/reading-agent/artifacts-client", async () => {
  const actual = await vi.importActual<typeof import("~/lib/reading-agent/artifacts-client")>(
    "~/lib/reading-agent/artifacts-client",
  );
  return {
    ...actual,
    fetchReadingArtifacts: vi.fn(() => new Promise(() => {})),
    saveReadingOutline: vi.fn(),
  };
});
vi.mock("~/lib/epub/epub-text-extract", () => ({ extractBookChapters: vi.fn(async () => []) }));
vi.mock("~/lib/pdf/pdf-text-extract", () => ({ extractPdfChapters: vi.fn(async () => []) }));
vi.mock("~/lib/sync/book-chapter-uploads", () => ({
  ensureBookChaptersUploaded: vi.fn(async () => {}),
}));
vi.mock("~/components/chat/chat-utils", async () => {
  const actual = await vi.importActual<typeof import("~/components/chat/chat-utils")>(
    "~/components/chat/chat-utils",
  );
  return {
    ...actual,
    createChatTransport: () => ({}),
    createDemoIntroChat: () => null,
    toUIMessages: () => [],
    uiMessagesToChatMessages: () => [],
  };
});
vi.mock("@ai-sdk/react", () => ({
  useChat: ({ messages = [] }: { messages?: unknown[] }) => ({
    messages,
    regenerate: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => {}),
    setMessages: vi.fn(),
    status: "ready",
    stop: vi.fn(),
  }),
}));
vi.mock("~/components/chat/chat-empty-state", () => ({
  ChatEmptyState: () => null,
  SuggestedPrompts: () => null,
}));
vi.mock("~/components/chat/chat-message", () => ({ ChatMessage: () => null }));
vi.mock("~/components/chat/use-chat-tool-handlers", () => ({
  useChatToolHandlers: () => ({ onToolCall: vi.fn(), onFinish: vi.fn() }),
}));
vi.mock("~/components/chat/use-open-books", () => ({ useOpenBooks: () => [] }));
vi.mock("~/components/chat/use-resume-message", () => ({ useResumeMessage: () => {} }));
vi.mock("~/components/chat/use-streaming-append", () => ({ useStreamingAppend: () => {} }));

import { ReaderSettingsMenu } from "~/components/reader-settings-menu";
import { ReadingRail } from "~/components/reading-shell/reading-rail";
import { openMobileReadingTab } from "~/components/reading-shell/mobile-reading-tabs";
import { ReadingRailMenuPortal } from "~/components/reading-shell/reading-rail-menu-portal";
import {
  ReadingRailTabProvider,
  useReadingRailTab,
} from "~/components/reading-shell/reading-rail-tab-context";
import { getSettings } from "~/lib/settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function ActiveTabProbe() {
  const { activeTab } = useReadingRailTab();
  return <output data-testid="active-rail-tab">{activeTab}</output>;
}

function renderRail() {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      <ReadingRailTabProvider>
        <ReadingRail />
        <ActiveTabProbe />
      </ReadingRailTabProvider>,
    ),
  );
  return container;
}

function MobileRailHarness({ mobile = true }: { mobile?: boolean }) {
  return (
    <ReadingRailTabProvider>
      <MemoryRouter>
        <ReadingRail
          mobile={mobile}
          bookSurface={<div data-testid="book-surface">Book surface</div>}
        />
        <ReadingRailMenuPortal>
          <ReaderSettingsMenu
            settings={getSettings()}
            onUpdateSettings={vi.fn()}
            book={themis.books[0]}
            onDownload={vi.fn()}
            onBookmarkPage={vi.fn()}
          />
        </ReadingRailMenuPortal>
      </MemoryRouter>
    </ReadingRailTabProvider>
  );
}

function renderMobileRail() {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(<MobileRailHarness />));
  return container;
}

function remountMobileRail() {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  return renderMobileRail();
}

function clickTab(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label,
  );
  act(() => button?.click());
}

function visiblePanel(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>("[role='tabpanel']")).find(
    (panel) => !panel.hidden,
  );
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  workspace.activeClusterBookIdRef.current = "book-1";
  themis.books[0].title = "The Power Broker";
  themis.books[0].format = "epub";
  readingLocation.chapterLabel = "Part III, Chapter VII";
  readingLocation.currentPage = 283;
  readingLocation.totalPages = 1164;
  tocEntries.splice(0, tocEntries.length, {
    label: "Chapter One",
    href: "chapter-1.xhtml",
  });
  navigateToToc.mockReset();
  themis.store.dispatch.mockReset();
  window.sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false })),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("ReadingRail", () => {
  it("mirrors the desktop rail in the mobile bottom row", () => {
    const container = renderMobileRail();
    const rail = container.firstElementChild!;
    const tabList = container.querySelector("[aria-label='Reading sections']")!;
    const tabs = Array.from(tabList.querySelectorAll("button"));
    const bottomRow = tabList.parentElement!;
    const indicator = tabList.querySelector("[role='presentation']");

    expect(tabs.map((tab) => tab.textContent)).toEqual(["Read", "Notes", "Discuss", "Outline"]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(rail.className).toContain("h-full");
    expect(rail.lastElementChild).toBe(bottomRow);
    expect(tabList.className).toContain("gap-5");
    expect(tabList.className).not.toContain("grid");
    expect(bottomRow.className).not.toContain("border-t");
    expect(bottomRow.className).toContain("pb-3");
    expect(bottomRow.className).not.toContain("safe-area-inset-bottom");
    const menuSlot = bottomRow.querySelector("#reading-rail-menu");
    const menuButton = menuSlot?.querySelector<HTMLButtonElement>("button[title='Reader menu']");
    expect(menuButton?.textContent).toContain("Reader menu");
    expect(menuButton?.querySelector("svg")).not.toBeNull();
    expect(indicator?.className).toContain("left-[var(--active-tab-left)]");
    expect(indicator?.className).toContain("h-px");
    expect(indicator?.className).toContain("w-3");
    expect(indicator?.className).toContain("transition-[left]");
  });

  it("switches Read, Notes, Discuss, and Outline while keeping the book mounted", () => {
    const container = renderMobileRail();
    const bookSurface = container.querySelector("[data-testid='book-surface']");
    const readPanel = bookSurface?.closest<HTMLElement>("[role='tabpanel']");

    expect(bookSurface).not.toBeNull();
    expect(readPanel?.hidden).toBe(false);
    for (const tab of ["Notes", "Discuss", "Outline"] as const) {
      clickTab(container, tab);
      expect(
        Array.from(container.querySelectorAll("button"))
          .find((candidate) => candidate.textContent === tab)
          ?.getAttribute("aria-selected"),
      ).toBe("true");
      const activePanel = visiblePanel(container);
      expect(activePanel?.hidden).toBe(false);
      expect(activePanel).not.toBe(readPanel);
      expect(container.querySelector("[data-testid='book-surface']")).toBe(bookSurface);
      expect(readPanel?.hidden).toBe(true);
      expect(readPanel?.hasAttribute("data-hidden")).toBe(true);
    }

    clickTab(container, "Read");
    expect(
      Array.from(container.querySelectorAll("button"))
        .find((tab) => tab.textContent === "Read")
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(container.querySelector("[data-testid='book-surface']")).toBe(bookSurface);
    expect(readPanel?.hidden).toBe(false);
    expect(readPanel?.hasAttribute("data-hidden")).toBe(false);
  });

  it("opens reader actions in the matching mobile tab", async () => {
    const container = renderMobileRail();

    openMobileReadingTab("Discuss");
    await act(async () => Promise.resolve());

    expect(
      Array.from(container.querySelectorAll("button"))
        .find((tab) => tab.textContent === "Discuss")
        ?.getAttribute("aria-selected"),
    ).toBe("true");

    const remounted = remountMobileRail();
    expect(
      Array.from(remounted.querySelectorAll("button"))
        .find((tab) => tab.textContent === "Discuss")
        ?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("does not force Read when the mobile effect reruns or the rail remounts", () => {
    let container = renderMobileRail();
    clickTab(container, "Outline");

    act(() => root?.render(<MobileRailHarness mobile={false} />));
    act(() => root?.render(<MobileRailHarness />));
    expect(
      Array.from(container.querySelectorAll("button"))
        .find((tab) => tab.textContent === "Outline")
        ?.getAttribute("aria-selected"),
    ).toBe("true");

    container = remountMobileRail();
    expect(
      Array.from(container.querySelectorAll("button"))
        .find((tab) => tab.textContent === "Outline")
        ?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("remembers the last mobile tab independently for each book", () => {
    let container = renderMobileRail();
    clickTab(container, "Discuss");

    workspace.activeClusterBookIdRef.current = "book-2";
    container = remountMobileRail();
    expect(
      Array.from(container.querySelectorAll("button"))
        .find((tab) => tab.textContent === "Read")
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    clickTab(container, "Notes");

    workspace.activeClusterBookIdRef.current = "book-1";
    container = remountMobileRail();
    expect(
      Array.from(container.querySelectorAll("button"))
        .find((tab) => tab.textContent === "Discuss")
        ?.getAttribute("aria-selected"),
    ).toBe("true");

    workspace.activeClusterBookIdRef.current = "book-2";
    container = remountMobileRail();
    expect(
      Array.from(container.querySelectorAll("button"))
        .find((tab) => tab.textContent === "Notes")
        ?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("keeps padding on production tool content inside flush mobile scrollers", async () => {
    const container = renderMobileRail();
    const rail = container.firstElementChild as HTMLElement;

    for (const tab of ["Notes", "Discuss", "Outline"]) {
      clickTab(container, tab);
      if (tab === "Discuss") await flushAsyncWork();

      const panel = visiblePanel(container);
      expect(panel?.className).toBe("min-h-0 flex-1 overflow-hidden outline-none");
      expect(panel?.classList.contains("px-6")).toBe(false);

      const scrollArea = panel?.querySelector("[data-slot='scroll-area']");
      const viewport = scrollArea?.querySelector("[data-slot='scroll-area-viewport']");
      for (const scroller of [scrollArea, viewport]) {
        expect(scroller?.classList.contains("px-6")).toBe(false);
        expect(scroller?.classList.contains("pl-6")).toBe(false);
        expect(scroller?.classList.contains("pr-6")).toBe(false);
      }

      const content = viewport?.firstElementChild ?? null;
      expect(content?.classList.contains("pr-6")).toBe(true);
      expect(content?.classList.contains("pl-6")).toBe(true);
      expect(content?.classList.contains("md:pl-0")).toBe(true);
      expect(rail.contains(content)).toBe(true);

      if (tab === "Discuss") {
        const input = panel?.querySelector("form");
        expect(input?.classList.contains("pr-6")).toBe(true);
        expect(input?.classList.contains("pl-6")).toBe(true);
        expect(input?.classList.contains("md:pl-0")).toBe(true);
      }
    }
  });

  it("hides Notes scrollbar chrome without removing its scroll viewport", () => {
    const container = renderMobileRail();
    clickTab(container, "Notes");

    const panel = visiblePanel(container);
    expect(panel?.querySelector("[data-slot='scroll-area-viewport']")).not.toBeNull();
    expect(panel?.querySelector("[data-slot='scroll-area-scrollbar']")).toBeNull();
  });

  it("keeps scroll viewports flush with the right edge while chrome owns its inset", async () => {
    const container = renderRail();
    const rail = container.firstElementChild as HTMLElement;

    expect(rail.classList.contains("pl-6")).toBe(true);
    expect(rail.classList.contains("py-5")).toBe(true);
    expect(rail.classList.contains("px-6")).toBe(false);
    expect(rail.classList.contains("pr-6")).toBe(false);
    expect(
      container.querySelector("[aria-label='Reading tools']")?.parentElement?.className,
    ).toContain("pr-6");

    for (const tab of ["Notes", "Discuss", "Outline"]) {
      clickTab(container, tab);
      if (tab === "Discuss") await flushAsyncWork();
      const panel = visiblePanel(container);
      const scrollArea = panel?.querySelector("[data-slot='scroll-area']");
      const viewport = scrollArea?.querySelector("[data-slot='scroll-area-viewport']");
      expect(panel?.classList.contains("px-6")).toBe(false);
      expect(scrollArea?.classList.contains("pr-6")).toBe(false);
      expect(viewport?.classList.contains("pr-6")).toBe(false);
    }
  });

  it("switches Notes, Discuss, and Outline in place", () => {
    const container = renderRail();
    expect(container.querySelector("[data-testid='production-editor']")).not.toBeNull();

    clickTab(container, "Discuss");
    expect(visiblePanel(container)?.textContent).toContain("Loading chat");
    expect(container.querySelector("[data-testid='active-rail-tab']")?.textContent).toBe("Discuss");

    clickTab(container, "Outline");
    expect(visiblePanel(container)?.textContent).toContain("Loading outline");
    expect(container.querySelector("[data-testid='active-rail-tab']")?.textContent).toBe("Outline");
  });

  it("uses one sliding underline left-aligned with the active tab label", () => {
    const container = renderRail();
    const tabList = container.querySelector("[aria-label='Reading tools']");
    const indicators = tabList?.querySelectorAll("[data-testid='rail-tab-indicator']");
    const indicator = indicators?.item(0);

    expect(indicators).toHaveLength(1);
    expect(indicator?.className).toContain("left-[var(--active-tab-left)]");
    expect(indicator?.className).toContain("w-3");
    expect(indicator?.className).toContain("transition-[left]");
    expect(indicator?.className).toContain("motion-reduce:transition-none");
    expect(indicator?.className).not.toContain("left-1/2");
    expect(
      Array.from(tabList?.querySelectorAll("button") ?? []).every(
        (tab) => !tab.className.includes("after:"),
      ),
    ).toBe(true);
  });

  it("hides Review and defaults to Notes", () => {
    const container = renderRail();
    const tabList = container.querySelector("[aria-label='Reading tools']");
    const tabs = Array.from(tabList?.querySelectorAll("button") ?? []);

    expect(tabs.map((tab) => tab.textContent)).toEqual(["Notes", "Discuss", "Outline"]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("[data-testid='production-editor']")).not.toBeNull();
    expect(container.textContent).not.toContain("Nothing to review yet.");
  });

  it("shows title, chapter, page metadata, and the rail menu slot", () => {
    const container = renderRail();
    expect(container.textContent).toContain("The Power Broker · Part III, Chapter VII");
    expect(container.textContent).toContain("283 / 1164");
    expect(container.querySelector("#reading-rail-menu")).not.toBeNull();
  });

  it("opens the table of contents from the chapter label and navigates", () => {
    const container = renderRail();
    const chapter = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Part III, Chapter VII",
    );

    expect(chapter?.getAttribute("aria-label")).toContain("Open table of contents");
    act(() => chapter?.click());
    const entry = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Chapter One",
    );
    expect(entry).not.toBeUndefined();

    act(() => entry?.click());
    expect(navigateToToc).toHaveBeenCalledWith("chapter-1.xhtml");
    expect(chapter?.getAttribute("aria-expanded")).toBe("false");
  });

  it("does not make the book title a table of contents control", () => {
    const container = renderRail();
    const title = Array.from(container.querySelectorAll("span")).find(
      (span) => span.textContent === "The Power Broker",
    );
    const titleButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("The Power Broker"),
    );

    act(() => title?.click());
    expect(titleButton).toBeUndefined();
    expect(document.body.querySelector("[data-slot='popover-content']")).toBeNull();
  });

  it("does not render a chapter control without a chapter label or table of contents", () => {
    tocEntries.splice(0);
    const withoutToc = renderRail();
    expect(withoutToc.textContent).toContain("Part III, Chapter VII");
    expect(
      Array.from(withoutToc.querySelectorAll("button")).find(
        (button) => button.textContent === "Part III, Chapter VII",
      ),
    ).toBeUndefined();

    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    tocEntries.push({ label: "Chapter One", href: "chapter-1.xhtml" });
    readingLocation.chapterLabel = "";
    const withoutChapter = renderRail();
    expect(withoutChapter.textContent).not.toContain("Chapter VII");
    expect(withoutChapter.querySelector("[aria-label^='Open table of contents']")).toBeNull();
  });

  it("shows a PDF bookmark title in the rail metadata", () => {
    themis.books[0].title = "Designing Data-Intensive Applications";
    themis.books[0].format = "pdf";
    readingLocation.chapterLabel = "Part II: Distributed Data";
    readingLocation.currentPage = 167;
    readingLocation.totalPages = 616;

    const container = renderRail();
    expect(container.textContent).toContain(
      "Designing Data-Intensive Applications · Part II: Distributed Data",
    );
    expect(container.textContent).toContain("167 / 616");
  });
});
