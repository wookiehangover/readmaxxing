import ePub from "epubjs";

export interface BookChapter {
  index: number;
  title: string;
  text: string;
  spineStart: number;
  spineEnd: number;
}

interface TocEntryLike {
  label?: string;
  href?: string;
  subitems?: TocEntryLike[];
}

interface SpineTextItem {
  index: number;
  href: string;
  text: string;
}

interface TocChapterStart {
  title: string;
  spineStart: number;
}

function normalizeEpubHref(href: string): string {
  const withoutFragment = href.split("#")[0]?.split("?")[0] ?? "";
  const withoutLeadingSlash = withoutFragment.replace(/^\/+/, "");

  try {
    return decodeURIComponent(withoutLeadingSlash);
  } catch {
    return withoutLeadingSlash;
  }
}

function hrefsMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeEpubHref(left);
  const normalizedRight = normalizeEpubHref(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(`/${normalizedRight}`) ||
    normalizedRight.endsWith(`/${normalizedLeft}`)
  );
}

function filenameFromHref(href: string): string {
  return (
    normalizeEpubHref(href)
      .split("/")
      .pop()
      ?.replace(/\.\w+$/, "") ?? ""
  );
}

function flattenTocToUsefulEntries(entries: TocEntryLike[]): TocEntryLike[] {
  return entries.flatMap((entry) => {
    const subitems = entry.subitems?.filter((subitem) => subitem.label?.trim() || subitem.href);

    // EPUB TOCs often use top-level entries for "Part" containers and nested
    // entries for the actual readable chapters. The chat model needs the same
    // logical chapter units a reader sees, so prefer leaf entries; when leaves
    // point into the same spine file, later range building dedupes them because
    // spine-level extraction cannot safely split by fragment anchors.
    if (subitems && subitems.length > 0) {
      return flattenTocToUsefulEntries(subitems);
    }

    return [entry];
  });
}

function findSpineIndexForHref(spineItems: any[], href: string): number | null {
  const normalizedHref = normalizeEpubHref(href);
  if (!normalizedHref) {
    return null;
  }

  const matchIndex = spineItems.findIndex((item) => hrefsMatch(item.href ?? "", normalizedHref));
  return matchIndex >= 0 ? matchIndex : null;
}

function buildTocChapterStarts(spineItems: any[], toc: TocEntryLike[]): TocChapterStart[] {
  const starts = flattenTocToUsefulEntries(toc)
    .map((entry): TocChapterStart | null => {
      const title = entry.label?.trim();
      const href = entry.href ?? "";
      const spineStart = findSpineIndexForHref(spineItems, href);

      if (!title || spineStart === null) {
        return null;
      }

      return { title, spineStart };
    })
    .filter((start): start is TocChapterStart => start !== null)
    .sort((left, right) => left.spineStart - right.spineStart);

  const deduped: TocChapterStart[] = [];
  for (const start of starts) {
    if (deduped[deduped.length - 1]?.spineStart === start.spineStart) {
      continue;
    }
    deduped.push(start);
  }

  return deduped;
}

function buildFallbackChapters(spineTexts: SpineTextItem[]): BookChapter[] {
  return spineTexts
    .filter((item) => item.text.length > 0)
    .map((item) => ({
      index: item.index,
      title: filenameFromHref(item.href) || `Chapter ${item.index + 1}`,
      text: item.text,
      spineStart: item.index,
      spineEnd: item.index + 1,
    }));
}

/**
 * Extract structured chapter data from an epub ArrayBuffer.
 * Client-side only — epubjs requires DOM.
 *
 * @param data - The epub file as an ArrayBuffer
 * @returns Array of logical chapters with index, title, text, and spine range
 */
export async function extractBookChapters(data: ArrayBuffer): Promise<BookChapter[]> {
  const book = ePub(data);

  try {
    await book.ready;

    const spine = book.spine as any;
    if (typeof spine.each !== "function") {
      return [];
    }

    let toc: TocEntryLike[] = [];
    try {
      const nav = await book.loaded.navigation;
      if (nav?.toc) {
        toc = nav.toc as TocEntryLike[];
      }
    } catch {
      // Navigation may not be available for all epubs
    }

    // Collect spine items
    const spineItems: any[] = [];
    spine.each((item: any) => {
      spineItems.push(item);
    });

    const spineTexts: SpineTextItem[] = [];

    for (let i = 0; i < spineItems.length; i++) {
      const item = spineItems[i];

      try {
        await item.load(book.load.bind(book));
        const text = item.document?.body?.textContent?.trim() ?? "";
        item.unload();

        spineTexts.push({ index: i, href: item.href ?? "", text });
      } catch (err) {
        console.warn(`Failed to load spine item "${item.href ?? "unknown"}":`, err);
        continue;
      }
    }

    const tocStarts = buildTocChapterStarts(spineItems, toc);
    if (tocStarts.length === 0) {
      return buildFallbackChapters(spineTexts);
    }

    const chapters = tocStarts
      .map((start, index): BookChapter | null => {
        const spineEnd = tocStarts[index + 1]?.spineStart ?? spineItems.length;
        const text = spineTexts
          .filter((item) => item.index >= start.spineStart && item.index < spineEnd)
          .map((item) => item.text)
          .filter(Boolean)
          .join("\n\n")
          .trim();

        if (!text) {
          return null;
        }

        return {
          index,
          title: start.title,
          text,
          spineStart: start.spineStart,
          spineEnd,
        };
      })
      .filter((chapter): chapter is BookChapter => chapter !== null)
      .map((chapter, index) => ({ ...chapter, index }));

    return chapters.length > 0 ? chapters : buildFallbackChapters(spineTexts);
  } finally {
    book.destroy();
  }
}
