import { useState } from "react";
import {
  BookOpen,
  ChevronRight,
  CircleAlert,
  Highlighter,
  Library,
  NotebookPen,
  Search,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Marker, MarkerContent, MarkerIcon } from "~/components/ui/marker";
import { cn } from "~/lib/utils";
import type { SearchHit, ToolStep, ToolStepKind } from "./tool-step-model";

const KIND_ICONS: Record<ToolStepKind, LucideIcon> = {
  search: Search,
  read: BookOpen,
  notes: NotebookPen,
  highlight: Highlighter,
  catalog: Library,
  other: Wrench,
};

export type OpenStep = (step: ToolStep, hit?: SearchHit) => void;

function StepLabel({ step }: { step: ToolStep }) {
  const lead = [step.verb, step.object].filter(Boolean).join(" ");
  return (
    <span className="flex min-w-0 items-baseline gap-1">
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

/** One tool step as a shadcn Marker. Search steps expand to passages; others open in the book. */
export function StepMarker({ step, onOpen }: { step: ToolStep; onOpen?: OpenStep }) {
  const [open, setOpen] = useState(false);
  const running = step.status === "running";
  const failed = step.status === "error";
  const hits = step.hits?.length ? step.hits : undefined;
  const opensInBook =
    !!onOpen && !failed && (step.kind === "read" || step.toolName === "create_highlight");
  const Icon = failed ? CircleAlert : KIND_ICONS[step.kind];

  const body = (
    <>
      <MarkerIcon className="flex size-3.5 items-center justify-center">
        {hits ? (
          <>
            <Icon
              className={cn(
                "size-3.5 group-hover/marker:hidden group-focus-visible/marker:hidden",
                {
                  hidden: open,
                },
              )}
            />
            <ChevronRight
              className={cn(
                "hidden size-3.5 transition-transform group-hover/marker:block group-focus-visible/marker:block",
                { "block rotate-90": open },
              )}
            />
          </>
        ) : (
          <Icon className="size-3.5" />
        )}
      </MarkerIcon>
      <MarkerContent
        className={cn("flex min-w-0 flex-1 items-baseline gap-2", { shimmer: running })}
      >
        <StepLabel step={step} />
        {(step.meta || step.error) && (
          <span
            className={cn("ml-auto shrink-0 text-muted-foreground/70 tabular-nums", {
              "max-w-[50%] truncate text-destructive/80": step.error,
            })}
          >
            {step.error ?? step.meta}
          </span>
        )}
      </MarkerContent>
    </>
  );

  const markerClass = cn("min-h-6 text-xs", { "text-destructive": failed });
  const interactiveClass = "cursor-pointer rounded-sm transition-colors hover:text-foreground";

  if (hits) {
    return (
      <div className="min-w-0">
        <Marker
          render={<button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} />}
          className={cn(markerClass, interactiveClass)}
        >
          {body}
        </Marker>
        {open && (
          <SearchHitList hits={hits} onOpen={onOpen ? (hit) => onOpen(step, hit) : undefined} />
        )}
      </div>
    );
  }

  if (opensInBook) {
    return (
      <Marker
        render={<button type="button" onClick={() => onOpen?.(step)} />}
        className={cn(markerClass, interactiveClass)}
      >
        {body}
      </Marker>
    );
  }

  return (
    <Marker role={running ? "status" : undefined} className={markerClass}>
      {body}
    </Marker>
  );
}

function SearchHitList({ hits, onOpen }: { hits: SearchHit[]; onOpen?: (hit: SearchHit) => void }) {
  return (
    <ul className="space-y-0.5 pt-0.5 pb-1 pl-4 text-xs">
      {hits.map((hit, index) => {
        const content = (
          <>
            <span className="block text-muted-foreground">
              {hit.chapterTitle ?? `Chapter ${(hit.chapterIndex ?? 0) + 1}`}
            </span>
            {hit.excerpt && <span className="line-clamp-2 text-foreground/80">{hit.excerpt}</span>}
          </>
        );
        return (
          <li key={index}>
            {onOpen ? (
              <button
                type="button"
                onClick={() => onOpen(hit)}
                className="block w-full cursor-pointer rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted"
              >
                {content}
              </button>
            ) : (
              <div className="px-1.5 py-1">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
