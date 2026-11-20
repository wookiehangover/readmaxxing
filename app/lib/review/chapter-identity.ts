import { computeFileHash } from "~/lib/book-hash";

export const REVIEW_TEXT_VERSION = "review-text-v1";

export function normalizeReviewChapterText(text: string): string {
  return text.normalize("NFC").replace(/\s+/gu, " ").trim();
}

export async function fingerprintReviewChapter(text: string): Promise<string> {
  const normalized = normalizeReviewChapterText(text);
  if (!normalized) throw new Error("Cannot fingerprint an empty review chapter");
  const bytes = new TextEncoder().encode(normalized);
  return `${REVIEW_TEXT_VERSION}:${await computeFileHash(bytes.buffer)}`;
}
