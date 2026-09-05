import { sql } from "pg-sql";
import { z } from "zod";
import { getPool } from "../pool";
import {
  fingerprintReviewChapter,
  normalizeReviewChapterText,
} from "~/lib/review/chapter-identity";
import { reviewBoundarySchema } from "~/lib/review/review-schemas";
import type { ReviewChapterDTO } from "~/lib/review/review-types";

export interface OwnedReviewChapter extends ReviewChapterDTO {
  /** Complete normalized slice, never a preview or truncated chat window. */
  text: string;
}

export function toReviewChapterDTO(source: OwnedReviewChapter): ReviewChapterDTO {
  return {
    bookId: source.bookId,
    chapterKey: source.chapterKey,
    sourceFingerprint: source.sourceFingerprint,
    chapterIndex: source.chapterIndex,
    boundary: source.boundary,
  };
}
const chapterSchema = z.object({
  index: z.number().int().nonnegative(),
  text: z.string(),
  reviewBoundaries: z.array(reviewBoundarySchema),
});

/** null covers unavailable, deleted, non-EPUB, unowned and legacy/unresolved sources. */
export async function getOwnedReviewChapter(
  userId: string,
  bookId: string,
  chapterKey: string,
): Promise<OwnedReviewChapter | null> {
  const result = await getPool().query<{ chapters: unknown }>(sql`
    SELECT c.chapters FROM readmax.book_chapters c
    JOIN readmax.book b ON b.id = c.book_id AND b.user_id = c.user_id
    WHERE c.user_id = ${userId} AND c.book_id = ${bookId}
      AND b.deleted_at IS NULL AND COALESCE(b.format, 'epub') = 'epub'
  `);
  const chapters = result.rows[0]?.chapters;
  if (!Array.isArray(chapters)) return null;
  const matches: OwnedReviewChapter[] = [];
  for (const raw of chapters) {
    const parsed = chapterSchema.safeParse(raw);
    if (!parsed.success) continue;
    const chapter = parsed.data;
    for (const boundary of chapter.reviewBoundaries) {
      if (boundary.key !== chapterKey || boundary.endOffset > chapter.text.length) continue;
      const text = normalizeReviewChapterText(
        chapter.text.slice(boundary.startOffset, boundary.endOffset),
      );
      if (!text) continue;
      matches.push({
        bookId,
        chapterKey,
        chapterIndex: chapter.index,
        boundary,
        text,
        sourceFingerprint: await fingerprintReviewChapter(text),
      });
    }
  }
  return matches.length === 1 ? matches[0]! : null;
}
