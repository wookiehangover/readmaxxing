import { useState } from "react";
import { Marker, MarkerContent } from "~/components/ui/marker";
import { cn } from "~/lib/utils";
import { segmentParts, type ToolStep } from "./tool-step-model";
import { type DirectionProps, MessageText, ReasoningText, StepMarker } from "./tool-step-ui";

const VISIBLE_TAIL = 2;

/**
 * Direction B — Inline trail.
 * Steps stay where they happened, between paragraphs, so the answer reads as
 * "looked here, then said this". Long runs fold to their last steps.
 */
export function TrailDirection({ parts, isStreaming, ...ctx }: DirectionProps) {
  const segments = segmentParts(parts, ctx);
  return (
    <div className="flex flex-col gap-3">
      {segments.map((segment, index) =>
        segment.type === "text" ? (
          <MessageText
            key={segment.key}
            text={segment.text}
            isStreaming={isStreaming && index === segments.length - 1}
          />
        ) : (
          <StepTrail
            key={segment.key}
            steps={segment.steps}
            reasoning={segment.reasoning}
            live={isStreaming && index === segments.length - 1}
          />
        ),
      )}
    </div>
  );
}

function StepTrail({
  steps,
  reasoning,
  live,
}: {
  steps: ToolStep[];
  reasoning: string[];
  live: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hidden = expanded || live ? 0 : Math.max(0, steps.length - VISIBLE_TAIL - 1);
  const visible = steps.slice(hidden);

  return (
    <div
      className={cn(
        "relative flex flex-col",
        "before:absolute before:top-3 before:bottom-3 before:left-[6.5px] before:w-px before:bg-border",
      )}
    >
      {hidden > 0 && (
        <Marker
          render={<button type="button" onClick={() => setExpanded(true)} />}
          className="min-h-6 cursor-pointer text-xs transition-colors hover:text-foreground"
        >
          <span className="relative z-10 flex size-3.5 shrink-0 items-center justify-center">
            <span className="size-1.5 rounded-full bg-muted-foreground/40 ring-4 ring-background" />
          </span>
          <MarkerContent>
            {hidden} earlier step{hidden > 1 ? "s" : ""}
          </MarkerContent>
        </Marker>
      )}
      {visible.map((step) => (
        <StepMarker
          key={step.id}
          step={step}
          className="[&_[data-slot=marker-icon]]:relative [&_[data-slot=marker-icon]]:z-10 [&_[data-slot=marker-icon]]:bg-background"
        />
      ))}
      {reasoning.length > 0 && (
        <div className="relative z-10 bg-background py-1 pl-5.5">
          <ReasoningText reasoning={reasoning} />
        </div>
      )}
    </div>
  );
}
