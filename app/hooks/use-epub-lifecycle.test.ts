import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  normalizePublicationPath,
  openPublication,
  openZipResourceProvider,
} from "@readmaxxing/epub-successor";
import {
  displayStoredCfiWithFallback,
  resolveTocNavigationTarget,
} from "~/hooks/use-epub-lifecycle";
import type { TocEntry } from "~/lib/context/reader-context";
import { fuzzySearchEpubForCfi } from "~/lib/epub/epub-search";
import { extractBookChapters } from "~/lib/epub/epub-text-extract";
import {
  createSuccessorBookAdapter,
  parseSuccessorPositionCache,
  serializeSuccessorPositionCache,
  spineIndexFromCfi,
  extractCompatibleToc,
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

describe("successor position compatibility", () => {
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

  it("searches fixture text and returns a standard CFI", async () => {
    const data = await fixtureArrayBuffer();
    const provider = await openZipResourceProvider(data);
    try {
      const opened = await openPublication(provider);
      expect(opened.publication).not.toBeNull();
      const book = createSuccessorBookAdapter(opened.publication!, provider);
      const directResults = await book.spine.get(1)!.find("elephant");
      expect(directResults[0]?.excerpt).toContain("elephant");
    } finally {
      provider.close();
    }

    const results = await fuzzySearchEpubForCfi(data, "elephant");
    expect(results[0]?.cfi).toMatch(/^epubcfi\(/);
    expect(spineIndexFromCfi(results[0]!.cfi)).toBe(1);
  });

  it("extracts logical chapters with the successor parser", async () => {
    const chapters = await extractBookChapters(await fixtureArrayBuffer());
    expect(chapters.map(({ title }) => title)).toEqual([
      "Chapter 1: The Beginning",
      "Chapter 2: The End",
    ]);
    expect(chapters[1]?.text).toContain("elephant appears exactly once");
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
    expect(display).toHaveBeenCalledWith(fullCfi);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("falls back to the CFI-identified spine when only its package path parses", async () => {
    const display = vi.fn(async (target?: string | number) => {
      if (typeof target === "string") throw new RangeError("unresolvable local path");
    });
    const onFallback = vi.fn();

    await displayStoredCfiWithFallback({ display }, partialCfi, onFallback);

    expect(display.mock.calls).toEqual([[partialCfi], [3]]);
    expect(onFallback).toHaveBeenCalledOnce();
  });

  it("falls back to spine zero only when no spine reference can be extracted", async () => {
    const display = vi.fn(async (target?: string | number) => {
      if (typeof target === "string") throw new TypeError("invalid CFI");
    });
    const onFallback = vi.fn();

    await displayStoredCfiWithFallback({ display }, "not-a-cfi", onFallback);

    expect(display.mock.calls).toEqual([["not-a-cfi"], [0]]);
    expect(onFallback).toHaveBeenCalledOnce();
  });
});
