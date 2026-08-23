import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useSearchParams: () => [new URLSearchParams()],
  };
});
vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => ({ dispatch: mocks.dispatch }),
}));

import LoginRoute from "~/routes/login";
import { registerRequested, signInRequested } from "~/lib/themis/auth-session/auth-session-slice";

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("LoginRoute", () => {
  it.each([
    { button: "Create account", operation: "register" as const, request: registerRequested },
    { button: "Sign in", operation: "signIn" as const, request: signInRequested },
  ])(
    "waits for demo adoption before navigating after $operation",
    async ({ button, operation, request }) => {
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
      const [authAction] = mocks.dispatch.mock.calls[0];
      expect(authAction.type).toBe(request.type);
      expect(authAction.payload.at(-1)).toBe(true);
      expect(mocks.navigate).not.toHaveBeenCalled();

      await act(async () => {
        const completed = authAction.payload[operation === "register" ? 1 : 0];
        completed({ verified: true, userId: "user-1" });
      });

      expect(mocks.navigate).toHaveBeenCalledWith("/", { replace: true });
      act(() => root.unmount());
    },
  );
});
