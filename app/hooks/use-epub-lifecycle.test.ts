import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  createCfi,
  normalizePublicationPath,
  openPublication,
  openZipResourceProvider,
  type Navigator,
  type PersistentLocator,
  type Publication,
  type Relocation,
} from "@readmaxxing/epub-successor";
import {
  displayStoredCfiWithFallback,
  resolveTocNavigationTarget,
} from "~/hooks/use-epub-lifecycle";
import { logicalChapterIndex } from "~/lib/epub/successor-toc";
import type { TocEntry } from "~/lib/context/reader-context";
import { fuzzySearchEpubForCfi } from "~/lib/epub/epub-search";
import { extractBookChapters, joinSpineTextSegments } from "~/lib/epub/epub-text-extract";
import {
  createSuccessorBookAdapter,
  pageIndexFromPositions,
  parseSuccessorPositionCache,
  serializeSuccessorPositionCache,
  spineIndexFromCfi,
  extractCompatibleToc,
  SuccessorRenditionAdapter,
} from "~/lib/epub/successor-reader-adapter";
import type { ReaderBookLike } from "~/lib/epub/successor-toc";

interface MockSection {
  href: string;
  index: number;
}

async function fixtureArrayBuffer(): Promise<ArrayBuffer> {
  const bytes = await readFile("e2e/fixtures/test-book.epub");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function createMockBook(hrefs: string[]): ReaderBookLike {
  const sections = hrefs.map((href, index) => ({ href, index }));
  const byHref = new Map(sections.map((section) => [section.href, section]));

  return {
    spine: {
      get(target?: string | number) {
        if (typeof target === "number") {
          return sections[target] ?? null;
        }
        if (typeof target === "string") {
          return byHref.get(target.split("#")[0] ?? target) ?? null;
        }
        return sections[0] ?? null;
      },
      each(callback: (section: MockSection) => void) {
        sections.forEach(callback);
      },
    },
  };
}

const book = createMockBook([
  "OPS/text/chapter 1.xhtml",
  "OPS/text/chapter-2.xhtml",
  "OPS/text/chapter-3.xhtml",
]);

const toc: TocEntry[] = [
  { label: "Chapter 1", href: "OPS/text/chapter%201.xhtml#intro" },
  { label: "Broken fragment", href: "#missing-anchor" },
  { label: "Chapter 2", href: "/OPS/text/chapter-2.xhtml" },
  { label: "Broken file", href: "OPS/text/missing.xhtml" },
  { label: "Chapter 3", href: "../OPS/text/chapter-3.xhtml" },
];

describe("resolveTocNavigationTarget", () => {
  it("normalizes encoded characters in hrefs", () => {
    expect(resolveTocNavigationTarget(book, toc, "OPS/text/chapter%201.xhtml#intro")).toEqual({
      kind: "href",
      href: "OPS/text/chapter 1.xhtml",
    });
  });

  it("normalizes leading slashes", () => {
    expect(resolveTocNavigationTarget(book, toc, "/OPS/text/chapter-2.xhtml")).toEqual({
      kind: "href",
      href: "OPS/text/chapter-2.xhtml",
    });
  });

  it("falls back from fragment-only hrefs to the next resolvable sibling", () => {
    expect(resolveTocNavigationTarget(book, toc, "#missing-anchor")).toEqual({
      kind: "fallback",
      href: "OPS/text/chapter-2.xhtml",
      label: "Chapter 2",
    });
  });

  it("normalizes extra parent-directory segments", () => {
    expect(resolveTocNavigationTarget(book, toc, "../OPS/text/chapter-3.xhtml")).toEqual({
      kind: "href",
      href: "OPS/text/chapter-3.xhtml",
    });
  });

  it("falls back from out-of-spine files to the next resolvable sibling", () => {
    expect(resolveTocNavigationTarget(book, toc, "OPS/text/missing.xhtml")).toEqual({
      kind: "fallback",
      href: "OPS/text/chapter-3.xhtml",
      label: "Chapter 3",
    });
  });

  it("keeps cleanly resolvable hrefs as href targets", () => {
    expect(resolveTocNavigationTarget(book, toc, "OPS/text/chapter-2.xhtml")).toEqual({
      kind: "href",
      href: "OPS/text/chapter-2.xhtml",
    });
  });
});

describe("logicalChapterIndex", () => {
  const partsBook = createMockBook([
    "OPS/cover.xhtml",
    "OPS/part-1.xhtml",
    "OPS/chapter-1.xhtml",
    "OPS/chapter-2.xhtml",
    "OPS/part-2.xhtml",
    "OPS/chapter-3.xhtml",
  ]);
  const partsToc: TocEntry[] = [
    {
      label: "Part I",
      href: "OPS/part-1.xhtml",
      subitems: [
        { label: "Chapter 1", href: "OPS/chapter-1.xhtml" },
        { label: "Chapter 2", href: "OPS/chapter-2.xhtml" },
      ],
    },
    {
      label: "Part II",
      href: "OPS/part-2.xhtml",
      subitems: [{ label: "Chapter 3", href: "OPS/chapter-3.xhtml" }],
    },
  ];

  it("counts only leaf chapters, matching extractBookChapters indexes", () => {
    // "Part" containers must not consume chapter indexes: the chapter uploads
    // use leaf entries, so counting parts here reports chapters ahead.
    expect(logicalChapterIndex(partsToc, partsBook, 2)).toBe(0);
    expect(logicalChapterIndex(partsToc, partsBook, 3)).toBe(1);
    expect(logicalChapterIndex(partsToc, partsBook, 5)).toBe(2);
  });

  it("clamps positions before the first chapter start to chapter 0", () => {
    expect(logicalChapterIndex(partsToc, partsBook, 0)).toBe(0);
    expect(logicalChapterIndex(partsToc, partsBook, 1)).toBe(0);
  });

  it("ignores untitled TOC entries, matching the extraction title filter", () => {
    const toc: TocEntry[] = [
      { label: "  ", href: "OPS/cover.xhtml" },
      { label: "Chapter 1", href: "OPS/chapter-1.xhtml" },
    ];
    expect(logicalChapterIndex(toc, partsBook, 2)).toBe(0);
  });

  it("falls back to the spine index when the TOC resolves nothing", () => {
    expect(logicalChapterIndex([], partsBook, 4)).toBe(4);
  });

  it("agrees with extractBookChapters on the E2E fixture", async () => {
    const data = await fixtureArrayBuffer();
    const chapters = await extractBookChapters(data);
    const provider = await openZipResourceProvider(data);
    try {
      const opened = await openPublication(provider);
      const publication = opened.publication!;
      const fixtureBook = createMockBook(publication.readingOrder.map((item) => item.href));
      const fixtureToc = (await extractCompatibleToc(publication, provider)).map((entry) => ({
        label: entry.title,
        href: entry.href,
      }));
      for (const chapter of chapters) {
        expect(logicalChapterIndex(fixtureToc, fixtureBook, chapter.spineStart)).toBe(
          chapter.index,
        );
      }
    } finally {
      provider.close();
    }
  });
});

describe("successor position compatibility", () => {
  const publication: Publication = {
    metadata: { title: "Test", languages: ["en"], authors: [] },
    readingOrder: ["OPS/front.xhtml", "OPS/chapter.xhtml"].map((href) => ({
      href: normalizePublicationPath(href),
      rel: [],
      properties: [],
    })),
    resources: [],
    toc: [],
    landmarks: [],
    diagnostics: [],
  };
  const relocation: Relocation = {
    href: normalizePublicationPath("OPS/chapter.xhtml"),
    spineIndex: 1,
    localProgression: 0.5,
    totalProgression: 0.75,
  };

  function createMockNavigator() {
    const display = vi.fn(async () => relocation);
    const restoreProgression = vi.fn(async () => relocation);
    const navigator = {
      addEventListener: vi.fn(),
      display,
      restoreProgression,
    } as unknown as Navigator;
    return { navigator, display, restoreProgression };
  }

  it("displays href page locators at the matching sampled EPUB page", async () => {
    const positions: PersistentLocator[] = [
      {
        href: normalizePublicationPath("OPS/front.xhtml"),
        locations: { progression: 0, totalProgression: 0, position: 1 },
        text: {},
        selectors: { textQuote: { exact: "" }, textPosition: { start: 0, end: 0 } },
      },
      {
        href: normalizePublicationPath("OPS/chapter.xhtml"),
        locations: { progression: 0, totalProgression: 0.5, position: 2 },
        text: {},
        selectors: { textQuote: { exact: "" }, textPosition: { start: 0, end: 0 } },
      },
      {
        href: normalizePublicationPath("OPS/chapter.xhtml"),
        locations: { progression: 0.5, totalProgression: 0.75, position: 3 },
        text: {},
        selectors: { textQuote: { exact: "" }, textPosition: { start: 1500, end: 1500 } },
      },
    ];
    const { navigator, display, restoreProgression } = createMockNavigator();
    const rendition = new SuccessorRenditionAdapter(publication, navigator, positions);

    await rendition.display("OPS/chapter.xhtml#page=2");
    await rendition.display("OPS/chapter.xhtml#page=3");

    expect(display.mock.calls).toEqual([
      [{ href: normalizePublicationPath("OPS/chapter.xhtml") }],
      [{ href: normalizePublicationPath("OPS/chapter.xhtml") }],
    ]);
    expect(restoreProgression.mock.calls).toEqual([[0], [0.5]]);
  });

  it("keeps CFI display navigation on the existing CFI path", async () => {
    const { navigator, display, restoreProgression } = createMockNavigator();
    const rendition = new SuccessorRenditionAdapter(publication, navigator);
    const cfi = "epubcfi(/6/4!/4)";

    await rendition.display(cfi, { localProgression: 0.5 });

    expect(display).toHaveBeenCalledWith({ spineIndex: 1 });
    expect(restoreProgression).toHaveBeenCalledWith(0.5);
  });

  it("extracts the spine index from stored standard CFIs", () => {
    expect(spineIndexFromCfi("epubcfi(/6/2[chapter]!/4/2/2:0)")).toBe(0);
    expect(spineIndexFromCfi("epubcfi(/6/8!/4/2)")).toBe(3);
  });

  it("extracts the spine index when only the CFI package path remains valid", () => {
    expect(spineIndexFromCfi("epubcfi(/6/8[chapter]!/4/not-a-step)")).toBe(3);
  });

  it("returns no spine index for total garbage", () => {
    expect(spineIndexFromCfi("not-a-cfi")).toBeNull();
  });

  it("rejects legacy location arrays so they are regenerated", () => {
    expect(parseSuccessorPositionCache(JSON.stringify(["epubcfi(/6/2!/4)"]))).toBeNull();
  });

  it("round-trips successor position caches", () => {
    const positions = [
      {
        href: normalizePublicationPath("OPS/chapter.xhtml"),
        locations: { progression: 0, totalProgression: 0, position: 1 },
        text: {},
        selectors: {
          textQuote: { exact: "" },
          textPosition: { start: 0, end: 0 },
        },
      },
    ];
    expect(
      parseSuccessorPositionCache(serializeSuccessorPositionCache(positions))?.positions,
    ).toEqual(positions);
  });

  it("maps locations to character-sampled page indexes, not spine-equal progression", () => {
    const positions: PersistentLocator[] = [
      {
        href: normalizePublicationPath("OPS/front.xhtml"),
        locations: {
          progression: 0,
          totalProgression: 0,
          position: 1,
          cfi: createCfi("epubcfi(/6/2!/4)"),
        },
        text: {},
        selectors: { textQuote: { exact: "" }, textPosition: { start: 0, end: 0 } },
      },
      {
        href: normalizePublicationPath("OPS/chapter-1.xhtml"),
        locations: {
          progression: 0,
          totalProgression: 0.2,
          position: 2,
          cfi: createCfi("epubcfi(/6/4!/4)"),
        },
        text: {},
        selectors: { textQuote: { exact: "" }, textPosition: { start: 0, end: 0 } },
      },
      {
        href: normalizePublicationPath("OPS/chapter-1.xhtml"),
        locations: {
          progression: 0.5,
          totalProgression: 0.4,
          position: 3,
          cfi: createCfi("epubcfi(/6/4!/4)"),
        },
        text: {},
        selectors: { textQuote: { exact: "" }, textPosition: { start: 1500, end: 1500 } },
      },
      {
        href: normalizePublicationPath("OPS/chapter-2.xhtml"),
        locations: {
          progression: 0,
          totalProgression: 0.6,
          position: 4,
          cfi: createCfi("epubcfi(/6/6!/4)"),
        },
        text: {},
        selectors: { textQuote: { exact: "" }, textPosition: { start: 0, end: 0 } },
      },
    ];

    // First chapter start is page 2 (after short front matter), not ~40% of total.
    expect(
      pageIndexFromPositions(positions, {
        href: "OPS/chapter-1.xhtml",
        cfi: "epubcfi(/6/4!/4/2/1:0)",
        localProgression: 0,
      }),
    ).toBe(2);

    // Mid-section progression advances the page within the section's samples.
    expect(
      pageIndexFromPositions(positions, {
        href: "OPS/chapter-1.xhtml",
        localProgression: 1,
      }),
    ).toBe(3);

    // Page-turns within a section must move the displayed page.
    expect(
      pageIndexFromPositions(positions, {
        href: "OPS/chapter-1.xhtml",
        localProgression: 0.5,
      }),
    ).toBe(3);

    expect(
      pageIndexFromPositions(positions, {
        href: "OPS/chapter-1.xhtml",
        textOffset: 1600,
      }),
    ).toBe(3);
  });

  it("advances page for single-sample sections toward the next sample", () => {
    const positions: PersistentLocator[] = [
      {
        href: normalizePublicationPath("OPS/a.xhtml"),
        locations: { progression: 0, totalProgression: 0, position: 1 },
        text: {},
        selectors: { textQuote: { exact: "" }, textPosition: { start: 0, end: 0 } },
      },
      {
        href: normalizePublicationPath("OPS/b.xhtml"),
        locations: { progression: 0, totalProgression: 0.5, position: 2 },
        text: {},
        selectors: { textQuote: { exact: "" }, textPosition: { start: 0, end: 0 } },
      },
    ];

    expect(pageIndexFromPositions(positions, { href: "OPS/a.xhtml", localProgression: 0 })).toBe(1);
    expect(pageIndexFromPositions(positions, { href: "OPS/a.xhtml", localProgression: 1 })).toBe(2);
    expect(pageIndexFromPositions(positions, { href: "OPS/b.xhtml", localProgression: 0 })).toBe(2);
  });

  it("extracts the E2E fixture table of contents", async () => {
    const provider = await openZipResourceProvider(await fixtureArrayBuffer());
    try {
      const opened = await openPublication(provider);
      const toc = opened.publication
        ? await extractCompatibleToc(opened.publication, provider)
        : [];
      expect(
        toc.map((entry) => entry.title),
        JSON.stringify(opened.diagnostics),
      ).toEqual(["Chapter 1: The Beginning", "Chapter 2: The End"]);
    } finally {
      provider.close();
    }
  });

  it("searches fixture text and returns range CFIs covering every match", async () => {
    const data = await fixtureArrayBuffer();
    const provider = await openZipResourceProvider(data);
    try {
      const opened = await openPublication(provider);
      expect(opened.publication).not.toBeNull();
      const book = createSuccessorBookAdapter(opened.publication!, provider);
      const directResults = await book.spine.get(1)!.find("elephant");
      expect(directResults[0]?.excerpt).toContain("elephant");
      // Range CFIs (base,start,end) — not collapsed points — so search
      // results render as highlight decorations over the matched text.
      expect(directResults[0]?.cfi).toMatch(/^epubcfi\(.*,.*,.*\)$/);

      const repeated = await book.spine.get(1)!.find("the");
      expect(repeated.length).toBeGreaterThan(1);
      for (const result of repeated) {
        expect(result.cfi).toMatch(/^epubcfi\(.*,.*,.*\)$/);
      }

      // Queries whose locale case-folding changes length (İ → i̇) fall back
      // to exact matching instead of producing misaligned offsets.
      const folded = await book.spine.get(1)!.find("İelephant");
      expect(folded).toEqual([]);
      const mixedCase = await book.spine.get(1)!.find("Elephant");
      expect(mixedCase[0]?.excerpt).toContain("elephant");
    } finally {
      provider.close();
    }

    const results = await fuzzySearchEpubForCfi(data, "elephant");
    expect(results[0]?.cfi).toMatch(/^epubcfi\(/);
    expect(spineIndexFromCfi(results[0]!.cfi)).toBe(1);
  });

  it("extracts logical chapters with the successor parser", async () => {
    const data = await fixtureArrayBuffer();
    const chapters = await extractBookChapters(data);
    expect(chapters.map(({ title }) => title)).toEqual([
      "Chapter 1: The Beginning",
      "Chapter 2: The End",
    ]);
    expect(chapters[1]?.text).toContain("elephant appears exactly once");

    const provider = await openZipResourceProvider(data);
    try {
      for (const chapter of chapters) {
        expect(chapter.segments?.length).toBeGreaterThan(0);
        for (const segment of chapter.segments ?? []) {
          const source = await provider.readText(segment.href);
          const document = new DOMParser().parseFromString(source, "application/xhtml+xml");
          const contributedText = document.body?.textContent?.trim() ?? "";
          expect(chapter.text.slice(segment.start, segment.end)).toBe(contributedText);
        }
      }
    } finally {
      provider.close();
    }
  });

  it("records ordered spine ranges while leaving separator gaps", () => {
    const content = joinSpineTextSegments([
      { index: 2, href: "chapter-a.xhtml", text: "Alpha" },
      { index: 3, href: "chapter-b.xhtml", text: "Beta" },
    ]);

    expect(content.text).toBe("Alpha\n\nBeta");
    expect(content.segments).toEqual([
      { spineIndex: 2, href: "chapter-a.xhtml", start: 0, end: 5 },
      { spineIndex: 3, href: "chapter-b.xhtml", start: 7, end: 11 },
    ]);
    expect(content.segments.map(({ start, end }) => content.text.slice(start, end))).toEqual([
      "Alpha",
      "Beta",
    ]);
    expect(content.text.slice(content.segments[0]!.end, content.segments[1]!.start)).toBe("\n\n");
  });
});

describe.each(["stored positions", "bookmarks"])("legacy CFI fallback for %s", () => {
  const fullCfi = "epubcfi(/6/8[chapter]!/4/2/2:0)";
  const partialCfi = "epubcfi(/6/8[chapter]!/4/not-a-step)";

  it("keeps a fully resolvable CFI", async () => {
    const display = vi.fn(async () => undefined);
    const onFallback = vi.fn();

    await displayStoredCfiWithFallback({ display }, fullCfi, onFallback);

    expect(display).toHaveBeenCalledOnce();
    expect(display).toHaveBeenCalledWith(fullCfi, undefined);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("falls back to the CFI-identified spine when only its package path parses", async () => {
    const display = vi.fn(async (target?: string | number) => {
      if (typeof target === "string") throw new RangeError("unresolvable local path");
    });
    const onFallback = vi.fn();

    await displayStoredCfiWithFallback({ display }, partialCfi, onFallback);

    expect(display.mock.calls).toEqual([[partialCfi, undefined], [3]]);
    expect(onFallback).toHaveBeenCalledOnce();
  });

  it("falls back to spine zero only when no spine reference can be extracted", async () => {
    const display = vi.fn(async (target?: string | number) => {
      if (typeof target === "string") throw new TypeError("invalid CFI");
    });
    const onFallback = vi.fn();

    await displayStoredCfiWithFallback({ display }, "not-a-cfi", onFallback);

    expect(display.mock.calls).toEqual([["not-a-cfi", undefined], [0]]);
    expect(onFallback).toHaveBeenCalledOnce();
  });
});
