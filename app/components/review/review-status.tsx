import { useSignals } from "@preact/signals-react/runtime";
import { Link } from "react-router";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { useAppStore } from "~/lib/themis/provider";
import {
  refreshReviewProgress,
  retryReviewPersistence,
  retryReviewQuestion,
} from "~/lib/themis/reviews/reviews-slice";

export function ReviewStatus({ bookId }: { bookId: string }) {
  useSignals();
  const store = useAppStore();
  const selectors = store.reviewsSelectors;
  const requirement = selectors.selectReviewRequirement(bookId).value;
  const persistence = selectors.selectReviewPersistenceError(bookId).value;
  const question = selectors.selectReviewQuestion(bookId).value;
  const checkpoint = selectors.selectReviewCheckpoint(bookId).value;
  const current = selectors.selectReviewAssignmentCurrent(bookId).value;
  const progress = selectors.selectReviewRequest(bookId, "progress").value;
  const generation = selectors.selectReviewRequest(bookId, "question").value;
  const submit = selectors.selectReviewRequest(bookId, "submit").value;
  const enabled = selectors.selectReviewPreferences(bookId).value.enabled;
  let message: string | null = null;
  let retry: "progress" | "question" | null = null;
  if (enabled) {
    if (progress?.token && question && !current)
      message = "Confirming this review against the current chapter…";
    else if (progress?.error) {
      message = progress.error.error;
      retry = "progress";
    } else if (generation?.token) message = "Preparing your chapter question…";
    else if (generation?.error) {
      message = generation.error.error;
      retry = "question";
    } else if (question && !current) {
      message =
        "This question no longer matches the current chapter. Your previous answer is kept.";
      retry = "question";
    } else if (submit?.error) message = submit.error.error;
    else if (checkpoint && !question) {
      message = "Your chapter question is not available yet.";
      retry = "question";
    }
  }
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {requirement === "sign_in" && (
        <p className="text-xs text-muted-foreground">
          Sign in to generate and grade reviews.{" "}
          <Link className="underline" to="/settings">
            Account settings
          </Link>
        </p>
      )}
      {requirement === "loading" && (
        <p role="status" className="text-xs text-muted-foreground">
          Loading your review settings…
        </p>
      )}
      {requirement === "online" && (
        <p role="status" className="text-xs text-muted-foreground">
          You’re offline. Keep writing; reconnect to generate or submit a review.
        </p>
      )}
      {(persistence || requirement === "storage") && (
        <Alert>
          <AlertDescription>
            {persistence ?? "Your saved review could not be loaded."} Your changes may not be saved.
          </AlertDescription>
          <Button
            size="sm"
            variant="outline"
            onClick={() => store.dispatch(retryReviewPersistence(bookId))}
          >
            Retry saving or loading
          </Button>
        </Alert>
      )}
      {message && (
        <Alert role={retry || submit?.error ? "alert" : "status"}>
          <AlertDescription>{message}</AlertDescription>
          {retry && (
            <Button
              size="sm"
              variant="outline"
              disabled={requirement !== null}
              onClick={() =>
                store.dispatch(
                  retry === "progress"
                    ? refreshReviewProgress(bookId)
                    : retryReviewQuestion(bookId),
                )
              }
            >
              {retry === "progress" ? "Retry confirmation" : "Retry question"}
            </Button>
          )}
        </Alert>
      )}
    </div>
  );
}
