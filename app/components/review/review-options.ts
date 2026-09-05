import type { ReviewDifficulty, ReviewGradingLevel } from "~/lib/review/review-types";

export const reviewDifficultyLabels: Record<ReviewDifficulty, string> = {
  friendly: "Friendly",
  challenging: "Challenging",
  adversarial: "Adversarial",
  tyler_cowen: "Tyler Cowen",
};
export const reviewGradingLabels: Record<ReviewGradingLevel, string> = {
  reading_group: "Reading Group",
  community_college: "Community College",
  elite_professor: "Elite Professor",
  tyler_cowen: "Tyler Cowen",
};
