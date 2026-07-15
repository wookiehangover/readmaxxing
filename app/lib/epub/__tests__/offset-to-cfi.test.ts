// @vitest-environment node

import { readFile } from "node:fs/promises";
import { openPublication, openZipResourceProvider, resolveCfi } from "@readmaxxing/epub-successor";
import { describe, expect, it } from "vitest";

import {
  extractBookChapters,
  joinSpineTextSegments,
  type BookChapterSegment,
} from "~/lib/epub/epub-text-extract";
import { offsetToCfi } from "~/lib/epub/offset-to-cfi";
import { ensureEpubServerDom, parseEpubServerDocument } from "~/lib/epub/server-dom";
import { sectionMetadata, spineIndexFromCfi } from "~/lib/epub/successor-reader-adapter";

const FIXTURE_URL = new URL("../../../../e2e/fixtures/test-book.epub", import.meta.url);
const FIRST_PHRASE = "quick brown fox jumps over the lazy dog";
const SECOND_PHRASE = "elephant appears exactly once";

async function fixtureData(): Promise<ArrayBuffer> {
  return Uint8Array.from(await readFile(FIXTURE_URL)).buffer;
}

async function combinedFixtureChapter(data: ArrayBuffer) {
  ensureEpubServerDom();
  const provider = await openZipResourceProvider(data);
  try {
    const { publication } = await openPublication(provider);
    if (!publication) throw new Error("Fixture publication did not open");
    const spineTexts = await Promise.all(
      publication.readingOrder.map(async (link, index) => {
        const source = await provider.readText(link.href);
        const document = parseEpubServerDocument(source);
        return { index, href: link.href, text: document.body?.textContent?.trim() ?? "" };
      }),
    );
    return joinSpineTextSegments(spineTexts);
  } finally {
    provider.close();
  }
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
    const range = resolveCfi(cfi, document, sectionMetadata(publication, segment.spineIndex));
    return range?.toString() ?? null;
  } finally {
    provider.close();
  }
}

describe("offsetToCfi", () => {
  it("round-trips an exact range in one fixture spine", async () => {
    const data = await fixtureData();
    ensureEpubServerDom();
    const chapter = (await extractBookChapters(data))[0]!;
    const startOffset = chapter.text.indexOf(FIRST_PHRASE);

    const cfi = await offsetToCfi({
      epubSource: data,
      segments: chapter.segments,
      startOffset,
      endOffset: startOffset + FIRST_PHRASE.length,
    });

    expect(cfi).not.toBeNull();
    const resolved = await resolveFixtureCfi(data, cfi!, chapter.segments![0]!);
    expect(resolved).toBe(FIRST_PHRASE);
  });

  it("round-trips an offset in the second segment of a multi-spine chapter", async () => {
    const data = await fixtureData();
    const chapter = await combinedFixtureChapter(data);
    const startOffset = chapter.text.indexOf(SECOND_PHRASE);
    const segment = chapter.segments[1]!;

    const cfi = await offsetToCfi({
      epubSource: data,
      segments: chapter.segments,
      startOffset,
      endOffset: startOffset + SECOND_PHRASE.length,
    });

    expect(cfi).not.toBeNull();
    expect(spineIndexFromCfi(cfi!)).toBe(1);
    const resolved = await resolveFixtureCfi(data, cfi!, segment);
    expect(resolved).toBe(SECOND_PHRASE);
  });

  it("returns null for gaps, cross-spine ranges, mismatches, and invalid EPUBs", async () => {
    const data = await fixtureData();
    const chapter = await combinedFixtureChapter(data);
    const [first, second] = chapter.segments;

    await expect(
      offsetToCfi({
        epubSource: data,
        segments: chapter.segments,
        startOffset: first!.end,
        endOffset: second!.start,
      }),
    ).resolves.toBeNull();
    await expect(
      offsetToCfi({
        epubSource: data,
        segments: chapter.segments,
        startOffset: first!.end - 1,
        endOffset: second!.start + 1,
      }),
    ).resolves.toBeNull();
    await expect(
      offsetToCfi({
        epubSource: data,
        segments: [{ ...first!, end: first!.end - 1 }],
        startOffset: 0,
        endOffset: 1,
      }),
    ).resolves.toBeNull();
    await expect(
      offsetToCfi({
        epubSource: data,
        segments: [],
        startOffset: 0,
        endOffset: 1,
      }),
    ).resolves.toBeNull();
    await expect(
      offsetToCfi({
        epubSource: new ArrayBuffer(0),
        segments: [first!],
        startOffset: 0,
        endOffset: 1,
      }),
    ).resolves.toBeNull();
  });
});
