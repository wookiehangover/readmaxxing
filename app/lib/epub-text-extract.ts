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
export async function extractBookChapters(
  data: ArrayBuffer,
): Promise<BookChapter[]> {
  const book = ePub(data);

  try {
    await book.ready;

    const spine = book.spine as any;
    if (typeof spine.each !== "function") {
      return [];
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

        // Derive title from href filename or fallback to "Chapter N"
        const href: string = item.href ?? "";
        const filename = href.split("/").pop()?.replace(/\.\w+$/, "") ?? "";
        const title = filename || `Chapter ${chapters.length + 1}`;

        chapters.push({ index: chapters.length, title, text });
      } catch (err) {
        console.warn(
          `Failed to load spine item "${item.href ?? "unknown"}":`,
          err,
        );
        continue;
      }
    }

    return chapters;
  } finally {
    book.destroy();
  }
}
