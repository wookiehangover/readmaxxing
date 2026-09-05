vi.mock("~/lib/themis/provider", () => ({ useAppStore: () => railStore }));
import { createAppStore } from "~/lib/themis/store";
import type { ReadingRailTab } from "~/lib/themis/reading-rail/reading-rail-types";
import React, { act, createContext, useContext, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "~/lib/settings";

const auth = vi.hoisted(() => ({ isAuthenticated: true }));
const navigate = vi.hoisted(() => vi.fn());
const exportNotebookMarkdown = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const toastWarning = vi.hoisted(() => vi.fn());

vi.mock("react-router", () => ({ useNavigate: () => navigate }));
vi.mock("~/lib/context/auth-context", () => ({ useAuth: () => auth }));
vi.mock("~/lib/editor/export-notebook-markdown", () => ({ exportNotebookMarkdown }));
vi.mock("sonner", () => ({ toast: { warning: toastWarning } }));
vi.mock("~/components/share-dialog", () => ({
  ShareDialog: ({ book, open }: { book: { title: string } | null; open: boolean }) =>
    open ? <div role="dialog">Share {book?.title}</div> : null,
}));
vi.mock("~/components/chat/chat-book-selector", () => ({
  ChatBookSelectorMenu: () => <div>Books in this chat</div>,
}));
vi.mock("~/components/chat/chat-session-menu", () => ({
  ChatRecentSessionsMenu: ({
    onSwitchSession,
  }: {
    onSwitchSession: (sessionId: string) => void;
  }) => (
    <div role="menuitem" onClick={() => onSwitchSession("session-2")}>
      Session Two
    </div>
  ),
}));
vi.mock("~/components/book-list", () => ({
  TocList: ({
    entries,
    onNavigate,
  }: {
    entries: { label: string; href: string }[];
    onNavigate: (href: string) => void;
  }) =>
    entries.map((entry) => (
      <button key={entry.href} onClick={() => onNavigate(entry.href)}>
        {entry.label}
      </button>
    )),
}));
vi.mock("~/components/ui/dropdown-menu", () => {
  const RadioGroupContext = createContext<((value: string) => void) | undefined>(undefined);
  const Container = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;

  return {
    DropdownMenu: Container,
    DropdownMenuContent: Container,
    DropdownMenuGroup: Container,
    DropdownMenuItem: ({ children, onClick }: React.ComponentProps<"div">) => (
      <div role="menuitem" onClick={onClick}>
        {children}
      </div>
    ),
    DropdownMenuLabel: Container,
    DropdownMenuRadioGroup: ({
      children,
      onValueChange,
    }: {
      children: React.ReactNode;
      onValueChange?: (value: string) => void;
    }) => <RadioGroupContext.Provider value={onValueChange}>{children}</RadioGroupContext.Provider>,
    DropdownMenuRadioItem: ({ children, value }: { children: React.ReactNode; value: string }) => {
      const onValueChange = useContext(RadioGroupContext);
      return <button onClick={() => onValueChange?.(value)}>{children}</button>;
    },
    DropdownMenuSeparator: () => <div role="separator" />,
    DropdownMenuSub: Container,
    DropdownMenuSubContent: Container,
    DropdownMenuSubTrigger: Container,
    DropdownMenuTrigger: Container,
  };
});

import { ReaderSettingsMenu } from "~/components/reader-settings-menu";
import {
  ReadingChatMenuProvider,
  useReadingChatMenuRegistration,
  type ReadingChatMenuActions,
} from "~/lib/context/reading-chat-menu-context";
import {
  ReadingRailProvider,
  useReadingRail,
} from "~/components/reading-shell/reading-rail-context";

let railStore: ReturnType<typeof createAppStore>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settings = {
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
} satisfies Settings;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function RegisterChatActions({ actions }: { actions: ReadingChatMenuActions }) {
  const register = useReadingChatMenuRegistration();
  useEffect(() => register?.(actions), [actions, register]);
  return null;
}

function RailTabControls() {
  const { activeTab, setActiveTab } = useReadingRail();
  return (
    <>
      <output data-testid="active-rail-tab">{activeTab}</output>
      {(["Notes", "Discuss", "Outline"] satisfies ReadingRailTab[]).map((tab) => (
        <button
          key={tab}
          aria-label={`Set active rail tab to ${tab}`}
          data-testid={`set-rail-tab-${tab}`}
          onClick={() => setActiveTab(tab)}
        />
      ))}
    </>
  );
}

function renderMenu({
  withChatActions = false,
  isPdf = false,
  remoteFileUrl,
  guest = false,
}: {
  withChatActions?: boolean;
  isPdf?: boolean;
  remoteFileUrl?: string;
  guest?: boolean;
} = {}) {
  const onUpdateSettings = vi.fn();
  const onNavigateToToc = vi.fn();
  const onNewSession = vi.fn();
  const onSwitchSession = vi.fn();
  const onSyncToFurthestPage = vi.fn().mockResolvedValue(undefined);
  const chatActions: ReadingChatMenuActions = {
    bookId: "book-1",
    activeSessionId: "session-1",
    onNewSession,
    onSwitchSession,
    bookSelection: {
      openBooks: [],
      selectedBookIds: ["book-1"],
      ownBookId: "book-1",
      onToggleBook: vi.fn(),
    },
  };
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      <ReadingRailProvider scope="book-1" privateBookId={isPdf || guest ? null : "book-1"}>
        <ReadingChatMenuProvider>
          <RailTabControls />
          {withChatActions ? <RegisterChatActions actions={chatActions} /> : null}
          <ReaderSettingsMenu
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            isPdf={isPdf}
            book={
              guest
                ? undefined
                : {
                    id: "book-1",
                    title: "Book",
                    author: "Author",
                    coverImage: null,
                    format: "epub",
                    remoteFileUrl,
                  }
            }
            onSyncToFurthestPage={guest ? undefined : onSyncToFurthestPage}
            onDownload={guest ? undefined : vi.fn()}
            onBookmarkPage={guest ? undefined : vi.fn()}
            onCopyPageAsMarkdown={guest ? undefined : vi.fn()}
            onOpenSpeedread={guest ? undefined : vi.fn()}
            toc={[{ label: "Chapter One", href: "chapter-1.xhtml" }]}
            onNavigateToToc={onNavigateToToc}
          />
        </ReadingChatMenuProvider>
      </ReadingRailProvider>,
    ),
  );
  return {
    container,
    onUpdateSettings,
    onNavigateToToc,
    onNewSession,
    onSwitchSession,
    onSyncToFurthestPage,
  };
}

beforeEach(() => {
  railStore = createAppStore();
  railStore.init();
  auth.isAuthenticated = true;
  navigate.mockReset();
  exportNotebookMarkdown.mockClear();
  toastWarning.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  railStore.dispose();
});

describe("ReaderSettingsMenu", () => {
  it("shows icons for the Formatting and Actions submenu triggers", () => {
    const rendered = renderMenu();
    const triggers = Array.from(rendered.container.querySelectorAll("div")).filter(
      (element) => element.textContent === "Formatting" || element.textContent === "Actions",
    );

    expect(triggers).toHaveLength(2);
    expect(triggers.every((trigger) => trigger.querySelector("svg"))).toBe(true);
  });

  it("includes Library and Settings navigation", () => {
    const rendered = renderMenu();
    const items = Array.from(rendered.container.querySelectorAll<HTMLElement>("[role='menuitem']"));

    act(() => items.find((item) => item.textContent?.includes("Library"))?.click());
    act(() => items.find((item) => item.textContent?.includes("Settings"))?.click());

    expect(navigate).toHaveBeenNthCalledWith(1, "/library");
    expect(navigate).toHaveBeenNthCalledWith(2, "/settings");
  });

  it("shows Share at the top level for signed-in users and opens the share dialog", () => {
    const rendered = renderMenu({ remoteFileUrl: "https://example.com/book.epub" });
    const items = Array.from(rendered.container.querySelectorAll<HTMLElement>("[role='menuitem']"));
    const shareItems = items.filter((item) => item.textContent?.trim() === "Share");
    const libraryItem = items.find((item) => item.textContent?.includes("Library"));
    const topLevelShare = shareItems.find(
      (item) => item.parentElement === libraryItem?.parentElement,
    );

    expect(shareItems).toHaveLength(2);
    expect(topLevelShare).toBeDefined();
    act(() => topLevelShare?.click());
    expect(rendered.container.querySelector("[role='dialog']")?.textContent).toBe("Share Book");
  });

  it("warns instead of opening the share dialog for an unsynced book", () => {
    const rendered = renderMenu();
    const items = Array.from(rendered.container.querySelectorAll<HTMLElement>("[role='menuitem']"));
    const libraryItem = items.find((item) => item.textContent?.includes("Library"));
    const topLevelShare = items.find(
      (item) =>
        item.textContent?.trim() === "Share" && item.parentElement === libraryItem?.parentElement,
    );

    act(() => topLevelShare?.click());
    expect(toastWarning).toHaveBeenCalledWith("Sign in and sync this book before sharing it.");
    expect(rendered.container.querySelector("[role='dialog']")).toBeNull();
  });

  it("hides Share when signed out", () => {
    auth.isAuthenticated = false;
    const signedOut = renderMenu();

    expect(
      Array.from(signedOut.container.querySelectorAll<HTMLElement>("[role='menuitem']")).filter(
        (item) => item.textContent?.trim() === "Share",
      ),
    ).toHaveLength(0);
  });

  it("shows Sync to furthest page only for signed-in readers with an open book", async () => {
    const signedIn = renderMenu();
    const syncItem = Array.from(
      signedIn.container.querySelectorAll<HTMLElement>("[role='menuitem']"),
    ).find((item) => item.textContent?.trim() === "Sync to furthest page");

    expect(syncItem).toBeDefined();
    await act(async () => syncItem?.click());
    expect(signedIn.onSyncToFurthestPage).toHaveBeenCalledOnce();

    act(() => root?.unmount());
    signedIn.container.remove();
    root = null;
    container = null;

    auth.isAuthenticated = false;
    const signedOut = renderMenu();
    expect(signedOut.container.textContent).not.toContain("Sync to furthest page");
  });

  it("opens Details for a book-backed menu and keeps notebook export scoped to Notes", async () => {
    const rendered = renderMenu();
    const findDetailsItem = () =>
      Array.from(rendered.container.querySelectorAll<HTMLElement>("[role='menuitem']")).find(
        (item) => item.textContent?.trim() === "Details",
      );
    const findExportItem = () =>
      Array.from(rendered.container.querySelectorAll<HTMLElement>("[role='menuitem']")).find(
        (item) => item.textContent?.includes("Export as Markdown"),
      );

    expect(findDetailsItem()).toBeDefined();
    expect(findExportItem()?.parentElement?.previousElementSibling?.getAttribute("role")).toBe(
      "separator",
    );

    await act(async () => {
      findDetailsItem()?.click();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(rendered.container.querySelector("[data-testid='active-rail-tab']")?.textContent).toBe(
      "Details",
    );
    expect(findExportItem()).toBeUndefined();

    await act(async () => {
      rendered.container
        .querySelector<HTMLButtonElement>("[data-testid='set-rail-tab-Notes']")
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    await act(async () => findExportItem()?.click());
    expect(exportNotebookMarkdown).toHaveBeenCalledWith("book-1", "Book");

    await act(async () => {
      rendered.container
        .querySelector<HTMLButtonElement>("[data-testid='set-rail-tab-Discuss']")
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(findExportItem()).toBeUndefined();
    await act(async () => {
      rendered.container
        .querySelector<HTMLButtonElement>("[data-testid='set-rail-tab-Outline']")
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(findExportItem()).toBeUndefined();
    await act(async () => {
      rendered.container
        .querySelector<HTMLButtonElement>("[data-testid='set-rail-tab-Notes']")
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(findExportItem()).not.toBeUndefined();
    expect(navigate.mock.calls.some(([path]) => path === "/books/book-1/details")).toBe(false);
  });

  it("hides Details when the reader menu has no book", () => {
    const rendered = renderMenu({ guest: true });

    expect(
      Array.from(rendered.container.querySelectorAll<HTMLElement>("[role='menuitem']")).some(
        (item) => item.textContent?.trim() === "Details",
      ),
    ).toBe(false);
  });

  it("keeps formatting updates in the nested menu", () => {
    const rendered = renderMenu();
    const spread = Array.from(rendered.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Two Page Spread",
    );

    act(() => spread?.click());

    expect(rendered.onUpdateSettings).toHaveBeenCalledWith({ readerLayout: "spread" });
  });

  it("shows and updates font weight for EPUB books", () => {
    const rendered = renderMenu();
    const increaseWeight = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Increase font weight"]',
    );

    expect(rendered.container.textContent).toContain("Weight");
    expect(rendered.container.textContent).toContain("400");
    act(() => increaseWeight?.click());
    expect(rendered.onUpdateSettings).toHaveBeenCalledWith({ fontWeight: 500 });
  });

  it("hides font weight for PDF books", () => {
    const rendered = renderMenu({ isPdf: true });

    expect(rendered.container.textContent).not.toContain("Review");
    expect(rendered.container.textContent).not.toContain("Weight");
    expect(
      rendered.container.querySelector('button[aria-label="Increase font weight"]'),
    ).toBeNull();
  });

  it("includes reader actions without Outline", () => {
    const rendered = renderMenu();

    expect(rendered.container.textContent).toContain("Review");
    expect(rendered.container.textContent).toContain("Speedread");
    expect(rendered.container.textContent).toContain("Copy chapter");
    expect(rendered.container.textContent).toContain("Share");
    expect(rendered.container.textContent).toContain("Sync to furthest page");
    expect(rendered.container.textContent).toContain("Download");
    expect(rendered.container.textContent).toContain("Bookmark page");
    expect(rendered.container.textContent).not.toContain("Outline");
  });

  it("hides library-bound actions for guest readers", () => {
    const rendered = renderMenu({ guest: true });

    expect(rendered.container.textContent).toContain("Formatting");
    expect(rendered.container.textContent).toContain("Table of Contents");
    expect(rendered.container.textContent).not.toContain("Review");
    expect(rendered.container.textContent).not.toContain("Actions");
    expect(rendered.container.textContent).not.toContain("Share");
    expect(rendered.container.textContent).not.toContain("Sync to furthest page");
    expect(rendered.container.textContent).not.toContain("Bookmark page");
  });

  it("includes the book table of contents and navigates chapters", () => {
    const rendered = renderMenu();
    expect(rendered.container.textContent).toContain("Table of Contents");

    const chapter = Array.from(rendered.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Chapter One",
    );
    act(() => chapter?.click());

    expect(rendered.onNavigateToToc).toHaveBeenCalledWith("chapter-1.xhtml");
  });

  it("keeps chat actions in a separate final group and switches recent sessions", () => {
    const rendered = renderMenu({ withChatActions: true });
    const items = Array.from(rendered.container.querySelectorAll<HTMLElement>("[role='menuitem']"));
    const exportItem = items.find((item) => item.textContent?.includes("Export as Markdown"));
    const recentSession = items.find((item) => item.textContent?.includes("Session Two"));
    const newChat = items.find((item) => item.textContent?.includes("New chat"));

    expect(rendered.container.textContent).toContain("Recent");
    expect(rendered.container.textContent).toContain("Books in this chat");
    expect(newChat?.parentElement).not.toBe(exportItem?.parentElement);
    expect(newChat?.parentElement?.previousElementSibling?.getAttribute("role")).toBe("separator");
    expect(newChat?.parentElement?.lastElementChild).toBe(newChat);

    act(() => recentSession?.click());
    act(() => newChat?.click());
    expect(rendered.onSwitchSession).toHaveBeenCalledWith("session-2");
    expect(rendered.onNewSession).toHaveBeenCalledOnce();
  });
});
