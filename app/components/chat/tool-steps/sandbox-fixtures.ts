import { useEffect, useMemo, useState } from "react";

const MOBY = "book-moby";
const FRANK = "book-frank";

export const SANDBOX_BOOKS: Record<string, string> = {
  [MOBY]: "Moby-Dick",
  [FRANK]: "Frankenstein",
};

const done = (tool: string, input: object, output: object, id: string) => ({
  type: `tool-${tool}`,
  toolCallId: id,
  state: "output-available",
  input,
  output,
});

const text = (value: string) => ({ type: "text", text: value });

export interface SandboxScenario {
  id: string;
  label: string;
  question: string;
  multiBook?: boolean;
  parts: any[];
}

export const SANDBOX_SCENARIOS: SandboxScenario[] = [
  {
    id: "simple",
    label: "One search",
    question: "Where does Ishmael first meet Queequeg?",
    parts: [
      done(
        "search_book",
        { query: "Queequeg harpooneer bed" },
        {
          bookId: MOBY,
          results: [
            {
              chapterIndex: 2,
              chapterTitle: "The Spouter-Inn",
              excerpt: "…the landlord told me the harpooneer was a dark complexioned chap…",
            },
            {
              chapterIndex: 3,
              chapterTitle: "The Counterpane",
              excerpt:
                "Upon waking next morning about daylight, I found Queequeg’s arm thrown over me…",
            },
          ],
        },
        "s1",
      ),
      text(
        "They meet at the **Spouter-Inn** in New Bedford. The inn is full, so the landlord makes Ishmael share a bed with an absent harpooneer — who turns out to be Queequeg, returning late from selling shrunken heads.",
      ),
    ],
  },
  {
    id: "research",
    label: "Research",
    question: "Why is Ahab so fixated on the whale’s whiteness?",
    parts: [
      {
        type: "reasoning",
        text: "Ishmael’s chapter on whiteness is the key text; Ahab’s view is in the quarter-deck scene.",
      },
      done(
        "search_book",
        { query: "whiteness of the whale" },
        {
          bookId: MOBY,
          results: [
            {
              chapterIndex: 41,
              chapterTitle: "The Whiteness of the Whale",
              excerpt: "It was the whiteness of the whale that above all things appalled me.",
            },
            {
              chapterIndex: 41,
              chapterTitle: "The Whiteness of the Whale",
              excerpt: "…is it that by its indefiniteness it shadows forth the heartless voids…",
            },
            {
              chapterIndex: 135,
              chapterTitle: "The Chase—Third Day",
              excerpt: "…the white whale churning himself into furious speed…",
            },
          ],
        },
        "r1",
      ),
      done(
        "search_book",
        { query: "pasteboard masks" },
        {
          bookId: MOBY,
          results: [
            {
              chapterIndex: 35,
              chapterTitle: "The Quarter-Deck",
              excerpt: "All visible objects, man, are but as pasteboard masks.",
            },
          ],
        },
        "r2",
      ),
      done(
        "read_chapter",
        { chapterIndex: 41 },
        { chapterIndex: 41, title: "The Whiteness of the Whale", text: "x".repeat(14200) },
        "r3",
      ),
      text(
        "Ahab and Ishmael read the whiteness differently. For Ahab, Moby Dick is a **mask** — something to strike through to reach whatever hides behind the visible world.",
      ),
      done(
        "create_highlight",
        { text: "All visible objects, man, are but as pasteboard masks.", chapterIndex: 35 },
        { executed: true },
        "r4",
      ),
      text(
        "Ishmael fears the opposite: that white is not a mask but an absence — “the heartless voids and immensities of the universe.” Ahab’s rage needs a target; whiteness threatens that there is none.",
      ),
    ],
  },
  {
    id: "notebook",
    label: "Notebook + error",
    question: "Save the mask quote to my notes and tidy the Starbuck section.",
    parts: [
      done("read_notes", {}, { bookId: MOBY, content: "## Starbuck\n- cautious\n" }, "n1"),
      done(
        "list_highlights",
        {},
        { bookId: MOBY, highlights: [{ id: "h1" }, { id: "h2" }, { id: "h3" }] },
        "n2",
      ),
      done(
        "append_to_notes",
        { text: "> All visible objects, man, are but as pasteboard masks." },
        { executed: true },
        "n3",
      ),
      done(
        "edit_notes",
        { find: "## Starbuck", replace: "## Starbuck (first mate)" },
        { executed: false, error: "Notebook changed since it was read" },
        "n4",
      ),
      text(
        "I added the quote to your notebook. I couldn’t tidy the Starbuck section because the notebook changed while I was working — try again and I’ll re-read it first.",
      ),
    ],
  },
  {
    id: "multi",
    label: "Two books",
    question: "Compare how Ahab and Victor pursue what destroys them.",
    multiBook: true,
    parts: [
      done(
        "search_book",
        { query: "pursuit vengeance", bookId: MOBY },
        {
          bookId: MOBY,
          results: [
            {
              chapterIndex: 35,
              chapterTitle: "The Quarter-Deck",
              excerpt: "…I’d strike the sun if it insulted me.",
            },
          ],
        },
        "m1",
      ),
      done(
        "search_book",
        { query: "pursuit vengeance", bookId: FRANK },
        {
          bookId: FRANK,
          results: [
            {
              chapterIndex: 23,
              chapterTitle: "Chapter 24",
              excerpt: "…I pursued him, and for many months this has been my task.",
            },
          ],
        },
        "m2",
      ),
      done(
        "read_chapter",
        { chapterIndex: 23, bookId: FRANK },
        { chapterIndex: 23, title: "Chapter 24", text: "x".repeat(9000) },
        "m3",
      ),
      text(
        "Both men end at the edge of the world chasing a creature they half made. Ahab chases across oceans; Victor across ice. The difference is guilt: Victor knows he made his monster, while Ahab insists his was sent.",
      ),
    ],
  },
];

type Frame = any[];

function buildFrames(parts: any[]): Frame[] {
  const frames: Frame[] = [[]];
  const settled: any[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      const words = part.text.split(" ");
      const step = Math.max(4, Math.ceil(words.length / 6));
      for (let i = step; i < words.length + step; i += step) {
        frames.push([...settled, { ...part, text: words.slice(0, i).join(" ") }]);
      }
    } else if (part.type === "reasoning") {
      frames.push([...settled, part]);
    } else {
      frames.push([...settled, { ...part, state: "input-available", output: undefined }]);
      frames.push([...settled, { ...part, state: "input-available", output: undefined }]);
    }
    settled.push(part);
    frames.push([...settled]);
  }
  return frames;
}

/** Replays a scenario's parts the way the AI SDK streams them. */
export function useReplay(parts: any[], runId: number) {
  const frames = useMemo(() => buildFrames(parts), [parts]);
  const [index, setIndex] = useState(frames.length - 1);

  useEffect(() => {
    if (runId === 0) {
      setIndex(frames.length - 1);
      return;
    }
    setIndex(0);
    const timer = setInterval(() => {
      setIndex((i) => {
        if (i >= frames.length - 1) {
          clearInterval(timer);
          return i;
        }
        return i + 1;
      });
    }, 380);
    return () => clearInterval(timer);
  }, [frames, runId]);

  const at = Math.min(index, frames.length - 1);
  return {
    parts: frames[at],
    isStreaming: at < frames.length - 1,
  };
}
