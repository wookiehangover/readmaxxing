import type { BookChapter } from "~/lib/epub/epub-text-extract";
import { offsetToCfi } from "~/lib/epub/offset-to-cfi";
import { normalizeForMatch, type TextAnchor } from "~/lib/orama-book-search";

type ResolveOffsetToCfi = typeof offsetToCfi;

interface TextRange {
  start: number;
  end: number;
}

interface NormalizedCharacter extends TextRange {
  value: string;
}

function normalizeCharacter(character: string): string {
  return normalizeForMatch(`a${character}b`).slice(1, -1);
}

function normalizedCharacters(text: string): NormalizedCharacter[] | null {
  const characters: NormalizedCharacter[] = [];
  let pendingWhitespaceStart: number | undefined;
  let pendingWhitespaceEnd = 0;

  for (let index = 0; index < text.length; index += 1) {
    const replacement = normalizeCharacter(text[index] ?? "");
    if (!replacement) continue;

    if (/^\s+$/.test(replacement)) {
      if (characters.length > 0) {
        pendingWhitespaceStart ??= index;
        pendingWhitespaceEnd = index + 1;
      }
      continue;
    }

    if (pendingWhitespaceStart !== undefined) {
      characters.push({
        value: " ",
        start: pendingWhitespaceStart,
        end: pendingWhitespaceEnd,
      });
      pendingWhitespaceStart = undefined;
    }
    for (const value of replacement) {
      characters.push({ value, start: index, end: index + 1 });
    }
  }

  return characters.map(({ value }) => value).join("") === normalizeForMatch(text)
    ? characters
    : null;
}

function findNormalizedRanges(text: string, passage: string, startOffset = 0): TextRange[] {
  const needle = normalizeForMatch(passage);
  if (!needle) return [];

  const characters = normalizedCharacters(text.slice(startOffset));
  if (!characters) return [];
  const normalizedText = characters.map(({ value }) => value).join("");
  const ranges: TextRange[] = [];
  let matchIndex = normalizedText.indexOf(needle);
  while (matchIndex >= 0) {
    const first = characters[matchIndex];
    const last = characters[matchIndex + needle.length - 1];
    if (first && last) {
      const range = { start: startOffset + first.start, end: startOffset + last.end };
      if (normalizeForMatch(text.slice(range.start, range.end)) === needle) ranges.push(range);
    }
    matchIndex = normalizedText.indexOf(needle, matchIndex + 1);
  }
  return ranges;
}

function findNormalizedRange(text: string, passage: string, startOffset: number): TextRange | null {
  return findNormalizedRanges(text, passage, startOffset)[0] ?? null;
}

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
  error?: "ambiguous";
  candidates?: Array<{
    chapterIndex: number;
    startOffset: number;
    endOffset: number;
    snippet: string;
  }>;
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
  const requestedText = normalizeForMatch(input.text);
  let chapter = input.chapters.find(
    (candidate) => candidate.index === (input.chapterIndex ?? input.textAnchor.chapterIndex),
  );
  let range: TextRange | null = null;

  if (input.startOffset !== undefined && chapter) {
    const providedEndOffset = input.endOffset;
    const providedRangeMatches =
      providedEndOffset !== undefined &&
      normalizeForMatch(chapter.text.slice(input.startOffset, providedEndOffset)) === requestedText;
    range = providedRangeMatches
      ? { start: input.startOffset, end: providedEndOffset }
      : findNormalizedRange(chapter.text, input.text, input.startOffset);
  } else if (input.startOffset === undefined) {
    const hintedChapters = chapter ? [chapter] : [];
    const findCandidates = (searchChapters: readonly BookChapter[]) =>
      searchChapters.flatMap((candidateChapter) =>
        findNormalizedRanges(candidateChapter.text, input.text).map((candidateRange) => ({
          chapter: candidateChapter,
          range: candidateRange,
        })),
      );
    const hintedCandidates = findCandidates(hintedChapters);
    const candidates =
      input.chapterIndex !== undefined || hintedCandidates.length > 0
        ? hintedCandidates
        : findCandidates(input.chapters.filter((candidate) => candidate !== chapter));

    if (candidates.length > 1) {
      return {
        ...fallback,
        error: "ambiguous",
        candidates: candidates.map(({ chapter: candidateChapter, range: candidateRange }) => ({
          chapterIndex: candidateChapter.index,
          startOffset: candidateRange.start,
          endOffset: candidateRange.end,
          snippet: candidateChapter.text.slice(candidateRange.start, candidateRange.end),
        })),
      };
    }

    chapter = candidates[0]?.chapter;
    range = candidates[0]?.range ?? null;
  }

  if (
    !range ||
    !chapter?.segments ||
    !input.fileBlobUrl ||
    !requestedText ||
    normalizeForMatch(chapter.text.slice(range.start, range.end)) !== requestedText
  ) {
    return fallback;
  }

  try {
    const expectedText = chapter.text.slice(range.start, range.end);
    const cfiRange = await resolveOffsetToCfi({
      epubSource: new URL(input.fileBlobUrl),
      segments: chapter.segments,
      startOffset: range.start,
      endOffset: range.end,
      expectedText,
    });
    if (!cfiRange) return fallback;

    return {
      cfiRange,
      matchQuality: "exact",
      chapterIndex: chapter.index,
      textAnchor: {
        ...input.textAnchor,
        chapterIndex: chapter.index,
        offset: range.start,
        matchQuality: "exact",
      },
    };
  } catch {
    return fallback;
  }
}
