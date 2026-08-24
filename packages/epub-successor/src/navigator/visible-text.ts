export interface VisibleViewportGeometry {
  readonly viewportWidth: number;
  readonly viewportHeight?: number;
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
