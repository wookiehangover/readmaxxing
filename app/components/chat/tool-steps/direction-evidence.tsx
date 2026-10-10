import { BookOpen, CircleAlert, NotebookPen } from "lucide-react";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "~/components/ui/attachment";
import { Marker, MarkerContent, MarkerIcon } from "~/components/ui/marker";
import { cn } from "~/lib/utils";
import {
  activeStep,
  collectSteps,
  segmentParts,
  stepLabel,
  summarizeSteps,
  type ToolStep,
} from "./tool-step-model";
import { type DirectionProps, MessageText, StepIcon } from "./tool-step-ui";

/**
 * Direction D — Evidence first.
 * Hide the process and show what changed or what was used: chapters read,
 * passages highlighted, notebook edits. Searches only feed the source line.
 */
export function EvidenceDirection({ parts, isStreaming, ...ctx }: DirectionProps) {
  const { steps, text } = collectSteps(segmentParts(parts, ctx));
  const working = isStreaming && !text;
  const live = working ? (activeStep(steps) ?? steps.at(-1)) : undefined;
  const sources = steps.filter(
    (s) => s.kind === "read" || (s.kind === "notes" && s.toolName !== "read_notes"),
  );
  const highlights = steps.filter(
    (s) => s.toolName === "create_highlight" && s.status !== "running",
  );
  const failures = steps.filter(
    (s) => s.status === "error" && !highlights.includes(s) && !sources.includes(s),
  );

  return (
    <div className="flex flex-col gap-3">
      {live ? (
        <Marker role="status" className="min-h-6 text-xs">
          <MarkerIcon className="flex size-3.5 items-center justify-center">
            <StepIcon step={live} />
          </MarkerIcon>
          <MarkerContent className="shimmer truncate">{stepLabel(live)}</MarkerContent>
        </Marker>
      ) : (
        steps.length > 0 && <p className="text-xs text-muted-foreground">{summarizeSteps(steps)}</p>
      )}
      {sources.length > 0 && (
        <AttachmentGroup className="-my-1 gap-2">
          {sources.map((step) => (
            <SourceAttachment key={step.id} step={step} />
          ))}
        </AttachmentGroup>
      )}
      <MessageText text={text} isStreaming={isStreaming} />
      {highlights.map((step) => (
        <HighlightQuote key={step.id} step={step} />
      ))}
      {!working &&
        failures.map((step) => (
          <Marker key={step.id} className="text-xs text-destructive">
            <MarkerIcon className="flex size-3.5 items-center justify-center">
              <CircleAlert className="size-3.5" />
            </MarkerIcon>
            <MarkerContent>
              {stepLabel(step)}
              {step.error && <span className="text-destructive/70"> — {step.error}</span>}
            </MarkerContent>
          </Marker>
        ))}
    </div>
  );
}

function SourceAttachment({ step }: { step: ToolStep }) {
  const isNotes = step.kind === "notes";
  const state =
    step.status === "running" ? "processing" : step.status === "error" ? "error" : "done";
  return (
    <Attachment size="xs" state={state} className="min-w-0 bg-transparent">
      <AttachmentMedia>{isNotes ? <NotebookPen /> : <BookOpen />}</AttachmentMedia>
      <AttachmentContent className="max-w-48 pr-1">
        <AttachmentTitle className="font-normal">
          {isNotes ? "Notebook" : step.object}
        </AttachmentTitle>
        <AttachmentDescription className="mt-0">
          {isNotes
            ? step.verb.replace(/ to$/, "")
            : typeof step.chapterIndex === "number"
              ? `Chapter ${step.chapterIndex + 1}`
              : "Read"}
        </AttachmentDescription>
      </AttachmentContent>
      <AttachmentTrigger aria-label={`Open ${step.object}`} />
    </Attachment>
  );
}

function HighlightQuote({ step }: { step: ToolStep }) {
  const failed = step.status === "error";
  return (
    <button
      type="button"
      className={cn(
        "group/quote flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted",
        { "text-destructive": failed },
      )}
    >
      <StepIcon step={step} className="mt-0.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 leading-relaxed">
        <span
          className={cn("box-decoration-clone px-0.5 text-foreground", {
            "bg-[rgba(255,213,79,0.4)]": !failed,
            "line-through decoration-destructive/60": failed,
          })}
        >
          {step.quote}
        </span>
        {failed && step.error && <span className="block text-destructive/80">{step.error}</span>}
      </span>
    </button>
  );
}
