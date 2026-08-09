import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDemoOnboarding } from "~/hooks/use-demo-onboarding";
import { DEMO_BOOK_METADATA } from "~/lib/onboarding/demo-content";

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useDemoOnboarding", () => {
  it("waits for layout and sidebar readiness before opening the demo once", () => {
    const updateSettings = vi.fn();
    const calls: string[] = [];
    const openBook = vi.fn(() => calls.push("book"));
    const openChat = vi.fn(() => calls.push("chat"));
    const openNotebook = vi.fn(() => calls.push("notebook"));
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
    expect(calls).toEqual(["book", "notebook", "chat"]);

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

  it("releases the bootstrap gate when layout readiness never settles", () => {
    vi.useFakeTimers();
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    let ready = true;

    function Harness() {
      ready = useDemoOnboarding({
        demoBook: DEMO_BOOK_METADATA,
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
    expect(ready).toBe(false);

    act(() => vi.advanceTimersByTime(10_000));
    expect(ready).toBe(true);
    act(() => root.unmount());
  });
});
