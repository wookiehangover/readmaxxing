import { useEffect, useState } from "react";
import { Skeleton } from "~/components/ui/skeleton";
import { loadChapterQuestions } from "~/lib/chat/chapter-questions";
import { cn } from "~/lib/utils";

export const SUGGESTION_CATEGORIES = [
  {
    label: "Summarize & Explore",
    suggestions: [
      "What is this book about?",
      "Summarize the chapter I'm reading",
      "What are the key themes?",
    ],
  },
  {
    label: "Examine & Debate",
    suggestions: [
      "What's the strongest argument in this chapter?",
      "What would a critic say about this book's thesis?",
      "Give me a Straussian reading of this chapter",
    ],
  },
  {
    label: "Pull the Thread",
    suggestions: [
      "What ideas connect across multiple chapters?",
      "What would Tyler Cowen think about this?",
      "What else should I read after this?",
    ],
  },
];

export function SuggestedPrompts({
  prompts,
  sendMessage,
}: {
  prompts: string[];
  sendMessage: (message: { text: string }) => void;
}) {
  if (prompts.length === 0) return null;
  return (
    <div className="mt-6 flex flex-col flex-wrap gap-2.5 pb-2">
      {prompts.map((prompt) => (
        <button
          key={prompt}
          type="button"
          className={cn(
            "text-sm text-muted-foreground text-left",
            "hover:text-foreground transition-colors",
            "cursor-pointer",
          )}
          onClick={() => sendMessage({ text: prompt })}
        >
          → {prompt}
        </button>
      ))}
    </div>
  );
}

/**
 * Static cross-book starter prompts shown when 2+ books are selected. Titles are
 * interpolated where natural; no LLM call.
 */
function crossBookCategory(titles: string[]) {
  const [a, b] = titles;
  return {
    label: "Across These Books",
    suggestions: [
      "Compare how these books treat their central themes",
      `What do ${a} and ${b} disagree on?`,
      `What would the author of ${a} say about ${b}?`,
    ],
  };
}

export function ChatEmptyState({
  bookId,
  bookTitles,
  chapterIndex,
  sendMessage,
}: {
  bookId: string;
  bookTitles: string[];
  chapterIndex: number | undefined;
  sendMessage: (message: { text: string }) => void;
}) {
  const fallbackQuestions = SUGGESTION_CATEGORIES[2].suggestions;
  const [chapterQuestions, setChapterQuestions] = useState<
    { status: "loading" } | { status: "ready"; questions: readonly string[] }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    if (chapterIndex === undefined) {
      setChapterQuestions({ status: "ready", questions: fallbackQuestions });
      return;
    }

    setChapterQuestions({ status: "loading" });
    loadChapterQuestions(bookId, chapterIndex)
      .then((questions) => {
        if (!cancelled) setChapterQuestions({ status: "ready", questions });
      })
      .catch(() => {
        if (!cancelled) setChapterQuestions({ status: "ready", questions: fallbackQuestions });
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, chapterIndex, fallbackQuestions]);

  const categories =
    bookTitles.length >= 2
      ? [crossBookCategory(bookTitles), ...SUGGESTION_CATEGORIES.slice(0, 2)]
      : SUGGESTION_CATEGORIES.slice(0, 2);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex w-full flex-col gap-4">
        {categories.map((category) => (
          <div
            key={category.label}
            className="flex flex-col gap-1.5 animate-in fade-in slide-in-from-bottom-2 duration-300"
          >
            <span className="text-xs tracking-wide text-muted-foreground">{category.label}</span>
            <div className="flex flex-wrap gap-1.5 text-sm text-foreground">
              {category.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className={cn("cursor-pointer text-left", { "hover:underline": true })}
                  onClick={() => sendMessage({ text: suggestion })}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="flex flex-col gap-1.5 text-sm text-foreground animate-in fade-in slide-in-from-bottom-2 duration-300">
          <span className="text-xs tracking-wide text-muted-foreground">Dig deeper</span>
          {chapterQuestions.status === "loading"
            ? ["w-4/5", "w-3/4", "w-5/6"].map((width) => (
                <Skeleton key={width} className={cn("h-4", width)} />
              ))
            : chapterQuestions.questions.map((question) => (
                <button
                  key={question}
                  type="button"
                  className={cn("cursor-pointer text-left", { "hover:underline": true })}
                  onClick={() => sendMessage({ text: question })}
                >
                  {question}
                </button>
              ))}
        </div>
      </div>
    </div>
  );
}
