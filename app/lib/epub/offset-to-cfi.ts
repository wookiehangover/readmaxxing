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
  expectedText: string;
  publication?: Publication;
}

interface TextBoundary {
  node: Text;
  offset: number;
}

interface TextStreamEntry {
  node: Text;
  start: number;
  end: number;
}

interface TextStream {
  text: string;
  entries: TextStreamEntry[];
}

interface NormalizedTextAlignment {
  text: string;
  rawStarts: number[];
  rawEnds: number[];
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

function createTextStream(root: Node): TextStream {
  const document = root.ownerDocument;
  if (!document) return { text: "", entries: [] };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const entries: TextStreamEntry[] = [];
  let text = "";
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (node.length > 0) {
      const start = text.length;
      text += node.data;
      entries.push({ node, start, end: text.length });
    }
    node = walker.nextNode() as Text | null;
  }
  return { text, entries };
}

function textBoundaryAtOffset(
  stream: TextStream,
  offset: number,
  affinity: "forward" | "backward",
): TextBoundary | null {
  if (offset < 0 || offset > stream.text.length) return null;

  for (const [index, entry] of stream.entries.entries()) {
    if (offset < entry.end) return { node: entry.node, offset: offset - entry.start };
    if (offset === entry.end) {
      const next = stream.entries[index + 1];
      if (affinity === "forward" && next) return { node: next.node, offset: 0 };
      return { node: entry.node, offset: entry.node.length };
    }
  }
  return null;
}

function normalizeWhitespaceWithAlignment(value: string): NormalizedTextAlignment {
  let text = "";
  const rawStarts: number[] = [];
  const rawEnds: number[] = [];

  for (let index = 0; index < value.length;) {
    if (/\s/.test(value[index]!)) {
      let end = index + 1;
      while (end < value.length && /\s/.test(value[end]!)) end++;
      text += " ";
      rawStarts.push(index);
      rawEnds.push(end);
      index = end;
    } else {
      text += value[index];
      rawStarts.push(index);
      rawEnds.push(index + 1);
      index++;
    }
  }

  return { text, rawStarts, rawEnds };
}

function locateUniqueWhitespaceMatch(
  segmentText: string,
  expectedText: string,
): { start: number; end: number; text: string } | null {
  const segment = normalizeWhitespaceWithAlignment(segmentText);
  const expected = normalizeWhitespaceWithAlignment(expectedText.trim()).text;
  if (!expected) return null;

  const matchStart = segment.text.indexOf(expected);
  if (matchStart < 0 || segment.text.indexOf(expected, matchStart + 1) >= 0) return null;

  const matchEnd = matchStart + expected.length;
  const start = segment.rawStarts[matchStart];
  const end = segment.rawEnds[matchEnd - 1];
  if (start === undefined || end === undefined) return null;

  const text = segmentText.slice(start, end);
  if (normalizeWhitespaceWithAlignment(text).text !== expected) return null;
  return { start, end, text };
}

/** Converts a chapter-level character window into a spine-qualified range CFI. */
export async function offsetToCfi(input: OffsetToCfiInput): Promise<string | null> {
  try {
    return await withEpubServerDom(async () => {
      const { segments, startOffset, endOffset, expectedText } = input;
      if (
        !segments ||
        segments.length === 0 ||
        !segmentsAreValid(segments) ||
        !Number.isInteger(startOffset) ||
        !Number.isInteger(endOffset) ||
        startOffset < 0 ||
        endOffset <= startOffset ||
        typeof expectedText !== "string" ||
        expectedText.trim().length === 0 ||
        expectedText.length !== endOffset - startOffset
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

        const textStream = createTextStream(document.body);
        const rawText = textStream.text;
        const leadingTrim = rawText.length - rawText.trimStart().length;
        const match = locateUniqueWhitespaceMatch(rawText.trim(), expectedText);
        if (!match) return null;

        const start = textBoundaryAtOffset(textStream, leadingTrim + match.start, "forward");
        const end = textBoundaryAtOffset(textStream, leadingTrim + match.end, "backward");
        if (!start || !end) return null;

        const range = document.createRange();
        range.setEnd(end.node, end.offset);
        range.setStart(start.node, start.offset);
        if (range.toString() !== match.text) return null;

        const section = sectionMetadata(publication, segment.spineIndex);
        const cfi = generateCfi(range, section);
        const resolved = resolveCfi(cfi, document, section);
        if (
          !resolved ||
          resolved.startContainer !== range.startContainer ||
          resolved.startOffset !== range.startOffset ||
          resolved.endContainer !== range.endContainer ||
          resolved.endOffset !== range.endOffset ||
          resolved.toString() !== match.text
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
