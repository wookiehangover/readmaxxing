import type { BookChapter } from "./epub-text-extract";
import { hrefsMatch } from "./successor-toc";
import type { ReviewChapterBoundary, ReviewChapterPoint } from "~/lib/review/review-types";

/** Offsets use the same trimmed body.textContent convention as legacy extraction. */
export function collectReviewAnchorOffsets(document: Document): Record<string, number> {
  const body = document.body;
  if (!body) return {};
  const raw = body.textContent ?? "";
  const trimStart = raw.length - raw.trimStart().length;
  const length = raw.trim().length;
  const anchors: Record<string, number> = Object.create(null);
  let offset = 0;
  function visit(node: Node) {
    if (node.nodeType === 3) {
      offset += node.textContent?.length ?? 0;
      return;
    }
    if (node.nodeType === 1) {
      const element = node as Element;
      for (const id of [element.getAttribute("id"), element.getAttribute("name")]) {
        if (id && !(id in anchors)) {
          anchors[id] = Math.max(0, Math.min(length, offset - trimStart));
        }
      }
    }
    for (const child of Array.from(node.childNodes)) visit(child);
  }
  visit(body);
  return anchors;
}

interface TocStart {
  title: string;
  href: string;
}
interface ReviewSpineText {
  index: number;
  href: string;
  text: string;
  anchors: Record<string, number>;
}

function fragmentFromHref(href: string): string | null {
  const fragment = href.split("#")[1];
  if (!fragment) return null;
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/**
 * Review checkpoints subdivide legacy chapters without changing their text/index/segments.
 * A missing anchor or missing spine source makes this chapter ineligible (empty list),
 * rather than silently generating a question about an incomplete chapter.
 */
export function buildReviewChapterBoundaries(
  chapter: BookChapter,
  tocLeaves: readonly TocStart[],
  spineItems: readonly { href: string }[],
  spineTexts: readonly ReviewSpineText[],
): ReviewChapterBoundary[] {
  for (let index = chapter.spineStart; index < chapter.spineEnd; index += 1) {
    if (!spineTexts.some((item) => item.index === index)) return [];
  }
  const first = spineTexts.find((item) => item.index === chapter.spineStart);
  if (!first || !chapter.segments?.length) return [];
  const starts: { title: string; point: ReviewChapterPoint; offset: number }[] = [];
  for (const entry of tocLeaves) {
    if (!entry.title.trim() || !hrefsMatch(entry.href, first.href)) continue;
    const fragment = fragmentFromHref(entry.href);
    const offset = fragment === null ? 0 : first.anchors[fragment];
    if (offset === undefined) return [];
    starts.push({
      title: entry.title.trim(),
      offset,
      point: { spineIndex: first.index, href: first.href, fragment, textOffset: offset },
    });
  }
  if (!starts.length) {
    starts.push({
      title: chapter.title,
      offset: 0,
      point: { spineIndex: first.index, href: first.href, fragment: null, textOffset: 0 },
    });
  }
  starts.sort((a, b) => a.offset - b.offset);
  const unique = starts.filter(
    (start, index) => !index || start.offset !== starts[index - 1]!.offset,
  );
  // Retain text before the first heading, as legacy extraction does.
  if (unique[0]!.offset > 0) {
    unique[0] = {
      ...unique[0]!,
      offset: 0,
      point: { ...unique[0]!.point, fragment: null, textOffset: 0 },
    };
  }
  const nextSpine = spineItems[chapter.spineEnd];
  const end: ReviewChapterPoint | null = nextSpine
    ? { spineIndex: chapter.spineEnd, href: nextSpine.href, fragment: null, textOffset: 0 }
    : null;
  return unique
    .map((start, index) => ({
      key: `review-v1:${start.point.spineIndex}:${start.point.textOffset}`,
      title: start.title,
      start: start.point,
      end: unique[index + 1]?.point ?? end,
      startOffset: start.offset,
      endOffset: unique[index + 1]?.offset ?? chapter.text.length,
    }))
    .filter((boundary) => chapter.text.slice(boundary.startOffset, boundary.endOffset).trim());
}

/** Requires a source-body offset for fragment chapters; a spine index alone is ambiguous. */
export function reviewBoundaryContains(
  boundary: ReviewChapterBoundary,
  point: Pick<ReviewChapterPoint, "spineIndex" | "textOffset">,
): boolean {
  const afterStart =
    point.spineIndex > boundary.start.spineIndex ||
    (point.spineIndex === boundary.start.spineIndex &&
      point.textOffset >= boundary.start.textOffset);
  const beforeEnd =
    !boundary.end ||
    point.spineIndex < boundary.end.spineIndex ||
    (point.spineIndex === boundary.end.spineIndex && point.textOffset < boundary.end.textOffset);
  return afterStart && beforeEnd;
}
