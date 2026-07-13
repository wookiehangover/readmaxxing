import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDemoOnboarding } from "~/hooks/use-demo-onboarding";
import { DEMO_BOOK_METADATA } from "~/lib/onboarding/demo-content";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useDemoOnboarding", () => {
  it("waits for layout and sidebar readiness before opening the demo once", () => {
    const updateSettings = vi.fn();
    const openBook = vi.fn();
    const openChat = vi.fn();
    const openNotebook = vi.fn();
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    let ready = true;

    const render = (layoutReady: boolean, sidebarCollapsed: boolean) => {
      act(() => {
        root.render(<Harness layoutReady={layoutReady} sidebarCollapsed={sidebarCollapsed} />);
      });
    };
    function Harness(props: { layoutReady: boolean; sidebarCollapsed: boolean }) {
      ready = useDemoOnboarding({
        demoBook: DEMO_BOOK_METADATA,
        ...props,
        updateSettings,
        openBook,
        openChat,
        openNotebook,
      });
      return null;
    }

    render(false, false);
    expect(ready).toBe(false);
    expect(updateSettings).not.toHaveBeenCalled();

    render(true, false);
    expect(updateSettings).toHaveBeenCalledWith({ sidebarCollapsed: true });
    expect(openBook).not.toHaveBeenCalled();

    render(true, true);
    expect(ready).toBe(true);
    expect(openBook).toHaveBeenCalledOnce();
    expect(openChat).toHaveBeenCalledOnce();
    expect(openNotebook).toHaveBeenCalledOnce();

    render(true, true);
    expect(openBook).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });

  it("is immediately ready when no demo was seeded", () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    let ready = false;

    function Harness() {
      ready = useDemoOnboarding({
        demoBook: null,
        layoutReady: false,
        sidebarCollapsed: false,
        updateSettings: vi.fn(),
        openBook: vi.fn(),
        openChat: vi.fn(),
        openNotebook: vi.fn(),
      });
      return null;
    }

    act(() => root.render(<Harness />));
    expect(ready).toBe(true);
    act(() => root.unmount());
  });
});
