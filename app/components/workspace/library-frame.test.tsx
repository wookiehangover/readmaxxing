import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuGroup: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: React.ComponentProps<"button">) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
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
    const headerNavigation = container.querySelector<HTMLElement>(
      '[data-slot="library-header-navigation"]',
    )!;
    const links = nav.querySelectorAll("a");

    expect(headerNavigation.style.getPropertyValue("--library-rail-width")).toBe(expectedWidth);
    expect(headerNavigation.className).toContain("md:w-(--library-rail-width)");
    expect(headerNavigation.className).toContain("px-6");
    expect(headerNavigation.parentElement?.className).toContain("py-5");
    expect(nav.className).toContain("flex-1");
    expect(nav.contains(links.item(links.length - 1))).toBe(true);
    expect(
      nav.contains(headerNavigation.querySelector('button[title="More library actions"]')),
    ).toBe(false);
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
    const headerNavigation = container.querySelector('[data-slot="library-header-navigation"]')!;

    expect(slot.contains(controls)).toBe(true);
    expect(header.children[0]).toBe(slot);
    expect(header.children[1]).toBe(headerNavigation);
    expect(headerNavigation.contains(nav)).toBe(true);
  });

  it.each([
    ["/library", "/library"],
    ["/standard-ebooks", "/standard-ebooks"],
  ])("renders the slim shared navigation on %s", (pathname, activeHref) => {
    const { container } = renderFrame(pathname);
    const nav = container.querySelector('nav[aria-label="Library navigation"]')!;
    const links = Array.from(nav.querySelectorAll("a"));

    expect(links.map((link) => link.textContent)).toEqual(["Library", "Free ebooks", "Settings"]);
    const activeLink = nav.querySelector<HTMLAnchorElement>(`a[href="${activeHref}"]`)!;
    expect(activeLink.getAttribute("aria-current")).toBe("page");
    expect(activeLink.className).toContain("after:w-[15px]");
    expect(
      links
        .filter((link) => link !== activeLink)
        .every((link) => !link.className.includes("after:w-[15px]")),
    ).toBe(true);
    const overflow = container.querySelector<HTMLButtonElement>(
      '[data-slot="library-header-navigation"] button[title="More library actions"]',
    );
    expect(overflow?.dataset.slot).toBe("button");
    expect(overflow?.className).toContain("size-8");
    expect(overflow?.className).toContain("hover:bg-muted");
    expect(overflow?.querySelector("svg")).not.toBeNull();
    expect(nav.textContent).not.toContain("…");
    expect(container.textContent).toContain("Browse body");
    expect(container.querySelector("aside")).toBeNull();
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Open sidebar"]')).toBeNull();
  });

  it("places the shared text navigation below the page content on mobile", () => {
    const { container } = renderFrame("/standard-ebooks");
    const mobileNav = container.querySelector<HTMLElement>(
      '[data-slot="library-mobile-navigation"]',
    )!;
    const links = Array.from(mobileNav.querySelectorAll("a"));
    const activeLink = mobileNav.querySelector<HTMLAnchorElement>('a[href="/standard-ebooks"]')!;

    expect(mobileNav.className).toContain("md:hidden");
    expect(mobileNav.className).not.toContain("border-t");
    expect(mobileNav.previousElementSibling?.textContent).toBe("Browse body");
    expect(links.map((link) => link.textContent)).toEqual(["Library", "Free ebooks", "Settings"]);
    expect(activeLink.getAttribute("aria-current")).toBe("page");
    expect(activeLink.className).toContain("text-foreground");
    expect(mobileNav.querySelector('[role="tablist"]')?.className).toContain("gap-5");
    expect(mobileNav.querySelector('[role="presentation"]')?.className).toContain(
      "left-[var(--active-tab-left)]",
    );
    expect(mobileNav.querySelector('button[title="More library actions"]')).not.toBeNull();
    expect(mobileNav.querySelector("svg")).not.toBeNull();
    expect(
      container.querySelector(
        '[data-slot="library-header-navigation"] button[title="More library actions"]',
      ),
    ).not.toBeNull();
  });

  it("keeps upload and bug report as the only overflow actions", () => {
    const inputClick = vi.spyOn(HTMLInputElement.prototype, "click");
    const { container } = renderFrame("/library");
    const headerNavigation = container.querySelector<HTMLElement>(
      '[data-slot="library-header-navigation"]',
    )!;
    const overflow = container.querySelectorAll('button[title="More library actions"]');
    const actions = Array.from(headerNavigation.querySelectorAll("button")).filter(
      (button) => !button.title.includes("More library actions"),
    );

    expect(overflow).toHaveLength(2);
    expect(actions.map((button) => button.textContent)).toEqual(["Upload book", "Bug report"]);
    act(() => actions[0]?.click());
    expect(inputClick).toHaveBeenCalledOnce();

    act(() => actions[1]?.click());
    expect(
      container.querySelector('[data-testid="bug-report-state"]')?.getAttribute("data-open"),
    ).toBe("true");
  });
});
