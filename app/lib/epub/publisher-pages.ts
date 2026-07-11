import type { Link, TocEntry } from "@readmaxxing/epub-successor";

export interface PublisherPageEntry {
  readonly label: string;
  /** Parsed integer page when the label/value is numeric; otherwise null. */
  readonly pageNumber: number | null;
  readonly href: string;
  readonly fragment: string | null;
  readonly spineIndex: number;
}

export interface PublisherPageMap {
  readonly entries: readonly PublisherPageEntry[];
  /** Last numeric page, or entry count when labels are non-numeric. */
  readonly totalPages: number;
}

function bareHref(value: string): string {
  return value.split("#")[0]?.replace(/^\/+/, "") ?? "";
}

function fragmentOf(value: string): string | null {
  const index = value.indexOf("#");
  if (index < 0) return null;
  const fragment = value.slice(index + 1).trim();
  return fragment.length > 0 ? fragment : null;
}

function hrefsMatch(left: string, right: string): boolean {
  const normalizedLeft = bareHref(left);
  const normalizedRight = bareHref(right);
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(`/${normalizedRight}`) ||
    normalizedRight.endsWith(`/${normalizedLeft}`)
  );
}

function flattenPageList(entries: readonly TocEntry[]): TocEntry[] {
  const flat: TocEntry[] = [];
  for (const entry of entries) {
    flat.push(entry);
    if (entry.children.length > 0) flat.push(...flattenPageList(entry.children));
  }
  return flat;
}

function parsePageLabel(label: string): number | null {
  const trimmed = label.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  // Common forms: "Page 12", "p. 12", "pp. 12"
  const match = trimmed.match(/(?:pages?|pp?\.?)\s*(\d+)\s*$/i) ?? trimmed.match(/(\d+)\s*$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function spineIndexForHref(readingOrder: readonly Link[], href: string): number {
  return readingOrder.findIndex((link) => hrefsMatch(link.href, href));
}

/**
 * Builds a publisher page map from an EPUB nav/NCX page-list.
 * Returns null when the list is empty or no entry maps into the spine.
 */
export function buildPublisherPageMap(
  pageList: readonly TocEntry[],
  readingOrder: readonly Link[],
): PublisherPageMap | null {
  if (pageList.length === 0 || readingOrder.length === 0) return null;

  const entries: PublisherPageEntry[] = [];
  for (const item of flattenPageList(pageList)) {
    const spineIndex = spineIndexForHref(readingOrder, item.href);
    if (spineIndex < 0) continue;
    entries.push({
      label: item.title.trim() || String(entries.length + 1),
      pageNumber: parsePageLabel(item.title),
      href: bareHref(item.href),
      fragment: fragmentOf(item.href),
      spineIndex,
    });
  }
  if (entries.length === 0) return null;

  const numericPages = entries
    .map((entry) => entry.pageNumber)
    .filter((value): value is number => value !== null);
  const totalPages = numericPages.length > 0 ? Math.max(...numericPages) : entries.length;

  return { entries, totalPages };
}

function entryDisplayPage(entry: PublisherPageEntry, index: number): number {
  return entry.pageNumber ?? index + 1;
}

function resolveFragmentTarget(document: Document, fragment: string): Element | null {
  try {
    const byId = document.getElementById(fragment);
    if (byId) return byId;
  } catch {
    // Invalid ID selector characters — try name attribute below.
  }
  try {
    return document.querySelector(
      `[id="${CSS.escape(fragment)}"], [name="${CSS.escape(fragment)}"]`,
    );
  } catch {
    return null;
  }
}

/**
 * Whether a page-list target is at or before the current viewport (i.e. has been reached).
 * Markers entirely after the visible area are not yet reached.
 */
export function isPageTargetReached(
  document: Document,
  fragment: string | null,
  localProgression: number,
): boolean {
  if (!fragment) {
    // No fragment → page starts at the beginning of the spine item.
    return true;
  }

  const target = resolveFragmentTarget(document, fragment);
  if (!target) {
    // Unresolved marker: only count it at section start so we don't skip ahead.
    return localProgression <= 0;
  }

  const rect = target.getBoundingClientRect();
  const view = document.documentElement;
  // Reached if the marker is not entirely to the right of / below the viewport.
  // Already-scrolled-past markers have negative top/left and still count as reached.
  return rect.left < view.clientWidth - 1 && rect.top < view.clientHeight - 1;
}

/**
 * Resolves the publisher page for the current relocation.
 * Prefers DOM pagebreak targets when the section document is available; otherwise
 * uses spine order + local progression among page-list entries on the active spine.
 */
export function resolvePublisherPage(
  map: PublisherPageMap,
  options: {
    readonly href: string;
    readonly spineIndex: number;
    readonly localProgression: number;
    readonly document?: Document | null;
  },
): { readonly currentPage: number; readonly totalPages: number } | null {
  if (map.entries.length === 0) return null;

  const { spineIndex, localProgression, document } = options;
  let bestIndex = -1;

  // Prefer live pagebreak geometry only when the document has a real viewport.
  // happy-dom / unloaded iframes report 0×0 and would never mark targets as reached.
  const hasLayout =
    !!document &&
    (document.documentElement.clientWidth > 0 || document.documentElement.clientHeight > 0);

  if (document && hasLayout) {
    for (let index = 0; index < map.entries.length; index += 1) {
      const entry = map.entries[index]!;
      if (entry.spineIndex < spineIndex) {
        bestIndex = index;
        continue;
      }
      if (entry.spineIndex > spineIndex) break;
      if (isPageTargetReached(document, entry.fragment, localProgression)) {
        bestIndex = index;
      }
    }
  } else {
    // No live layout: last entry on an earlier spine, then interpolate on this spine.
    const onSpine: number[] = [];
    for (let index = 0; index < map.entries.length; index += 1) {
      const entry = map.entries[index]!;
      if (entry.spineIndex < spineIndex) bestIndex = index;
      else if (entry.spineIndex === spineIndex) onSpine.push(index);
      else break;
    }

    if (onSpine.length > 0) {
      const local = Math.max(0, Math.min(1, localProgression));
      if (local >= 1) {
        bestIndex = onSpine[onSpine.length - 1]!;
      } else if (onSpine.length === 1) {
        bestIndex = onSpine[0]!;
      } else {
        bestIndex = onSpine[Math.min(onSpine.length - 1, Math.floor(local * onSpine.length))]!;
      }
    }
  }

  if (bestIndex < 0) {
    // Before the first page-list marker — show the first publisher page.
    return {
      currentPage: entryDisplayPage(map.entries[0]!, 0),
      totalPages: map.totalPages,
    };
  }

  return {
    currentPage: entryDisplayPage(map.entries[bestIndex]!, bestIndex),
    totalPages: map.totalPages,
  };
}
