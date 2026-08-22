import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("~/lib/auth-service", () => ({
  authService: { getSession: mocks.getSession },
}));
vi.mock("~/lib/context/auth-context", () => ({
  useAuth: () => ({ isAuthenticated: false }),
}));
vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({ dispatch: mocks.dispatch }),
}));

import { AppNavigation } from "~/components/app-navigation";
import LoginRoute, { clientLoader } from "~/routes/login";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

async function renderNavigation() {
  const container = document.body.appendChild(document.createElement("div"));
  const router = createMemoryRouter(
    [
      { path: "/", element: <p>Authenticated library</p> },
      { path: "/library", Component: AppNavigation },
      { path: "/login", loader: clientLoader, Component: LoginRoute },
    ],
    { initialEntries: ["/library"] },
  );
  root = createRoot(container);

  await act(async () => {
    root?.render(<RouterProvider router={router} />);
  });

  return { container, router };
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("first-click login navigation", () => {
  it("renders the login screen after one client-side click for signed-out sessions", async () => {
    mocks.getSession.mockResolvedValueOnce({ user: null });
    const { container, router } = await renderNavigation();
    const loginLink = container.querySelector<HTMLAnchorElement>('a[href="/login"]');

    expect(loginLink).not.toBeNull();

    await act(async () => {
      loginLink?.click();
    });

    expect(mocks.getSession).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe("/login");
    expect(container.querySelector("h1")?.textContent).toBe("Readmaxxing");
    expect(container.textContent).toContain("Create account");
    expect(container.textContent).toContain("Sign in");
  });

  it("preserves the authenticated-session redirect instead of rendering login", async () => {
    mocks.getSession.mockResolvedValueOnce({ user: { id: "user-1", displayName: "Reader" } });
    const { container, router } = await renderNavigation();
    const loginLink = container.querySelector<HTMLAnchorElement>('a[href="/login"]');

    await act(async () => {
      loginLink?.click();
    });

    expect(mocks.getSession).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe("/");
    expect(container.textContent).toBe("Authenticated library");
  });
});
