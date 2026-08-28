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

export interface PageScrollAnimation {
  readonly finished: Promise<void>;
  cancel(snapToTarget?: boolean): void;
}

const PAGINATION_STYLE_ID = "epub-successor-pagination-style";
const PAGINATION_PAD_STYLE_ID = "epub-successor-pagination-pad";
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

function styleElement(document: Document, id: string): HTMLStyleElement {
  const existing = document.getElementById(id);
  if (existing?.localName === "style") return existing as HTMLStyleElement;
  const style = document.createElementNS(XHTML_NAMESPACE, "style") as HTMLStyleElement;
  style.id = id;
  (document.head ?? document.documentElement).append(style);
  return style;
}

function layoutStyle(document: Document): HTMLStyleElement {
  return styleElement(document, PAGINATION_STYLE_ID);
}

function padStyle(document: Document): HTMLStyleElement {
  return styleElement(document, PAGINATION_PAD_STYLE_ID);
}

/**
 * Page geometry for multi-column layout.
 *
 * By default, columns pack the full iframe width and horizontal chrome belongs
 * on the host container. A single-page inline margin instead keeps the iframe
 * full-width, narrows each column, and repeats both resting margins as the
 * inter-column gap. That lets moving text paint through the margin while every
 * settled page shares the same inset.
 */
export function pageChromeInsets(
  viewportWidth: number,
  columnGap: number,
  pagesPerSpread: 1 | 2,
  pageInlineMargin = 0,
): {
  readonly padBlock: number;
  readonly padInlineStart: number;
  readonly padInlineEnd: number;
  readonly geometry: ColumnGeometry;
} {
  const width = contained(viewportWidth, 1);
  const margin =
    pagesPerSpread === 1
      ? Math.min(snapped(pageInlineMargin), Math.floor(Math.max(0, width - 1) / 2))
      : 0;
  const gap =
    margin > 0 ? margin * 2 : Math.min(snapped(columnGap), Math.max(0, width - pagesPerSpread));
  // A single-page margin becomes the gap between adjacent columns, keeping
  // every resting text column inset while the iframe still fills the viewport.
  const geometry = calculateColumnGeometry(width, gap, pagesPerSpread, margin * 2);

  return {
    padBlock: DEFAULT_BLOCK_PADDING,
    padInlineStart: margin,
    padInlineEnd: margin,
    geometry,
  };
}

export function applyPaginatedLayout(
  document: Document,
  viewport: Readonly<{ width: number; height: number }>,
  pagesPerSpread: 1 | 2,
  direction: "ltr" | "rtl",
  columnGap = DEFAULT_COLUMN_GAP,
  pageInlineMargin = 0,
): ColumnGeometry {
  const chrome = pageChromeInsets(viewport.width, columnGap, pagesPerSpread, pageInlineMargin);
  const height = contained(viewport.height, 1);
  const contentHeight = Math.max(1, height - chrome.padBlock * 2);
  const imageInlinePosition = direction === "rtl" ? "right" : "left";
  const bodyPadding =
    chrome.padInlineStart === 0 && chrome.padInlineEnd === 0
      ? `${chrome.padBlock}px 0`
      : `${chrome.padBlock}px ${chrome.padInlineEnd}px ${chrome.padBlock}px ${chrome.padInlineStart}px`;
  // Reset any spread padding from a previous layout before re-measuring.
  padStyle(document).textContent = "";
  // Do not set background here — theme/preference CSS owns html+body paint.
  // A configured single-page margin is part of the repeated column geometry.
  layoutStyle(document).textContent =
    `html{height:${height}px !important;width:${chrome.geometry.viewportWidth}px !important;` +
    `overflow:hidden !important;direction:${direction} !important;}` +
    `body{box-sizing:border-box !important;height:${height}px !important;min-height:0 !important;` +
    `margin:0 !important;` +
    `padding:${bodyPadding} !important;` +
    `column-fill:auto !important;column-gap:${chrome.geometry.columnGap}px !important;` +
    `column-width:${chrome.geometry.columnWidth}px !important;overflow:visible !important;}` +
    `blockquote:has(img){box-sizing:border-box !important;inline-size:auto !important;` +
    `min-inline-size:0 !important;max-inline-size:100% !important;}` +
    `blockquote:has(> img:only-child){text-indent:0 !important;}` +
    `img{box-sizing:border-box !important;` +
    `max-width:min(100%,${chrome.geometry.columnWidth}px) !important;` +
    `max-height:${contentHeight}px !important;object-fit:contain !important;` +
    `object-position:${imageInlinePosition} center !important;}` +
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
  padStyle(document).textContent = "";
  const scrolling = document.scrollingElement ?? document.documentElement;
  scrolling.scrollLeft = 0;
}

export function measurePaginatedLayout(
  document: Document,
  geometry: ColumnGeometry,
  direction: "ltr" | "rtl",
): PaginatedLayoutState {
  const scrolling = document.scrollingElement ?? document.documentElement;
  padStyle(document).textContent = "";
  let pageCount = calculatePageCount(scrolling.scrollWidth, geometry);
  // A single-page inset is encoded as half of the repeated inter-column gap.
  // Chromium's multicol scrollWidth stops at the final content edge, omitting
  // that trailing half-gap. Count from the natural extent first, then widen the
  // body to the last full stride so the terminal column is not clamped early.
  if (
    geometry.pagesPerSpread === 1 &&
    geometry.columnGap > 0 &&
    geometry.columnStride === geometry.viewportWidth
  ) {
    padStyle(document).textContent =
      `body{width:${pageCount * geometry.columnStride}px !important;}`;
  }
  // Two-page spreads: widen the body to a whole number of spreads so the last
  // spread starts on a spread boundary (trailing column stays blank). With an
  // odd column count the final turn's target offset exceeds maxOffset, the
  // browser clamps the scroll, and the last spread re-shows the second-to-last
  // column in its first slot.
  if (geometry.pagesPerSpread === 2 && pageCount % 2 !== 0) {
    pageCount += 1;
    const paddedWidth = pageCount * geometry.columnStride - geometry.columnGap;
    padStyle(document).textContent = `body{width:${paddedWidth}px !important;}`;
  }
  const maxOffset = Math.max(0, scrolling.scrollWidth - scrolling.clientWidth);
  return {
    ...geometry,
    direction,
    pageCount,
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

export function animateScrollToPage(
  state: PaginatedLayoutState,
  pageIndex: number,
  durationMs: number,
  scheduler?: Window,
): PageScrollAnimation {
  const page = Math.min(state.pageCount - 1, Math.max(0, Math.round(pageIndex)));
  const target = scrollLeftFromLogicalOffset(
    page * state.columnStride,
    state.maxOffset,
    state.direction,
    state.rtlScrollType,
  );
  const start = state.scrolling.scrollLeft;
  const duration = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
  // Safari blocks script callbacks scheduled in a sandboxed publication
  // window. Callers embedding the document pass their trusted host window.
  const view = scheduler ?? state.scrolling.ownerDocument.defaultView;
  if (!view || duration === 0 || start === target) {
    state.scrolling.scrollLeft = target;
    return { finished: Promise.resolve(), cancel: () => {} };
  }

  let frame: number | undefined;
  let startTime: number | undefined;
  let settled = false;
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  const finish = () => {
    if (settled) return;
    settled = true;
    frame = undefined;
    resolveFinished();
  };
  const step = (timestamp: number) => {
    startTime ??= timestamp;
    const progress = Math.min(1, Math.max(0, (timestamp - startTime) / duration));
    const eased = 1 - Math.pow(1 - progress, 3);
    state.scrolling.scrollLeft = start + (target - start) * eased;
    if (progress < 1) frame = view.requestAnimationFrame(step);
    else {
      state.scrolling.scrollLeft = target;
      finish();
    }
  };
  frame = view.requestAnimationFrame(step);

  return {
    finished,
    cancel(snapToTarget = false) {
      if (settled) return;
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      if (snapToTarget) state.scrolling.scrollLeft = target;
      finish();
    },
  };
}

export function snapToSpread(state: PaginatedLayoutState): void {
  const page = currentPageIndex(state);
  scrollToPage(state, Math.floor(page / state.pagesPerSpread) * state.pagesPerSpread);
}

/**
 * Column index containing a layout box's left edge.
 * Uses floor (not round): column index is floor(x / stride). Rounding pushes
 * restore one page forward when the caret sits past mid-column.
 */
export function pageIndexForLogicalOffset(logical: number, state: PaginatedLayoutState): number {
  if (state.columnStride <= 0 || state.pageCount <= 0) return 0;
  return Math.max(0, Math.min(state.pageCount - 1, Math.floor(logical / state.columnStride)));
}

/**
 * Document-space X of a client rect along the paginated column axis.
 */
export function logicalOffsetForClientRect(
  state: PaginatedLayoutState,
  rect: DOMRectReadOnly,
): number {
  const scrollRect = state.scrolling.getBoundingClientRect();
  return currentLogicalOffset(state) + (rect.left - scrollRect.left);
}

/**
 * Scroll so the spread containing `range` is shown, using the range's live box
 * (not a parent block). Floor-based column math avoids off-by-one on restore.
 */
export function alignPaginationToRange(state: PaginatedLayoutState, range: Range): void {
  if (state.columnStride <= 0 || state.pageCount <= 0) return;
  const rects = range.getClientRects();
  const rect = rects.length > 0 ? rects[0]! : range.getBoundingClientRect();
  const page = pageIndexForLogicalOffset(logicalOffsetForClientRect(state, rect), state);
  scrollToPage(state, Math.floor(page / state.pagesPerSpread) * state.pagesPerSpread);
}

/**
 * Scroll so the spread containing `element` is shown.
 */
export function alignPaginationToElement(state: PaginatedLayoutState, element: Element): void {
  if (state.columnStride <= 0 || state.pageCount <= 0) return;
  const page = pageIndexForLogicalOffset(
    logicalOffsetForClientRect(state, element.getBoundingClientRect()),
    state,
  );
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
