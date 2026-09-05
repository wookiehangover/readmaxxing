import type { ReactNode } from "react";
import type { ReviewAttemptDTO } from "~/lib/review/review-types";
import { reviewGradingLabels } from "./review-options";

export function ReviewFeedback({ attempt }: { attempt: ReviewAttemptDTO }) {
  // Offsets always refer to the server's immutable, untrimmed submitted text.
  const annotations = attempt.annotations.filter(
    (item) =>
      item.start >= 0 &&
      item.end > item.start &&
      item.end <= attempt.plainText.length &&
      attempt.plainText.slice(item.start, item.end) === item.quote,
  );
  const points = [
    ...new Set([
      0,
      attempt.plainText.length,
      ...annotations.flatMap(({ start, end }) => [start, end]),
    ]),
  ].sort((a, b) => a - b);
  const snapshot: ReactNode[] = points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    const matching = annotations.filter((item) => item.start <= start && item.end >= end);
    const text = attempt.plainText.slice(start, end);
    return matching.length ? (
      <mark
        key={start}
        className="rounded-sm bg-accent text-accent-foreground underline decoration-dotted underline-offset-4"
        title={matching.map((item) => item.feedback).join("\n")}
      >
        {text}
      </mark>
    ) : (
      text
    );
  });
  return (
    <section aria-label="Review feedback" className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="font-medium">
          {{ pass: "Passed", fail: "Not yet", needs_work: "Needs work" }[attempt.verdict]}
        </h2>
        <p className="text-xs text-muted-foreground">
          {reviewGradingLabels[attempt.grading]} · Submitted answer
        </p>
      </div>
      <p className="whitespace-pre-wrap">{attempt.feedback}</p>
      {annotations.length > 0 && (
        <>
          <blockquote
            aria-label="Submitted answer with annotations"
            className="border-l-2 border-border pl-4 whitespace-pre-wrap break-words text-muted-foreground"
          >
            {snapshot}
          </blockquote>
          <ol className="flex list-decimal flex-col gap-2 pl-5">
            {annotations.map((annotation, index) => (
              <li key={index}>
                <q>{annotation.quote}</q> — {annotation.feedback}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
