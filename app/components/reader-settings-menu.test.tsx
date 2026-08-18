import React, { act, createContext, useContext, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "~/lib/settings";

const auth = vi.hoisted(() => ({ isAuthenticated: true }));
const navigate = vi.hoisted(() => vi.fn());
const exportNotebookMarkdown = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("react-router", () => ({ useNavigate: () => navigate }));
vi.mock("~/lib/context/auth-context", () => ({ useAuth: () => auth }));
vi.mock("~/lib/editor/export-notebook-markdown", () => ({ exportNotebookMarkdown }));
vi.mock("~/components/share-dialog", () => ({ ShareDialog: () => null }));
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

function renderMenu({
  withChatActions = false,
  isPdf = false,
}: { withChatActions?: boolean; isPdf?: boolean } = {}) {
  const onUpdateSettings = vi.fn();
  const onNavigateToToc = vi.fn();
  const onNewSession = vi.fn();
  const onSwitchSession = vi.fn();
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
      <ReadingChatMenuProvider>
        {withChatActions ? <RegisterChatActions actions={chatActions} /> : null}
        <ReaderSettingsMenu
          settings={settings}
          onUpdateSettings={onUpdateSettings}
          isPdf={isPdf}
          book={{ id: "book-1", title: "Book", author: "Author", coverImage: null, format: "epub" }}
          onDownload={vi.fn()}
          onBookmarkPage={vi.fn()}
          onCopyPageAsMarkdown={vi.fn()}
          onOpenSpeedread={vi.fn()}
          toc={[{ label: "Chapter One", href: "chapter-1.xhtml" }]}
          onNavigateToToc={onNavigateToToc}
        />
      </ReadingChatMenuProvider>,
    ),
  );
  return { container, onUpdateSettings, onNavigateToToc, onNewSession, onSwitchSession };
}

beforeEach(() => {
  auth.isAuthenticated = true;
  navigate.mockReset();
  exportNotebookMarkdown.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
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

  it("places notebook actions in a final group and exports markdown", async () => {
    const rendered = renderMenu();
    const items = Array.from(rendered.container.querySelectorAll<HTMLElement>("[role='menuitem']"));
    const details = items.find((item) => item.textContent?.includes("Details"));
    const exportItem = items.find((item) => item.textContent?.includes("Export as Markdown"));

    expect(details?.parentElement).toBe(exportItem?.parentElement);
    expect(details?.parentElement?.previousElementSibling?.getAttribute("role")).toBe("separator");

    act(() => details?.click());
    expect(navigate).toHaveBeenCalledWith("/books/book-1/details");

    await act(async () => exportItem?.click());
    expect(exportNotebookMarkdown).toHaveBeenCalledWith("book-1", "Book");
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

    expect(rendered.container.textContent).not.toContain("Weight");
    expect(
      rendered.container.querySelector('button[aria-label="Increase font weight"]'),
    ).toBeNull();
  });

  it("includes reader actions without Outline", () => {
    const rendered = renderMenu();

    expect(rendered.container.textContent).toContain("Speedread");
    expect(rendered.container.textContent).toContain("Copy chapter");
    expect(rendered.container.textContent).toContain("Share");
    expect(rendered.container.textContent).toContain("Download");
    expect(rendered.container.textContent).toContain("Bookmark page");
    expect(rendered.container.textContent).not.toContain("Outline");
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
    const details = items.find((item) => item.textContent?.includes("Details"));
    const recentSession = items.find((item) => item.textContent?.includes("Session Two"));
    const newChat = items.find((item) => item.textContent?.includes("New chat"));

    expect(rendered.container.textContent).toContain("Recent");
    expect(rendered.container.textContent).toContain("Books in this chat");
    expect(newChat?.parentElement).not.toBe(details?.parentElement);
    expect(newChat?.parentElement?.previousElementSibling?.getAttribute("role")).toBe("separator");
    expect(newChat?.parentElement?.lastElementChild).toBe(newChat);

    act(() => recentSession?.click());
    act(() => newChat?.click());
    expect(rendered.onSwitchSession).toHaveBeenCalledWith("session-2");
    expect(rendered.onNewSession).toHaveBeenCalledOnce();
  });
});
