import { describe, expect, it, vi } from "vitest";

import { visibleViewportText } from "./visible-text";

interface RectFixture {
  readonly left: number;
  readonly top: number;
  readonly width?: number;
  readonly height?: number;
}

function fixture(markup: string, rects: Readonly<Record<string, RectFixture>>): Document {
  const document = window.document.implementation.createHTMLDocument();
  document.body.innerHTML = markup;
  Object.defineProperties(document.documentElement, {
    clientWidth: { configurable: true, value: 800 },
    clientHeight: { configurable: true, value: 600 },
  });

  vi.spyOn(document, "createRange").mockImplementation(() => {
    let node: Node | undefined;
    return {
      setStart(startNode: Node) {
        node = startNode;
      },
      setEnd() {},
      getClientRects() {
        const id = node?.parentElement?.id ?? "";
        const source = rects[id];
        if (!source) return { length: 0, item: () => null } as unknown as DOMRectList;
        const width = source.width ?? 100;
        const height = source.height ?? 20;
        const rect = {
          ...source,
          width,
          height,
          right: source.left + width,
          bottom: source.top + height,
        } as DOMRect;
        return { 0: rect, length: 1, item: () => rect } as unknown as DOMRectList;
      },
    } as unknown as Range;
  });

  return document;
}

describe("visibleViewportText", () => {
  it("excludes off-screen columns from a paginated page", () => {
    const document = fixture(
      '<p id="previous">Previous</p><p id="visible">Current page</p><p id="next">Next</p>',
      {
        previous: { left: -140, top: 40 },
        visible: { left: 40, top: 40 },
        next: { left: 840, top: 40 },
      },
    );

    expect(visibleViewportText(document)).toBe("Current page");
  });

  it("includes both visible columns in a spread", () => {
    const document = fixture(
      '<p id="left">Left page</p><p id="right">Right page</p><p id="next">Hidden page</p>',
      {
        left: { left: 40, top: 40 },
        right: { left: 460, top: 40 },
        next: { left: 840, top: 40 },
      },
    );

    expect(visibleViewportText(document)).toBe("Left page Right page");
  });

  it("excludes nodes above and below a scrolling viewport", () => {
    const document = fixture(
      '<p id="above">Above</p><p id="visible">In view</p><p id="below">Below</p>',
      {
        above: { left: 20, top: -40 },
        visible: { left: 20, top: 120 },
        below: { left: 20, top: 620 },
      },
    );

    expect(visibleViewportText(document)).toBe("In view");
  });

  it("returns short and empty visible strings without applying caller policy", () => {
    const short = fixture('<p id="short">Short</p>', { short: { left: 20, top: 20 } });
    const empty = fixture('<p id="hidden">Hidden</p>', { hidden: { left: 820, top: 20 } });

    expect(visibleViewportText(short)).toBe("Short");
    expect(visibleViewportText(empty)).toBe("");
  });

  it("accepts explicit paginated viewport geometry", () => {
    const document = fixture('<p id="visible">Geometry</p>', {
      visible: { left: 350, top: 20 },
    });

    expect(visibleViewportText(document, { viewportWidth: 300, viewportHeight: 200 })).toBe("");
    expect(visibleViewportText(document, { viewportWidth: 500, viewportHeight: 200 })).toBe(
      "Geometry",
    );
  });
});
