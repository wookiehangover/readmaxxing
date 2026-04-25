import {
  streamText,
  convertToModelMessages,
  type UIMessage,
  tool,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
} from "ai";
import { gateway } from "@ai-sdk/gateway";
import { anthropic } from "@ai-sdk/anthropic";
import { createResumableStreamContext } from "resumable-stream";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import type { Route } from "./+types/api.chat";
import { SE_BASE, parseSearchHtml } from "./api.standard-ebooks.search";
import type { BookChapter } from "~/lib/epub/epub-text-extract";
import { getOrBuildBookIndex, locateTextAnchor, searchBook } from "~/lib/orama-book-search";
import { getSessionFromRequest } from "~/lib/database/auth-middleware";
import { getBookByIdForUser } from "~/lib/database/book/book";
import { getBookChaptersForUser } from "~/lib/database/book/book-chapters";
import { upsertHighlight } from "~/lib/database/annotation/highlight";
import {
  getNotebookForUser,
  getNotebookMarkdownForUser,
  upsertNotebook,
} from "~/lib/database/annotation/notebook";
import { runEditNotesInSandbox } from "~/lib/editor/notebook-sdk-server";
import { markdownToTiptapJsonServer } from "~/lib/editor/markdown-to-tiptap-server";
import type { JSONContent } from "@tiptap/react";
import {
  getMessagesBySession,
  getSessionByIdForUser,
  upsertMessage,
  updateActiveStreamId,
  type ChatMessageRow,
} from "~/lib/database/chat/chat-session";

interface ChatRequestBody {
  sessionId?: string;
  bookId?: string;
  message?: UIMessage;
  visibleText?: string;
  currentChapterIndex?: number;
}

interface SystemPromptContext {
  title: string;
  author: string;
  chapters: BookChapter[];
  currentChapterIndex?: number;
  visibleText?: string;
}

const CURRENT_CHAPTER_CONTEXT_CHARS = 8000;
const VISIBLE_PAGE_CONTEXT_CHARS = 2000;

function truncateContext(text: string, limit: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, limit)}\n[truncated — text continues]`;
}

function hasLogicalChapterShape(chapters: unknown): chapters is BookChapter[] {
  return (
    Array.isArray(chapters) &&
    chapters.every(
      (chapter) =>
        chapter &&
        typeof chapter === "object" &&
        typeof (chapter as BookChapter).index === "number" &&
        typeof (chapter as BookChapter).title === "string" &&
        typeof (chapter as BookChapter).text === "string" &&
        typeof (chapter as BookChapter).spineStart === "number" &&
        typeof (chapter as BookChapter).spineEnd === "number",
    )
  );
}

function buildSystemPrompt(bookContext: SystemPromptContext): string {
  const toc = bookContext.chapters.map((c) => `  ${c.index}. ${c.title}`).join("\n");

  let currentChapterSection = "";

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

Logical chapter text:
---
${chapter ? truncateContext(chapter.text, CURRENT_CHAPTER_CONTEXT_CHARS) : "(unable to identify logical chapter text)"}
---

Here is what they are currently looking at:
---
${pageText ? truncateContext(pageText, VISIBLE_PAGE_CONTEXT_CHARS) : "(unable to extract page text)"}
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
- You can read and edit the reader's personal notebook using read_notes, append_to_notes, and edit_notes.
- When the reader asks you to "save this", "note that", or "add to my notes", use append_to_notes for quick additions.
- When the reader asks to reorganize, restructure, replace sections, delete content, or rewrite their notes, use edit_notes. This gives you a \`notebook\` object with methods like find(), replace(), remove(), insertAfter(), etc. To edit individual list items, use find({ type: "listItem" }) to target them directly instead of rewriting the entire list.
- When they ask about their notes or want you to reference what they've written, use read_notes first.
- When you find a passage that is particularly important, beautiful, or relevant to the reader's question, proactively highlight it using create_highlight. Include a brief note explaining why it's significant.
- When the reader asks for recommendations, related reading, or "what else should I read", use BOTH search tools together as described in "Going deeper" below.

## Going deeper — recommendations and related reading
When the reader asks for recommendations, related reading, essays, podcasts, or asks "what else should I read after this?" or wants to "go deeper" on a topic, use BOTH search tools together:

1. **Web search** — search for modern books, essays, articles, podcasts, and author interviews related to the topic. Always include clickable links. Prefer high-quality sources (literary reviews, academic essays, well-known podcasts, author sites).
2. **search_standard_ebooks** — search ONCE for free public domain books on Standard Ebooks. Use a single well-chosen query — do NOT call this tool multiple times. Results are displayed as interactive cards automatically.

Standard Ebooks results are automatically displayed as rich interactive cards below your response — do NOT format them as code blocks or lists. Simply mention them by name in your prose (e.g. "You might enjoy *Walden* by Thoreau, which is available on Standard Ebooks") and let the card UI handle the visual presentation.

Present your response as a mix: lead with a brief thematic introduction connecting the recommendations to the current book, then weave in modern resources (with links) alongside natural mentions of any relevant Standard Ebooks titles. Group them naturally by theme rather than separating by source.

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

function rowToUIMessage(row: ChatMessageRow): UIMessage {
  const parts = row.parts as UIMessage["parts"] | null;
  if (parts && Array.isArray(parts) && parts.length > 0) {
    return {
      id: row.id,
      role: row.role as UIMessage["role"],
      parts,
    };
  }
  return {
    id: row.id,
    role: row.role as UIMessage["role"],
    parts: [{ type: "text", text: row.content ?? "" }],
  };
}

function extractTextContent(message: UIMessage): string {
  return (
    message.parts
      ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("") ?? ""
  );
}

export async function action({ request }: Route.ActionArgs) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  // Require authentication before processing chat requests
  const authSession = await getSessionFromRequest(request);
  if (!authSession) {
    return Response.json({ error: "auth_required" }, { status: 401 });
  }
  const { userId } = authSession;

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId, bookId, message, visibleText, currentChapterIndex } = body;

  if (!sessionId || typeof sessionId !== "string") {
    return Response.json({ error: "sessionId is required" }, { status: 400 });
  }
  if (!bookId || typeof bookId !== "string") {
    return Response.json({ error: "bookId is required" }, { status: 400 });
  }
  if (!message || typeof message !== "object" || !message.id || message.role !== "user") {
    return Response.json({ error: "message with role='user' is required" }, { status: 400 });
  }

  const book = await getBookByIdForUser(bookId, userId);
  if (!book) {
    return Response.json({ error: "Book not found" }, { status: 404 });
  }

  // Verify the session belongs to this user before loading its history or
  // persisting new messages to it — otherwise an authed user could leak/inject
  // into another user's session by passing its id.
  const session = await getSessionByIdForUser(sessionId, userId);
  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  const chaptersRow = await getBookChaptersForUser(userId, bookId);
  if (!chaptersRow) {
    return Response.json(
      {
        error:
          "Book chapters not uploaded. Upload via POST /api/books/:bookId/chapters before starting a chat.",
      },
      { status: 400 },
    );
  }
  if (!hasLogicalChapterShape(chaptersRow.chapters)) {
    return Response.json(
      {
        error:
          "Book chapters cache is stale. Reopen the book to upload logical chapter ranges before starting a chat.",
      },
      { status: 400 },
    );
  }
  const chapters = chaptersRow.chapters;

  const priorRows = await getMessagesBySession(sessionId);
  const priorMessages: UIMessage[] = priorRows.map(rowToUIMessage);

  const originalMessages: UIMessage[] = [...priorMessages, message];

  // Persist the user message before streaming so it survives if the stream crashes.
  await upsertMessage({
    id: message.id,
    sessionId,
    role: message.role,
    content: extractTextContent(message),
    parts: message.parts ?? null,
    createdAt: new Date(),
  });

  const bookIndex = getOrBuildBookIndex(chapters);

  const systemPromptContext: SystemPromptContext = {
    title: book.title ?? "Untitled",
    author: book.author ?? "Unknown",
    chapters,
    currentChapterIndex,
    visibleText,
  };

  const uiStream = createUIMessageStream<UIMessage>({
    originalMessages,
    execute: async ({ writer }) => {
      const result = streamText({
        model: gateway("anthropic/claude-sonnet-4.6"),
        system: buildSystemPrompt(systemPromptContext),
        messages: await convertToModelMessages(originalMessages),
        tools: {
          web_search: anthropic.tools.webSearch_20250305(),
          search_book: tool({
            description:
              "Search the book for passages matching a query. Uses fuzzy, typo-tolerant full-text search to find relevant excerpts across all chapters. Use this to find specific quotes, topics, characters, or themes — even with approximate or misspelled terms.",
            inputSchema: z.object({
              query: z.string().describe("Text, keywords, or phrase to search for in the book"),
            }),
            execute: async ({ query }) => {
              return searchBook(bookIndex, query);
            },
          }),
          read_notes: tool({
            description:
              "Read the reader's personal notes and annotations for this book. Returns their notebook content as markdown.",
            inputSchema: z.object({}),
            execute: async () => {
              const content = await getNotebookMarkdownForUser(userId, bookId);
              return { content: content || "(No notes yet)" };
            },
          }),
          append_to_notes: tool({
            description:
              "Add a note to the reader's notebook for this book. Use when they ask to save something, bookmark a passage, or jot down a thought. The text is appended to their existing notes.",
            inputSchema: z.object({
              text: z.string().describe("The text to add (markdown format)"),
            }),
            execute: async ({ text }) => {
              const parsed = markdownToTiptapJsonServer(text);
              const appendedNodes = (parsed.content ?? []) as JSONContent[];

              if (appendedNodes.length === 0) {
                return { appended: false, text, appendedNodes: [] };
              }

              const existing = await getNotebookForUser(userId, bookId);
              const existingDoc = (existing?.content as JSONContent | null | undefined) ?? null;
              const existingNodes = existingDoc?.content ?? [];

              const updatedContent: JSONContent = {
                type: "doc",
                content: [...existingNodes, ...appendedNodes],
              };

              const now = new Date();
              let updatedAtMs = now.getTime();
              try {
                const row = await upsertNotebook(userId, bookId, updatedContent, now);
                if (row) updatedAtMs = row.updatedAt.getTime();
              } catch (err) {
                console.error("append_to_notes: failed to persist notebook:", err);
                return {
                  appended: false,
                  text,
                  appendedNodes: [],
                  error: err instanceof Error ? err.message : String(err),
                };
              }

              return {
                appended: true,
                text,
                appendedNodes,
                updatedContent,
                updatedAt: updatedAtMs,
              };
            },
          }),
          edit_notes: tool({
            description:
              "Edit the reader's notebook using JavaScript code. Use this for block-targeted edits: changing a specific paragraph or list item, removing a block, inserting around a block, or restructuring a section. The code runs against a `notebook` object. ALWAYS call read_notes first to see the current content. PREFER block-targeted operations (find → setText/replace/remove/insertAfter/insertBefore). DO NOT reassemble the whole notebook from scratch — there is no whole-document replace method, and the server rejects scripts that reduce the notebook to near-empty. If the user explicitly asks to reset their notebook, call remove() on each block in a loop.",
            inputSchema: z.object({
              code: z
                .string()
                .describe(
                  "JavaScript code that uses the `notebook` object to edit notes. Available methods: " +
                    "notebook.getMarkdown() — current notes as markdown; " +
                    "notebook.getBlocks() — all blocks as structured objects; " +
                    "notebook.find(query) — locate blocks to edit (accepts a string for plain-text search — links show as their display text, not markdown syntax — or an object { type?: 'heading'|'paragraph'|'bulletList'|'orderedList'|'blockquote'|'codeBlock'|'listItem', text?: string }); " +
                    "notebook.setText(block, text) → boolean — PREFERRED for 'change the text of this block'. Preserves heading level, list-item structure, code-block language, etc. Use this to rename headings, fix typos, or reword existing blocks. `text` is inserted verbatim as plain text — do NOT include markdown markers like '#' or '*'; " +
                    "notebook.replace(block, markdown) → boolean — replaces the entire block with newly-parsed markdown. Use when you want to change the block's TYPE (e.g. a paragraph becomes a bulleted list) or insert multiple blocks in place of one; " +
                    "notebook.remove(block) → boolean — delete a single block; " +
                    "notebook.insertAfter(block, markdown) — insert new content after a block; " +
                    "notebook.insertBefore(block, markdown) — insert new content before a block; " +
                    "notebook.append(markdown) — add new content at the END of the notebook; does NOT touch existing content; " +
                    "notebook.prepend(markdown) — add new content at the START of the notebook; does NOT touch existing content. " +
                    "`find` returns Block objects with { type, text, level?, index, parentIndex?, depth? }. Use type 'listItem' to target individual list items at ANY nesting level. Each listItem has a `depth` field (0 = top-level, 1 = first sub-level, etc.) and `text` contains only the item's direct content (not nested sub-items). setText(), replace() and remove() return true if the block was found and modified, false otherwise. " +
                    "Example — rename a heading (keeps it a heading): const h = notebook.find({ type: 'heading', text: 'Intro' })[0]; if (h) notebook.setText(h, 'Introduction'); " +
                    "Example — fix a typo in a paragraph: const p = notebook.find('teh quick')[0]; if (p) notebook.setText(p, p.text.replace('teh', 'the')); " +
                    "Example — change a paragraph into a bullet list (structural change): const p = notebook.find('items:')[0]; if (p) notebook.replace(p, '- a\\n- b\\n- c'); " +
                    "Example — remove a block: const b = notebook.find({ text: 'obsolete' })[0]; if (b) notebook.remove(b); " +
                    "There is NO whole-document replace method. Do NOT rebuild the entire notebook in a single call — the server will reject scripts that reduce the notebook to near-empty.",
                ),
            }),
            execute: async ({ code }) => {
              const existing = await getNotebookForUser(userId, bookId);
              const currentContent: JSONContent = (existing?.content as
                | JSONContent
                | null
                | undefined) ?? {
                type: "doc",
                content: [],
              };

              const result = await runEditNotesInSandbox(currentContent, code, {
                timeoutMs: 1500,
              });
              if (!result.ok) {
                return { executed: false, error: result.error };
              }

              let row: Awaited<ReturnType<typeof upsertNotebook>>;
              try {
                row = await upsertNotebook(userId, bookId, result.updatedContent, new Date());
              } catch (err) {
                console.error("edit_notes: failed to persist updated notebook:", err);
                return {
                  executed: false,
                  error: err instanceof Error ? err.message : String(err),
                };
              }

              // LWW-filtered: server already has a newer notebook row. Do NOT
              // fabricate a timestamp — mirror the server-authoritative model
              // and surface the conflict so the client skips its cache write.
              if (!row) {
                console.warn(
                  "edit_notes: upsertNotebook returned null (LWW filtered); skipping client cache update",
                );
                return {
                  executed: false,
                  error: "edit_notes: server already has a newer notebook; ignoring this edit",
                };
              }

              return {
                executed: true,
                updatedContent: result.updatedContent,
                updatedAt: row.updatedAt.getTime(),
              };
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
              // PDF is not supported server-side yet — client falls back to
              // its own PDF search + persist path on unsupported responses.
              if (book.format === "pdf") {
                return { created: false, unsupported: "pdf", text, note: note ?? null };
              }

              const anchor = locateTextAnchor(chapters, bookIndex, text);
              if (!anchor) {
                return { created: false, error: "not_found", text, note: note ?? null };
              }

              const id = generateId();
              const createdAt = new Date();
              const color = "rgba(255, 213, 79, 0.4)";
              try {
                await upsertHighlight(userId, {
                  id,
                  bookId,
                  cfiRange: null,
                  text,
                  color,
                  textAnchor: anchor,
                  note: note ?? null,
                  createdAt,
                });
              } catch (err) {
                console.error("create_highlight: failed to persist:", err);
                return { created: false, error: "persist_failed", text, note: note ?? null };
              }

              return {
                created: true,
                highlight: {
                  id,
                  bookId,
                  text,
                  note: note ?? null,
                  color,
                  textAnchor: anchor,
                  createdAt: createdAt.getTime(),
                },
              };
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
                chapter = chapters.find((c) => c.index === chapterIndex);
              } else if (chapterTitle) {
                const lower = chapterTitle.toLowerCase();
                chapter = chapters.find((c) => c.title.toLowerCase().includes(lower));
              }
              if (!chapter) return { error: "Chapter not found" };
              const text =
                chapter.text.length > 15000
                  ? chapter.text.slice(0, 15000) + "\n[truncated — chapter continues]"
                  : chapter.text;
              return { chapterIndex: chapter.index, title: chapter.title, text };
            },
          }),
          search_standard_ebooks: tool({
            description:
              "Search Standard Ebooks for free, beautifully formatted public domain books. Use this when the reader asks for similar books, recommendations, or wants to find other works by the same author or in a similar genre. Returns structured results the reader can browse and import.",
            inputSchema: z.object({
              query: z
                .string()
                .describe(
                  "Search query — author name, book title, genre, or keywords (e.g. 'Jane Austen', 'science fiction', 'philosophy')",
                ),
            }),
            execute: async ({ query }) => {
              const params = new URLSearchParams({
                query,
                "per-page": "6",
                page: "1",
              });
              const res = await fetch(`${SE_BASE}/ebooks?${params.toString()}`);
              if (!res.ok) {
                return { error: `Standard Ebooks returned ${res.status}` };
              }
              const html = await res.text();
              const data = parseSearchHtml(html, 1);
              const books = data.books
                .filter((b) => b.urlPath && b.title && b.urlPath.startsWith("/ebooks/"))
                .filter((b) => b.title.toLowerCase() !== systemPromptContext.title.toLowerCase())
                .slice(0, 4)
                .map((b) => ({
                  title: b.title,
                  author: b.author,
                  coverUrl: b.coverUrl,
                  urlPath: b.urlPath,
                  url: `${SE_BASE}${b.urlPath}`,
                }));
              return { books, totalResults: data.totalPages * 12 };
            },
          }),
        },
        stopWhen: stepCountIs(5),
      });

      writer.merge(
        result.toUIMessageStream<UIMessage>({
          generateMessageId: generateId,
          onFinish: async ({ responseMessage }) => {
            try {
              await upsertMessage({
                id: responseMessage.id,
                sessionId,
                role: responseMessage.role,
                content: extractTextContent(responseMessage),
                parts: responseMessage.parts ?? null,
                createdAt: new Date(),
              });
            } catch (err) {
              console.error("Failed to persist assistant message:", err);
            }
            try {
              await updateActiveStreamId(userId, sessionId, null);
            } catch (err) {
              console.error("Failed to clear active_stream_id:", err);
            }
          },
        }),
      );
    },
  });

  const streamContext = createResumableStreamContext({ waitUntil });

  return createUIMessageStreamResponse({
    stream: uiStream,
    async consumeSseStream({ stream }) {
      const streamId = generateId();
      try {
        await streamContext.createNewResumableStream(streamId, () => stream);
        await updateActiveStreamId(userId, sessionId, streamId);
      } catch (err) {
        console.error("Failed to create resumable stream:", err);
      }
    },
  });
}
