import type { JSONContent } from "@tiptap/react";
import type { BookMeta } from "~/lib/stores/book-store";
import type { ChatSession } from "~/lib/stores/chat-store";
import type { PositionRecord } from "~/lib/stores/position-store";

export const DEMO_BOOK_ID = "af6bcb3e-6cb8-4c64-8e4d-9d65b1ec19d1";

export const DEMO_BOOK_METADATA = {
  id: DEMO_BOOK_ID,
  title: "The Great Gatsby",
  author: "F. Scott Fitzgerald",
  coverImage: null,
  format: "epub",
  hasLocalFile: true,
} satisfies BookMeta;

/** Chapter 3, as Nick sits with Jordan shortly before Gatsby introduces himself. */
export const DEMO_POSITION_CFI: PositionRecord["cfi"] =
  "epubcfi(/6/16!/4/4/2[chapter-3]/122/1:31[ Baker. ,We were ])";

export const DEMO_NOTEBOOK_CONTENT = {
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
} satisfies JSONContent;

const DEMO_CHAT_STARTED_AT = Date.UTC(2025, 3, 10, 20, 0, 0);

export const DEMO_CHAT_SESSION = {
  id: "39e8921b-1341-49c1-9ef8-0f03e8a36571",
  bookId: DEMO_BOOK_ID,
  title: "Can we trust Nick Carraway?",
  messages: [
    {
      id: "bc1d728b-e919-47bc-a244-82ff5c826ded",
      role: "user",
      content: "Is Nick an unreliable narrator, or is he just unusually self-aware?",
      createdAt: DEMO_CHAT_STARTED_AT,
    },
    {
      id: "ee349d98-f6f6-4d23-bdda-d9bd955ed644",
      role: "assistant",
      content:
        'He is self-aware enough to sound trustworthy, but the novel keeps exposing gaps between his principles and his behavior. He opens by claiming he is "inclined to reserve all judgments," then fills his account with sharp judgments of Tom, Jordan, the party guests, and even Gatsby. His closing claim that he is "one of the few honest people" he has known is also self-certification, not independent evidence. That does not make his report false; it makes it selective. Nick turns memory into a moral story, and his growing affection for Gatsby shapes which contradictions receive sympathy.',
      createdAt: DEMO_CHAT_STARTED_AT + 60_000,
    },
    {
      id: "b772cc3a-df23-4be4-afaa-12357f7e6c8e",
      role: "user",
      content: "Does the Chapter 3 party change how we should read him?",
      createdAt: DEMO_CHAT_STARTED_AT + 120_000,
    },
    {
      id: "630ac28e-2e69-47b3-ae70-75f68d8b222c",
      role: "assistant",
      content:
        'Yes. Nick first presents himself as an embarrassed outsider, but after two bowls of champagne he says the scene becomes "significant, elemental, and profound." The shift admits that mood and desire alter his perception. He also misrecognizes Gatsby until Gatsby introduces himself, despite spending the evening interpreting strangers and rumors. Chapter 3 therefore shows both his value and his limit: he notices revealing details, but he arranges them through fascination, alcohol, social anxiety, and hindsight. His narration is most useful when read as a beautifully shaped perspective rather than a neutral record.',
      createdAt: DEMO_CHAT_STARTED_AT + 180_000,
    },
  ],
  createdAt: DEMO_CHAT_STARTED_AT,
  updatedAt: DEMO_CHAT_STARTED_AT + 180_000,
} satisfies ChatSession;