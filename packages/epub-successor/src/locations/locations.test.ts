import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

import { normalizePublicationPath } from "../publication-model/paths";
import { generateCfi, parseCfi, printCfi, resolveCfi } from "./cfi";
import {
  calculateProgression,
  generateEphemeralPositions,
  locatorFromRange,
  resolveLocator,
  type SectionMetadata,
} from "./locations";

function parseDocument(body: string): Document {
  const window = new Window();
  window.document.body.innerHTML = body;
  return window.document as unknown as Document;
}

function section(spineIndex = 1, spineLength = 4): SectionMetadata {
  return {
    href: normalizePublicationPath(`chapter-${spineIndex + 1}.xhtml`),
    spineIndex,
    spineLength,
    spineId: `item-${spineIndex + 1}`,
  };
}

function textNode(document: Document, selector: string): Text {
  const node = document.querySelector(selector)?.firstChild;
  if (node?.nodeType !== Node.TEXT_NODE) throw new TypeError(`Missing text node for ${selector}`);
  return node as Text;
}

describe("EPUB CFI", () => {
  it("parses and prints steps, indirection, offsets, escaped IDs, and text assertions", () => {
    const value = "epubcfi(/6/4[item^,2]!/4/4/2/1:7[leading,target])";
    expect(printCfi(parseCfi(value))).toBe(value);
    expect(parseCfi(value)).toMatchObject({
      kind: "point",
      packagePath: { steps: [{ number: 6 }, { number: 4, id: "item,2" }] },
      path: {
        offset: 7,
        textAssertion: { before: "leading", after: "target" },
      },
    });
  });

  it("generates and resolves a spine-qualified range CFI", () => {
    const document = parseDocument('<p id="first">Alpha target omega</p>');
    const node = textNode(document, "p");
    const range = document.createRange();
    range.setEnd(node, 12);
    range.setStart(node, 6);

    const cfi = generateCfi(range, section());
    const resolved = resolveCfi(cfi, document, section());

    expect(cfi).toContain("/6/4[item-2]!");
    expect(parseCfi(cfi).kind).toBe("range");
    expect(resolved?.toString()).toBe("target");
    expect(resolved?.startOffset).toBe(6);
    expect(resolved?.endOffset).toBe(12);
  });
});

describe("persistent locators", () => {
  it("round-trips a DOM Range with quote and position selectors", () => {
    const document = parseDocument("<p>Alpha target omega</p>");
    const node = textNode(document, "p");
    const range = document.createRange();
    range.setEnd(node, 12);
    range.setStart(node, 6);

    const locator = locatorFromRange(range, section());
    const resolved = resolveLocator(locator, document, section());

    expect(locator.selectors.textQuote.exact).toBe("target");
    expect(locator.selectors.textPosition).toEqual({ start: 6, end: 12 });
    expect(resolved?.toString()).toBe("target");
  });

  it("uses the text quote when shifted DOM invalidates the CFI", () => {
    const original = parseDocument("<p>Alpha target omega</p>");
    const originalNode = textNode(original, "p");
    const range = original.createRange();
    range.setEnd(originalNode, 12);
    range.setStart(originalNode, 6);
    const locator = locatorFromRange(range, section());

    const shifted = parseDocument("<p>Inserted text</p><p>Alpha target omega</p>");
    const resolved = resolveLocator(locator, shifted, section());

    expect(resolveCfi(locator.locations.cfi!, shifted, section())).toBeNull();
    expect(resolved?.toString()).toBe("target");
    expect(resolved?.startContainer.parentElement).toBe(shifted.querySelectorAll("p")[1]);
  });

  it("uses text positions when neither CFI nor quote resolves", () => {
    const document = parseDocument("<p>Alpha target omega</p>");
    const node = textNode(document, "p");
    const source = document.createRange();
    source.setEnd(node, 1);
    source.setStart(node, 0);
    const locator = {
      ...locatorFromRange(source, section()),
      locations: { progression: 0, totalProgression: 0 },
      selectors: {
        textQuote: { exact: "missing" },
        textPosition: { start: 6, end: 12 },
      },
    };
    expect(resolveLocator(locator, document, section())?.toString()).toBe("target");
  });
});

describe("progression and sampled positions", () => {
  it("combines a clamped intra-section progression with the spine index", () => {
    expect(calculateProgression(1, 4, 0.5)).toEqual({
      progression: 0.5,
      totalProgression: 0.375,
    });
    expect(calculateProgression(3, 4, 2)).toEqual({
      progression: 1,
      totalProgression: 1,
    });
  });

  it("generates one-based ephemeral positions by character count", () => {
    const first = parseDocument(`<p>${"a".repeat(10)}</p>`);
    const second = parseDocument(`<p>${"b".repeat(5)}</p>`);
    const positions = generateEphemeralPositions(
      [
        { document: first, metadata: section(0, 2) },
        { document: second, metadata: section(1, 2) },
      ],
      4,
    );

    expect(positions).toHaveLength(5);
    expect(positions.map(({ locations }) => locations.position)).toEqual([1, 2, 3, 4, 5]);
    expect(positions.map(({ selectors }) => selectors.textPosition.start)).toEqual([0, 4, 8, 0, 4]);
  });
});
