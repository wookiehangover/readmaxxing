import { getToolInfo } from "../chat-utils";

export type ToolStepKind = "search" | "read" | "notes" | "highlight" | "catalog" | "other";
export type ToolStepStatus = "running" | "done" | "error";

export interface SearchHit {
  chapterIndex?: number;
  chapterTitle?: string;
  excerpt?: string;
}

export interface ToolStep {
  id: string;
  kind: ToolStepKind;
  toolName: string;
  status: ToolStepStatus;
  /** Sentence-case action, e.g. "Searched" or "Searching". */
  verb: string;
  /** What the action touched, e.g. a chapter title or the notebook. */
  object?: string;
  /** Quoted user-facing text: a search query or highlighted passage. */
  quote?: string;
  /** Short outcome, e.g. "4 passages". */
  meta?: string;
  /** Book title, only set when the conversation spans several books. */
  book?: string;
  error?: string;
  hits?: SearchHit[];
  chapterIndex?: number;
}

export type MessageSegment =
  | { type: "text"; key: string; text: string }
  | { type: "steps"; key: string; steps: ToolStep[]; reasoning: string[] };

export interface StepContext {
  resolveBookTitle: (id: string | undefined) => string | undefined;
  showBookLabel: boolean;
}

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

function humanize(toolName: string): string {
  const words = toolName.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function searchHits(output: any): SearchHit[] | undefined {
  if (Array.isArray(output)) return output;
  if (Array.isArray(output?.results)) return output.results;
  return undefined;
}

export function toToolStep(part: any, index: number, ctx: StepContext): ToolStep | null {
  const info = getToolInfo(part);
  if (!info) return null;
  const input = info.input ?? {};
  const output = info.output;
  const done = info.state === "output-available";
  const failed =
    info.state === "output-error" ||
    (done && (output?.executed === false || output?.attached === false || !!str(output?.error)));
  const status: ToolStepStatus = failed ? "error" : done ? "done" : "running";
  const error = failed
    ? (str(output?.error) ?? str(output?.reason) ?? str(part.errorText))
    : undefined;
  const pick = (past: string, present: string) => (done ? past : present);
  const book = ctx.showBookLabel
    ? ctx.resolveBookTitle(str(output?.bookId) ?? str(input.bookId))
    : undefined;
  const base = {
    id: part.toolCallId ?? `step-${index}`,
    toolName: info.toolName,
    status,
    book,
    error,
  };

  switch (info.toolName) {
    case "search_book": {
      const hits = done ? searchHits(output) : undefined;
      return {
        ...base,
        kind: "search",
        verb: pick("Searched", "Searching"),
        quote: str(input.query),
        meta: hits ? (hits.length ? plural(hits.length, "passage") : "No matches") : undefined,
        hits,
      };
    }
    case "read_chapter": {
      const title =
        str(output?.title) ??
        str(input.chapterTitle) ??
        (typeof input.chapterIndex === "number" ? `Chapter ${input.chapterIndex + 1}` : "chapter");
      return {
        ...base,
        kind: "read",
        verb: pick("Read", "Reading"),
        object: title,
        chapterIndex:
          typeof output?.chapterIndex === "number"
            ? output.chapterIndex
            : (input.chapterIndex as number),
      };
    }
    case "read_notes":
      return { ...base, kind: "notes", verb: pick("Read", "Reading"), object: "notebook" };
    case "append_to_notes":
      return { ...base, kind: "notes", verb: pick("Added to", "Adding to"), object: "notebook" };
    case "edit_notes":
      return {
        ...base,
        kind: "notes",
        verb: failed ? "Couldn't edit" : pick("Edited", "Editing"),
        object: "notebook",
      };
    case "create_highlight":
      return {
        ...base,
        kind: "highlight",
        verb: failed ? "Couldn't highlight" : pick("Highlighted", "Highlighting"),
        quote: str(input.text),
      };
    case "list_highlights": {
      const list = Array.isArray(output?.highlights) ? output.highlights : undefined;
      return {
        ...base,
        kind: "highlight",
        verb: pick("Checked", "Checking"),
        object: "highlights",
        meta: list ? plural(list.length, "highlight") : undefined,
      };
    }
    case "attach_highlight":
      return {
        ...base,
        kind: "highlight",
        verb: failed ? "Couldn't attach" : pick("Attached", "Attaching"),
        object: "highlight to notebook",
      };
    case "delete_highlight":
      return { ...base, kind: "highlight", verb: pick("Removed", "Removing"), object: "highlight" };
    case "search_standard_ebooks": {
      const books = Array.isArray(output?.books) ? output.books : undefined;
      return {
        ...base,
        kind: "catalog",
        verb: pick("Searched", "Searching"),
        object: "Standard Ebooks",
        quote: str(input.query),
        meta: books ? plural(books.length, "book") : undefined,
      };
    }
    default:
      return { ...base, kind: "other", verb: humanize(info.toolName) };
  }
}

/** Split message parts into ordered text and step runs, keeping tool calls where they happened. */
export function segmentParts(parts: readonly any[], ctx: StepContext): MessageSegment[] {
  const segments: MessageSegment[] = [];
  parts.forEach((part, index) => {
    const last = segments.at(-1);
    if (part.type === "text") {
      if (!part.text) return;
      if (last?.type === "text") last.text += part.text;
      else segments.push({ type: "text", key: `t-${index}`, text: part.text });
      return;
    }
    const isReasoning = part.type === "reasoning";
    const step = isReasoning ? null : toToolStep(part, index, ctx);
    if (!isReasoning && !step) return;
    const run =
      last?.type === "steps"
        ? last
        : (segments[
            segments.push({ type: "steps", key: `s-${index}`, steps: [], reasoning: [] }) - 1
          ] as Extract<MessageSegment, { type: "steps" }>);
    if (step) run.steps.push(step);
    else if (part.text) run.reasoning.push(part.text);
  });
  return segments;
}

export function collectSteps(segments: MessageSegment[]) {
  const steps: ToolStep[] = [];
  const reasoning: string[] = [];
  let text = "";
  for (const segment of segments) {
    if (segment.type === "text") text += (text ? "\n\n" : "") + segment.text;
    else {
      steps.push(...segment.steps);
      reasoning.push(...segment.reasoning);
    }
  }
  return { steps, reasoning, text };
}

/** One-line label for a single step, without the outcome. */
export function stepLabel(step: ToolStep): string {
  const parts = [step.verb];
  if (step.object) parts.push(step.object);
  if (step.quote) parts.push(step.kind === "catalog" ? `for “${step.quote}”` : `“${step.quote}”`);
  return parts.join(" ");
}

/** Plain-language digest of several steps, e.g. "Searched 3 times, read Chapter 42". */
export function summarizeSteps(steps: ToolStep[]): string {
  if (steps.length === 0) return "Thought it through";
  if (steps.length === 1) return stepLabel(steps[0]);
  const byKind = new Map<ToolStepKind, ToolStep[]>();
  for (const step of steps) byKind.set(step.kind, [...(byKind.get(step.kind) ?? []), step]);

  const phrases: string[] = [];
  for (const [kind, group] of byKind) {
    const n = group.length;
    switch (kind) {
      case "search":
        phrases.push(`searched ${n === 1 ? "once" : n === 2 ? "twice" : `${n} times`}`);
        break;
      case "read":
        phrases.push(n === 1 ? "read a chapter" : `read ${n} chapters`);
        break;
      case "highlight":
        phrases.push(
          group.every((s) => s.toolName === "create_highlight")
            ? `highlighted ${n === 1 ? "a passage" : `${n} passages`}`
            : "updated highlights",
        );
        break;
      case "notes":
        phrases.push(
          group.some((s) => s.toolName !== "read_notes") ? "updated notes" : "read notes",
        );
        break;
      case "catalog":
        phrases.push("searched Standard Ebooks");
        break;
      default:
        phrases.push(...group.map((s) => s.verb.toLowerCase()));
    }
  }
  const sentence = phrases.join(", ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export const activeStep = (steps: ToolStep[]) => steps.findLast((s) => s.status === "running");
export const hasStepError = (steps: ToolStep[]) => steps.some((s) => s.status === "error");
