import { streamText, convertToModelMessages, type UIMessage, tool, stepCountIs } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { z } from "zod";
import type { Route } from "./+types/api.chat";

interface BookChapter {
  index: number;
  title: string;
  text: string;
}

interface ChatRequestBody {
  messages: UIMessage[];
  bookContext: {
    title: string;
    author: string;
    chapters: BookChapter[];
    currentChapterIndex?: number;
    visibleText?: string;
    notebookMarkdown?: string;
  };
}

function buildSystemPrompt(bookContext: ChatRequestBody["bookContext"]): string {
  const toc = bookContext.chapters.map((c) => `  ${c.index}. ${c.title}`).join("\n");

  let currentChapterSection = "";

  // Prefer the actual visible text from the reader iframe
  const pageText = bookContext.visibleText?.trim();
  const chapter =
    bookContext.currentChapterIndex != null
      ? bookContext.chapters.find((c) => c.index === bookContext.currentChapterIndex)
      : undefined;

  if (pageText || chapter) {
    const chapterLabel = chapter
      ? `Chapter ${chapter.index} — "${chapter.title}"`
      : bookContext.currentChapterIndex != null
        ? `Chapter ${bookContext.currentChapterIndex}`
        : "an unknown position";

    currentChapterSection = `

## Current context
The reader is currently on: ${chapterLabel}

Here is what they are currently looking at:
---
${pageText || chapter?.text.slice(0, 2000) || "(unable to extract page text)"}
---`;
  }

  return `You are a reading companion for "${bookContext.title}" by ${bookContext.author}.

## Your role
You help the reader engage deeply with this book. You are curious, intellectually honest, and willing to challenge ideas. You are not a generic assistant — you are a close reader of this specific text and an intellectual discussion partner.

## Intellectual discussion
When the reader asks "What would [thinker] think about this?" or similar questions that invoke a specific intellectual perspective, engage directly and substantively. Draw on what you know about the thinker's published views, methodological commitments, and intellectual style, then apply that lens to the book's actual ideas. Do not hedge or disclaim — reason through the thinker's likely perspective with confidence. Connect their known positions to specific passages and arguments in the text. If the thinker would push back on the book's claims, say so and explain why. If they would be enthusiastic, explain what would resonate and why. Treat these as genuine intellectual exercises in perspective-taking, grounded in the text.

## How to respond
- Always ground your answers in the book's actual text. Use search_book to find relevant passages before answering.
- Quote specific passages when making claims about what the book says. Use quotation marks and cite the chapter.
- Reference chapter numbers and titles so the reader can follow along.
- When relevant, suggest other chapters the reader might find interesting.
- If the reader asks something the book doesn't cover, say so honestly and offer what you can from the text.
- Push back on misreadings. Offer alternative interpretations. Be intellectually honest.
- Keep responses focused. Don't ramble.
- Use read_chapter when you need to understand a chapter's full argument, not just keyword matches.
- When referencing a specific passage, wrap a SHORT phrase (not the full quote) in a <ref> tag so the reader can click to navigate there:
  <ref chapter="3" query="first few words of passage">the key phrase</ref>
  The "chapter" attribute is the chapter index number, and "query" is a short exact phrase from the passage (enough to locate it uniquely). The text between the tags is what the reader sees — keep it brief (a few words). Do NOT wrap entire quotes or long passages in ref tags; use them only for short inline references.
- You can read and add to the reader's personal notebook using read_notes and append_to_notes.
- When the reader asks you to "save this", "note that", or "add to my notes", use append_to_notes.
- When they ask about their notes or want you to reference what they've written, use read_notes first.
- When you find a passage that is particularly important, beautiful, or relevant to the reader's question, proactively highlight it using create_highlight. Include a brief note explaining why it's significant.

## Suggested follow-ups
At the very end of every response, include an HTML comment with 2-3 suggested follow-up prompts the reader might want to ask next. These should be contextual and specific to what was just discussed. Format:
<!-- suggested-prompts
How does this theme develop in later chapters?
What counterarguments does the author address?
Compare this to the introduction's thesis.
-->

## Book structure
${toc}
${currentChapterSection}`;
}

function searchChapters(
  chapters: BookChapter[],
  query: string,
): Array<{ chapterIndex: number; chapterTitle: string; excerpt: string }> {
  const results: Array<{
    chapterIndex: number;
    chapterTitle: string;
    excerpt: string;
  }> = [];
  const lowerQuery = query.toLowerCase();
  const MAX_RESULTS = 10;
  const CONTEXT_CHARS = 250;

  for (const chapter of chapters) {
    if (results.length >= MAX_RESULTS) break;

    const lowerText = chapter.text.toLowerCase();
    let searchFrom = 0;

    while (results.length < MAX_RESULTS) {
      const matchIndex = lowerText.indexOf(lowerQuery, searchFrom);
      if (matchIndex === -1) break;

      const start = Math.max(0, matchIndex - CONTEXT_CHARS);
      const end = Math.min(chapter.text.length, matchIndex + query.length + CONTEXT_CHARS);
      const excerpt =
        (start > 0 ? "…" : "") +
        chapter.text.slice(start, end) +
        (end < chapter.text.length ? "…" : "");

      results.push({
        chapterIndex: chapter.index,
        chapterTitle: chapter.title,
        excerpt,
      });

      searchFrom = matchIndex + query.length;
    }
  }

  return results;
}

export async function action({ request }: Route.ActionArgs) {
  const body = (await request.json()) as ChatRequestBody;
  const { messages, bookContext } = body;

  if (!messages || !Array.isArray(messages)) {
    return new Response("Missing or invalid messages", { status: 400 });
  }

  if (!bookContext?.title || !bookContext?.author || !Array.isArray(bookContext?.chapters)) {
    return new Response("Missing required bookContext fields", { status: 400 });
  }

  const result = streamText({
    model: gateway("anthropic/claude-sonnet-4.6"),
    system: buildSystemPrompt(bookContext),
    messages: await convertToModelMessages(messages),
    tools: {
      search_book: tool({
        description:
          "Search the book for passages matching a query. Returns matching excerpts with surrounding context. Use this to find specific quotes, topics, characters, or themes.",
        inputSchema: z.object({
          query: z.string().describe("Text, keywords, or phrase to search for in the book"),
        }),
        execute: async ({ query }) => {
          return searchChapters(bookContext.chapters, query);
        },
      }),
      read_notes: tool({
        description:
          "Read the reader's personal notes and annotations for this book. Returns their notebook content as markdown.",
        inputSchema: z.object({}),
        execute: async () => {
          return { content: bookContext.notebookMarkdown || "(No notes yet)" };
        },
      }),
      append_to_notes: tool({
        description:
          "Add a note to the reader's notebook for this book. Use when they ask to save something, bookmark a passage, or jot down a thought. The text is appended to their existing notes.",
        inputSchema: z.object({
          text: z.string().describe("The text to add (markdown format)"),
        }),
        execute: async ({ text }) => {
          return { appended: true, text };
        },
      }),
      create_highlight: tool({
        description:
          "Highlight a passage in the book. Use this proactively when you find text that is particularly important, beautiful, or relevant to the reader's question. The highlight will appear in the epub reader and be saved to the reader's notebook.",
        inputSchema: z.object({
          text: z
            .string()
            .describe("The exact text from the book to highlight. Must be a verbatim quote."),
          note: z
            .string()
            .optional()
            .describe("A brief note explaining why this passage is significant"),
        }),
        execute: async ({ text, note }) => {
          return { created: true, text, note };
        },
      }),
      read_chapter: tool({
        description:
          "Read the full text of a specific chapter. Use this to understand a chapter's full argument before answering detailed questions about it.",
        inputSchema: z.object({
          chapterIndex: z.number().optional().describe("The 0-based chapter index"),
          chapterTitle: z
            .string()
            .optional()
            .describe("The chapter title to look up (partial match OK)"),
        }),
        execute: async ({ chapterIndex, chapterTitle }) => {
          let chapter: BookChapter | undefined;
          if (chapterIndex != null) {
            chapter = bookContext.chapters.find((c) => c.index === chapterIndex);
          } else if (chapterTitle) {
            const lower = chapterTitle.toLowerCase();
            chapter = bookContext.chapters.find((c) => c.title.toLowerCase().includes(lower));
          }
          if (!chapter) return { error: "Chapter not found" };
          const text =
            chapter.text.length > 15000
              ? chapter.text.slice(0, 15000) + "\n[truncated — chapter continues]"
              : chapter.text;
          return { chapterIndex: chapter.index, title: chapter.title, text };
        },
      }),
    },
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
