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
vi.mock("~/components/settings/settings-footer", () => ({
  SettingsFooter: () => (
    <footer>
      <a href="/login">Login</a>
      <a href="/about">About</a>
    </footer>
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
    const links = Array.from(nav.querySelectorAll("a"));

    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Library", "/library"],
      ["Free ebooks", "/standard-ebooks"],
      ["Settings", "/settings"],
    ]);
    expect(nav.querySelector('a[href="/settings"]')?.getAttribute("aria-current")).toBe("page");
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

  it("places the plain section rail after the main content without the boxed sidebar", () => {
    const container = renderSettings();
    const layout = container.querySelector('[data-slot="settings-layout"]')!;
    const main = container.querySelector('[data-slot="settings-main"]')!;
    const rail = container.querySelector<HTMLElement>('[data-slot="settings-rail"]')!;

    expect(Array.from(layout.children)).toEqual([main, rail]);
    expect(rail.style.width).toBe("384px");
    expect(rail.className).not.toContain("bg-sidebar");
    expect(container.querySelector("aside.bg-sidebar")).toBeNull();
    expect(container.textContent).not.toContain("Home");
    expect(container.textContent).toContain("Login");
    expect(container.textContent).toContain("About");
  });

  it("switches the main settings section from the right rail", () => {
    const container = renderSettings();
    const accountButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Settings sections"] button'),
    ).find((button) => button.textContent === "Account");

    act(() => accountButton?.click());

    expect(container.querySelector("h1")?.textContent).toBe("Account");
    expect(container.querySelector('[data-testid="account-section"]')).not.toBeNull();
  });
});
