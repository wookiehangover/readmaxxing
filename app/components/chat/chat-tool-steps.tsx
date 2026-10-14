import { useState } from "react";
import type { UIMessage } from "@ai-sdk/react";
import {
  BookOpen,
  Brain,
  CircleAlert,
  Highlighter,
  NotebookPen,
  Search,
  Wrench,
} from "lucide-react";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "~/components/ui/trace";
import {
  buildChatTrace,
  summarizeChatTrace,
  type ChatTraceStep,
  type SearchHit,
} from "./chat-trace-model";

export type OpenTraceStep = (step: ChatTraceStep, hit?: SearchHit) => void;

function stepIcon(step: ChatTraceStep) {
  if (step.status === "error") return CircleAlert;
  switch (step.toolName) {
    case "reasoning":
      return Brain;
    case "search_book":
    case "search_standard_ebooks":
    case "web_search":
      return Search;
    case "read_chapter":
      return BookOpen;
    case "read_notes":
    case "append_to_notes":
    case "edit_notes":
      return NotebookPen;
    case "create_highlight":
    case "list_highlights":
    case "attach_highlight":
    case "delete_highlight":
      return Highlighter;
    default:
      return Wrench;
  }
}

export function ToolStepsDetails({
  parts,
  isStreaming = false,
  resolveBookTitle,
  showBookLabel,
  bookId,
  onOpen,
}: {
  parts: UIMessage["parts"];
  isStreaming?: boolean;
  resolveBookTitle: (id: string | undefined) => string | undefined;
  showBookLabel: boolean;
  bookId?: string;
  onOpen?: OpenTraceStep;
}) {
  const [open, setOpen] = useState<boolean>();
  const steps = buildChatTrace(parts, isStreaming, resolveBookTitle, showBookLabel);
  if (!steps.length) return null;
  const onlyReasoning = steps.every((step) => step.toolName === "reasoning");
  const running = steps.some((step) => step.status === "running");
  const status = running
    ? "running"
    : steps.some((step) => step.status === "error")
      ? "error"
      : undefined;

  return (
    <Trace>
      <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={status}>
            {onlyReasoning && (
              <TraceIcon>
                <Brain />
              </TraceIcon>
            )}
            <TraceTitle>{summarizeChatTrace(steps)}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent keepMounted>
          {onlyReasoning ? (
            <div className="flex flex-col gap-3 text-sm whitespace-pre-wrap">
              {steps.map((step) => (
                <p key={step.id}>{step.text}</p>
              ))}
            </div>
          ) : (
            <Trace>
              {steps.map((step) => (
                <TraceStep
                  key={step.id}
                  step={step}
                  onOpen={!step.bookId || step.bookId === bookId ? onOpen : undefined}
                />
              ))}
            </Trace>
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function TraceStep({ step, onOpen }: { step: ChatTraceStep; onOpen?: OpenTraceStep }) {
  const [open, setOpen] = useState<boolean>();
  const Icon = stepIcon(step);
  const line = (
    <TraceLine status={step.status}>
      <TraceIcon>
        <Icon />
      </TraceIcon>
      <TraceTitle>{step.title}</TraceTitle>
      {step.description && <TraceDescription>{step.description}</TraceDescription>}
    </TraceLine>
  );
  if (step.canOpen && onOpen) {
    return (
      <button
        type="button"
        onClick={() => onOpen(step)}
        className="w-full cursor-pointer rounded-sm text-left hover:text-foreground focus-visible:outline-ring"
      >
        {line}
      </button>
    );
  }
  if (!step.text && !step.results?.length) return line;

  return (
    <TraceCollapsible open={open ?? step.status === "running"} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent keepMounted className="text-sm">
        {step.text && <p className="whitespace-pre-wrap">{step.text}</p>}
        {!!step.results?.length && (
          <ul className="mt-2 flex flex-col gap-3">
            {step.results.map((hit, index) => (
              <li key={index}>
                {onOpen ? (
                  <button
                    type="button"
                    onClick={() => onOpen(step, hit)}
                    className="flex w-full cursor-pointer flex-col gap-1 rounded-sm text-left hover:text-foreground focus-visible:outline-ring"
                  >
                    <SearchExcerpt hit={hit} />
                  </button>
                ) : (
                  <div className="flex flex-col gap-1">
                    <SearchExcerpt hit={hit} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function SearchExcerpt({ hit }: { hit: SearchHit }) {
  return (
    <>
      <span className="font-medium text-foreground">
        {hit.chapterTitle ?? `Chapter ${(hit.chapterIndex ?? 0) + 1}`}
      </span>
      {hit.excerpt && <span>{hit.excerpt}</span>}
    </>
  );
}
