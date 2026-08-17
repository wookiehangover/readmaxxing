import React, { act, createContext, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "~/lib/settings";

const auth = vi.hoisted(() => ({ isAuthenticated: true }));
const navigate = vi.hoisted(() => vi.fn());

vi.mock("react-router", () => ({ useNavigate: () => navigate }));
vi.mock("~/lib/context/auth-context", () => ({ useAuth: () => auth }));
vi.mock("~/components/share-dialog", () => ({ ShareDialog: () => null }));
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
      />,
    ),
  );
  return { container, onUpdateSettings };
}

beforeEach(() => {
  auth.isAuthenticated = true;
  navigate.mockReset();
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
});
