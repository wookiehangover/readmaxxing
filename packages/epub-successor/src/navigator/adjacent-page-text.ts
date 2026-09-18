import { currentSpreadIndex, type PaginatedLayoutState } from "./paginated";
import { visibleViewportText } from "./visible-text";

/** Unmounted spine neighbors are unavailable; never substitute a previously visited page. */
export function adjacentPageText(document: Document, pagination?: PaginatedLayoutState) {
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  if (!pagination) {
    return {
      previousPage:
        visibleViewportText(document, { viewportWidth: width, viewportTop: -height }) || null,
      nextPage:
        visibleViewportText(document, { viewportWidth: width, viewportTop: height }) || null,
    };
  }

  const { columnStride, columnWidth, pagesPerSpread, direction, viewportWidth } = pagination;
  const firstPage = currentSpreadIndex(pagination) * pagesPerSpread;
  const inset = Math.max(
    0,
    (viewportWidth -
      columnWidth * pagesPerSpread -
      (columnStride - columnWidth) * (pagesPerSpread - 1)) /
      2,
  );
  const textAt = (relativePage: number) => {
    const page = firstPage + relativePage;
    if (page < 0 || page >= pagination.pageCount) return null;
    const left =
      direction === "ltr"
        ? inset + relativePage * columnStride
        : viewportWidth - inset - columnWidth - relativePage * columnStride;
    return (
      visibleViewportText(document, {
        viewportWidth: columnWidth,
        viewportHeight: height,
        viewportLeft: left,
      }) || null
    );
  };
  return { previousPage: textAt(-1), nextPage: textAt(pagesPerSpread) };
}
