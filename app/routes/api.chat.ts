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
  };
}

function buildSystemPrompt(bookContext: ChatRequestBody["bookContext"]): string {
  let prompt = `You are a reading companion for "${bookContext.title}" by ${bookContext.author}. You have access to a search_book tool to find passages in the book. Always search before answering questions about specific content. Quote relevant passages when possible.`;

  if (bookContext.currentChapterIndex != null) {
    const chapter = bookContext.chapters[bookContext.currentChapterIndex];
    if (chapter) {
      const excerpt = chapter.text.slice(0, 3000);
      prompt += `\n\nThe reader is currently on this chapter:\n--- ${chapter.title} ---\n${excerpt}${chapter.text.length > 3000 ? "\n[truncated]" : ""}`;
    }
  }

  return prompt;
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
      const end = Math.min(
        chapter.text.length,
        matchIndex + query.length + CONTEXT_CHARS,
      );
      const excerpt = (start > 0 ? "…" : "") +
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

  if (
    !bookContext?.title ||
    !bookContext?.author ||
    !Array.isArray(bookContext?.chapters)
  ) {
    return new Response("Missing required bookContext fields", { status: 400 });
  }

  const result = streamText({
    model: gateway("anthropic/claude-sonnet-4-20250514"),
    system: buildSystemPrompt(bookContext),
    messages: await convertToModelMessages(messages),
    tools: {
      search_book: tool({
        description:
          "Search the book for passages matching a query. Returns matching excerpts with surrounding context. Use this to find specific quotes, topics, characters, or themes.",
        inputSchema: z.object({
          query: z
            .string()
            .describe("Text, keywords, or phrase to search for in the book"),
        }),
        execute: async ({ query }) => {
          return searchChapters(bookContext.chapters, query);
        },
      }),
    },
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
