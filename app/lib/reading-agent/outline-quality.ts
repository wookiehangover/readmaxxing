export const OUTLINE_QUALITY_THRESHOLD = 0.75;
export const OUTLINE_RETRY_QUALITY_THRESHOLD = 0.7;
export const OUTLINE_MAX_FAILURES = 3;

export interface OutlineBulletRating {
  bullet: string;
  bulletIndex: number;
  relevance: number;
  accuracy: number;
  consistency: number;
  rating: number;
  attempt: number;
  accepted: boolean;
}

export interface OutlinePageContext {
  page: string;
  previousPage?: string | null;
  nextPage?: string | null;
  chapterLabel: string | null;
  existingBullets: readonly string[];
}
