import { useState } from "react";
import {
  BookOpen,
  ChevronRight,
  CircleAlert,
  Highlighter,
  Library,
  NotebookPen,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { Marker, MarkerContent, MarkerIcon } from "~/components/ui/marker";
import { cn } from "~/lib/utils";
import type { SearchHit, ToolStep, ToolStepKind } from "./tool-step-model";

export const KIND_ICONS: Record<ToolStepKind, LucideIcon> = {
  search: Search,
  read: BookOpen,
  notes: NotebookPen,
  highlight: Highlighter,
  catalog: Library,
  other: Sparkles,
};

export function StepIcon({ step, className }: { step: ToolStep; className?: string }) {
  const Icon = step.status === "error" ? CircleAlert : KIND_ICONS[step.kind];
  return <Icon className={cn("size-3.5", className)} />;
}

/** "Searched “whiteness”" with the quote kept readable and truncated on its own. */
export function StepLabelText({ step, className }: { step: ToolStep; className?: string }) {
  const lead = [step.verb, step.object].filter(Boolean).join(" ");
  return (
    <span className={cn("flex min-w-0 items-baseline gap-1", className)}>
      <span className="shrink-0">{lead}</span>
      {step.quote && (
        <span className="min-w-0 truncate text-foreground/75">
          {step.kind === "catalog" ? "for " : ""}“{step.quote}”
        </span>
      )}
      {step.book && <span className="shrink-0 text-muted-foreground/70">in {step.book}</span>}
    </span>
  );
}

/** One step as a shadcn Marker. Search steps with hits can expand to show passages. */
export function StepMarker({ step, className }: { step: ToolStep; className?: string }) {
  const [open, setOpen] = useState(false);
  const running = step.status === "running";
  const expandable = !!step.hits?.length;

  const body = (
    <>
      <MarkerIcon className="flex size-3.5 items-center justify-center">
        <StepIcon step={step} />
      </MarkerIcon>
      <MarkerContent
        className={cn("flex min-w-0 flex-1 items-baseline gap-2", { shimmer: running })}
      >
        <StepLabelText step={step} />
        {(step.meta || step.error) && (
          <span
            className={cn("ml-auto shrink-0 tabular-nums text-muted-foreground/70", {
              "max-w-[50%] truncate text-destructive/80": step.error,
            })}
          >
            {step.error ?? step.meta}
          </span>
        )}
      </MarkerContent>
      {expandable && (
        <ChevronRight
          className={cn("size-3 shrink-0 opacity-0 transition group-hover/marker:opacity-100", {
            "rotate-90 opacity-100": open,
          })}
        />
      )}
    </>
  );

  const markerClass = cn(
    "min-h-6 text-xs",
    { "text-destructive": step.status === "error" },
    className,
  );

  return (
    <div className="min-w-0">
      {expandable ? (
        <Marker
          render={<button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} />}
          className={cn(markerClass, "cursor-pointer transition-colors hover:text-foreground")}
        >
          {body}
        </Marker>
      ) : (
        <Marker role={running ? "status" : undefined} className={markerClass}>
          {body}
        </Marker>
      )}
      {expandable && open && <SearchHitList hits={step.hits!} className="pb-1 pl-5.5" />}
    </div>
  );
}

export function SearchHitList({ hits, className }: { hits: SearchHit[]; className?: string }) {
  return (
    <ul className={cn("space-y-1.5 text-xs", className)}>
      {hits.map((hit, index) => (
        <li key={index}>
          <button
            type="button"
            className="block w-full cursor-pointer rounded-md px-2 py-1 text-left transition-colors hover:bg-muted"
          >
            <span className="block text-muted-foreground">
              {hit.chapterTitle ?? `Chapter ${(hit.chapterIndex ?? 0) + 1}`}
            </span>
            {hit.excerpt && <span className="line-clamp-2 text-foreground/80">{hit.excerpt}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ReasoningText({ reasoning }: { reasoning: string[] }) {
  if (reasoning.length === 0) return null;
  return (
    <div className="space-y-1 text-xs leading-relaxed text-muted-foreground/80">
      {reasoning.map((text, i) => (
        <p key={i}>{text}</p>
      ))}
    </div>
  );
}

export function MessageText({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  if (!text) return null;
  return (
    <div className="typeset [--typeset-flow:0.75em] [--typeset-leading:1.6] [--typeset-size:0.875rem]">
      <Streamdown caret="block" isAnimating={isStreaming}>
        {text}
      </Streamdown>
    </div>
  );
}

export interface DirectionProps {
  parts: readonly any[];
  isStreaming: boolean;
  resolveBookTitle: (id: string | undefined) => string | undefined;
  showBookLabel: boolean;
}
