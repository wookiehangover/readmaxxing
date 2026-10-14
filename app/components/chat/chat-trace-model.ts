import type { UIMessage } from "@ai-sdk/react";
import { getToolInfo } from "./chat-utils";

export interface SearchHit {
  chapterIndex?: number;
  chapterTitle?: string;
  excerpt?: string;
}

export interface ChatTraceStep {
  id: string;
  toolName: string;
  title: string;
  summary: string;
  status?: "running" | "error" | "pending";
  description?: string;
  text?: string;
  results?: SearchHit[];
  bookId?: string;
  chapterIndex?: number;
  canOpen?: boolean;
}

export function buildChatTrace(
  parts: UIMessage["parts"],
  isStreaming: boolean,
  resolveBookTitle: (id: string | undefined) => string | undefined,
  showBookLabel: boolean,
): ChatTraceStep[] {
  return parts.flatMap((part, index): ChatTraceStep[] => {
    if (part.type === "reasoning") {
      const running = isStreaming && part.state === "streaming";
      if (!part.text && !running) return [];
      return [
        {
          id: `reasoning-${index}`,
          toolName: "reasoning",
          title: running ? "Thinking" : "Reasoning",
          summary: "Reasoning",
          status: running ? "running" : undefined,
          text: part.text,
        },
      ];
    }

    const info = getToolInfo(part);
    if (!info) return [];
    const { toolName, input, output, state } = info;
    const complete = state === "output-available";
    const errorText = "errorText" in part ? part.errorText : (output?.error ?? output?.reason);
    const failed =
      state === "output-error" ||
      (complete &&
        (output?.executed === false ||
          output?.appended === false ||
          output?.created === false ||
          output?.attached === false ||
          typeof output?.error === "string"));
    const denied =
      state === "output-denied" ||
      (state === "approval-responded" && "approval" in part && !part.approval?.approved);
    const pending = state === "approval-requested";
    const running = isStreaming && !complete && !failed && !denied && !pending;
    const bookId = output?.bookId ?? input?.bookId;
    const bookTitle = showBookLabel
      ? resolveBookTitle(typeof bookId === "string" ? bookId : undefined)
      : undefined;
    const query = typeof input?.query === "string" ? input.query : "";
    const quotedQuery = query ? ` for “${query}”` : "";
    let action: string;
    let active: string;
    let done: string;
    let summary: string;
    let description: string | undefined;
    let text: string | undefined;
    let results: SearchHit[] | undefined;

    switch (toolName) {
      case "search_book": {
        const target = bookTitle ?? "book";
        action = `search ${target}${quotedQuery}`;
        active = `Searching ${target}${quotedQuery}`;
        done = `Searched ${target}${quotedQuery}`;
        summary = `Searched ${target}`;
        const hits = Array.isArray(output) ? output : output?.results;
        if (Array.isArray(hits)) {
          results = hits.filter((hit): hit is SearchHit => hit !== null && typeof hit === "object");
          description = `${results.length} result${results.length === 1 ? "" : "s"}`;
        }
        text = query || undefined;
        break;
      }
      case "read_chapter": {
        const chapter =
          typeof output?.title === "string"
            ? output.title
            : typeof input?.chapterTitle === "string"
              ? input.chapterTitle
              : typeof input?.chapterIndex === "number"
                ? `chapter ${input.chapterIndex + 1}`
                : "chapter";
        action = `read ${chapter}`;
        active = `Reading ${chapter}`;
        done = `Read ${chapter}`;
        summary = "Read chapter";
        break;
      }
      case "read_notes":
        action = "read notebook";
        active = "Reading notebook";
        done = summary = "Read notebook";
        break;
      case "append_to_notes":
        action = "add to notebook";
        active = "Adding to notebook";
        done = summary = "Added to notebook";
        break;
      case "edit_notes":
        action = "edit notebook";
        active = "Editing notebook";
        done = summary = "Edited notebook";
        break;
      case "create_highlight": {
        text = typeof input?.text === "string" ? input.text : undefined;
        const snippet = text ? ` “${text.slice(0, 40)}${text.length > 40 ? "…" : ""}”` : "";
        action = `highlight${snippet}`;
        active = `Highlighting${snippet}`;
        done = `Highlighted${snippet}`;
        summary = "Highlighted passage";
        break;
      }
      case "list_highlights":
        action = "check highlights";
        active = "Checking highlights";
        done = summary = "Checked highlights";
        if (Array.isArray(output?.highlights)) {
          description = `${output.highlights.length} highlight${output.highlights.length === 1 ? "" : "s"}`;
        }
        break;
      case "attach_highlight":
        action = "attach highlight to notebook";
        active = "Attaching highlight to notebook";
        done = summary = "Attached highlight to notebook";
        break;
      case "delete_highlight":
        action = "remove highlight";
        active = "Removing highlight";
        done = summary = "Removed highlight";
        break;
      case "search_standard_ebooks":
      case "web_search": {
        const target = toolName === "web_search" ? "the web" : "Standard Ebooks";
        action = `search ${target}${quotedQuery}`;
        active = `Searching ${target}${quotedQuery}`;
        done = `Searched ${target}${quotedQuery}`;
        summary = `Searched ${target}`;
        if (Array.isArray(output?.books)) {
          description = `${output.books.length} result${output.books.length === 1 ? "" : "s"}`;
        }
        text = query || undefined;
        break;
      }
      default: {
        const name = toolName.replaceAll("_", " ");
        action = `run ${name}`;
        active = `Running ${name}`;
        done = summary = `Ran ${name}`;
      }
    }

    let title = complete ? done : active;
    let status: ChatTraceStep["status"] = running ? "running" : undefined;
    if (failed) {
      title = summary = `Failed to ${action}`;
      status = "error";
      text = typeof errorText === "string" ? errorText : "The tool could not complete this action.";
    } else if (denied) {
      title = summary = `Skipped: ${action}`;
    } else if (pending) {
      title = summary = `Awaiting approval to ${action}`;
      status = "pending";
    } else if (!complete && !running) {
      title = summary = `Stopped: ${action}`;
      status = "error";
    }

    return [
      {
        id: "toolCallId" in part ? part.toolCallId : `tool-${index}`,
        toolName,
        title,
        summary,
        status,
        text,
        description: complete && !failed ? description : undefined,
        results: complete && !failed ? results : undefined,
        bookId: typeof bookId === "string" ? bookId : undefined,
        chapterIndex:
          typeof output?.chapterIndex === "number"
            ? output.chapterIndex
            : typeof input?.chapterIndex === "number"
              ? input.chapterIndex
              : undefined,
        canOpen:
          complete && !failed && (toolName === "read_chapter" || toolName === "create_highlight"),
      },
    ];
  });
}

export function summarizeChatTrace(steps: ChatTraceStep[]): string {
  const active = steps
    .filter((step) => step.status === "running" || step.status === "pending")
    .at(-1);
  if (active) return active.title;
  const tools = steps.filter((step) => step.toolName !== "reasoning");
  if (!tools.length) return "Reasoning";
  const failed = tools.filter((step) => step.status === "error");
  const counts = new Map<string, number>();
  for (const step of failed.length ? failed : tools) {
    counts.set(step.summary, (counts.get(step.summary) ?? 0) + 1);
  }
  return Array.from(counts, ([label, count]) => (count > 1 ? `${label} (${count}×)` : label)).join(
    ", ",
  );
}
