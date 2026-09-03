import { readReviewRequest, reviewApi } from "~/lib/review/review-api.server";
import { reviewQuestionRequestSchema } from "~/lib/review/review-schemas";
import { reviewQuestion } from "~/lib/review/review-service.server";

export function action({ request }: { request: Request }) {
  return reviewApi(request, "POST", async (userId) =>
    reviewQuestion(userId, await readReviewRequest(request, reviewQuestionRequestSchema)),
  );
}

export const loader = action;
