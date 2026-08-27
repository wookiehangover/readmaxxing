import { describe, expect, it, vi } from "vitest";
import { addPageSwipeRecognizer, PAGE_SWIPE_MAX_DURATION_MS } from "~/hooks/page-swipe-recognizer";

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

function dispatchGesture(target: EventTarget, start: TouchPoint, end: TouchPoint, duration = 100) {
  const startEvent = touchEvent("touchstart", [start], [start], 10);
  const endEvent = touchEvent("touchend", [], [end], 10 + duration);
  target.dispatchEvent(startEvent);
  target.dispatchEvent(endEvent);
  return { startEvent, endEvent };
}

function setup(getSelection?: () => Selection | null) {
  const target = document.createElement("div");
  const onPrevious = vi.fn();
  const onNext = vi.fn();
  const cleanup = addPageSwipeRecognizer(target, { onPrevious, onNext, getSelection });
  return { target, onPrevious, onNext, cleanup };
}

describe("addPageSwipeRecognizer", () => {
  it("recognizes repeated horizontal swipes once in their natural direction", () => {
    const { target, onPrevious, onNext } = setup();

    dispatchGesture(target, point(180, 50), point(80, 55));
    dispatchGesture(target, point(80, 50), point(180, 45));

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it("ignores short, vertically dominant, and long gestures", () => {
    const { target, onPrevious, onNext } = setup();

    dispatchGesture(target, point(100, 100), point(115, 103));
    dispatchGesture(target, point(100, 100), point(170, 180));
    dispatchGesture(target, point(180, 50), point(80, 50), PAGE_SWIPE_MAX_DURATION_MS + 1);

    expect(onPrevious).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("ignores canceled and multi-touch gestures", () => {
    const { target, onPrevious, onNext } = setup();
    const start = point(180, 50);

    target.dispatchEvent(touchEvent("touchstart", [start], [start], 10));
    target.dispatchEvent(touchEvent("touchcancel", [], [start], 20));
    target.dispatchEvent(touchEvent("touchend", [], [point(80, 50)], 30));

    target.dispatchEvent(touchEvent("touchstart", [start], [start], 40));
    target.dispatchEvent(
      touchEvent("touchmove", [start, point(170, 50, 2)], [point(170, 50, 2)], 50),
    );
    target.dispatchEvent(touchEvent("touchend", [], [point(80, 50)], 60));

    expect(onPrevious).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("ignores gestures ending with selected text without preventing native touch behavior", () => {
    const selection = { isCollapsed: false, toString: () => "selected text" } as Selection;
    const { target, onNext } = setup(() => selection);
    const preventStart = vi.spyOn(Event.prototype, "preventDefault");

    const { startEvent, endEvent } = dispatchGesture(target, point(180, 50), point(80, 50));

    expect(onNext).not.toHaveBeenCalled();
    expect(preventStart).not.toHaveBeenCalled();
    expect(startEvent.defaultPrevented).toBe(false);
    expect(endEvent.defaultPrevented).toBe(false);
    preventStart.mockRestore();
  });

  it("removes all behavior during cleanup", () => {
    const { target, onPrevious, onNext, cleanup } = setup();
    cleanup();

    dispatchGesture(target, point(180, 50), point(80, 50));
    dispatchGesture(target, point(80, 50), point(180, 50));

    expect(onPrevious).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });
});
