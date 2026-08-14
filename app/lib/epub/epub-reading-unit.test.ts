import { describe, expect, it, vi } from "vitest";
import { buildEpubReadingUnit } from "~/lib/epub/epub-reading-unit";

interface RectFixture {
  readonly left: number;
  readonly top: number;
}

function documentFixture(markup: string, rects: Readonly<Record<string, RectFixture>>): Document {
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
        const source = rects[node?.parentElement?.id ?? ""];
        if (!source) return { length: 0, item: () => null } as unknown as DOMRectList;
        const rect = {
          ...source,
          width: 100,
          height: 20,
          right: source.left + 100,
          bottom: source.top + 20,
        } as DOMRect;
        return { 0: rect, length: 1, item: () => rect } as unknown as DOMRectList;
      },
    } as unknown as Range;
  });
  return document;
}

describe("buildEpubReadingUnit", () => {
  it("uses only text intersecting the visible viewport", () => {
    const document = documentFixture(
      '<p id="previous">Previous</p><p id="visible">Visible words</p><p id="next">Next</p>',
      {
        previous: { left: -140, top: 40 },
        visible: { left: 40, top: 40 },
        next: { left: 840, top: 40 },
      },
    );

    expect(buildEpubReadingUnit({ href: "chapter.xhtml", page: 1, document })?.text).toBe(
      "Visible words",
    );
  });

  it("distinguishes pages within the same spine href", () => {
    const first = buildEpubReadingUnit({ href: "chapter.xhtml", page: 1 });
    const second = buildEpubReadingUnit({ href: "chapter.xhtml", page: 2 });

    expect(first?.locator).toBe("chapter.xhtml#page=1");
    expect(second?.locator).toBe("chapter.xhtml#page=2");
    expect(first?.locator).not.toBe(second?.locator);
  });

  it("reuses the locator for the same href and page", () => {
    const options = { href: "chapter.xhtml", page: 7 } as const;

    expect(buildEpubReadingUnit(options)?.locator).toBe(buildEpubReadingUnit(options)?.locator);
  });

  it("keeps text empty without a document or body", () => {
    const withoutBody = documentFixture("<p>Unused</p>", {});
    withoutBody.body.remove();

    expect(buildEpubReadingUnit({ href: "chapter.xhtml", page: 1 })?.text).toBe("");
    expect(
      buildEpubReadingUnit({ href: "chapter.xhtml", page: 1, document: withoutBody })?.text,
    ).toBe("");
  });

  it("provides the same sliced value for dwell and chat context", () => {
    const document = documentFixture('<p id="visible">Shared slice</p>', {
      visible: { left: 40, top: 40 },
    });
    const dwellUnit = buildEpubReadingUnit({ href: "chapter.xhtml", page: 3, document });
    const chatContext = { visibleText: dwellUnit?.text };

    expect(chatContext.visibleText).toBe("Shared slice");
    expect(chatContext.visibleText).toBe(dwellUnit?.text);
  });
});
