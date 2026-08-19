import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/components/settings/account-section", () => ({
  AccountSection: () => <div data-testid="account-section">Account content</div>,
}));
vi.mock("~/components/settings/appearance-section", () => ({
  AppearanceSection: () => <div data-testid="appearance-section">Appearance content</div>,
}));
vi.mock("~/components/settings/bug-reports-section", () => ({
  BugReportsSection: () => <div data-testid="bug-reports-section">Bug reports content</div>,
}));
vi.mock("~/components/settings/data-section", () => ({
  DataSection: () => <div data-testid="data-section">Data content</div>,
}));
vi.mock("~/components/settings/reading-section", () => ({
  ReadingSection: () => <div data-testid="reading-section">Reading content</div>,
}));
vi.mock("~/components/settings/updates-section", () => ({
  UpdatesSection: () => <div data-testid="updates-section">Updates content</div>,
}));
vi.mock("~/lib/context/auth-context", () => ({
  useAuth: () => ({ isAuthenticated: false, logout: vi.fn() }),
}));
vi.mock("~/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuGroup: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    render,
  }: React.PropsWithChildren<{
    render?: React.ReactElement<{ children?: React.ReactNode }>;
  }>) =>
    render ? React.cloneElement(render, {}, children) : <button type="button">{children}</button>,
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

import SettingsPage from "~/routes/settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function renderSettings() {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => {
    root?.render(
      <MemoryRouter initialEntries={["/settings"]}>
        <SettingsPage />
      </MemoryRouter>,
    );
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("SettingsPage", () => {
  it("renders the shared app navigation with Settings active", () => {
    const container = renderSettings();
    const nav = container.querySelector('nav[aria-label="Library navigation"]')!;
    const links = Array.from(nav.firstElementChild?.querySelectorAll("a") ?? []);

    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Library", "/library"],
      ["Free ebooks", "/standard-ebooks"],
      ["Settings", "/settings"],
    ]);
    expect(nav.querySelector('a[href="/settings"]')?.getAttribute("aria-current")).toBe("page");
    expect((nav as HTMLElement).style.width).toBe("384px");
  });

  it("shows About in the settings overflow while keeping Login in the footer", () => {
    const container = renderSettings();
    const nav = container.querySelector('nav[aria-label="Library navigation"]')!;
    const overflow = nav.querySelector<HTMLButtonElement>('button[title="More settings actions"]');
    const aboutLink = nav.querySelector<HTMLAnchorElement>('a[href="/about"]');
    const footer = container.querySelector("footer")!;

    expect(overflow?.dataset.slot).toBe("button");
    expect(overflow?.querySelector("svg")).not.toBeNull();
    expect(aboutLink?.textContent).toContain("About");
    expect(aboutLink?.querySelector("svg.lucide-info")).not.toBeNull();
    expect(footer.querySelector('a[href="/about"]')).toBeNull();
    expect(footer.querySelector('a[href="/login"]')?.textContent).toBe("Login");
  });

  it("shows Appearance by default and lists sections in the approved order", () => {
    const container = renderSettings();
    const sectionNav = container.querySelector('nav[aria-label="Settings sections"]')!;
    const buttons = Array.from(sectionNav.querySelectorAll("button"));

    expect(buttons.map((button) => button.textContent)).toEqual([
      "Appearance",
      "Account",
      "Reading",
      "Bug reports",
      "Updates",
      "Data",
    ]);
    expect(container.querySelector("h1")?.textContent).toBe("Appearance");
    expect(container.querySelector('[data-testid="appearance-section"]')).not.toBeNull();
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");
  });

  it("places the plain section rail before the main content without the boxed sidebar", () => {
    const container = renderSettings();
    const layout = container.querySelector('[data-slot="settings-layout"]')!;
    const main = container.querySelector('[data-slot="settings-main"]')!;
    const rail = container.querySelector<HTMLElement>('[data-slot="settings-rail"]')!;

    expect(Array.from(layout.children)).toEqual([rail, main]);
    expect(rail.style.width).toBe("");
    expect(rail.className).toContain("md:w-fit");
    expect(rail.className).not.toContain("bg-sidebar");
    expect(container.querySelector("aside.bg-sidebar")).toBeNull();
    expect(container.textContent).not.toContain("Home");
    expect(container.textContent).toContain("Login");
  });

  it("switches the main settings section from the left rail", () => {
    const container = renderSettings();
    const accountButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Settings sections"] button'),
    ).find((button) => button.textContent === "Account");

    act(() => accountButton?.click());

    expect(container.querySelector("h1")?.textContent).toBe("Account");
    expect(container.querySelector('[data-testid="account-section"]')).not.toBeNull();
  });
});
