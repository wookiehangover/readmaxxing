import type { BookChapter } from "~/lib/epub/epub-text-extract";
import { offsetToCfi } from "~/lib/epub/offset-to-cfi";
import { normalizeForMatch, type TextAnchor } from "~/lib/orama-book-search";

type ResolveOffsetToCfi = typeof offsetToCfi;

interface ResolveCreateHighlightAnchorInput {
  chapters: readonly BookChapter[];
  text: string;
  textAnchor: TextAnchor;
  fileBlobUrl: string | null;
  chapterIndex?: number;
  startOffset?: number;
  endOffset?: number;
}

export interface ResolvedCreateHighlightAnchor {
  cfiRange: string | null;
  matchQuality: "exact" | "fuzzy";
  chapterIndex: number;
  textAnchor: TextAnchor;
}

export async function resolveCreateHighlightAnchor(
  input: ResolveCreateHighlightAnchorInput,
  resolveOffsetToCfi: ResolveOffsetToCfi = offsetToCfi,
): Promise<ResolvedCreateHighlightAnchor> {
  const fallback = {
    cfiRange: null,
    matchQuality: "fuzzy" as const,
    chapterIndex: input.textAnchor.chapterIndex,
    textAnchor: input.textAnchor,
  };
  const chapter = input.chapters.find(
    (candidate) => candidate.index === (input.chapterIndex ?? input.textAnchor.chapterIndex),
  );
  if (
    input.startOffset === undefined ||
    input.endOffset === undefined ||
    !chapter?.segments ||
    !input.fileBlobUrl ||
    normalizeForMatch(chapter.text.slice(input.startOffset, input.endOffset)) !==
      normalizeForMatch(input.text)
  ) {
    return fallback;
  }

  try {
    const cfiRange = await resolveOffsetToCfi({
      epubSource: new URL(input.fileBlobUrl),
      segments: chapter.segments,
      startOffset: input.startOffset,
      endOffset: input.endOffset,
    });
    if (!cfiRange) return fallback;

    return {
      cfiRange,
      matchQuality: "exact",
      chapterIndex: chapter.index,
      textAnchor: {
        ...input.textAnchor,
        chapterIndex: chapter.index,
        offset: input.startOffset,
        matchQuality: "exact",
      },
    };
  } catch {
    return fallback;
  }
}
