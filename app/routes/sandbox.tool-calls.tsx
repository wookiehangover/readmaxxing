import { type ComponentType, useCallback, useState } from "react";
import { Play } from "lucide-react";
import { redirect } from "react-router";
import { ThemeToggle } from "~/components/theme-toggle";
import { Bubble, BubbleContent } from "~/components/ui/bubble";
import { Button } from "~/components/ui/button";
import { Message, MessageContent } from "~/components/ui/message";
import { ToolStepsDetails } from "~/components/chat/chat-tool-steps";
import { getToolInfo } from "~/components/chat/chat-utils";
import { EvidenceDirection } from "~/components/chat/tool-steps/direction-evidence";
import { SeparatorDirection } from "~/components/chat/tool-steps/direction-separator";
import { SummaryDirection } from "~/components/chat/tool-steps/direction-summary";
import { TrailDirection } from "~/components/chat/tool-steps/direction-trail";
import {
  SANDBOX_BOOKS,
  SANDBOX_SCENARIOS,
  useReplay,
} from "~/components/chat/tool-steps/sandbox-fixtures";
import { type DirectionProps, MessageText } from "~/components/chat/tool-steps/tool-step-ui";
import { cn } from "~/lib/utils";

export function clientLoader() {
  if (!import.meta.env.DEV) throw redirect("/");
  return null;
}

function CurrentDirection({ parts, isStreaming, resolveBookTitle, showBookLabel }: DirectionProps) {
  const toolParts = parts.filter((p) => getToolInfo(p) !== null);
  const reasoningParts = parts.filter((p) => p.type === "reasoning");
  const text = parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join(" ");
  return (
    <>
      {(toolParts.length > 0 || reasoningParts.length > 0) && (
        <ToolStepsDetails
          toolParts={toolParts}
          reasoningParts={reasoningParts}
          isStreaming={isStreaming}
          resolveBookTitle={resolveBookTitle}
          showBookLabel={showBookLabel}
        />
      )}
      <MessageText text={text} isStreaming={isStreaming} />
    </>
  );
}

const DIRECTIONS: {
  id: string;
  name: string;
  note: string;
  Component: ComponentType<DirectionProps>;
}[] = [
  { id: "current", name: "Current", note: "Mono summary, hoisted", Component: CurrentDirection },
  {
    id: "a",
    name: "A · Quiet summary",
    note: "One sentence, expands",
    Component: SummaryDirection,
  },
  {
    id: "b",
    name: "B · Inline trail",
    note: "Steps where they happened",
    Component: TrailDirection,
  },
  { id: "c", name: "C · Separator chip", note: "Divider + popover", Component: SeparatorDirection },
  {
    id: "d",
    name: "D · Evidence first",
    note: "Show effects, not process",
    Component: EvidenceDirection,
  },
];

export default function ToolCallsSandbox() {
  const [scenarioId, setScenarioId] = useState(SANDBOX_SCENARIOS[1].id);
  const [runId, setRunId] = useState(0);
  const scenario = SANDBOX_SCENARIOS.find((s) => s.id === scenarioId) ?? SANDBOX_SCENARIOS[0];
  const replay = useReplay(scenario.parts, runId);
  const resolveBookTitle = useCallback(
    (id: string | undefined) => SANDBOX_BOOKS[id ?? "book-moby"],
    [],
  );

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-2 bg-background/90 px-6 py-3 backdrop-blur">
        <h1 className="mr-3 text-sm font-medium">Tool call directions</h1>
        <div className="flex gap-1">
          {SANDBOX_SCENARIOS.map((s) => (
            <Button
              key={s.id}
              size="sm"
              variant={s.id === scenarioId ? "secondary" : "ghost"}
              onClick={() => {
                setScenarioId(s.id);
                setRunId(0);
              }}
            >
              {s.label}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Button size="sm" variant="outline" onClick={() => setRunId((n) => n + 1)}>
            <Play data-icon="inline-start" />
            Replay
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 gap-4 overflow-x-auto px-6 pt-2 pb-10">
        {DIRECTIONS.map(({ id, name, note, Component }) => (
          <section key={id} className="flex w-[22rem] shrink-0 flex-col gap-3" data-direction={id}>
            <div className="flex items-baseline gap-2 px-1 text-xs">
              <span className="font-medium">{name}</span>
              <span className="text-muted-foreground">{note}</span>
            </div>
            <div
              className={cn("flex flex-col rounded-xl border bg-background px-4 py-3", {
                "border-dashed": id === "current",
              })}
            >
              <Message align="end">
                <MessageContent>
                  <Bubble variant="secondary" className="my-3 max-w-prose">
                    <BubbleContent>
                      <p className="whitespace-pre-wrap">{scenario.question}</p>
                    </BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>
              <Message align="start">
                <MessageContent>
                  <Bubble variant="ghost" className="max-w-prose text-foreground">
                    <BubbleContent>
                      <Component
                        parts={replay.parts}
                        isStreaming={replay.isStreaming}
                        resolveBookTitle={resolveBookTitle}
                        showBookLabel={!!scenario.multiBook}
                      />
                    </BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
