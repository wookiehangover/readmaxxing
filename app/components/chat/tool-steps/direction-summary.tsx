import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "~/components/ui/marker";
import { cn } from "~/lib/utils";
import {
  activeStep,
  collectSteps,
  hasStepError,
  segmentParts,
  stepLabel,
  summarizeSteps,
  type ToolStep,
} from "./tool-step-model";
import {
  type DirectionProps,
  MessageText,
  ReasoningText,
  StepIcon,
  StepMarker,
} from "./tool-step-ui";

/**
 * Direction A — Quiet summary.
 * One sentence above the answer. While working it shows only the live step;
 * when done it reads like a footnote and expands into a step list.
 */
export function SummaryDirection({ parts, isStreaming, ...ctx }: DirectionProps) {
  const { steps, reasoning, text } = collectSteps(segmentParts(parts, ctx));
  const hasActivity = steps.length > 0 || reasoning.length > 0;
  return (
    <div className="flex flex-col gap-3">
      {hasActivity && (
        <StepsSummary steps={steps} reasoning={reasoning} working={isStreaming && !text} />
      )}
      <MessageText text={text} isStreaming={isStreaming} />
    </div>
  );
}

function StepsSummary({
  steps,
  reasoning,
  working,
}: {
  steps: ToolStep[];
  reasoning: string[];
  working: boolean;
}) {
  const [open, setOpen] = useState(false);
  const live = working ? (activeStep(steps) ?? steps.at(-1)) : undefined;
  const failed = hasStepError(steps);
  const failedCount = steps.filter((s) => s.status === "error").length;

  if (live && !open) {
    return (
      <Marker role="status" className="min-h-6 text-xs">
        <MarkerIcon className="flex size-3.5 items-center justify-center">
          <StepIcon step={live} />
        </MarkerIcon>
        <MarkerContent className="shimmer truncate">{stepLabel(live)}</MarkerContent>
      </Marker>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={<Marker render={<button type="button" />} />}
        className={cn(
          "min-h-6 w-fit max-w-full cursor-pointer text-xs transition-colors hover:text-foreground",
          { "text-destructive hover:text-destructive": failed },
        )}
      >
        <MarkerContent className="truncate">
          {working && live ? stepLabel(live) : summarizeSteps(steps)}
          {failed && ` · ${failedCount} failed`}
        </MarkerContent>
        <MarkerIcon className="flex size-3.5 items-center justify-center">
          <ChevronRight
            className={cn("size-3 transition-transform duration-200", { "rotate-90": open })}
          />
        </MarkerIcon>
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0">
        <div className="flex flex-col pt-1">
          {steps.map((step) => (
            <StepMarker key={step.id} step={step} />
          ))}
          {reasoning.length > 0 && (
            <div className="pt-1.5 pl-5.5">
              <ReasoningText reasoning={reasoning} />
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
