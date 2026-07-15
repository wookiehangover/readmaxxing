import type { HighlightRow } from "~/lib/database/annotation/highlight";

export interface ListedHighlight {
  id: string;
  text: string | null;
  note: string | null;
  chapterIndex: number | null;
  inNotebook: boolean;
}

export function getNotebookHighlightIds(content: unknown): Set<string> {
  const ids = new Set<string>();

  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const record = node as { type?: unknown; attrs?: unknown; content?: unknown };
    if (record.type === "highlightReference" && record.attrs && typeof record.attrs === "object") {
      const highlightId = (record.attrs as { highlightId?: unknown }).highlightId;
      if (typeof highlightId === "string") ids.add(highlightId);
    }
    if (Array.isArray(record.content)) record.content.forEach(visit);
  };

  visit(content);
  return ids;
}

export function listLiveHighlightsForBook(
  highlights: readonly HighlightRow[],
  bookId: string,
  notebookHighlightIds: ReadonlySet<string>,
): ListedHighlight[] {
  return highlights
    .filter((highlight) => highlight.bookId === bookId && highlight.deletedAt === null)
    .map((highlight) => ({
      id: highlight.id,
      text: highlight.text,
      note: highlight.note,
      chapterIndex: highlight.textAnchor?.chapterIndex ?? null,
      inNotebook: notebookHighlightIds.has(highlight.id),
    }));
}
