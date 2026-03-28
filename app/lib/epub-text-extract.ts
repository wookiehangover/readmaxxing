import ePub from "epubjs";

export interface BookChapter {
  index: number;
  title: string;
  text: string;
}

/**
 * Extract structured chapter data from an epub ArrayBuffer.
 * Client-side only — epubjs requires DOM.
 *
 * @param data - The epub file as an ArrayBuffer
 * @returns Array of chapters with index, title, and text
 */
export async function extractBookChapters(data: ArrayBuffer): Promise<BookChapter[]> {
  const book = ePub(data);

  try {
    await book.ready;

    const spine = book.spine as any;
    if (typeof spine.each !== "function") {
      return [];
    }

    // Build a TOC lookup map for better chapter titles
    const tocMap = new Map<string, string>();
    try {
      const nav = await book.loaded.navigation;
      if (nav?.toc) {
        for (const entry of nav.toc) {
          const href = entry.href?.split("#")[0] ?? "";
          if (entry.label) tocMap.set(href, entry.label.trim());
          if (entry.subitems) {
            for (const sub of entry.subitems) {
              const subHref = sub.href?.split("#")[0] ?? "";
              if (sub.label) tocMap.set(subHref, sub.label.trim());
            }
          }
        }
      }
    } catch {
      // Navigation may not be available for all epubs
    }

    // Collect spine items
    const spineItems: any[] = [];
    spine.each((item: any) => {
      spineItems.push(item);
    });

    const chapters: BookChapter[] = [];

    for (let i = 0; i < spineItems.length; i++) {
      const item = spineItems[i];

      try {
        await item.load(book.load.bind(book));
        const text = item.document?.body?.textContent?.trim() ?? "";
        item.unload();

        if (!text) continue;

        // Resolve title from TOC navigation, href filename, or fallback
        const href: string = item.href ?? "";
        const filename =
          href
            .split("/")
            .pop()
            ?.replace(/\.\w+$/, "") ?? "";
        const title =
          tocMap.get(item.href) || tocMap.get(filename) || filename || `Chapter ${i + 1}`;

        chapters.push({ index: i, title, text });
      } catch (err) {
        console.warn(`Failed to load spine item "${item.href ?? "unknown"}":`, err);
        continue;
      }
    }

    return chapters;
  } finally {
    book.destroy();
  }
}
