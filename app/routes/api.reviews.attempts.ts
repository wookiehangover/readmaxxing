import { readReviewRequest, reviewApi } from "~/lib/review/review-api.server";
import { reviewSubmitRequestSchema } from "~/lib/review/review-schemas";
import { submitReview } from "~/lib/review/review-service.server";

export function action({ request }: { request: Request }) {
  return reviewApi(request, "POST", async (userId) =>
    submitReview(userId, await readReviewRequest(request, reviewSubmitRequestSchema)),
  );
}

export const loader = action;
