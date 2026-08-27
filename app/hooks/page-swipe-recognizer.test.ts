import { describe, expect, it, vi } from "vitest";
import {
  addPageSwipeRecognizer,
  type PageSwipeCancellation,
  type PageSwipeProgress,
  type PageSwipeRelease,
} from "~/hooks/page-swipe-recognizer";

interface TouchPoint {
  readonly identifier: number;
  readonly clientX: number;
  readonly clientY: number;
}

function point(clientX: number, clientY: number, identifier = 1): TouchPoint {
  return { identifier, clientX, clientY };
}

function touchEvent(
  type: string,
  touches: readonly TouchPoint[],
  changedTouches: readonly TouchPoint[],
  timeStamp: number,
): TouchEvent {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: { value: touches },
    changedTouches: { value: changedTouches },
    timeStamp: { value: timeStamp },
  });
  return event as TouchEvent;
}

function start(target: EventTarget, touch: TouchPoint, timeStamp = 10) {
  target.dispatchEvent(touchEvent("touchstart", [touch], [touch], timeStamp));
}

function move(target: EventTarget, touch: TouchPoint, timeStamp: number) {
  target.dispatchEvent(touchEvent("touchmove", [touch], [touch], timeStamp));
}

function end(target: EventTarget, touch: TouchPoint, timeStamp: number) {
  target.dispatchEvent(touchEvent("touchend", [], [touch], timeStamp));
}

function setup(overrides: Parameters<typeof addPageSwipeRecognizer>[1] = {}) {
  const target = document.createElement("div");
  const onPrevious = vi.fn();
  const onNext = vi.fn();
  const onStart = vi.fn<(swipe: PageSwipeProgress) => void>();
  const onProgress = vi.fn<(swipe: PageSwipeProgress) => void>();
  const onRelease = vi.fn<(swipe: PageSwipeRelease) => void>();
  const onCancel = vi.fn<(swipe: PageSwipeCancellation) => void>();
  const cleanup = addPageSwipeRecognizer(target, {
    onPrevious,
    onNext,
    onStart,
    onProgress,
    onRelease,
    onCancel,
    getViewportWidth: () => 400,
    ...overrides,
  });
  return { target, onPrevious, onNext, onStart, onProgress, onRelease, onCancel, cleanup };
}

describe("addPageSwipeRecognizer", () => {
  it("locks after horizontal intent and reports continuous signed displacement and progress", () => {
    const { target, onStart, onProgress } = setup();

    start(target, point(200, 100));
    move(target, point(196, 102), 20);
    expect(onStart).not.toHaveBeenCalled();

    move(target, point(180, 103), 30);
    move(target, point(120, 105), 50);

    expect(onStart).toHaveBeenCalledOnce();
    expect(onStart).toHaveBeenCalledWith({
      direction: "next",
      displacement: -20,
      progress: -0.05,
      boundary: false,
    });
    expect(onProgress).toHaveBeenLastCalledWith({
      direction: "next",
      displacement: -80,
      progress: -0.2,
      boundary: false,
    });
  });

  it("does not lock vertical gestures or prevent native touch behavior", () => {
    const { target, onStart, onProgress, onRelease } = setup();
    const preventDefault = vi.spyOn(Event.prototype, "preventDefault");

    start(target, point(100, 100));
    move(target, point(105, 130), 20);
    end(target, point(110, 170), 30);

    expect(onStart).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
    expect(onRelease).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    preventDefault.mockRestore();
  });

  it("completes from 25% viewport distance in either direction", () => {
    const { target, onPrevious, onNext, onRelease } = setup();

    start(target, point(250, 50), 10);
    move(target, point(140, 52), 310);
    end(target, point(140, 52), 610);
    start(target, point(100, 50), 700);
    move(target, point(210, 48), 1000);
    end(target, point(210, 48), 1300);

    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onRelease.mock.calls.map(([swipe]) => swipe.intent)).toEqual(["complete", "complete"]);
  });

  it("completes a clear horizontal fling below the distance threshold", () => {
    const { target, onNext, onRelease } = setup();

    start(target, point(200, 50), 10);
    move(target, point(160, 50), 40);
    end(target, point(160, 50), 50);

    expect(onNext).toHaveBeenCalledOnce();
    expect(onRelease).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "complete", velocity: -1 }),
    );
  });

  it("reports snap-back when neither distance nor velocity commits", () => {
    const { target, onPrevious, onNext, onRelease } = setup();

    start(target, point(200, 50), 10);
    move(target, point(170, 50), 110);
    end(target, point(160, 50), 210);

    expect(onPrevious).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
    expect(onRelease).toHaveBeenCalledWith(
      expect.objectContaining({ displacement: -40, progress: -0.1, intent: "snap-back" }),
    );
  });

  it("allows slow deliberate drags to complete based on distance", () => {
    const { target, onNext, onRelease } = setup();

    start(target, point(250, 50), 10);
    move(target, point(190, 50), 1010);
    end(target, point(140, 50), 5010);

    expect(onNext).toHaveBeenCalledOnce();
    expect(onRelease).toHaveBeenCalledWith(expect.objectContaining({ intent: "complete" }));
  });

  it("exposes unavailable directions as boundary releases without navigation", () => {
    const canNavigate = vi.fn(() => false);
    const { target, onStart, onNext, onRelease } = setup({ canNavigate });

    start(target, point(250, 50), 10);
    move(target, point(130, 50), 100);
    end(target, point(100, 50), 120);

    expect(canNavigate).toHaveBeenCalledWith("next");
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ boundary: true }));
    expect(onRelease).toHaveBeenCalledWith(
      expect.objectContaining({ boundary: true, intent: "boundary" }),
    );
    expect(onNext).not.toHaveBeenCalled();
  });

  it("cancels locked sessions on multi-touch, touchcancel, and cleanup", () => {
    const { target, onCancel, cleanup } = setup();

    start(target, point(200, 50), 10);
    move(target, point(180, 50), 20);
    target.dispatchEvent(
      touchEvent("touchmove", [point(170, 50), point(220, 50, 2)], [point(220, 50, 2)], 30),
    );

    start(target, point(200, 50), 40);
    move(target, point(180, 50), 50);
    target.dispatchEvent(touchEvent("touchcancel", [], [point(180, 50)], 60));

    start(target, point(200, 50), 70);
    move(target, point(180, 50), 80);
    cleanup();

    expect(onCancel.mock.calls.map(([swipe]) => swipe.reason)).toEqual([
      "multi-touch",
      "touchcancel",
      "cleanup",
    ]);
  });

  it("preserves text selection without starting or committing a swipe", () => {
    const selection = { isCollapsed: false, toString: () => "selected text" } as Selection;
    const { target, onStart, onNext, onRelease } = setup({ getSelection: () => selection });

    start(target, point(200, 50), 10);
    move(target, point(120, 50), 20);
    end(target, point(80, 50), 30);

    expect(onStart).not.toHaveBeenCalled();
    expect(onRelease).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("removes all behavior during cleanup", () => {
    const { target, onStart, onPrevious, onNext, cleanup } = setup();
    cleanup();

    start(target, point(200, 50), 10);
    move(target, point(100, 50), 20);
    end(target, point(80, 50), 30);

    expect(onStart).not.toHaveBeenCalled();
    expect(onPrevious).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });
});
