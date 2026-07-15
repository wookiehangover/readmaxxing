import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ isAuthenticated: false, isLoading: false }));
const workspace = vi.hoisted(() => ({
  openStandardEbooks: vi.fn(),
  subscribeClusterChanges: vi.fn(() => () => {}),
  booksRef: { current: [] },
}));

vi.mock("~/lib/context/auth-context", () => ({ useAuth: () => auth }));
vi.mock("~/lib/context/workspace-context", () => ({
  useWorkspace: () => ({
    openStandardEbooksRef: { current: workspace.openStandardEbooks },
    subscribeClusterChanges: workspace.subscribeClusterChanges,
    booksRef: workspace.booksRef,
  }),
}));
vi.mock("~/components/bug-report-dialog", () => ({
  BugReportDialog: () => <button aria-label="Need help?" />,
}));

import { ClusterBar, ClusterBarActions } from "~/components/workspace/cluster-bar";
import { hasDemoOnboardingState } from "~/lib/onboarding/demo-seed";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function renderActions(demoActive = true) {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      <MemoryRouter>
        <ClusterBarActions demoActive={demoActive} />
      </MemoryRouter>,
    ),
  );
  return container;
}

function renderClusterBar(demoActive = true) {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      <MemoryRouter>
        <ClusterBar
          demoActive={demoActive}
          getEntries={() => [{ bookId: "book-1", bookTitle: "The Great Gatsby" }]}
          getActiveId={() => "book-1"}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onReorder={vi.fn()}
        />
      </MemoryRouter>,
    ),
  );
  return container;
}

beforeEach(() => {
  auth.isAuthenticated = false;
  auth.isLoading = false;
  workspace.openStandardEbooks.mockClear();
  window.localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("ClusterBarActions", () => {
  it("replaces workspace actions with a primary login link for logged-out demos", () => {
    const container = renderActions();
    const login = container.querySelector<HTMLAnchorElement>('a[href="/login"]');

    expect(login?.textContent).toBe("Log in");
    expect(login?.className).toContain("bg-blue-600");
    expect(container.textContent).not.toContain("More books →");
    expect(container.querySelector('[aria-label="Open book"]')).toBeNull();
    expect(container.querySelector('[aria-label="Need help?"]')).toBeNull();
  });
});

describe("ClusterBar", () => {
  it("shows More books immediately after the book tabs for logged-out demos", () => {
    const container = renderClusterBar();
    const tablist = container.querySelector('[role="tablist"]');
    const moreBooks = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "More books →",
    );

    expect(moreBooks).toBeDefined();
    expect(tablist?.nextElementSibling).toBe(moreBooks);
    act(() => moreBooks?.click());
    expect(workspace.openStandardEbooks).toHaveBeenCalledOnce();
  });

  it("keeps the login link after reload when the demo book is not seeded again", () => {
    const demoBook = null;
    window.localStorage.setItem("demo-onboarding", "complete");

    const container = renderClusterBar(demoBook !== null || hasDemoOnboardingState());

    expect(container.querySelector('a[href="/login"]')).not.toBeNull();
    expect(container.textContent).toContain("More books →");
    expect(container.querySelector('[aria-label="Open book"]')).toBeNull();
    expect(container.querySelector('[aria-label="Need help?"]')).toBeNull();
  });

  it("shows the normal actions outside a logged-out demo", () => {
    auth.isAuthenticated = true;
    const authenticated = renderClusterBar();

    expect(authenticated.querySelector('a[href="/login"]')).toBeNull();
    expect(authenticated.textContent).not.toContain("More books →");
    expect(authenticated.querySelector('[aria-label="Open book"]')).not.toBeNull();
    expect(authenticated.querySelector('[aria-label="Need help?"]')).not.toBeNull();

    act(() => root?.unmount());
    root = null;
    auth.isAuthenticated = false;
    const regularWorkspace = renderClusterBar(false);
    expect(regularWorkspace.querySelector('a[href="/login"]')).toBeNull();
    expect(regularWorkspace.textContent).not.toContain("More books →");
    expect(regularWorkspace.querySelector('[aria-label="Open book"]')).not.toBeNull();
    expect(regularWorkspace.querySelector('[aria-label="Need help?"]')).not.toBeNull();
  });
});
