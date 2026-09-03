import { useEffect, useRef, type RefObject } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { ArrowLeft } from "lucide-react";
import { TiptapEditor, type TiptapEditorHandle } from "~/components/tiptap-editor";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import type { ReviewNavigationControls } from "~/lib/epub/review-navigation";
import { getFontFallback } from "~/lib/epub/epub-rendering-utils";
import type { ReviewRichTextNode } from "~/lib/review/review-types";
import { useAppStore } from "~/lib/themis/provider";
import { editReviewDraft, submitReviewAnswer } from "~/lib/themis/reviews/reviews-slice";
import { ReviewFeedback } from "./review-feedback";
import { ReviewStatus } from "./review-status";

export function ReviewPage({
  bookId,
  fontFamily,
  navigation,
}: {
  bookId: string;
  fontFamily: string;
  navigation: RefObject<ReviewNavigationControls | null>;
}) {
  useSignals();
  const store = useAppStore();
  const selectors = store.reviewsSelectors;
  const question = selectors.selectReviewQuestion(bookId).value;
  const assignment = selectors.selectReviewAssignment(bookId).value;
  const document = selectors.selectReviewDocument(bookId).value;
  const scope = selectors.selectReviewScope().value;
  const meetsThreshold = selectors.selectReviewAnswerMeetsThreshold(bookId).value;
  const canSubmit = selectors.selectReviewCanSubmit(bookId).value;
  const request = selectors.selectReviewRequest(bookId, "submit").value;
  const passed = selectors.selectReviewPassed(bookId).value;
  const attempt = selectors.selectLatestReviewAttempt(bookId).value;
  const editor = useRef<TiptapEditorHandle>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // Only synchronize external widget content; Redux remains the draft owner.
  useEffect(() => {
    if (editor.current && JSON.stringify(editor.current.getContent()) !== JSON.stringify(document))
      editor.current.setContent(document);
  }, [document]);
  useEffect(() => {
    heading.current?.focus();
  }, [question?.id]);

  return (
    <section
      data-review-editor
      aria-label="Chapter review"
      className="absolute inset-0 flex flex-col overflow-y-auto bg-background px-6 py-6 md:px-16 md:py-10"
    >
      <div className="mx-auto flex w-full max-w-[65ch] flex-1 flex-col gap-6">
        <div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigation.current?.backToChapter().catch(console.error);
            }}
          >
            <ArrowLeft data-icon="inline-start" />
            Back to chapter
          </Button>
        </div>
        {question && (
          <h1
            ref={heading}
            tabIndex={-1}
            data-testid="review-question"
            className="leading-relaxed font-normal outline-none"
            style={{
              fontFamily: `"${fontFamily}", ${getFontFallback(fontFamily)}`,
              fontSize: "20px",
            }}
          >
            {question.question}
          </h1>
        )}
        <ReviewStatus bookId={bookId} />
        {assignment && (
          <div className="font-sans" data-testid="review-answer">
            <TiptapEditor
              key={`${scope}:${assignment.id}`}
              ref={editor}
              compact
              content={document}
              ariaLabel="Your answer"
              placeholder="Write your answer…"
              onUpdate={(content) =>
                store.dispatch(
                  editReviewDraft(bookId, assignment.id, content as ReviewRichTextNode, Date.now()),
                )
              }
            />
          </div>
        )}
        {attempt && (
          <>
            <Separator />
            <ReviewFeedback attempt={attempt} />
          </>
        )}
        <div className="mt-auto flex shrink-0 justify-end pt-4 pb-2">
          {passed ? (
            <Button
              onClick={() => {
                void navigation.current?.continueReading().catch(console.error);
              }}
            >
              Continue reading
            </Button>
          ) : (
            meetsThreshold && (
              <Button
                disabled={!canSubmit}
                onClick={() => store.dispatch(submitReviewAnswer(bookId))}
              >
                {request?.token ? "Grading…" : "Submit answer"}
              </Button>
            )
          )}
        </div>
      </div>
    </section>
  );
}
