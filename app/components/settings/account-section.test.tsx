import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { isAuthenticated: false, isLoading: false },
  runPromise: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("~/lib/context/auth-context", () => ({
  useAuth: () => mocks.auth,
}));
vi.mock("~/lib/effect-runtime", () => ({
  AppRuntime: { runPromise: mocks.runPromise },
}));
vi.mock("~/lib/auth-service", () => ({
  AuthService: { pipe: vi.fn(() => ({ type: "generateMagicLink" })) },
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

import { AccountSection } from "./account-section";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

beforeEach(() => {
  mocks.auth.isAuthenticated = false;
  mocks.auth.isLoading = false;
  mocks.runPromise.mockReset();
  mocks.toastError.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.writeText.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.writeText },
  });
  document.body.innerHTML = "";
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function renderSection() {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => {
    root?.render(
      <MemoryRouter>
        <AccountSection />
      </MemoryRouter>,
    );
  });
}

describe("AccountSection", () => {
  it("shows the auth checking state", () => {
    mocks.auth.isLoading = true;
    renderSection();
    expect(document.body.textContent).toContain("Checking sign-in status…");
  });

  it("prompts signed-out users to sign in", () => {
    renderSection();
    const link = document.body.querySelector<HTMLAnchorElement>('a[href="/login"]');
    expect(document.body.textContent).toContain("Sign in to generate a magic link.");
    expect(link?.textContent).toBe("Sign in");
  });

  it("generates and copies a magic link for signed-in users", async () => {
    mocks.auth.isAuthenticated = true;
    mocks.runPromise.mockResolvedValue({
      url: "https://example.com/api/auth/magic-link/token",
      expiresAt: "2026-07-15T12:15:00.000Z",
    });
    mocks.writeText.mockResolvedValue(undefined);
    renderSection();

    const generateButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Generate magic link",
    );
    await act(async () => {
      generateButton?.click();
      await Promise.resolve();
    });

    const input = document.body.querySelector<HTMLInputElement>('input[aria-label="Magic link"]');
    expect(input?.value).toBe("https://example.com/api/auth/magic-link/token");
    expect(document.body.textContent).toContain("Expires in 15 minutes.");
    expect(document.body.textContent).toContain("Regenerate magic link");

    const copyButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Copy",
    );
    await act(async () => {
      copyButton?.click();
      await Promise.resolve();
    });

    expect(mocks.writeText).toHaveBeenCalledWith("https://example.com/api/auth/magic-link/token");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Magic link copied");
  });

  it("shows a toast when generation fails", async () => {
    mocks.auth.isAuthenticated = true;
    mocks.runPromise.mockRejectedValue(new Error("request failed"));
    renderSection();

    const generateButton = document.body.querySelector("button");
    await act(async () => {
      generateButton?.click();
      await Promise.resolve();
    });

    expect(mocks.toastError).toHaveBeenCalledWith("Could not generate magic link");
  });
});
