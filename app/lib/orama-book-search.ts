import { create, insertMultiple, search } from "@orama/orama";
import type { AnyOrama } from "@orama/orama";
import type { BookChapter } from "~/lib/epub-text-extract";

/**
 * Schema for paragraph-sized chunks of book content, indexed by Orama.
 */
const bookChunkSchema = {
  chapterIndex: "number",
  chapterTitle: "string",
  text: "string",
} as const;

interface BookChunkDocument {
  chapterIndex: number;
  chapterTitle: string;
  text: string;
}

export interface BookSearchResult {
  chapterIndex: number;
  chapterTitle: string;
  excerpt: string;
}

const TARGET_CHUNK_SIZE = 500;

/**
 * Split chapter text into roughly paragraph-sized chunks (~500 chars).
 * Splits on paragraph boundaries (double newline) when possible,
 * falling back to sentence boundaries.
 */
function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (current.length + trimmed.length + 1 > TARGET_CHUNK_SIZE && current.length > 0) {
      chunks.push(current.trim());
      current = trimmed;
    } else {
      current += (current ? "\n\n" : "") + trimmed;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  // If no paragraph breaks produced useful chunks, fall back to
  // splitting at sentence boundaries within the full text.
  if (chunks.length <= 1 && text.length > TARGET_CHUNK_SIZE) {
    chunks.length = 0;
    const sentences = text.split(/(?<=[.!?])\s+/);
    current = "";
    for (const sentence of sentences) {
      if (current.length + sentence.length + 1 > TARGET_CHUNK_SIZE && current.length > 0) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current += (current ? " " : "") + sentence;
      }
    }
    if (current.trim()) {
      chunks.push(current.trim());
    }
  }

  return chunks.length > 0 ? chunks : [text.trim()].filter(Boolean);
}

/**
 * Compute a fingerprint for a set of chapters to use as a cache key.
 * Uses chapter count, titles, and total text length as a fast proxy.
 */
function computeCacheKey(chapters: BookChapter[]): string {
  const parts = chapters.map((ch) => `${ch.index}:${ch.title}:${ch.text.length}`);
  return `${chapters.length}|${parts.join(";")}`;
}

/** LRU-1 cache: stores only the most recent index to bound memory. */
let cachedKey: string | null = null;
let cachedIndex: AnyOrama | null = null;

/**
 * Return a cached Orama index if the chapters haven't changed,
 * otherwise build and cache a new one.
 */
export function getOrBuildBookIndex(chapters: BookChapter[]): AnyOrama {
  const key = computeCacheKey(chapters);
  if (cachedKey === key && cachedIndex !== null) {
    return cachedIndex;
  }
  const db = buildBookIndex(chapters);
  cachedKey = key;
  cachedIndex = db;
  return db;
}

/**
 * Clear the cached index. Exposed for testing.
 * @internal
 */
export function clearBookIndexCache(): void {
  cachedKey = null;
  cachedIndex = null;
}

/**
 * Build an Orama full-text search index from extracted book chapters.
 * Each chapter is split into paragraph-sized chunks (~500 chars) so
 * search results are granular rather than whole chapters.
 */
export function buildBookIndex(chapters: BookChapter[]): AnyOrama {
  const db = create({ schema: bookChunkSchema });

  const docs: BookChunkDocument[] = [];
  for (const chapter of chapters) {
    const chunks = chunkText(chapter.text);
    for (const chunk of chunks) {
      docs.push({
        chapterIndex: chapter.index,
        chapterTitle: chapter.title,
        text: chunk,
      });
    }
  }

  if (docs.length > 0) {
    insertMultiple(db, docs);
  }

  return db;
}

const CONTEXT_CHARS = 250;

/**
 * Search the book index and return results matching the shape used by
 * the chat `searchChapters` function: `{ chapterIndex, chapterTitle, excerpt }[]`.
 *
 * Uses Orama's `tolerance` option for typo-tolerant fuzzy matching.
 */
export function searchBook(db: AnyOrama, query: string, limit: number = 10): BookSearchResult[] {
  const raw = search(db, {
    term: query,
    properties: ["text"],
    tolerance: 1,
    limit,
  });

  // search() can return a promise or a value in Orama v3 —
  // our synchronous schema means it returns synchronously.
  const results = raw as Awaited<typeof raw>;

  return results.hits.map((hit) => {
    const doc = hit.document as unknown as BookChunkDocument;
    const lowerText = doc.text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const matchIndex = lowerText.indexOf(lowerQuery);

    let excerpt: string;
    if (matchIndex >= 0) {
      const start = Math.max(0, matchIndex - CONTEXT_CHARS);
      const end = Math.min(doc.text.length, matchIndex + query.length + CONTEXT_CHARS);
      excerpt =
        (start > 0 ? "…" : "") + doc.text.slice(start, end) + (end < doc.text.length ? "…" : "");
    } else {
      // Fuzzy match — no exact substring found; return the chunk trimmed to context size.
      excerpt =
        doc.text.length > CONTEXT_CHARS * 2 ? doc.text.slice(0, CONTEXT_CHARS * 2) + "…" : doc.text;
    }

    return {
      chapterIndex: doc.chapterIndex,
      chapterTitle: doc.chapterTitle,
      excerpt,
    };
  });
}
