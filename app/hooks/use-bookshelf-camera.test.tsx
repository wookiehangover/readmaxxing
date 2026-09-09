import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBookshelfCamera } from "~/hooks/use-bookshelf-camera";

let root: Root | undefined;
let time = 0;
let nextFrame = 0;
let smoothMotion = true;
let notifyMotionChange: (() => void) | undefined;
const frames = new Map<number, FrameRequestCallback>();

function Camera({ visibleIds }: { visibleIds: Set<string> }) {
  const stack = useRef<HTMLOListElement>(null);
  useBookshelfCamera(stack, visibleIds, null);
  return (
    <div className="bookshelf">
      <ol ref={stack}>
        <li style={{ marginBottom: 28 }}>
          <span
            className="bookshelf-scene"
            data-active="true"
            style={{ paddingTop: 48, perspective: 4200 }}
          />
        </li>
      </ol>
    </div>
  );
}

function renderCamera() {
  act(() => root?.unmount());
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root!.render(<Camera visibleIds={new Set(["book"])} />));
  const shelf = host.querySelector<HTMLElement>(".bookshelf")!;
  const scene = host.querySelector<HTMLElement>(".bookshelf-scene")!;
  return {
    scroll: (position: number) => {
      shelf.scrollTop = position;
      shelf.dispatchEvent(new Event("scroll"));
    },
    origin: () => parseFloat(scene.style.getPropertyValue("--shelf-camera-y")),
  };
}

function advance(milliseconds: number) {
  time += milliseconds;
  const pending = Array.from(frames.values());
  frames.clear();
  for (const callback of pending) callback(time);
}

describe("useBookshelfCamera animation", () => {
  beforeEach(() => {
    time = 0;
    nextFrame = 0;
    smoothMotion = true;
    notifyMotionChange = undefined;
    frames.clear();
    vi.spyOn(performance, "now").mockImplementation(() => time);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (frame: number) => frames.delete(frame));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(window, "matchMedia").mockImplementation(
      () =>
        ({
          get matches() {
            return smoothMotion;
          },
          addEventListener: (_type: string, listener: () => void) => {
            notifyMotionChange = listener;
          },
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "clientTop", "get").mockReturnValue(0);
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.className === "bookshelf-scene" ? 200 : 0;
      },
    );
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("interpolates wheel-sized steps monotonically in both directions and stops when settled", () => {
    const camera = renderCamera();
    const initial = camera.origin();
    expect(Number.isFinite(initial)).toBe(true);
    expect(frames.size).toBe(0);

    for (const position of [80, 0]) {
      const start = camera.origin();
      const direction = position === 80 ? 1 : -1;
      camera.scroll(position);
      expect(camera.origin()).toBe(start);
      advance(16);
      const intermediate = camera.origin();
      expect((intermediate - start) * direction).toBeGreaterThan(0);
      expect(frames.size).toBe(1);
      let previous = intermediate;
      for (let frame = 0; frame < 60; frame++) {
        advance(16);
        expect((camera.origin() - previous) * direction).toBeGreaterThanOrEqual(0);
        previous = camera.origin();
      }
      expect((camera.origin() - intermediate) * direction).toBeGreaterThan(0);
      expect(frames.size).toBe(0);
    }
    expect(camera.origin()).toBeCloseTo(initial, 5);
  });

  it("makes equal progress at equal elapsed times across refresh rates", () => {
    const origins = [8, 16, 32].map((interval) => {
      const camera = renderCamera();
      camera.scroll(80);
      for (let elapsed = 0; elapsed < 160; elapsed += interval) advance(interval);
      return camera.origin();
    });
    expect(origins[0]).toBeCloseTo(origins[1], 5);
    expect(origins[1]).toBeCloseTo(origins[2], 5);
  });

  it("keeps animation progress when the visible rows change", () => {
    const camera = renderCamera();
    camera.scroll(80);
    advance(16);
    const intermediate = camera.origin();
    act(() => root!.render(<Camera visibleIds={new Set(["book", "next"])} />));
    expect(camera.origin()).toBe(intermediate);
    advance(16);
    expect(camera.origin()).toBeGreaterThan(intermediate);
  });

  it("updates directly when smooth motion is disabled", () => {
    smoothMotion = false;
    const camera = renderCamera();
    const initial = camera.origin();
    camera.scroll(80);
    advance(16);
    expect(camera.origin()).toBeGreaterThan(initial);
    expect(frames.size).toBe(0);
  });

  it("finishes pending motion when the motion preference changes", () => {
    const camera = renderCamera();
    camera.scroll(80);
    advance(16);
    const intermediate = camera.origin();
    smoothMotion = false;
    notifyMotionChange!();
    expect(camera.origin()).toBeGreaterThan(intermediate);
    expect(frames.size).toBe(0);
  });

  it("cancels the pending animation on unmount", () => {
    renderCamera().scroll(80);
    expect(frames.size).toBe(1);
    act(() => root!.unmount());
    root = undefined;
    expect(frames.size).toBe(0);
  });
});
