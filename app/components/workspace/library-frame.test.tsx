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

import { LibraryFrame } from "~/components/workspace/library-frame";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function renderFrame(pathname: string) {
  const container = document.body.appendChild(document.createElement("div"));
  const fileInputRef = createRef<HTMLInputElement>();
  root = createRoot(container);
  act(() => {
    root?.render(
      <MemoryRouter initialEntries={[pathname]}>
        <LibraryFrame fileInputRef={fileInputRef} onFileInput={vi.fn()}>
          <div>Browse body</div>
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
    ["512", "512px"],
  ])("matches the reading rail column at stored width %s", (storedWidth, expectedWidth) => {
    if (storedWidth) window.sessionStorage.setItem("reading-rail-width", storedWidth);
    const { container } = renderFrame("/library");
    const nav = container.querySelector<HTMLElement>('nav[aria-label="Library navigation"]')!;
    const links = nav.querySelectorAll("a");
    const linkGroup = links.item(0).parentElement!;

    expect(nav.style.width).toBe(expectedWidth);
    expect(nav.className).toContain("px-6");
    expect(nav.className).toContain("py-5");
    expect(linkGroup.className).toContain("flex-1");
    expect(linkGroup.contains(links.item(links.length - 1))).toBe(true);
    expect(linkGroup.contains(nav.querySelector('button[title="More library actions"]'))).toBe(
      false,
    );
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

  it("keeps upload and bug report as the only overflow actions", () => {
    const inputClick = vi.spyOn(HTMLInputElement.prototype, "click");
    const { container } = renderFrame("/library");
    const overflow = container.querySelector('button[title="More library actions"]');
    const actions = Array.from(container.querySelectorAll("button")).filter(
      (button) => button !== overflow,
    );

    expect(actions.map((button) => button.textContent)).toEqual(["Upload book", "Bug report"]);
    act(() => actions[0]?.click());
    expect(inputClick).toHaveBeenCalledOnce();

    act(() => actions[1]?.click());
    expect(
      container.querySelector('[data-testid="bug-report-state"]')?.getAttribute("data-open"),
    ).toBe("true");
  });
});
