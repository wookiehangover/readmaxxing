import { useState } from "react";
import { Marker, MarkerContent } from "~/components/ui/marker";
import { cn } from "~/lib/utils";
import type { TrailEntry } from "./tool-step-model";
import { type OpenStep, StepMarker } from "./step-marker";

const VISIBLE_TAIL = 2;

/** Hairline between icon centres; rows are 24px tall with a 14px icon. */
function Connector() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-[21px] -bottom-[3px] left-[6.5px] w-px bg-border"
    />
  );
}

/**
 * A run of tool calls and reasoning, shown inline where it happened in the
 * answer. Settled runs fold to their last steps.
 */
export function StepTrail({
  entries,
  live,
  bookId,
  onOpen,
}: {
  entries: TrailEntry[];
  live: boolean;
  /** Steps from other books are not opened, since only this book's data is loaded. */
  bookId?: string;
  onOpen?: OpenStep;
}) {
  const [expanded, setExpanded] = useState(false);
  const hidden = expanded || live ? 0 : Math.max(0, entries.length - VISIBLE_TAIL - 1);
  const visible = entries.slice(hidden);

  return (
    <div className="flex flex-col">
      {hidden > 0 && (
        <div className="relative">
          <Marker
            render={<button type="button" onClick={() => setExpanded(true)} />}
            className="min-h-6 cursor-pointer text-xs transition-colors hover:text-foreground"
          >
            <span className="flex size-3.5 shrink-0 items-center justify-center">
              <span className="size-1 rounded-full bg-muted-foreground/50" />
            </span>
            <MarkerContent>
              {hidden} earlier step{hidden > 1 ? "s" : ""}
            </MarkerContent>
          </Marker>
          <Connector />
        </div>
      )}
      {visible.map((entry, index) => (
        <div key={entry.key} className="relative">
          {entry.type === "step" ? (
            <StepMarker
              step={entry.step}
              onOpen={!entry.step.bookId || entry.step.bookId === bookId ? onOpen : undefined}
            />
          ) : (
            <ReasoningEntry text={entry.text} />
          )}
          {index < visible.length - 1 && <Connector />}
        </div>
      ))}
    </div>
  );
}

function ReasoningEntry({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      className="flex w-full cursor-pointer items-start gap-2 py-1 text-left text-xs leading-4 text-muted-foreground/80 transition-colors hover:text-muted-foreground"
    >
      <span className="flex h-4 w-3.5 shrink-0 items-center justify-center">
        <span className="size-1 rounded-full bg-muted-foreground/50" />
      </span>
      <span className={cn("min-w-0 whitespace-pre-wrap", { "line-clamp-2": !open })}>{text}</span>
    </button>
  );
}
