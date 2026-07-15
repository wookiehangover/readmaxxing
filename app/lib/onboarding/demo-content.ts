import type { JSONContent } from "@tiptap/react";
import type { BookMeta } from "~/lib/stores/book-store";
import type { ChatSession } from "~/lib/stores/chat-store";
import type { PositionRecord } from "~/lib/stores/position-store";

interface DemoBookConfig {
  readonly bookId: string;
  readonly metadata: Omit<BookMeta, "id">;
  readonly epubPath: string;
  readonly positionCfi: PositionRecord["cfi"];
  readonly notebookContent: JSONContent;
  readonly introQuestion: string;
  readonly suggestedQuestions: readonly [string, string, string];
}

export const DEFAULT_DEMO_BOOK = {
  bookId: "af6bcb3e-6cb8-4c64-8e4d-9d65b1ec19d1",
  metadata: {
    title: "The Great Gatsby",
    author: "F. Scott Fitzgerald",
    coverImage: null,
    format: "epub",
    hasLocalFile: true,
  },
  epubPath: "/demo/the-great-gatsby.epub",
  /** Chapter 1, at Nick's opening reflection on his father's advice. */
  positionCfi: "epubcfi(/6/12!/4/4/2[chapter-1]/4/1:0[,In my yo])",
  notebookContent: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Reading notes: The Great Gatsby" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Fitzgerald keeps desire at a distance. Gatsby can see the green light, but crossing the bay would destroy the dream that gives it power. The symbol feels hopeful and ominous at once: longing creates his future while preventing him from inhabiting the present.",
          },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Nick calls himself tolerant and honest, yet he edits, judges, and aestheticizes everyone around him. His restraint may be another performance.",
                  },
                ],
              },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "The parties turn people into motion, colour, rumour, and appetite. Their abundance feels strangely lonely because almost nobody knows the host.",
                  },
                ],
              },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Gatsby's untouched library and carefully rehearsed phrases suggest that authenticity matters less here than making an illusion materially convincing.",
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Watch how Nick's attraction to Gatsby changes the moral vocabulary of the narration: criticism gradually gives way to wonder, even when the evidence grows darker.",
          },
        ],
      },
    ],
  } satisfies JSONContent,
  introQuestion: "What can Readmaxxing do?",
  suggestedQuestions: [
    "How does Nick's claim that he reserves judgment shape how we read Chapter 1?",
    'What does Daisy mean when she hopes her daughter will be a "beautiful little fool"?',
    "Why does Gatsby reach toward the green light at the end of Chapter 1?",
  ],
} satisfies DemoBookConfig;

export const DEMO_BOOK_ID = DEFAULT_DEMO_BOOK.bookId;
export const DEMO_BOOK_METADATA = {
  ...DEFAULT_DEMO_BOOK.metadata,
  id: DEFAULT_DEMO_BOOK.bookId,
} satisfies BookMeta;
export const DEMO_EPUB_PATH = DEFAULT_DEMO_BOOK.epubPath;
export const DEMO_POSITION_CFI = DEFAULT_DEMO_BOOK.positionCfi;
export const DEMO_NOTEBOOK_CONTENT = DEFAULT_DEMO_BOOK.notebookContent;
export const DEMO_INTRO_QUESTION = DEFAULT_DEMO_BOOK.introQuestion;
export const DEMO_SUGGESTED_QUESTIONS = DEFAULT_DEMO_BOOK.suggestedQuestions;

export const DEMO_CAPABILITIES_ANSWER = `Readmaxxing brings reading, questions, and notes together in one workspace. You can:

- **Read EPUBs and PDFs** with your place kept as you move through the book.
- **Ask questions in chat** grounded in the text you are reading.
- **Take notes and highlight passages** without leaving your reading workspace.
- **Click a suggested question** whenever you want a useful next step.
- **Arrange reading, notes, and chat together** in the layout that works for you.

Explore the demo by reading and choosing one of the suggestions below. Sign in to continue chatting and to save your library, notes, highlights, and reading progress across devices.`;

const DEMO_CHAT_STARTED_AT = Date.UTC(2025, 3, 10, 20, 0, 0);

export const DEMO_CHAT_SESSION = {
  id: "39e8921b-1341-49c1-9ef8-0f03e8a36571",
  bookId: DEMO_BOOK_ID,
  title: "",
  messages: [],
  createdAt: DEMO_CHAT_STARTED_AT,
  updatedAt: DEMO_CHAT_STARTED_AT,
} satisfies ChatSession;
