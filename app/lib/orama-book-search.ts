import { create, insertMultiple, search } from "@orama/orama";
import type { AnyOrama } from "@orama/orama";
import type { BookChapter } from "~/lib/epub/epub-text-extract";

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

function computeCacheKey(chapters: BookChapter[]): string {
  const parts = chapters.map(
    (ch) => `${ch.index}:${ch.spineStart}-${ch.spineEnd}:${ch.title}:${ch.text.length}`,
  );
  return `${chapters.length}|${parts.join(";")}`;
}

let cachedKey: string | null = null;
let cachedIndex: AnyOrama | null = null;

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

export function clearBookIndexCache(): void {
  cachedKey = null;
  cachedIndex = null;
}

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

export interface TextAnchor {
  chapterIndex: number;
  snippet: string;
  offset?: number;
  matchQuality: "exact" | "fuzzy";
}

export function normalizeForMatch(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\u2014/g, "--")
    .replace(/\u2013/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u202F]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function locateTextAnchor(
  chapters: BookChapter[],
  db: AnyOrama,
  text: string,
): TextAnchor | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const needle = normalizeForMatch(trimmed);
  if (!needle) return null;

  const hits = searchBook(db, trimmed, 1);
  const snippetSource = trimmed.length > 160 ? trimmed.slice(0, 160) : trimmed;

  const topHit = hits[0];
  const topChapter = topHit
    ? chapters.find((chapter) => chapter.index === topHit.chapterIndex)
    : undefined;
  if (topChapter) {
    const offset = normalizeForMatch(topChapter.text).indexOf(needle);
    if (offset >= 0) {
      return {
        chapterIndex: topChapter.index,
        snippet: snippetSource,
        offset,
        matchQuality: "exact",
      };
    }
  }

  const findExactChapter = (searchNeedle: string): TextAnchor | null => {
    for (const chapter of chapters) {
      const offset = normalizeForMatch(chapter.text).indexOf(searchNeedle);
      if (offset >= 0) {
        return {
          chapterIndex: chapter.index,
          snippet: snippetSource,
          offset,
          matchQuality: "exact",
        };
      }
    }
    return null;
  };

  const exactAnchor = findExactChapter(needle);
  if (exactAnchor) return exactAnchor;

  if (needle.length > 40) {
    const prefixAnchor = findExactChapter(needle.slice(0, 40));
    if (prefixAnchor) return prefixAnchor;
  }

  return topHit
    ? {
        chapterIndex: topHit.chapterIndex,
        snippet: snippetSource,
        matchQuality: "fuzzy",
      }
    : null;
}

export function searchBook(db: AnyOrama, query: string, limit: number = 10): BookSearchResult[] {
  const raw = search(db, {
    term: query,
    properties: ["text"],
    tolerance: 1,
    limit,
  });

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
