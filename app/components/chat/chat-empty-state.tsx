import { SendHorizonalIcon } from "lucide-react";
import { Fragment, useCallback, useRef, useState } from "react";
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
    <div className="mt-4 flex flex-wrap gap-2 px-5 pb-2">
      {prompts.map((prompt) => (
        <button
          key={prompt}
          type="button"
          className={cn(
            "text-xs text-muted-foreground text-left",
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
 * Builds an italicized, naturally-joined list of book titles for the empty-state
 * header (e.g. "*A*", "*A* and *B*", "*A*, *B*, and *C*").
 */
function TitleList({ titles }: { titles: string[] }) {
  return (
    <>
      {titles.map((title, i) => {
        let separator = "";
        if (i > 0) {
          if (titles.length === 2) separator = " and ";
          else if (i === titles.length - 1) separator = ", and ";
          else separator = ", ";
        }
        return (
          <Fragment key={title}>
            {separator}
            <span className="italic">{title}</span>
          </Fragment>
        );
      })}
    </>
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
  bookTitles,
  sendMessage,
}: {
  bookTitles: string[];
  sendMessage: (message: { text: string }) => void;
}) {
  const categories =
    bookTitles.length >= 2
      ? [crossBookCategory(bookTitles), ...SUGGESTION_CATEGORIES]
      : SUGGESTION_CATEGORIES;

  const containerRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  const moveIconTo = useCallback((target: HTMLElement) => {
    const container = containerRef.current;
    const icon = iconRef.current;
    if (!container || !icon) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const left = targetRect.left - containerRect.left;
    const centerY = targetRect.top - containerRect.top + targetRect.height / 2;
    icon.style.transform = `translate(calc(${left}px - 100% - 0.375rem), calc(${centerY}px - 50%))`;
    setActive(true);
  }, []);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-2">
      <p className="max-w-sm w-full text-sm text-muted-foreground">
        Discuss <TitleList titles={bookTitles} />
      </p>
      <div
        ref={containerRef}
        className="flex w-full max-w-sm flex-col gap-4 relative suggested-questions"
        onPointerLeave={() => setActive(false)}
      >
        {categories.map((category) => (
          <div key={category.label} className="flex flex-col gap-1.5">
            <span className="text-xs tracking-wide text-muted-foreground">{category.label}</span>
            <div className="flex flex-wrap gap-1.5 text-sm text-foreground">
              {category.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className={cn(
                    "suggestion-item",
                    // "transition-colors hover:bg-accent hover:text-accent-foreground",
                    "cursor-pointer text-left",
                  )}
                  onPointerEnter={(e) => moveIconTo(e.currentTarget)}
                  onFocus={(e) => moveIconTo(e.currentTarget)}
                  onClick={() => sendMessage({ text: suggestion })}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div
          ref={iconRef}
          aria-hidden
          className={cn("next-suggestion", { "next-suggestion-active": active })}
        >
          <SendHorizonalIcon className="size-4 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}
