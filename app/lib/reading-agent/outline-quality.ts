export const OUTLINE_QUALITY_THRESHOLD = 0.8;
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
