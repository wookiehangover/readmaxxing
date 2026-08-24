import type { TocEntry } from "~/lib/context/reader-context";

export interface ReaderBookLike {
  readonly spine: {
    get(target?: string | number): { href?: string; index?: number } | null;
    each(callback: (section: { href?: string; index?: number }) => void): void;
  };
}

export type TocNavigationTarget =
  | { kind: "href"; href: string }
  | { kind: "spineIndex"; index: number; label?: string }
  | { kind: "fallback"; href: string; label: string }
  | { kind: "unresolved" };

export function flattenToc(entries: TocEntry[]): TocEntry[] {
  return entries.flatMap((entry) => [entry, ...(entry.subitems ? flattenToc(entry.subitems) : [])]);
}

function normalizePathSegments(href: string): string {
  const segments: string[] = [];
  for (const segment of href.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
}

export function normalizeEpubHref(href: string): string {
  const bare = (href.split("#")[0]?.split("?")[0] ?? "").replace(/^\/+/, "");
  try {
    return normalizePathSegments(decodeURIComponent(bare));
  } catch {
    return normalizePathSegments(bare);
  }
}

export function hrefsMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeEpubHref(left);
  const normalizedRight = normalizeEpubHref(right);
  return Boolean(
    normalizedLeft &&
    normalizedRight &&
    (normalizedLeft === normalizedRight ||
      normalizedLeft.endsWith(`/${normalizedRight}`) ||
      normalizedRight.endsWith(`/${normalizedLeft}`)),
  );
}

export function getSpineIndexForHref(book: ReaderBookLike, href: string): number | null {
  const normalized = normalizeEpubHref(href);
  const direct = book.spine.get(href) ?? (normalized ? book.spine.get(normalized) : null);
  if (typeof direct?.index === "number") return direct.index;
  let match: number | null = null;
  let fallbackIndex = 0;
  book.spine.each((section) => {
    if (match === null && section.href && hrefsMatch(section.href, normalized)) {
      match = section.index ?? fallbackIndex;
    }
    fallbackIndex += 1;
  });
  return match;
}

function directTarget(book: ReaderBookLike, rawHref: string, label?: string): TocNavigationTarget {
  const raw = book.spine.get(rawHref);
  if (typeof raw?.index === "number") return { kind: "href", href: rawHref };
  const normalized = normalizeEpubHref(rawHref);
  const normalizedSection = normalized ? book.spine.get(normalized) : null;
  if (typeof normalizedSection?.index === "number") return { kind: "href", href: normalized };
  const index = getSpineIndexForHref(book, rawHref);
  return index === null
    ? { kind: "unresolved" }
    : { kind: "spineIndex", index, ...(label ? { label } : {}) };
}

function resolvedHref(book: ReaderBookLike, target: TocNavigationTarget): string | null {
  if (target.kind === "href") return target.href;
  if (target.kind !== "spineIndex") return null;
  return book.spine.get(target.index)?.href ?? null;
}

export function resolveTocNavigationTarget(
  book: ReaderBookLike,
  toc: TocEntry[],
  rawHref: string,
): TocNavigationTarget {
  const direct = directTarget(book, rawHref);
  if (direct.kind !== "unresolved") return direct;
  const entries = flattenToc(toc).filter((entry) => entry.href.trim());
  const currentIndex = entries.findIndex(
    (entry) => entry.href === rawHref || hrefsMatch(entry.href, rawHref),
  );
  if (currentIndex < 0) return { kind: "unresolved" };

  const findSibling = (start: number, end: number, step: number): TocNavigationTarget => {
    for (let index = start; step > 0 ? index < end : index > end; index += step) {
      const entry = entries[index]!;
      const href = resolvedHref(book, directTarget(book, entry.href, entry.label));
      if (href) return { kind: "fallback", href, label: entry.label };
    }
    return { kind: "unresolved" };
  };
  const next = findSibling(currentIndex + 1, entries.length, 1);
  return next.kind === "unresolved" ? findSibling(currentIndex - 1, -1, -1) : next;
}

export function resolveCurrentChapterLabel(
  toc: TocEntry[],
  book: ReaderBookLike,
  href: string,
  spineIndex: number,
): string | null {
  const entries = flattenToc(toc).filter((entry) => entry.label.trim());
  const exact = [...entries].reverse().find((entry) => hrefsMatch(entry.href, href));
  if (exact) return exact.label;
  return (
    [...entries]
      .reverse()
      .find(
        (entry) =>
          (getSpineIndexForHref(book, entry.href) ?? Number.POSITIVE_INFINITY) <= spineIndex,
      )?.label ?? null
  );
}

/**
 * Flatten a TOC to the leaf entries a reader treats as chapters, mirroring
 * `flattenTocToUsefulEntries` in epub-text-extract.ts: "Part" containers with
 * nested children are skipped in favor of their leaves.
 */
function flattenTocToLeafEntries(entries: TocEntry[]): TocEntry[] {
  return entries.flatMap((entry) => {
    const children = (entry.subitems ?? []).filter((child) => child.label.trim() || child.href);
    if (children.length > 0) {
      return flattenTocToLeafEntries(children);
    }
    return [entry];
  });
}

/**
 * Chapter index for the given spine position, aligned with the indexes
 * produced by `extractBookChapters` (epub-text-extract.ts). Both count only
 * titled leaf TOC entries that resolve to a spine item, deduped by spine
 * start — the chat prompt resolves chapters by this index, so any divergence
 * makes the model report the wrong chapter.
 */
export function logicalChapterIndex(
  toc: TocEntry[],
  book: ReaderBookLike,
  spineIndex: number,
): number {
  const starts = [
    ...new Set(
      flattenTocToLeafEntries(toc)
        .filter((entry) => entry.label.trim())
        .map((entry) => getSpineIndexForHref(book, entry.href))
        .filter((index): index is number => index !== null),
    ),
  ].sort((left, right) => left - right);
  if (starts.length === 0) return spineIndex;
  let chapter = 0;
  for (let index = 0; index < starts.length; index += 1) {
    if (starts[index]! <= spineIndex) chapter = index;
  }
  return chapter;
}
