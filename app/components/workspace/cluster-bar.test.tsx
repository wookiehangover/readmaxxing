import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ isAuthenticated: false, isLoading: false }));

vi.mock("~/lib/context/auth-context", () => ({ useAuth: () => auth }));
vi.mock("~/components/bug-report-dialog", () => ({
  BugReportDialog: () => <button aria-label="Need help?" />,
}));

import { ClusterBarActions } from "~/components/workspace/cluster-bar";
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

beforeEach(() => {
  auth.isAuthenticated = false;
  auth.isLoading = false;
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
    expect(container.querySelector('[aria-label="Open book"]')).toBeNull();
    expect(container.querySelector('[aria-label="Need help?"]')).toBeNull();
  });

  it("keeps the login link after reload when the demo book is not seeded again", () => {
    const demoBook = null;
    window.localStorage.setItem("demo-onboarding", "complete");

    const container = renderActions(demoBook !== null || hasDemoOnboardingState());

    expect(container.querySelector('a[href="/login"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Open book"]')).toBeNull();
    expect(container.querySelector('[aria-label="Need help?"]')).toBeNull();
  });

  it("shows the normal actions outside a logged-out demo", () => {
    auth.isAuthenticated = true;
    const authenticated = renderActions();

    expect(authenticated.querySelector('a[href="/login"]')).toBeNull();
    expect(authenticated.querySelector('[aria-label="Open book"]')).not.toBeNull();
    expect(authenticated.querySelector('[aria-label="Need help?"]')).not.toBeNull();

    act(() => root?.unmount());
    root = null;
    auth.isAuthenticated = false;
    const regularWorkspace = renderActions(false);
    expect(regularWorkspace.querySelector('a[href="/login"]')).toBeNull();
    expect(regularWorkspace.querySelector('[aria-label="Open book"]')).not.toBeNull();
    expect(regularWorkspace.querySelector('[aria-label="Need help?"]')).not.toBeNull();
  });
});
