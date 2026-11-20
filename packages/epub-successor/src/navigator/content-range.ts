export interface NavigatorContentRange {
  readonly key: string;
  readonly start?: string;
  readonly end?: string;
}

export function fragmentElement(document: Document, fragment: string): Element | null {
  let id = fragment.replace(/^#/, "");
  try {
    id = decodeURIComponent(id);
  } catch {}
  return document.getElementById(id) ?? document.getElementsByName(id)[0] ?? null;
}

export function contentRange(document: Document, bounds: NavigatorContentRange): Range {
  const range = document.createRange();
  range.selectNodeContents(document.body);
  if (bounds.end) {
    const end = fragmentElement(document, bounds.end);
    if (!end || !document.body.contains(end)) throw new RangeError("Missing content range end");
    range.setEndBefore(end);
  }
  if (bounds.start) {
    const start = fragmentElement(document, bounds.start);
    if (!start || !document.body.contains(start))
      throw new RangeError("Missing content range start");
    range.setStartBefore(start);
  }
  if (range.collapsed) throw new RangeError("Empty content range");
  return range;
}

export function rangeContainsRange(bounds: Range, target: Range): boolean {
  return (
    compareRangePoints(bounds, true, target, true) <= 0 &&
    compareRangePoints(bounds, false, target, true) > 0 &&
    compareRangePoints(bounds, false, target, false) >= 0
  );
}

function compareRangePoints(left: Range, leftStart: boolean, right: Range, rightStart: boolean) {
  const a = left.cloneRange();
  a.collapse(leftStart);
  const b = right.cloneRange();
  b.collapse(rightStart);
  return a.compareBoundaryPoints(Range.START_TO_START, b);
}

export function applyContentRange(document: Document, bounds?: NavigatorContentRange): () => void {
  if (!bounds) return () => {};
  const allowed = contentRange(document, bounds);
  const restore: (() => void)[] = [];
  function visit(node: Node) {
    const extent = document.createRange();
    extent.selectNode(node);
    const outside =
      compareRangePoints(allowed, false, extent, true) <= 0 ||
      compareRangePoints(allowed, true, extent, false) >= 0;
    if (outside) {
      if (node.nodeType === 1) {
        const element = node as HTMLElement;
        const old = element.getAttribute("style");
        const inert = element.hasAttribute("inert");
        element.style.setProperty("display", "none", "important");
        element.setAttribute("inert", "");
        restore.push(() => {
          if (old === null) element.removeAttribute("style");
          else element.setAttribute("style", old);
          if (!inert) element.removeAttribute("inert");
        });
      } else if (node.nodeType === 3 || node.nodeType === 4) {
        const old = node.nodeValue;
        node.nodeValue = "";
        restore.push(() => {
          node.nodeValue = old;
        });
      }
      return;
    }
    for (const child of Array.from(node.childNodes)) visit(child);
  }
  for (const child of Array.from(document.body.childNodes)) visit(child);
  return () => {
    for (const undo of restore) undo();
  };
}
