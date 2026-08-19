import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addPasskey: vi.fn(),
  auth: { isAuthenticated: false, isLoading: false },
  generateMagicLink: vi.fn(),
  listPasskeys: vi.fn(),
  removePasskey: vi.fn(),
  renamePasskey: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("~/lib/context/auth-context", () => ({
  useAuth: () => ({
    ...mocks.auth,
    addPasskey: mocks.addPasskey,
    generateMagicLink: mocks.generateMagicLink,
    listPasskeys: mocks.listPasskeys,
    removePasskey: mocks.removePasskey,
    renamePasskey: mocks.renamePasskey,
  }),
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

import { AccountSection } from "./account-section";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

const firstPasskey = {
  id: "credential-1",
  name: "Laptop",
  createdAt: "2026-01-02T12:00:00.000Z",
  deviceType: "multiDevice",
  backedUp: true,
  lastUsedAt: null,
};

beforeEach(() => {
  mocks.auth.isAuthenticated = false;
  mocks.auth.isLoading = false;
  mocks.addPasskey.mockReset();
  mocks.generateMagicLink.mockReset();
  mocks.listPasskeys.mockReset();
  mocks.removePasskey.mockReset();
  mocks.renamePasskey.mockReset();
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

async function renderSignedIn(passkeys = [firstPasskey]) {
  mocks.auth.isAuthenticated = true;
  mocks.listPasskeys.mockResolvedValueOnce(passkeys);
  renderSection();
  await flushAsyncWork();
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function findButton(label: string, rootElement: ParentNode = document.body) {
  return Array.from(rootElement.querySelectorAll("button")).find(
    (button) => button.textContent === label,
  );
}

async function click(button: HTMLButtonElement | undefined) {
  expect(button).toBeDefined();
  await act(async () => {
    button?.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
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
    await renderSignedIn();
    mocks.generateMagicLink.mockResolvedValueOnce({
      url: "https://example.com/api/auth/magic-link/token",
      expiresAt: new Date(Date.now() + 7 * 60_000).toISOString(),
    });
    mocks.writeText.mockResolvedValue(undefined);

    await click(findButton("Generate magic link"));

    const input = document.body.querySelector<HTMLInputElement>('input[aria-label="Magic link"]');
    expect(input?.value).toBe("https://example.com/api/auth/magic-link/token");
    expect(document.body.textContent).toContain("Expires in 7 minutes.");
    expect(document.body.textContent).toContain("Regenerate magic link");

    await click(findButton("Copy"));

    expect(mocks.writeText).toHaveBeenCalledWith("https://example.com/api/auth/magic-link/token");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Magic link copied");
  });

  it("shows a toast when generation fails", async () => {
    await renderSignedIn();
    mocks.generateMagicLink.mockRejectedValueOnce(new Error("request failed"));

    await click(findButton("Generate magic link"));

    expect(mocks.toastError).toHaveBeenCalledWith("Could not generate magic link");
  });

  it("lists passkey details and keeps magic links available", async () => {
    await renderSignedIn();

    expect(document.body.textContent).toContain("Laptop");
    expect(document.body.textContent).not.toContain("Backed up");
    expect(document.body.textContent).not.toContain("Backup");
    expect(document.body.querySelector("time")?.dateTime).toBe(firstPasskey.createdAt);
    expect(findButton("Generate magic link")).toBeDefined();
  });

  it("adds a passkey and refreshes the list", async () => {
    await renderSignedIn();
    mocks.addPasskey.mockResolvedValueOnce({ verified: true });
    mocks.listPasskeys.mockResolvedValueOnce([
      firstPasskey,
      { ...firstPasskey, id: "credential-2", name: "Phone", backedUp: false },
    ]);

    await click(findButton("Add passkey"));

    expect(document.body.textContent).toContain("Phone");
    expect(document.body.textContent).not.toContain("Not backed up");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Passkey added");
  });

  it("renames a passkey", async () => {
    await renderSignedIn();
    await click(findButton("Rename"));

    const input = document.body.querySelector<HTMLInputElement>('input[aria-label="Passkey name"]');
    expect(input).not.toBeNull();
    act(() => setInputValue(input!, "Work laptop"));
    mocks.renamePasskey.mockResolvedValueOnce(undefined);

    await click(findButton("Save"));

    expect(document.body.textContent).toContain("Work laptop");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Passkey renamed");
  });

  it("removes a passkey after confirmation", async () => {
    const secondPasskey = { ...firstPasskey, id: "credential-2", name: "Phone" };
    await renderSignedIn([firstPasskey, secondPasskey]);
    await click(findButton("Remove"));

    const dialog = document.body.querySelector('[data-slot="dialog-content"]');
    mocks.removePasskey.mockResolvedValueOnce(undefined);
    await click(findButton("Remove", dialog!));

    expect(document.body.textContent).not.toContain("Laptop");
    expect(document.body.textContent).toContain("Phone");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Passkey removed");
  });

  it("shows a clear error when removing the last passkey", async () => {
    await renderSignedIn();
    await click(findButton("Remove"));

    const dialog = document.body.querySelector('[data-slot="dialog-content"]');
    mocks.removePasskey.mockRejectedValueOnce({
      cause: new Error("Cannot remove the last passkey"),
    });
    await click(findButton("Remove", dialog!));

    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "Add another passkey before removing your last passkey.",
    );
    expect(document.body.textContent).toContain("Laptop");
  });
});
