import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { applyContentRange, contentRange, rangeContainsRange } from "./content-range";
import { generateCfi, resolveCfi } from "../locations/cfi";

function fixture() {
  // happy-dom's detached XML documents bind Range to the wrong root. Native
  // XHTML parsing and mounted range geometry are also covered by package E2E.
  const doc = new Window().document as unknown as Document;
  doc.body.innerHTML =
    'prefix<div><h1 id="a">First</h1><p>Alpha 😀</p><h1 id="b">Second</h1><p>Beta</p></div><h1 id="c">Third</h1>suffix';
  return doc;
}
describe("bounded publication layout", () => {
  it("keeps inclusive starts, exclusive ends and rejects ranges spanning units", () => {
    const doc = fixture();
    const bounds = contentRange(doc, { key: "second", start: "b", end: "c" });
    const point = doc.createRange();
    point.setStartBefore(doc.getElementById("b")!);
    point.collapse(true);
    expect(rangeContainsRange(bounds, point)).toBe(true);
    point.setStartBefore(doc.getElementById("c")!);
    point.collapse(true);
    expect(rangeContainsRange(bounds, point)).toBe(false);
    point.setStartBefore(doc.getElementById("b")!);
    point.setEndAfter(doc.getElementById("c")!);
    expect(rangeContainsRange(bounds, point)).toBe(false);
  });
  it("hides nested siblings and direct text without changing readable CFI identities", () => {
    const doc = fixture();
    const before = doc.body.innerHTML;
    const text = doc.querySelectorAll("p")[1]!.firstChild!;
    const range = doc.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    const cfi = generateCfi(range, { spineIndex: 0 });
    const restore = applyContentRange(doc, { key: "second", start: "b", end: "c" });
    expect((doc.getElementById("a") as HTMLElement).style.display).toBe("none");
    expect((doc.getElementById("b") as HTMLElement).style.display).toBe("");
    expect((doc.getElementById("c") as HTMLElement).style.display).toBe("none");
    expect(doc.body.firstChild?.textContent).toBe("");
    expect(doc.body.lastChild?.textContent).toBe("");
    expect(resolveCfi(cfi, doc, { spineIndex: 0 })?.startContainer).toBe(text);
    expect(generateCfi(range, { spineIndex: 0 })).toBe(cfi);
    restore();
    expect(doc.body.innerHTML).toBe(before);
  });
  it("retains the prefix of the first unit and rejects missing anchors", () => {
    const doc = fixture();
    applyContentRange(doc, { key: "first", end: "b" });
    expect(doc.body.firstChild?.textContent).toBe("prefix");
    expect((doc.getElementById("b") as HTMLElement).style.display).toBe("none");
    expect(() => contentRange(doc, { key: "bad", start: "missing" })).toThrow("Missing");
  });
});
