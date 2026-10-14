import { createRoot, type Root } from "react-dom/client";
import type { UIMessage } from "@ai-sdk/react";
import { ToolStepsDetails } from "~/components/chat/chat-tool-steps";
import { Bubble, BubbleContent } from "~/components/ui/bubble";
import { Message, MessageContent } from "~/components/ui/message";
import "~/app.css";

const reasoning: UIMessage["parts"][number] = {
  type: "reasoning",
  state: "done",
  text: "I’ll compare the passages on solitude in Walden with Emerson’s account of self-reliance, then save the connection to the notebook.",
};
const search: UIMessage["parts"][number] = {
  type: "tool-search_book",
  toolCallId: "search-walden",
  state: "output-available",
  input: { query: "solitude and self-reliance", bookId: "walden" },
  output: {
    bookId: "walden",
    results: [
      {
        chapterTitle: "Solitude",
        excerpt: "I never found the companion that was so companionable as solitude.",
      },
      {
        chapterTitle: "Where I Lived, and What I Lived For",
        excerpt: "I went to the woods because I wished to live deliberately.",
      },
    ],
  },
};
const read: UIMessage["parts"][number] = {
  type: "tool-read_chapter",
  toolCallId: "read-essays",
  state: "output-available",
  input: { chapterTitle: "Self-Reliance", bookId: "essays" },
  output: { text: "Trust thyself." },
};
const edit = {
  type: "tool-append_to_notes",
  toolCallId: "save-note",
  state: "output-available",
  input: { text: "Solitude makes room for independent judgment." },
  output: { appended: true },
} satisfies UIMessage["parts"][number];

export type TracePreviewState = "complete" | "running" | "error";
let root: Root | undefined;

export function renderTracePreview(state: TracePreviewState = "complete") {
  if (!root) {
    const host = document.body.appendChild(document.createElement("div"));
    host.className = "fixed inset-0 z-50 overflow-auto bg-background text-foreground";
    root = createRoot(host);
  }
  const parts: UIMessage["parts"] = [
    reasoning,
    search,
    read,
    state === "running"
      ? { ...edit, state: "input-available", output: undefined }
      : state === "error"
        ? {
            ...edit,
            state: "output-error",
            output: undefined,
            errorText: "The notebook has a newer edit. Please try again.",
          }
        : edit,
  ];
  root.render(
    <main
      aria-label="Chat trace preview"
      className="mx-auto flex min-h-full w-full max-w-xl flex-col gap-5 px-5 py-12"
    >
      <Message align="end">
        <MessageContent>
          <Bubble variant="secondary">
            <BubbleContent>
              How do Thoreau and Emerson connect solitude with self-reliance? Save the connection to
              my notes.
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
      <Message>
        <MessageContent>
          <Bubble variant="ghost">
            <BubbleContent>
              <ToolStepsDetails
                parts={parts}
                isStreaming={state === "running"}
                resolveBookTitle={(id) => (id === "walden" ? "Walden" : "Essays")}
                showBookLabel
              />
              {state === "complete" && (
                <p className="text-sm leading-relaxed">
                  For both writers, solitude creates room for independent judgment. Thoreau puts it
                  into practice at Walden; Emerson makes it a principle: trust your own perception
                  before accepting the crowd’s. I’ve added this connection to your notebook.
                </p>
              )}
              {state === "error" && (
                <p className="text-sm leading-relaxed">
                  I found the connection, but couldn’t save it because the notebook changed.
                </p>
              )}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </main>,
  );
}
