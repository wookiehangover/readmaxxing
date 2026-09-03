import { useId } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { useReadingRail } from "~/components/reading-shell/reading-rail-context";
import { Button } from "~/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { useAppStore } from "~/lib/themis/provider";
import {
  setReviewDifficulty,
  setReviewGrading,
  setReviewsEnabled,
  showReview,
} from "~/lib/themis/reviews/reviews-slice";
import { REVIEW_DIFFICULTIES, REVIEW_GRADING_LEVELS } from "~/lib/review/review-types";
import { reviewDifficultyLabels, reviewGradingLabels } from "./review-options";
import { ReviewStatus } from "./review-status";

export function ReviewPanel({ bookId }: { bookId: string }) {
  useSignals();
  const store = useAppStore();
  const { mobile, setActiveTab } = useReadingRail();
  const id = useId();
  const preferences = store.reviewsSelectors.selectReviewPreferences(bookId).value;
  const question = store.reviewsSelectors.selectReviewQuestion(bookId).value;
  const requirement = store.reviewsSelectors.selectReviewRequirement(bookId).value;
  const checkpoint = store.reviewsSelectors.selectReviewCheckpoint(bookId).value;
  const locked = store.reviewsSelectors.selectReviewLocked(bookId).value;
  const enableUnavailable =
    !preferences.enabled &&
    (requirement === "sign_in" || requirement === "loading" || requirement === "storage");
  return (
    <section
      aria-label="Chapter review settings"
      className="flex h-full flex-col gap-5 overflow-y-auto p-6 md:pt-0 md:pl-0"
    >
      <FieldGroup>
        <Field orientation="horizontal" data-disabled={enableUnavailable || undefined}>
          <FieldLabel htmlFor={`${id}-enabled`}>Chapter reviews</FieldLabel>
          <Switch
            id={`${id}-enabled`}
            checked={preferences.enabled}
            disabled={enableUnavailable}
            onCheckedChange={(enabled) => store.dispatch(setReviewsEnabled(bookId, enabled))}
          />
        </Field>
        {!preferences.enabled ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Pause at the end of each chapter for a question. Write an answer to continue, or turn
            reviews off at any time.
          </p>
        ) : (
          <>
            <Field>
              <FieldLabel htmlFor={`${id}-difficulty`}>Difficulty</FieldLabel>
              <Select
                value={preferences.difficulty}
                items={reviewDifficultyLabels}
                onValueChange={(value) => {
                  if (value) store.dispatch(setReviewDifficulty(bookId, value));
                }}
              >
                <SelectTrigger id={`${id}-difficulty`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {REVIEW_DIFFICULTIES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {reviewDifficultyLabels[value]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Applies to the next question.</p>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-grading`}>Grading</FieldLabel>
              <Select
                value={preferences.grading}
                items={reviewGradingLabels}
                onValueChange={(value) => {
                  if (value) store.dispatch(setReviewGrading(bookId, value));
                }}
              >
                <SelectTrigger id={`${id}-grading`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {REVIEW_GRADING_LEVELS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {reviewGradingLabels[value]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Applies to your next submission.</p>
            </Field>
          </>
        )}
      </FieldGroup>
      <ReviewStatus bookId={bookId} />
      {preferences.enabled && (question || checkpoint) && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {locked ? "Current question" : "Chapter reviewed"}
            {question ? ` · ${reviewDifficultyLabels[question.difficulty]}` : ""}
          </p>
          <Button
            variant="ghost"
            className="h-auto justify-start whitespace-normal text-left"
            onClick={() => {
              store.dispatch(showReview(bookId));
              if (mobile) setActiveTab("Read");
            }}
          >
            {question?.question ?? "Open chapter review"}
          </Button>
        </div>
      )}
      {preferences.enabled && !checkpoint && (
        <p className="text-xs text-muted-foreground">
          Your first question will appear at the end of the chapter.
        </p>
      )}
    </section>
  );
}
