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
import { buildChatTrace, summarizeChatTrace, type ChatTraceStep } from "./chat-trace-model";

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
}: {
  parts: UIMessage["parts"];
  isStreaming?: boolean;
  resolveBookTitle: (id: string | undefined) => string | undefined;
  showBookLabel: boolean;
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
    <Trace className="mb-4">
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
                <TraceStep key={step.id} step={step} />
              ))}
            </Trace>
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function TraceStep({ step }: { step: ChatTraceStep }) {
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
  if (!step.text && !step.results?.length) return line;

  return (
    <TraceCollapsible open={open ?? step.status === "running"} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent keepMounted className="text-sm">
        {step.text && <p className="whitespace-pre-wrap">{step.text}</p>}
        {!!step.results?.length && (
          <ul className="mt-2 flex flex-col gap-3">
            {step.results.map((hit, index) => (
              <li key={index} className="flex flex-col gap-1">
                <p className="font-medium text-foreground">
                  {hit.chapterTitle ?? `Chapter ${hit.chapterIndex ?? "?"}`}
                </p>
                {hit.excerpt && <p>{hit.excerpt}</p>}
              </li>
            ))}
          </ul>
        )}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
