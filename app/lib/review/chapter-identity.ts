import { computeFileHash } from "~/lib/book-hash";

export const REVIEW_TEXT_VERSION = "review-text-v1";

/** Collapse packaging whitespace; preserve case, punctuation, accents and word order. */
export function normalizeReviewChapterText(text: string): string {
  return text.normalize("NFC").replace(/\s+/gu, " ").trim();
}

/** Hash the entire normalized chapter, without user/book/title/locator metadata. */
export async function fingerprintReviewChapter(text: string): Promise<string> {
  const normalized = normalizeReviewChapterText(text);
  if (!normalized) throw new Error("Cannot fingerprint an empty review chapter");
  const bytes = new TextEncoder().encode(normalized);
  return `${REVIEW_TEXT_VERSION}:${await computeFileHash(bytes.buffer)}`;
}
