// @vitest-environment node

import { readFile } from "node:fs/promises";
import { openPublication, openZipResourceProvider, resolveCfi } from "@readmaxxing/epub-successor";
import { describe, expect, it } from "vitest";

import { resolveCreateHighlightAnchor } from "~/lib/chat/create-highlight-anchor";
import { searchEpubForCfiWithQuality } from "~/lib/epub/epub-search";
import { extractBookChapters, type BookChapterSegment } from "~/lib/epub/epub-text-extract";
import { offsetToCfi } from "~/lib/epub/offset-to-cfi";
import { ensureEpubServerDom, parseEpubServerDocument } from "~/lib/epub/server-dom";
import { sectionMetadata } from "~/lib/epub/successor-reader-adapter";

const FIXTURE_URL = new URL("../../../../e2e/fixtures/test-book.epub", import.meta.url);
const PASSAGE = "quick brown fox jumps over the lazy dog";
const MULTI_PARAGRAPH_PASSAGE =
  "The quick brown fox jumps over the lazy dog. This sentence contains every letter of the alphabet.\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";

async function fixtureData(): Promise<ArrayBuffer> {
  return Uint8Array.from(await readFile(FIXTURE_URL)).buffer;
}

async function resolveFixtureCfi(
  data: ArrayBuffer,
  cfi: string,
  segment: BookChapterSegment,
): Promise<string | null> {
  const provider = await openZipResourceProvider(data);
  try {
    const { publication } = await openPublication(provider);
    if (!publication) throw new Error("Fixture publication did not open");
    const source = await provider.readText(publication.readingOrder[segment.spineIndex]!.href);
    const document = parseEpubServerDocument(source);
    return (
      resolveCfi(cfi, document, sectionMetadata(publication, segment.spineIndex))?.toString() ??
      null
    );
  } finally {
    provider.close();
  }
}

describe("fixture highlight anchoring", () => {
  it("resolves exact fixture offsets to a CFI that round-trips to the passage", async () => {
    const data = await fixtureData();
    ensureEpubServerDom();
    const chapter = (await extractBookChapters(data))[0]!;
    const startOffset = chapter.text.indexOf(PASSAGE);
    const segment = chapter.segments!.find(
      (candidate) => candidate.start <= startOffset && startOffset < candidate.end,
    )!;
    const textAnchor = {
      chapterIndex: chapter.index,
      snippet: PASSAGE,
      matchQuality: "fuzzy" as const,
    };
    const resolveFromFixture: typeof offsetToCfi = (input) =>
      offsetToCfi({ ...input, epubSource: data });

    const result = await resolveCreateHighlightAnchor(
      {
        chapters: [chapter],
        text: PASSAGE,
        textAnchor,
        fileBlobUrl: FIXTURE_URL.href,
        chapterIndex: chapter.index,
        startOffset,
        endOffset: startOffset + PASSAGE.length,
      },
      resolveFromFixture,
    );

    expect(startOffset).toBeGreaterThanOrEqual(0);
    expect(result.matchQuality).toBe("exact");
    expect(result.cfiRange).not.toBeNull();
    await expect(resolveFixtureCfi(data, result.cfiRange!, segment)).resolves.toBe(PASSAGE);

    const mismatch = await resolveCreateHighlightAnchor(
      {
        chapters: [chapter],
        text: PASSAGE,
        textAnchor,
        fileBlobUrl: FIXTURE_URL.href,
        chapterIndex: chapter.index,
        startOffset: startOffset + 1,
        endOffset: startOffset + PASSAGE.length,
      },
      resolveFromFixture,
    );
    expect(mismatch.matchQuality).not.toBe("exact");
    expect(mismatch.cfiRange).toBeNull();
  });

  it("round-trips a Gatsby-class multi-paragraph passage exactly", async () => {
    const data = await fixtureData();
    ensureEpubServerDom();
    const chapter = (await extractBookChapters(data))[0]!;
    const startOffset = chapter.text.indexOf(MULTI_PARAGRAPH_PASSAGE);
    const segment = chapter.segments!.find(
      (candidate) => candidate.start <= startOffset && startOffset < candidate.end,
    )!;
    const resolveFromFixture: typeof offsetToCfi = (input) =>
      offsetToCfi({ ...input, epubSource: data });

    const result = await resolveCreateHighlightAnchor(
      {
        chapters: [chapter],
        text: MULTI_PARAGRAPH_PASSAGE,
        textAnchor: {
          chapterIndex: chapter.index,
          snippet: MULTI_PARAGRAPH_PASSAGE,
          matchQuality: "fuzzy",
        },
        fileBlobUrl: FIXTURE_URL.href,
        chapterIndex: chapter.index,
        startOffset,
        endOffset: startOffset + MULTI_PARAGRAPH_PASSAGE.length,
      },
      resolveFromFixture,
    );

    expect(startOffset).toBeGreaterThanOrEqual(0);
    expect(result.matchQuality).toBe("exact");
    expect(result.cfiRange).not.toBeNull();
    await expect(resolveFixtureCfi(data, result.cfiRange!, segment)).resolves.toBe(
      MULTI_PARAGRAPH_PASSAGE,
    );
  });

  it("observes an exact client search match for the same fixture passage", async () => {
    const result = await searchEpubForCfiWithQuality(await fixtureData(), PASSAGE);

    expect(result.matchQuality).toBe("exact");
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]!.cfi).toMatch(/^epubcfi\(/);
  });
});
