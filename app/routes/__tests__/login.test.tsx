import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  navigate: vi.fn(),
  register: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useSearchParams: () => [new URLSearchParams()],
  };
});
vi.mock("~/lib/context/auth-context", () => ({
  useAuth: () => ({ register: mocks.register, signIn: mocks.signIn }),
}));
vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({ dispatch: mocks.dispatch }),
}));

import LoginRoute from "~/routes/login";
import { refreshAuthSessionRequested } from "~/lib/themis/auth-session/auth-session-slice";

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("LoginRoute", () => {
  it.each([
    { button: "Create account", operation: "register" as const },
    { button: "Sign in", operation: "signIn" as const },
  ])(
    "waits for demo adoption before navigating after $operation",
    async ({ button, operation }) => {
      mocks[operation].mockResolvedValueOnce({ verified: true, userId: "user-1" });
      const root = createRoot(document.body.appendChild(document.createElement("div")));
      act(() => root.render(React.createElement(LoginRoute)));

      const authButton = [...document.querySelectorAll("button")].find(
        (element) => element.textContent === button,
      );
      expect(authButton).toBeDefined();

      await act(async () => {
        authButton?.click();
      });

      expect(mocks.dispatch).toHaveBeenCalledOnce();
      const [refreshAction] = mocks.dispatch.mock.calls[0];
      expect(refreshAction.type).toBe(refreshAuthSessionRequested.type);
      expect(mocks.navigate).not.toHaveBeenCalled();

      await act(async () => {
        refreshAction.payload[0]();
      });

      expect(mocks.navigate).toHaveBeenCalledWith("/", { replace: true });
      act(() => root.unmount());
    },
  );
});
