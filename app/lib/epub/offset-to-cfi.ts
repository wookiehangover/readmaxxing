import {
  generateCfi,
  openPublication,
  openZipResourceProvider,
  resolveCfi,
  type Publication,
} from "@readmaxxing/epub-successor";

import type { BookChapterSegment } from "~/lib/epub/epub-text-extract";
import { parseEpubServerDocument, withEpubServerDom } from "~/lib/epub/server-dom";
import { sectionMetadata } from "~/lib/epub/successor-reader-adapter";

type EpubSource = Parameters<typeof openZipResourceProvider>[0];

export interface OffsetToCfiInput {
  epubSource: EpubSource;
  segments?: readonly BookChapterSegment[];
  startOffset: number;
  endOffset: number;
  publication?: Publication;
}

interface TextBoundary {
  node: Text;
  offset: number;
}

function segmentsAreValid(segments: readonly BookChapterSegment[]): boolean {
  return segments.every((segment, index) => {
    const previous = segments[index - 1];
    return (
      Number.isInteger(segment.spineIndex) &&
      segment.spineIndex >= 0 &&
      segment.href.length > 0 &&
      Number.isInteger(segment.start) &&
      Number.isInteger(segment.end) &&
      segment.start >= 0 &&
      segment.end > segment.start &&
      (previous === undefined
        ? segment.start === 0
        : segment.start === previous.end + 2 && segment.spineIndex > previous.spineIndex)
    );
  });
}

function textBoundaryAtOffset(root: Node, offset: number): TextBoundary | null {
  const document = root.ownerDocument;
  if (!document || offset < 0) return null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (remaining <= node.length) return { node, offset: remaining };
    remaining -= node.length;
    node = walker.nextNode() as Text | null;
  }
  return null;
}

/** Converts a chapter-level character window into a spine-qualified range CFI. */
export async function offsetToCfi(input: OffsetToCfiInput): Promise<string | null> {
  try {
    return await withEpubServerDom(async () => {
      const { segments, startOffset, endOffset } = input;
      if (
        !segments ||
        segments.length === 0 ||
        !segmentsAreValid(segments) ||
        !Number.isInteger(startOffset) ||
        !Number.isInteger(endOffset) ||
        startOffset < 0 ||
        endOffset <= startOffset
      ) {
        return null;
      }

      const segment = segments.find(
        (candidate) => startOffset >= candidate.start && startOffset < candidate.end,
      );
      if (!segment || endOffset > segment.end) return null;

      const provider = await openZipResourceProvider(input.epubSource);
      try {
        const publication = input.publication ?? (await openPublication(provider)).publication;
        if (!publication) return null;

        const link = publication.readingOrder[segment.spineIndex];
        if (!link || link.href !== segment.href) return null;

        const documents = new Map<number, Document>();
        const getDocument = async (spineIndex: number): Promise<Document> => {
          const cached = documents.get(spineIndex);
          if (cached) return cached;
          const spineLink = publication.readingOrder[spineIndex];
          if (!spineLink) throw new RangeError("EPUB spine item is missing");
          const source = await provider.readText(spineLink.href);
          const document = parseEpubServerDocument(source);
          documents.set(spineIndex, document);
          return document;
        };

        const document = await getDocument(segment.spineIndex);
        if (document.getElementsByTagName("parsererror").length > 0 || !document.body) return null;

        const rawText = document.body.textContent ?? "";
        const normalizedText = rawText.trim();
        const segmentLength = segment.end - segment.start;
        if (normalizedText.length !== segmentLength) return null;

        const localStart = startOffset - segment.start;
        const localEnd = endOffset - segment.start;
        const leadingTrim = rawText.length - rawText.trimStart().length;
        const start = textBoundaryAtOffset(document.body, leadingTrim + localStart);
        const end = textBoundaryAtOffset(document.body, leadingTrim + localEnd);
        if (!start || !end) return null;

        const expectedText = normalizedText.slice(localStart, localEnd);
        const range = document.createRange();
        range.setEnd(end.node, end.offset);
        range.setStart(start.node, start.offset);
        if (range.toString() !== expectedText) return null;

        const section = sectionMetadata(publication, segment.spineIndex);
        const cfi = generateCfi(range, section);
        const resolved = resolveCfi(cfi, document, section);
        if (
          !resolved ||
          resolved.startContainer !== range.startContainer ||
          resolved.startOffset !== range.startOffset ||
          resolved.endContainer !== range.endContainer ||
          resolved.endOffset !== range.endOffset ||
          resolved.toString() !== expectedText
        ) {
          return null;
        }
        return cfi;
      } finally {
        provider.close();
      }
    });
  } catch {
    return null;
  }
}
