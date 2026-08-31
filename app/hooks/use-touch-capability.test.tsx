import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHasTouchCapability } from "~/hooks/use-touch-capability";

let root: Root | undefined;

function renderTouchCapability() {
  const values: boolean[] = [];
  const host = document.body.appendChild(document.createElement("div"));
  function Probe() {
    values.push(useHasTouchCapability());
    return null;
  }
  root = createRoot(host);
  act(() => root?.render(<Probe />));
  return values;
}

describe("useHasTouchCapability", () => {
  let coarsePointer = false;
  let notifyChange: (() => void) | undefined;

  beforeEach(() => {
    coarsePointer = false;
    notifyChange = undefined;
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 0 });
    vi.spyOn(window, "matchMedia").mockImplementation(
      () =>
        ({
          matches: coarsePointer,
          media: "(any-pointer: coarse)",
          addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
            notifyChange = () =>
              typeof listener === "function" ? listener(new Event("change")) : undefined;
          },
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("detects touch points at tablet viewport widths", () => {
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 5 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });

    const values = renderTouchCapability();

    expect(values.at(-1)).toBe(true);
  });

  it("stays false for a mouse-only desktop and reacts to pointer capability changes", () => {
    const values = renderTouchCapability();
    expect(values.at(-1)).toBe(false);

    coarsePointer = true;
    act(() => notifyChange?.());
    expect(values.at(-1)).toBe(true);
  });
});
