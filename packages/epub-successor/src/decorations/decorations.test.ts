import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";

import { locatorFromRange, type SectionMetadata } from "../locations/locations";
import { normalizePublicationPath } from "../publication-model/paths";
import {
  createDecorationLayer,
  supportsCssCustomHighlights,
  type Decoration,
  type SelectionChangedDetail,
} from "./decorations";

function setup() {
  const window = new Window();
  window.document.body.innerHTML = "<p>Alpha target omega</p>";
  const document = window.document as unknown as Document;
  const section: SectionMetadata = {
    href: normalizePublicationPath("chapter.xhtml"),
    spineIndex: 0,
    spineLength: 1,
    spineId: "chapter",
  };
  const text = document.querySelector("p")!.firstChild as Text;
  const range = document.createRange();
  range.setStart(text, 6);
  range.setEnd(text, 12);
  const decoration: Decoration = {
    id: "note-1",
    locator: locatorFromRange(range, section),
    style: { variant: "highlight", color: "gold" },
  };
  return { window, document, section, range, decoration };
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  };
}

describe("DecorationLayer registry", () => {
  it("adds, updates, removes, and clears decorations by id", () => {
    const { document, section, decoration } = setup();
    const layer = createDecorationLayer({ document, section, rendering: "overlay" });

    expect(layer.add(decoration)).toBe(true);
    expect(layer.size).toBe(1);
    expect(layer.get(decoration.id)).toBe(decoration);
    expect(() => layer.add(decoration)).toThrow("already exists");

    const updated = { ...decoration, style: { variant: "highlight" as const, color: "lime" } };
    expect(layer.update(updated)).toBe(true);
    expect(layer.get(decoration.id)).toBe(updated);
    expect(layer.remove(decoration.id)).toBe(true);
    expect(layer.remove(decoration.id)).toBe(false);
    layer.add(decoration);
    layer.clear();
    expect(layer.size).toBe(0);
    layer.destroy();
  });

  it("keeps unresolved decorations for a later refresh", () => {
    const { document, section, decoration } = setup();
    const layer = createDecorationLayer({ document, section, rendering: "overlay" });
    const otherSection = {
      ...decoration,
      locator: { ...decoration.locator, href: normalizePublicationPath("other.xhtml") },
    };

    expect(layer.add(otherSection)).toBe(false);
    expect(layer.size).toBe(1);
    layer.refresh();
    expect(layer.get(decoration.id)).toBe(otherSection);
    layer.destroy();
  });
});

describe("decoration rendering", () => {
  it("feature-detects and registers independent native highlights", () => {
    const { window, document, section, decoration } = setup();
    const registry = new Map<string, object>();
    class FakeHighlight {
      constructor(readonly range: Range) {}
    }
    Object.defineProperties(window, {
      CSS: { configurable: true, value: { highlights: registry } },
      Highlight: { configurable: true, value: FakeHighlight },
    });

    expect(supportsCssCustomHighlights(document)).toBe(true);
    const layer = createDecorationLayer({ document, section });
    expect(layer.renderingMode).toBe("native");
    layer.add(decoration);
    layer.add({ ...decoration, id: "note-2", style: { variant: "highlight", color: "pink" } });

    expect(registry.size).toBe(2);
    expect(document.querySelector("style")?.textContent).toContain("::highlight(");
    layer.remove("note-1");
    expect(registry.size).toBe(1);
    layer.destroy();
    expect(registry.size).toBe(0);
  });

  it("renders stacked overlay rects and hit-tests the top decoration", async () => {
    const { document, section, range, decoration } = setup();
    const rangePrototype = Object.getPrototypeOf(range) as Range;
    vi.spyOn(rangePrototype, "getClientRects").mockReturnValue([
      rect(10, 20, 80, 16),
    ] as unknown as DOMRectList);
    const layer = createDecorationLayer({ document, section, rendering: "overlay" });
    const clicked: string[] = [];
    layer.on("decoration-click", ({ decoration: hit }) => clicked.push(hit.id));

    layer.add(decoration);
    const second = { ...decoration, id: "note-2", style: { variant: "highlight" as const } };
    layer.add(second);
    const overlay = document.querySelector("[data-epub-decoration-overlay]")!;
    expect(overlay.querySelectorAll("span")).toHaveLength(2);
    expect((overlay.lastElementChild as HTMLElement).style.zIndex).toBe("2");

    document.dispatchEvent(new MouseEvent("click", { clientX: 20, clientY: 25 }));
    await Promise.resolve();
    expect(clicked).toEqual(["note-2"]);
    layer.destroy();
    expect(document.querySelector("[data-epub-decoration-overlay]")).toBeNull();
  });
});

describe("selection surface", () => {
  it("emits a persistent locator for a document selection", async () => {
    const { document, section, range } = setup();
    const layer = createDecorationLayer({ document, section, rendering: "overlay" });
    const changes: SelectionChangedDetail[] = [];
    layer.on("selection-changed", (detail) => changes.push(detail));
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    await Promise.resolve();

    expect(changes).not.toHaveLength(0);
    expect(changes.at(-1)?.text).toBe("target");
    expect(changes.at(-1)?.locator?.selectors.textQuote.exact).toBe("target");
    layer.destroy();
  });
});
