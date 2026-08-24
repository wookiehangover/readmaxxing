import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refreshAuth: vi.fn(),
  register: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("~/lib/context/auth-context", () => ({
  useAuth: () => ({
    refreshAuth: mocks.refreshAuth,
    register: mocks.register,
    signIn: mocks.signIn,
  }),
}));

import { OnboardingDialog } from "./onboarding-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

beforeEach(() => {
  mocks.refreshAuth.mockReset();
  mocks.register.mockReset();
  mocks.signIn.mockReset();
  document.body.innerHTML = "";
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("OnboardingDialog", () => {
  it("awaits post-auth adoption before refreshing auth and resuming", async () => {
    const order: string[] = [];
    let finishAdoption: (() => void) | undefined;
    const adoption = new Promise<void>((resolve) => {
      finishAdoption = resolve;
    });
    mocks.register.mockImplementation(async () => {
      order.push("auth");
      return { verified: true, userId: "user-1" };
    });
    mocks.refreshAuth.mockImplementation(() => order.push("refresh"));
    const onAuthenticated = vi.fn(async (userId: string) => {
      order.push(`adopt:${userId}`);
      await adoption;
      order.push("resolve-intent");
    });

    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() => {
      root?.render(
        <OnboardingDialog open onOpenChange={vi.fn()} onAuthenticated={onAuthenticated} />,
      );
    });

    const createButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Create account",
    );
    expect(createButton).toBeDefined();
    act(() => createButton?.click());
    await act(async () => Promise.resolve());

    expect(document.body.textContent).toContain("Setting up your library…");
    expect(order).toEqual(["auth", "adopt:user-1"]);
    expect(mocks.refreshAuth).not.toHaveBeenCalled();

    await act(async () => {
      finishAdoption?.();
      await adoption;
      await Promise.resolve();
    });

    expect(order).toEqual(["auth", "adopt:user-1", "resolve-intent", "refresh"]);
  });
});
