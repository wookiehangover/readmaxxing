import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  normalizePublicationPath,
  openPublication,
  openZipResourceProvider,
} from "@readmaxxing/epub-successor";
import { resolveTocNavigationTarget } from "~/hooks/use-epub-lifecycle";
import type EpubBook from "epubjs/types/book";
import type { TocEntry } from "~/lib/context/reader-context";
import {
  parseSuccessorPositionCache,
  serializeSuccessorPositionCache,
  spineIndexFromCfi,
  extractCompatibleToc,
} from "~/lib/epub/successor-reader-adapter";

interface MockSection {
  href: string;
  index: number;
}

function createMockBook(hrefs: string[]): EpubBook {
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
  } as unknown as EpubBook;
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

describe("successor position compatibility", () => {
  it("extracts the spine index from epubjs-format CFIs", () => {
    expect(spineIndexFromCfi("epubcfi(/6/2[chapter]!/4/2/2:0)")).toBe(0);
    expect(spineIndexFromCfi("epubcfi(/6/8!/4/2)")).toBe(3);
  });

  it("rejects old epubjs location arrays so they are regenerated", () => {
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

  it("extracts the E2E fixture table of contents", async () => {
    const bytes = await readFile("e2e/fixtures/test-book.epub");
    const provider = await openZipResourceProvider(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
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
});
