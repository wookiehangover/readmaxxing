export type RtlScrollType = "default" | "negative" | "reverse";

export interface ColumnGeometry {
  readonly viewportWidth: number;
  readonly columnWidth: number;
  readonly columnGap: number;
  readonly columnStride: number;
  readonly pagesPerSpread: 1 | 2;
}

export interface PaginatedLayoutState extends ColumnGeometry {
  readonly direction: "ltr" | "rtl";
  readonly pageCount: number;
  readonly maxOffset: number;
  readonly rtlScrollType: RtlScrollType;
  readonly scrolling: Element;
}

const PAGINATION_STYLE_ID = "epub-successor-pagination-style";
const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
export const DEFAULT_MIN_SPREAD_WIDTH = 800;
/** Gap between columns in a multi-page spread (middle gutter only). */
export const DEFAULT_COLUMN_GAP = 64;
/**
 * Vertical padding inside the section body. Horizontal chrome lives on the host
 * container — body side padding only paints at scrollLeft=0 and makes later
 * pages look offset relative to the first.
 */
export const DEFAULT_BLOCK_PADDING = 24;

function snapped(value: number, minimum = 0): number {
  return Math.max(minimum, Math.round(Number.isFinite(value) ? value : minimum));
}

function contained(value: number, minimum = 0): number {
  return Math.max(minimum, Math.floor(Number.isFinite(value) ? value : minimum));
}

export function effectivePagesPerSpread(
  viewportWidth: number,
  spread: "single" | "double" | undefined,
  minSpreadWidth = DEFAULT_MIN_SPREAD_WIDTH,
): 1 | 2 {
  const threshold =
    Number.isFinite(minSpreadWidth) && minSpreadWidth >= 0
      ? minSpreadWidth
      : DEFAULT_MIN_SPREAD_WIDTH;
  return spread === "double" && viewportWidth >= threshold ? 2 : 1;
}

export function calculateColumnGeometry(
  viewportWidth: number,
  columnGap: number,
  pagesPerSpread: 1 | 2,
  inlineInset = 0,
): ColumnGeometry {
  const width = contained(viewportWidth, 1);
  const availableWidth = Math.max(pagesPerSpread, width - contained(inlineInset));
  const gap = Math.min(snapped(columnGap), Math.max(0, availableWidth - pagesPerSpread));
  const columnWidth = Math.max(
    1,
    Math.floor((availableWidth - gap * (pagesPerSpread - 1)) / pagesPerSpread),
  );
  return {
    viewportWidth: width,
    columnWidth,
    columnGap: gap,
    columnStride: columnWidth + gap,
    pagesPerSpread,
  };
}

export function calculatePageCount(scrollWidth: number, geometry: ColumnGeometry): number {
  const extent = Math.max(geometry.viewportWidth, snapped(scrollWidth, geometry.viewportWidth));
  const overflow = Math.max(0, extent - geometry.viewportWidth);
  return Math.max(
    geometry.pagesPerSpread,
    Math.ceil(overflow / geometry.columnStride) + geometry.pagesPerSpread,
  );
}

export function logicalOffsetFromScrollLeft(
  scrollLeft: number,
  maxOffset: number,
  direction: "ltr" | "rtl",
  rtlType: RtlScrollType,
): number {
  if (direction === "ltr") return Math.min(maxOffset, Math.max(0, scrollLeft));
  const logical =
    rtlType === "negative"
      ? -scrollLeft
      : rtlType === "default"
        ? maxOffset - scrollLeft
        : scrollLeft;
  return Math.min(maxOffset, Math.max(0, logical));
}

export function scrollLeftFromLogicalOffset(
  logicalOffset: number,
  maxOffset: number,
  direction: "ltr" | "rtl",
  rtlType: RtlScrollType,
): number {
  const logical = Math.min(maxOffset, Math.max(0, logicalOffset));
  if (direction === "ltr") return logical;
  if (rtlType === "negative") return -logical;
  if (rtlType === "default") return maxOffset - logical;
  return logical;
}

export function pageIndexFromOffset(offset: number, geometry: ColumnGeometry): number {
  return Math.max(0, Math.round(offset / geometry.columnStride));
}

export function spreadPageCount(pageCount: number, pagesPerSpread: 1 | 2): number {
  return Math.max(1, Math.ceil(Math.max(1, pageCount) / pagesPerSpread));
}

export function lastSpreadPageIndex(pageCount: number, pagesPerSpread: 1 | 2): number {
  return (spreadPageCount(pageCount, pagesPerSpread) - 1) * pagesPerSpread;
}

export function pageProgression(pageIndex: number, pageCount: number): number {
  if (pageCount <= 1) return 0;
  return Math.min(1, Math.max(0, pageIndex / (pageCount - 1)));
}

export function detectRtlScrollType(document: Document): RtlScrollType {
  const host = document.body ?? document.documentElement;
  const probe = document.createElementNS(XHTML_NAMESPACE, "div") as HTMLDivElement;
  const child = document.createElementNS(XHTML_NAMESPACE, "div") as HTMLDivElement;
  probe.dir = "rtl";
  probe.style.cssText =
    "position:absolute;left:-10000px;top:-10000px;width:4px;height:1px;overflow:scroll;visibility:hidden";
  child.style.width = "8px";
  child.style.height = "1px";
  probe.append(child);
  host.append(probe);
  let type: RtlScrollType;
  if (probe.scrollLeft > 0) type = "default";
  else {
    probe.scrollLeft = 1;
    type = probe.scrollLeft === 0 ? "negative" : "reverse";
  }
  probe.remove();
  return type;
}

function layoutStyle(document: Document): HTMLStyleElement {
  const existing = document.getElementById(PAGINATION_STYLE_ID);
  if (existing?.localName === "style") return existing as HTMLStyleElement;
  const style = document.createElementNS(XHTML_NAMESPACE, "style") as HTMLStyleElement;
  style.id = PAGINATION_STYLE_ID;
  (document.head ?? document.documentElement).append(style);
  return style;
}

/**
 * Page geometry for multi-column layout.
 *
 * Inline (horizontal) body padding is intentionally 0. Side padding on a
 * multicol body only appears at scrollLeft=0, so page 1 looks offset from
 * later pages / when navigating back. Horizontal chrome belongs on the host
 * container around the iframe. Body only keeps neutral vertical padding.
 *
 * Columns pack the full viewport width so every page turn shares the same
 * origin (no first-page-only inset).
 */
export function pageChromeInsets(
  viewportWidth: number,
  columnGap: number,
  pagesPerSpread: 1 | 2,
): {
  readonly padBlock: number;
  readonly padInlineStart: number;
  readonly padInlineEnd: number;
  readonly geometry: ColumnGeometry;
} {
  const width = contained(viewportWidth, 1);
  const gap = Math.min(snapped(columnGap), Math.max(0, width - pagesPerSpread));
  // Full-width pack: n*columnWidth + (n-1)*gap <= width, no leftover as side pad.
  const geometry = calculateColumnGeometry(width, gap, pagesPerSpread, 0);

  return {
    padBlock: DEFAULT_BLOCK_PADDING,
    padInlineStart: 0,
    padInlineEnd: 0,
    geometry,
  };
}

export function applyPaginatedLayout(
  document: Document,
  viewport: Readonly<{ width: number; height: number }>,
  pagesPerSpread: 1 | 2,
  direction: "ltr" | "rtl",
  columnGap = DEFAULT_COLUMN_GAP,
): ColumnGeometry {
  const chrome = pageChromeInsets(viewport.width, columnGap, pagesPerSpread);
  const height = contained(viewport.height, 1);
  // Do not set background here — theme/preference CSS owns html+body paint.
  // Horizontal padding stays 0 so every column page aligns the same.
  layoutStyle(document).textContent =
    `html{height:${height}px !important;width:${chrome.geometry.viewportWidth}px !important;` +
    `overflow:hidden !important;direction:${direction} !important;}` +
    `body{box-sizing:border-box !important;height:${height}px !important;min-height:0 !important;` +
    `margin:0 !important;` +
    `padding:${chrome.padBlock}px 0 !important;` +
    `column-fill:auto !important;column-gap:${chrome.geometry.columnGap}px !important;` +
    `column-width:${chrome.geometry.columnWidth}px !important;overflow:visible !important;}` +
    `body::after{content:"" !important;display:block !important;` +
    `width:100% !important;height:1px !important;` +
    `margin-block-start:-1px !important;}`;
  return chrome.geometry;
}

export function clearPaginatedLayout(document: Document): void {
  // Scroll mode: neutral vertical padding only (host supplies horizontal chrome).
  layoutStyle(document).textContent =
    `body{box-sizing:border-box !important;margin:0 !important;` +
    `padding:${DEFAULT_BLOCK_PADDING}px 0 !important;}`;
  const scrolling = document.scrollingElement ?? document.documentElement;
  scrolling.scrollLeft = 0;
}

export function measurePaginatedLayout(
  document: Document,
  geometry: ColumnGeometry,
  direction: "ltr" | "rtl",
): PaginatedLayoutState {
  const scrolling = document.scrollingElement ?? document.documentElement;
  const maxOffset = Math.max(0, scrolling.scrollWidth - scrolling.clientWidth);
  return {
    ...geometry,
    direction,
    pageCount: calculatePageCount(scrolling.scrollWidth, geometry),
    maxOffset,
    rtlScrollType: direction === "rtl" ? detectRtlScrollType(document) : "reverse",
    scrolling,
  };
}

export function currentPageIndex(state: PaginatedLayoutState): number {
  return Math.min(state.pageCount - 1, pageIndexFromOffset(currentLogicalOffset(state), state));
}

export function currentLogicalOffset(state: PaginatedLayoutState): number {
  return logicalOffsetFromScrollLeft(
    state.scrolling.scrollLeft,
    state.maxOffset,
    state.direction,
    state.rtlScrollType,
  );
}

export function currentSpreadIndex(state: PaginatedLayoutState): number {
  const count = spreadPageCount(state.pageCount, state.pagesPerSpread);
  if (count <= 1 || state.maxOffset === 0) return 0;
  return Math.min(
    count - 1,
    Math.round((currentLogicalOffset(state) / state.maxOffset) * (count - 1)),
  );
}

export function paginatedProgression(state: PaginatedLayoutState): number {
  const count = spreadPageCount(state.pageCount, state.pagesPerSpread);
  return pageProgression(currentSpreadIndex(state), count);
}

export function scrollToPage(state: PaginatedLayoutState, pageIndex: number): void {
  const page = Math.min(state.pageCount - 1, Math.max(0, Math.round(pageIndex)));
  state.scrolling.scrollLeft = scrollLeftFromLogicalOffset(
    page * state.columnStride,
    state.maxOffset,
    state.direction,
    state.rtlScrollType,
  );
}

export function snapToSpread(state: PaginatedLayoutState): void {
  const page = currentPageIndex(state);
  scrollToPage(state, Math.floor(page / state.pagesPerSpread) * state.pagesPerSpread);
}

export function captureFirstVisibleElement(document: Document): Element | undefined {
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  return (
    Array.from(document.body?.querySelectorAll("*") ?? []).find((element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < width &&
        rect.top < height
      );
    }) ??
    document.body ??
    undefined
  );
}

export function restoreElementAnchor(element: Element | undefined): void {
  element?.scrollIntoView({ block: "start", inline: "start" });
}
