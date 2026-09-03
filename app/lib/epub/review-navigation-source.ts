import {
  contentRange,
  fragmentElement,
  rangeContainsRange,
  resolveCfi,
  assembleSectionDocument,
  type DisplayTarget,
  type NavigatorContentRange,
  type Publication,
  type ResourceProvider,
} from "@readmaxxing/epub-successor";
import { extractBookChapters } from "./epub-text-extract";
import { fingerprintReviewChapter } from "~/lib/review/chapter-identity";
import type { ReviewChapterBoundary } from "~/lib/review/review-types";

export interface ReviewNavigationUnit {
  boundary: ReviewChapterBoundary;
  chapterIndex: number;
  fingerprint: string;
}

export function unitContentRange(
  unit: ReviewNavigationUnit,
  spineIndex: number,
): NavigatorContentRange {
  const { key, start, end } = unit.boundary;
  return {
    key,
    ...(start.spineIndex === spineIndex && start.fragment ? { start: start.fragment } : {}),
    ...(end?.spineIndex === spineIndex && end.fragment ? { end: end.fragment } : {}),
  };
}

export function unitLastSpine(unit: ReviewNavigationUnit, spineCount: number): number {
  const end = unit.boundary.end;
  return end ? end.spineIndex - (end.textOffset === 0 ? 1 : 0) : spineCount - 1;
}

/** Source fingerprints use full extracted text; navigation compares DOM anchors, never normalized offsets. */
export async function loadReviewNavigationSource(
  data: ArrayBuffer,
  publication: Publication,
  provider: ResourceProvider,
) {
  const chapters = await extractBookChapters(data);
  const units = await Promise.all(
    chapters.flatMap((chapter) =>
      (chapter.reviewBoundaries ?? []).map(async (boundary) => ({
        boundary,
        chapterIndex: chapter.index,
        fingerprint: await fingerprintReviewChapter(
          chapter.text.slice(boundary.startOffset, boundary.endOffset),
        ),
      })),
    ),
  );
  units.sort(
    (a, b) =>
      a.boundary.start.spineIndex - b.boundary.start.spineIndex ||
      a.boundary.start.textOffset - b.boundary.start.textOffset,
  );
  const documents = await Promise.all(
    publication.readingOrder.map(async (link, spineIndex) => {
      const document = new DOMParser().parseFromString(
        await provider.readText(link.href),
        "application/xhtml+xml",
      );
      // Match the mounted tree, including sanitization and an inserted missing
      // head: even a structural repair changes the body's CFI element index.
      assembleSectionDocument(document, { context: { sectionHref: link.href, spineIndex } });
      return document;
    }),
  );
  return new ReviewNavigationSource(publication, units, documents);
}

export class ReviewNavigationSource {
  constructor(
    readonly publication: Publication,
    readonly units: readonly ReviewNavigationUnit[],
    readonly documents: readonly Document[],
  ) {}

  spineIndex(target: DisplayTarget): number {
    return (
      target.spineIndex ??
      this.publication.readingOrder.findIndex((link) => link.href === target.href?.split("#")[0])
    );
  }

  containsReviewContent(spineIndex: number): boolean {
    return this.units.some(
      (unit) =>
        spineIndex >= unit.boundary.start.spineIndex &&
        spineIndex <= unitLastSpine(unit, this.documents.length),
    );
  }

  unitForTarget(target: DisplayTarget): ReviewNavigationUnit | undefined {
    const spineIndex = this.spineIndex(target);
    const document = this.documents[spineIndex];
    if (!document?.body) return;
    const units = this.units.filter(
      (unit) =>
        spineIndex >= unit.boundary.start.spineIndex &&
        spineIndex <= unitLastSpine(unit, this.documents.length),
    );
    const fragment = target.fragment ?? target.href?.split("#")[1];
    // A bare spine target means its first readable interval, not body DOM
    // offset zero: trimmed source offsets can omit whitespace before a heading.
    // Keep the interval's fragment bounds so clipping and later-chapter locks
    // still use the same strict range as explicitly anchored navigation.
    if (!target.cfi && !fragment) return units[0];
    let point: Range | null;
    if (target.cfi) point = resolveCfi(target.cfi, document, { spineIndex });
    else {
      point = document.createRange();
      const element = fragment ? fragmentElement(document, fragment) : document.body;
      if (!element) return;
      if (element === document.body) point.selectNodeContents(element);
      else point.selectNode(element);
      point.collapse(true);
    }
    if (!point) return;
    return units.find((unit) => {
      try {
        return rangeContainsRange(
          contentRange(document, unitContentRange(unit, spineIndex)),
          point,
        );
      } catch {
        return false;
      }
    });
  }

  target(unit: ReviewNavigationUnit, position: "start" | "end" = "start"): DisplayTarget {
    const spineIndex =
      position === "start"
        ? unit.boundary.start.spineIndex
        : unitLastSpine(unit, this.documents.length);
    const bounds = unitContentRange(unit, spineIndex);
    return {
      spineIndex,
      ...(bounds.start ? { fragment: bounds.start } : {}),
      position,
      contentRange: bounds,
    };
  }
}
