import { describe, expect, it, vi } from "vitest";
import {
  createDecorationLayer,
  locatorFromRange,
  normalizePublicationPath,
  type Decoration,
  type SectionMetadata,
} from "@readmaxxing/epub-successor";
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

function swipe(document: Document, from: number, to: number) {
  const start = { identifier: 1, clientX: from, clientY: 50 };
  const end = { identifier: 1, clientX: to, clientY: 52 };
  document.dispatchEvent(touchEvent("touchstart", [start], [start], 10));
  document.dispatchEvent(touchEvent("touchend", [], [end], 100));
}

function documentFixture() {
  const contentDocument = document.implementation.createHTMLDocument();
  Object.defineProperty(contentDocument.documentElement, "clientWidth", { value: 400 });
  return contentDocument;
}

describe("registerEpubContentInteractions", () => {
  it("drives same-section navigator turns without invoking legacy page callbacks", async () => {
    let contentHook: ((content: { document: Document }) => void) | undefined;
    const navigator = {
      beginInteractivePageTurn: vi.fn(() => true),
      updateInteractivePageTurn: vi.fn(() => true),
      endInteractivePageTurn: vi.fn(async () => true),
      cancelInteractivePageTurn: vi.fn(async () => false),
    };
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    registerEpubContentInteractions(
      {
        navigator,
        hooks: {
          content: {
            register: (callback) => {
              contentHook = callback;
            },
          },
        },
      },
      { isPaginatedMobile: () => true, onPrevious, onNext, onToggleToolbar: vi.fn() },
    );
    const contentDocument = documentFixture();
    contentHook?.({ document: contentDocument });
    const start = { identifier: 1, clientX: 300, clientY: 50 };
    const middle = { identifier: 1, clientX: 180, clientY: 52 };
    const end = { identifier: 1, clientX: 100, clientY: 52 };

    contentDocument.dispatchEvent(touchEvent("touchstart", [start], [start], 10));
    contentDocument.dispatchEvent(touchEvent("touchmove", [middle], [middle], 50));
    contentDocument.dispatchEvent(touchEvent("touchend", [], [end], 90));
    await Promise.resolve();

    expect(navigator.beginInteractivePageTurn).toHaveBeenCalledWith("next");
    expect(navigator.updateInteractivePageTurn).toHaveBeenNthCalledWith(1, -120);
    expect(navigator.updateInteractivePageTurn).toHaveBeenLastCalledWith(-200);
    expect(navigator.endInteractivePageTurn).toHaveBeenCalledWith(true);
    expect(onPrevious).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("returns an interactive turn to origin after a sub-threshold release", async () => {
    let contentHook: ((content: { document: Document }) => void) | undefined;
    const navigator = {
      beginInteractivePageTurn: vi.fn(() => true),
      updateInteractivePageTurn: vi.fn(() => true),
      endInteractivePageTurn: vi.fn(async () => false),
      cancelInteractivePageTurn: vi.fn(async () => false),
    };
    registerEpubContentInteractions(
      {
        navigator,
        hooks: {
          content: {
            register: (callback) => {
              contentHook = callback;
            },
          },
        },
      },
      {
        isPaginatedMobile: () => true,
        onPrevious: vi.fn(),
        onNext: vi.fn(),
        onToggleToolbar: vi.fn(),
      },
    );
    const contentDocument = documentFixture();
    contentHook?.({ document: contentDocument });
    const start = { identifier: 1, clientX: 300, clientY: 50 };
    const middle = { identifier: 1, clientX: 260, clientY: 51 };
    const end = { identifier: 1, clientX: 250, clientY: 51 };

    contentDocument.dispatchEvent(touchEvent("touchstart", [start], [start], 10));
    contentDocument.dispatchEvent(touchEvent("touchmove", [middle], [middle], 20));
    contentDocument.dispatchEvent(touchEvent("touchend", [], [end], 300));
    await Promise.resolve();

    expect(navigator.endInteractivePageTurn).toHaveBeenCalledWith(false);
  });

  it("wires natural-direction swipes for current and remounted content documents", () => {
    let contentHook: ((content: { document: Document }) => void) | undefined;
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const cleanup = registerEpubContentInteractions(
      {
        hooks: {
          content: {
            register: (callback) => {
              contentHook = callback;
            },
          },
        },
      },
      { isPaginatedMobile: () => true, onPrevious, onNext, onToggleToolbar: vi.fn() },
    );
    const firstDocument = documentFixture();
    const remountedDocument = documentFixture();

    contentHook?.({ document: firstDocument });
    swipe(firstDocument, 180, 80);
    firstDocument.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 80 }));
    contentHook?.({ document: remountedDocument });
    swipe(remountedDocument, 80, 180);

    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrevious).toHaveBeenCalledOnce();
    cleanup();
    swipe(remountedDocument, 180, 80);
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("preserves tap zones while suppressing all navigation for selection and scroll mode", () => {
    let contentHook: ((content: { document: Document }) => void) | undefined;
    let enabled = true;
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onToggleToolbar = vi.fn();
    registerEpubContentInteractions(
      {
        hooks: {
          content: {
            register: (callback) => {
              contentHook = callback;
            },
          },
        },
      },
      { isPaginatedMobile: () => enabled, onPrevious, onNext, onToggleToolbar },
    );
    const contentDocument = documentFixture();
    contentHook?.({ document: contentDocument });

    for (const x of [50, 200, 350])
      contentDocument.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x }));
    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onToggleToolbar).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();

    const selection = vi.spyOn(contentDocument, "getSelection").mockReturnValue({
      isCollapsed: false,
      toString: () => "selected text",
    } as Selection);
    contentDocument.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 350 }));
    swipe(contentDocument, 180, 80);
    selection.mockReturnValue(null);
    enabled = false;
    contentDocument.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 50 }));
    swipe(contentDocument, 180, 80);
    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("leaves interactive content in control of touch gestures", () => {
    let contentHook: ((content: { document: Document }) => void) | undefined;
    const navigator = {
      beginInteractivePageTurn: vi.fn(() => true),
      updateInteractivePageTurn: vi.fn(() => true),
      endInteractivePageTurn: vi.fn(async () => true),
      cancelInteractivePageTurn: vi.fn(async () => false),
    };
    const onNext = vi.fn();
    registerEpubContentInteractions(
      {
        navigator,
        hooks: { content: { register: (callback) => (contentHook = callback) } },
      },
      {
        isPaginatedMobile: () => true,
        onPrevious: vi.fn(),
        onNext,
        onToggleToolbar: vi.fn(),
      },
    );
    const contentDocument = documentFixture();
    const link = contentDocument.body.appendChild(contentDocument.createElement("a"));
    contentHook?.({ document: contentDocument });
    const start = { identifier: 1, clientX: 180, clientY: 50 };
    const end = { identifier: 1, clientX: 80, clientY: 50 };

    link.dispatchEvent(touchEvent("touchstart", [start], [start], 10));
    link.dispatchEvent(touchEvent("touchmove", [end], [end], 20));
    link.dispatchEvent(touchEvent("touchend", [], [end], 30));

    expect(navigator.beginInteractivePageTurn).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("lets an existing decoration consume a click before mobile page controls", async () => {
    let contentHook: ((content: { document: Document }) => void) | undefined;
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onToggleToolbar = vi.fn();
    const contentDocument = documentFixture();
    contentDocument.body.innerHTML = "<p>Alpha target omega</p>";
    const text = contentDocument.querySelector("p")!.firstChild as Text;
    const range = contentDocument.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 12);
    const rangePrototype = Object.getPrototypeOf(range) as Range;
    const getClientRects = vi.spyOn(rangePrototype, "getClientRects").mockReturnValue([
      {
        left: 150,
        right: 250,
        top: 20,
        bottom: 40,
        width: 100,
        height: 20,
      },
    ] as unknown as DOMRectList);
    const section: SectionMetadata = {
      href: normalizePublicationPath("chapter.xhtml"),
      spineIndex: 0,
      spineLength: 1,
      spineId: "chapter",
    };
    const decoration: Decoration = {
      id: "highlight-1",
      locator: locatorFromRange(range, section),
      style: { variant: "highlight" },
    };
    const layer = createDecorationLayer({
      document: contentDocument,
      section,
      rendering: "overlay",
    });
    const onDecorationClick = vi.fn();
    layer.on("decoration-click", onDecorationClick);
    layer.add(decoration);
    const cleanup = registerEpubContentInteractions(
      {
        hooks: {
          content: {
            register: (callback) => {
              contentHook = callback;
            },
          },
        },
      },
      { isPaginatedMobile: () => true, onPrevious, onNext, onToggleToolbar },
    );
    contentHook?.({ document: contentDocument });

    contentDocument.querySelector("p")!.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 200,
        clientY: 30,
      }),
    );
    await Promise.resolve();

    expect(onDecorationClick).toHaveBeenCalledOnce();
    expect(onPrevious).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
    expect(onToggleToolbar).not.toHaveBeenCalled();
    cleanup();
    layer.destroy();
    getClientRects.mockRestore();
  });
});
