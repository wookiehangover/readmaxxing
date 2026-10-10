import { getToolInfo, joinTextParts } from "../chat-utils";

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
  bookId?: string;
  error?: string;
  hits?: SearchHit[];
  chapterIndex?: number;
}

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
  const bookId = str(output?.bookId) ?? str(input.bookId);
  const book = ctx.showBookLabel ? ctx.resolveBookTitle(bookId) : undefined;
  const base = {
    id: part.toolCallId ?? `step-${index}`,
    toolName: info.toolName,
    status,
    book,
    bookId,
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
        chapterIndex: typeof input.chapterIndex === "number" ? input.chapterIndex : undefined,
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

export type TrailEntry =
  | { type: "step"; key: string; step: ToolStep }
  | { type: "reasoning"; key: string; text: string };

export type MessageSegment =
  | { type: "text"; key: string; text: string }
  | { type: "steps"; key: string; entries: TrailEntry[] };

/** Split message parts into ordered text and step runs, keeping tool calls where they happened. */
export function segmentParts(parts: readonly any[], ctx: StepContext): MessageSegment[] {
  const segments: MessageSegment[] = [];
  parts.forEach((part, index) => {
    const last = segments.at(-1);
    if (part.type === "text") {
      if (!part.text) return;
      if (last?.type === "text") last.text = joinTextParts([last.text, part.text]);
      else segments.push({ type: "text", key: `t-${index}`, text: part.text });
      return;
    }
    let entry: TrailEntry | null = null;
    if (part.type === "reasoning") {
      if (str(part.text)) entry = { type: "reasoning", key: `r-${index}`, text: part.text.trim() };
    } else {
      const step = toToolStep(part, index, ctx);
      if (step) entry = { type: "step", key: step.id, step };
    }
    if (!entry) return;
    if (last?.type === "steps") last.entries.push(entry);
    else segments.push({ type: "steps", key: `s-${index}`, entries: [entry] });
  });
  return segments;
}
