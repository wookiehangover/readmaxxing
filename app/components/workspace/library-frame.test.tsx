import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookMeta } from "~/lib/stores/book-store";

const mocks = vi.hoisted(() => ({
  books: [] as BookMeta[],
  lastOpenedMap: new Map<string, number>(),
  auth: {
    isAuthenticated: false as boolean,
  },
}));

vi.mock("~/hooks/use-effect-query", () => ({
  useEffectQuery: () => ({ data: mocks.lastOpenedMap, error: undefined, isLoading: false }),
}));

vi.mock("~/lib/context/workspace-context", () => ({
  useOptionalWorkspace: () => ({ booksRef: { current: mocks.books } }),
}));

vi.mock("~/lib/context/auth-context", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("~/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuGroup: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuItem: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({
    children,
    render,
    ...props
  }: React.ComponentProps<"button"> & {
    render?: React.ReactElement<React.ComponentProps<"button">>;
  }) =>
    render ? (
      React.cloneElement(render, props, children)
    ) : (
      <button type="button" {...props}>
        {children}
      </button>
    ),
}));

vi.mock("~/components/bug-report-dialog", () => ({
  BugReportDialog: ({ open }: { open?: boolean }) => (
    <div data-testid="bug-report-state" data-open={open} />
  ),
}));

import { LibraryFrame, LibraryHeaderControls } from "~/components/workspace/library-frame";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderFrame(pathname: string, children: React.ReactNode = <div>Browse body</div>) {
  const container = document.body.appendChild(document.createElement("div"));
  const fileInputRef = createRef<HTMLInputElement>();
  root = createRoot(container);
  act(() => {
    root?.render(
      <MemoryRouter initialEntries={[pathname]}>
        <LibraryFrame fileInputRef={fileInputRef} onFileInput={vi.fn()}>
          {children}
        </LibraryFrame>
      </MemoryRouter>,
    );
  });
  return { container, fileInputRef };
}

beforeEach(() => {
  window.sessionStorage.clear();
  mocks.books = [];
  mocks.lastOpenedMap = new Map();
  mocks.auth.isAuthenticated = false;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("LibraryFrame", () => {
  it.each([
    [null, "384px"],
    ["512", "384px"],
  ])("uses the default rail width with stored width %s", (storedWidth, expectedWidth) => {
    if (storedWidth) window.sessionStorage.setItem("reading-rail-width", storedWidth);
    const { container } = renderFrame("/library");
    const nav = container.querySelector<HTMLElement>('nav[aria-label="Library navigation"]')!;
    const links = Array.from(nav.firstElementChild?.querySelectorAll("a") ?? []);
    const linkGroup = links[0]!.parentElement!;

    expect(nav.style.width).toBe(expectedWidth);
    expect(nav.className).toContain("px-6");
    expect(nav.parentElement?.className).toContain("py-5");
    expect(linkGroup.className).toContain("flex-1");
    expect(linkGroup.contains(links[links.length - 1]!)).toBe(true);
    expect(linkGroup.contains(nav.querySelector('button[title="More library actions"]'))).toBe(
      false,
    );
  });

  it("renders page controls to the left of the rail-width navigation", () => {
    const { container } = renderFrame(
      "/library",
      <LibraryHeaderControls>
        <div data-testid="page-controls">Controls</div>
      </LibraryHeaderControls>,
    );
    const header = container.querySelector("header")!;
    const controls = container.querySelector('[data-testid="page-controls"]')!;
    const slot = container.querySelector('[data-slot="library-header-controls"]')!;
    const nav = container.querySelector('nav[aria-label="Library navigation"]')!;

    expect(slot.contains(controls)).toBe(true);
    expect(header.children[0]).toBe(slot);
    expect(header.children[1]).toBe(nav);
  });

  it.each([
    ["/library", "/library"],
    ["/standard-ebooks", "/standard-ebooks"],
  ])("renders the slim shared navigation on %s", (pathname, activeHref) => {
    const { container } = renderFrame(pathname);
    const nav = container.querySelector('nav[aria-label="Library navigation"]')!;
    const links = Array.from(nav.firstElementChild?.querySelectorAll("a") ?? []);
    const loginLink = nav.querySelector<HTMLAnchorElement>('a[href="/login"]');

    expect(links.map((link) => link.textContent)).toEqual(["Library", "Free ebooks", "Settings"]);
    expect(loginLink?.dataset.slot).toBe("button");
    expect(loginLink?.className).toContain("border-border");
    const activeLink = nav.querySelector<HTMLAnchorElement>(`a[href="${activeHref}"]`)!;
    expect(activeLink.getAttribute("aria-current")).toBe("page");
    expect(activeLink.className).toContain("after:w-[15px]");
    expect(activeLink.className).toContain("text-foreground");
    expect(activeLink.className).not.toContain("text-muted-foreground");
    expect(
      links
        .filter((link) => link !== activeLink)
        .every((link) => !link.className.includes("after:w-[15px]")),
    ).toBe(true);
    expect(
      links
        .filter((link) => link !== activeLink)
        .every(
          (link) =>
            link.className.includes("text-muted-foreground") &&
            link.className.includes("hover:text-foreground"),
        ),
    ).toBe(true);
    const overflow = nav.querySelector<HTMLButtonElement>('button[title="More library actions"]');
    expect(overflow?.dataset.slot).toBe("button");
    expect(overflow?.className).toContain("size-8");
    expect(overflow?.className).toContain("hover:bg-muted");
    expect(overflow?.querySelector("svg")).not.toBeNull();
    expect(nav.textContent).not.toContain("…");
    expect(container.textContent).toContain("Browse body");
    expect(container.querySelector("aside")).toBeNull();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector('[aria-label="Open sidebar"]')).toBeNull();
  });

  it("hides Login when authenticated", () => {
    mocks.auth.isAuthenticated = true;
    const { container } = renderFrame("/library");
    const nav = container.querySelector('nav[aria-label="Library navigation"]')!;

    expect(nav.querySelector('a[href="/login"]')).toBeNull();
  });

  it("shows iconed upload and bug report actions and omits an empty Recent section", () => {
    const inputClick = vi.spyOn(HTMLInputElement.prototype, "click");
    const { container } = renderFrame("/library");
    const overflow = container.querySelector('button[title="More library actions"]');
    const actions = Array.from(container.querySelectorAll("button")).filter(
      (button) => button !== overflow,
    );

    expect(actions.map((button) => button.textContent)).toEqual(["Upload book", "Bug report"]);
    expect(actions[0]?.querySelector("svg.lucide-upload")).not.toBeNull();
    expect(actions[1]?.querySelector("svg.lucide-bug")).not.toBeNull();
    expect(container.textContent).not.toContain("Recent");
    expect(container.querySelector("hr")).toBeNull();
    act(() => actions[0]?.click());
    expect(inputClick).toHaveBeenCalledOnce();

    act(() => actions[1]?.click());
    expect(
      container.querySelector('[data-testid="bug-report-state"]')?.getAttribute("data-open"),
    ).toBe("true");
  });

  it("lists the five most recently opened books and navigates to the selected book", () => {
    mocks.books = Array.from({ length: 7 }, (_, index) => ({
      id: `book-${index + 1}`,
      title: `Book ${index + 1}`,
      author: `Author ${index + 1}`,
      coverImage: null,
      format: "epub" as const,
    }));
    mocks.lastOpenedMap = new Map([
      ["book-1", 100],
      ["book-2", 600],
      ["book-3", 300],
      ["book-4", 500],
      ["book-5", 200],
      ["book-6", 400],
    ]);
    const { container } = renderFrame("/library", <LocationProbe />);
    const recentLabel = Array.from(container.querySelectorAll("span")).find(
      (span) => span.textContent === "Recent",
    );
    const recentGroup = recentLabel?.parentElement;
    const recentItems = Array.from(recentGroup?.querySelectorAll("button") ?? []);

    expect(container.querySelectorAll("hr")).toHaveLength(1);
    expect(recentItems.map((button) => button.textContent)).toEqual([
      "Book 2",
      "Book 4",
      "Book 6",
      "Book 3",
      "Book 5",
    ]);
    expect(recentItems[0]?.querySelector("span")?.className).toContain("truncate");

    act(() => recentItems[2]?.click());
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe("/books/book-6");
  });
});
