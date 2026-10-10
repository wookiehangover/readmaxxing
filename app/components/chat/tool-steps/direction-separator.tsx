import { ChevronDown } from "lucide-react";
import { Marker, MarkerContent } from "~/components/ui/marker";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
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
  KIND_ICONS,
  MessageText,
  ReasoningText,
  StepIcon,
  StepMarker,
} from "./tool-step-ui";

/**
 * Direction C — Separator chip.
 * Activity becomes a thin divider (shadcn Marker "separator") with kind icons
 * and a step count. Details open in a popover, so the answer flow stays clean.
 */
export function SeparatorDirection({ parts, isStreaming, ...ctx }: DirectionProps) {
  const { steps, reasoning, text } = collectSteps(segmentParts(parts, ctx));
  const working = isStreaming && !text;
  return (
    <div className="flex flex-col gap-3">
      {(steps.length > 0 || reasoning.length > 0) &&
        (working ? (
          <LiveSeparator steps={steps} />
        ) : (
          <ActivityChip steps={steps} reasoning={reasoning} />
        ))}
      <MessageText text={text} isStreaming={isStreaming} />
    </div>
  );
}

function LiveSeparator({ steps }: { steps: ToolStep[] }) {
  const live = activeStep(steps) ?? steps.at(-1);
  return (
    <Marker variant="separator" role="status" className="min-h-6 text-xs">
      <MarkerContent className="flex max-w-[80%] min-w-0 items-center gap-1.5">
        {live ? (
          <>
            <StepIcon step={live} className="shrink-0" />
            <span className="shimmer truncate">{stepLabel(live)}</span>
          </>
        ) : (
          <span className="shimmer">Thinking</span>
        )}
      </MarkerContent>
    </Marker>
  );
}

function ActivityChip({ steps, reasoning }: { steps: ToolStep[]; reasoning: string[] }) {
  const kinds = [...new Set(steps.map((s) => s.kind))].slice(0, 3);
  const failed = hasStepError(steps);
  return (
    <Marker variant="separator" className="min-h-6 text-xs">
      <MarkerContent>
        <Popover>
          <PopoverTrigger
            className={cn(
              "group/chip flex h-6 cursor-pointer items-center gap-1.5 rounded-full px-2 transition-colors hover:bg-muted hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground",
              { "text-destructive hover:text-destructive": failed },
            )}
          >
            <span className="flex items-center gap-1">
              {kinds.map((kind) => {
                const Icon = KIND_ICONS[kind];
                return <Icon key={kind} className="size-3.5" />;
              })}
            </span>
            {steps.length > 0 ? `${steps.length} step${steps.length > 1 ? "s" : ""}` : "Reasoning"}
            <ChevronDown className="size-3 transition-transform group-data-popup-open/chip:rotate-180" />
          </PopoverTrigger>
          <PopoverContent align="center" className="w-80 gap-0 p-2">
            <p className="px-1 pb-1.5 text-xs font-medium">{summarizeSteps(steps)}</p>
            <div className="flex max-h-72 flex-col overflow-y-auto px-1">
              {steps.map((step) => (
                <StepMarker key={step.id} step={step} />
              ))}
              {reasoning.length > 0 && (
                <div className="pt-1.5">
                  <ReasoningText reasoning={reasoning} />
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </MarkerContent>
    </Marker>
  );
}
