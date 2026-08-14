import { normalizeForMatch } from "~/lib/orama-book-search";

export const CHAPTER_WINDOW_LENGTH = 15000;
export const DEFAULT_AROUND_RADIUS = 4000;

interface TextRange {
  start: number;
  end: number;
}

interface NormalizedCharacter extends TextRange {
  value: string;
}

export interface ReadChapterWindowOptions {
  query?: string;
  radius?: number;
  startOffset?: number;
}

export interface ChapterWindow {
  text: string;
  startOffset: number;
  endOffset: number;
  totalLength: number;
  matchOffset?: number;
  nextOffset?: number;
}

export type ReadChapterWindowResult = ChapterWindow | { error: "query_not_found" };

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
      characters.push({ value: " ", start: pendingWhitespaceStart, end: pendingWhitespaceEnd });
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

function findNormalizedRange(text: string, query: string): TextRange | null {
  const needle = normalizeForMatch(query);
  const characters = normalizedCharacters(text);
  if (!needle || !characters) return null;

  const matchIndex = characters
    .map(({ value }) => value)
    .join("")
    .indexOf(needle);
  const first = characters[matchIndex];
  const last = characters[matchIndex + needle.length - 1];
  return matchIndex >= 0 && first && last ? { start: first.start, end: last.end } : null;
}

export function readChapterWindow(
  chapterText: string,
  options: ReadChapterWindowOptions = {},
): ReadChapterWindowResult {
  const totalLength = chapterText.length;
  if (options.query === undefined) {
    const startOffset = options.startOffset ?? 0;
    const text = chapterText.slice(startOffset, startOffset + CHAPTER_WINDOW_LENGTH);
    const endOffset = startOffset + text.length;
    return {
      text,
      startOffset,
      endOffset,
      totalLength,
      ...(endOffset < totalLength ? { nextOffset: endOffset } : {}),
    };
  }

  const match = findNormalizedRange(chapterText, options.query);
  if (!match) return { error: "query_not_found" };

  const matchLength = match.end - match.start;
  const radius = Math.max(0, options.radius ?? DEFAULT_AROUND_RADIUS);
  const availableContext = Math.max(0, CHAPTER_WINDOW_LENGTH - matchLength);
  const contextBefore = Math.min(radius, Math.floor(availableContext / 2));
  const contextAfter = Math.min(radius, availableContext - contextBefore);
  const startOffset = Math.max(0, match.start - contextBefore);
  const endOffset = Math.min(
    totalLength,
    matchLength >= CHAPTER_WINDOW_LENGTH
      ? startOffset + CHAPTER_WINDOW_LENGTH
      : match.end + contextAfter,
  );

  return {
    text: chapterText.slice(startOffset, endOffset),
    startOffset,
    endOffset,
    totalLength,
    matchOffset: match.start,
    ...(endOffset < totalLength ? { nextOffset: endOffset } : {}),
  };
}
