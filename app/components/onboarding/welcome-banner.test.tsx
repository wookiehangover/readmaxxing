import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ isAuthenticated: false, isLoading: false }));

vi.mock("~/lib/context/auth-context", () => ({ useAuth: () => auth }));

import { WelcomeBanner } from "~/components/onboarding/welcome-banner";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function renderBanner(active = true) {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      <MemoryRouter>
        <WelcomeBanner active={active} />
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

describe("WelcomeBanner", () => {
  it("shows only for an active, logged-out demo", () => {
    const container = renderBanner();
    expect(container.querySelector('[aria-label="Demo welcome"]')).not.toBeNull();
    expect(container.querySelector('a[href="/login"]')?.textContent).toBe("Log in");

    act(() =>
      root?.render(
        <MemoryRouter>
          <WelcomeBanner active={false} />
        </MemoryRouter>,
      ),
    );
    expect(container.querySelector('[aria-label="Demo welcome"]')).toBeNull();

    auth.isAuthenticated = true;
    act(() =>
      root?.render(
        <MemoryRouter>
          <WelcomeBanner active />
        </MemoryRouter>,
      ),
    );
    expect(container.querySelector('[aria-label="Demo welcome"]')).toBeNull();
  });

  it("persists dismissal across mounts", () => {
    const container = renderBanner();
    const dismiss = container.querySelector<HTMLButtonElement>('[aria-label="Dismiss welcome"]');
    act(() => dismiss?.click());

    expect(container.querySelector('[aria-label="Demo welcome"]')).toBeNull();
    expect(window.localStorage.getItem("demo-welcome-banner-dismissed")).toBe("complete");

    act(() => root?.unmount());
    root = null;
    expect(renderBanner().querySelector('[aria-label="Demo welcome"]')).toBeNull();
  });
});
