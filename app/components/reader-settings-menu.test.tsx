import React, { act, createContext, useContext } from "react";
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
  lineHeight: 1.6,
  textAlign: undefined,
} satisfies Settings;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderMenu() {
  const onUpdateSettings = vi.fn();
  const onNavigateToToc = vi.fn();
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      <ReaderSettingsMenu
        settings={settings}
        onUpdateSettings={onUpdateSettings}
        book={{ id: "book-1", title: "Book", author: "Author", coverImage: null, format: "epub" }}
        onDownload={vi.fn()}
        onBookmarkPage={vi.fn()}
        onCopyPageAsMarkdown={vi.fn()}
        onOpenSpeedread={vi.fn()}
        toc={[{ label: "Chapter One", href: "chapter-1.xhtml" }]}
        onNavigateToToc={onNavigateToToc}
      />,
    ),
  );
  return { container, onUpdateSettings, onNavigateToToc };
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
});
