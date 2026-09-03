export interface VisibleViewportGeometry {
  readonly viewportWidth: number;
  readonly viewportHeight?: number;
}

/** Last rendered source box, excluding clipped/hidden nodes and trailing whitespace. */
export function lastRenderedRange(document: Document): Range | undefined {
  const walker = document.createTreeWalker(document.body, 1 | 4 | 8);
  while (walker.lastChild()) {
    // Descend to the final source node.
  }
  const range = document.createRange();
  let node: Node | null = walker.currentNode;
  while (node && node !== document.body) {
    if (node.nodeType === 3 || node.nodeType === 4) {
      const end = (node.nodeValue ?? "").trimEnd().length;
      if (end > 0) {
        range.setStart(node, end - 1);
        range.setEnd(node, end);
      } else {
        node = walker.previousNode();
        continue;
      }
    } else range.selectNode(node);
    if (Array.from(range.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0))
      return range;
    node = walker.previousNode();
  }
  return undefined;
}

function viewportDimension(value: number | undefined, fallback: number): number {
  const dimension = value ?? fallback;
  return Number.isFinite(dimension) ? Math.max(0, dimension) : 0;
}

function intersectsViewport(rect: DOMRect, width: number, height: number): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < width &&
    rect.top < height
  );
}

function rangeIntersectsViewport(range: Range, width: number, height: number): boolean {
  const rects = range.getClientRects();
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects.item(index);
    if (rect && intersectsViewport(rect, width, height)) return true;
  }
  return false;
}

/** Returns normalized text whose rendered word boxes intersect the iframe viewport. */
export function visibleViewportText(
  document: Document,
  geometry?: VisibleViewportGeometry,
): string {
  const root = document.documentElement;
  const width = viewportDimension(geometry?.viewportWidth, root.clientWidth);
  const height = viewportDimension(geometry?.viewportHeight, root.clientHeight);
  if (!document.body || width === 0 || height === 0) return "";

  const walker = document.createTreeWalker(document.body, 4);
  const range = document.createRange();
  const visibleWords: string[] = [];
  let node = walker.nextNode();

  while (node) {
    const text = node.nodeValue ?? "";
    for (const match of text.matchAll(/\S+/g)) {
      const start = match.index;
      range.setStart(node, start);
      range.setEnd(node, start + match[0].length);
      if (rangeIntersectsViewport(range, width, height)) visibleWords.push(match[0]);
    }
    node = walker.nextNode();
  }

  return visibleWords.join(" ");
}
