import { reviewApi, reviewProgressBookId } from "~/lib/review/review-api.server";
import { reviewProgress } from "~/lib/review/review-service.server";

export function loader({ request }: { request: Request }) {
  return reviewApi(request, "GET", async (userId) =>
    reviewProgress(userId, reviewProgressBookId(request)),
  );
}

export const action = loader;
