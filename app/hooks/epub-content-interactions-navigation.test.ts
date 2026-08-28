import { describe, expect, it, vi } from "vitest";
import { registerEpubContentInteractions } from "~/hooks/epub-content-interactions";

interface TouchPoint {
  readonly identifier: number;
  readonly clientX: number;
  readonly clientY: number;
}

function touchEvent(
  type: string,
  touches: TouchPoint[],
  changedTouches: TouchPoint[],
  time: number,
) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, {
    touches: { value: touches },
    changedTouches: { value: changedTouches },
    timeStamp: { value: time },
  });
  return event;
}

function swipe(document: Document) {
  const start = { identifier: 1, clientX: 300, clientY: 50 };
  const end = { identifier: 1, clientX: 100, clientY: 52 };
  document.dispatchEvent(touchEvent("touchstart", [start], [start], 10));
  document.dispatchEvent(touchEvent("touchend", [], [end], 100));
}

function setup(endInteractivePageTurn: () => Promise<boolean>) {
  let contentHook: ((content: { document: Document }) => void) | undefined;
  const navigator = {
    beginInteractivePageTurn: vi.fn(() => true),
    updateInteractivePageTurn: vi.fn(() => true),
    endInteractivePageTurn: vi.fn(endInteractivePageTurn),
    cancelInteractivePageTurn: vi.fn(async () => false),
  };
  const callbacks = {
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onInteractiveNavigationStart: vi.fn(),
    onInteractiveNavigationAbort: vi.fn(),
  };
  const cleanup = registerEpubContentInteractions(
    {
      navigator,
      hooks: { content: { register: (callback) => (contentHook = callback) } },
    },
    {
      isPaginatedMobile: () => true,
      onToggleToolbar: vi.fn(),
      ...callbacks,
    },
  );
  const contentDocument = document.implementation.createHTMLDocument();
  Object.defineProperty(contentDocument.documentElement, "clientWidth", { value: 400 });
  contentHook?.({ document: contentDocument });
  return { callbacks, cleanup, contentDocument, navigator };
}

describe("interactive EPUB navigation lifecycle", () => {
  it("cancels an active touch without marking navigation", async () => {
    const { callbacks, contentDocument, navigator } = setup(async () => true);
    const start = { identifier: 1, clientX: 300, clientY: 50 };
    const middle = { identifier: 1, clientX: 180, clientY: 52 };
    contentDocument.dispatchEvent(touchEvent("touchstart", [start], [start], 10));
    contentDocument.dispatchEvent(touchEvent("touchmove", [middle], [middle], 50));
    contentDocument.dispatchEvent(touchEvent("touchcancel", [], [], 60));
    await Promise.resolve();

    expect(navigator.cancelInteractivePageTurn).toHaveBeenCalledOnce();
    expect(navigator.endInteractivePageTurn).not.toHaveBeenCalled();
    expect(callbacks.onInteractiveNavigationStart).not.toHaveBeenCalled();
    expect(callbacks.onInteractiveNavigationAbort).not.toHaveBeenCalled();
  });

  it.each(["reaches a book edge", "rejects", "throws"])(
    "clears navigation when an interactive commit %s",
    async (failure) => {
      const end = () => {
        if (failure === "throws") throw new Error("failed");
        return failure === "rejects" ? Promise.reject(new Error("failed")) : Promise.resolve(false);
      };
      const { callbacks, contentDocument } = setup(end);
      swipe(contentDocument);
      await Promise.resolve();

      expect(callbacks.onInteractiveNavigationStart).toHaveBeenCalledOnce();
      expect(callbacks.onInteractiveNavigationAbort).toHaveBeenCalledOnce();
    },
  );

  it("clears a superseded commit without letting it abort the replacement", async () => {
    let settleFirst: ((completed: boolean) => void) | undefined;
    let settleSecond: ((completed: boolean) => void) | undefined;
    const first = new Promise<boolean>((resolve) => (settleFirst = resolve));
    const second = new Promise<boolean>((resolve) => (settleSecond = resolve));
    const { callbacks, contentDocument, navigator } = setup(async () => true);
    navigator.endInteractivePageTurn.mockReturnValueOnce(first).mockReturnValueOnce(second);

    swipe(contentDocument);
    swipe(contentDocument);
    settleFirst?.(false);
    await Promise.resolve();
    expect(callbacks.onInteractiveNavigationStart).toHaveBeenCalledTimes(2);
    expect(callbacks.onInteractiveNavigationAbort).toHaveBeenCalledOnce();

    settleSecond?.(true);
    await Promise.resolve();
    expect(callbacks.onInteractiveNavigationAbort).toHaveBeenCalledOnce();
  });

  it("clears a pending commit when registration is disposed", () => {
    const { callbacks, cleanup, contentDocument } = setup(() => new Promise(() => {}));
    swipe(contentDocument);
    cleanup();
    expect(callbacks.onInteractiveNavigationAbort).toHaveBeenCalledOnce();
  });
});
