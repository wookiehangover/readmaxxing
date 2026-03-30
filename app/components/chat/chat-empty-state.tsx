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

export function ChatEmptyState({
  bookTitle,
  sendMessage,
}: {
  bookTitle: string;
  sendMessage: (message: { text: string }) => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-2">
      <p className="text-center text-sm text-muted-foreground">
        Ask about <span className="italic">{bookTitle}</span>
      </p>
      <div className="flex w-full max-w-sm flex-col gap-4">
        {SUGGESTION_CATEGORIES.map((category) => (
          <div key={category.label} className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {category.label}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {category.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm text-foreground",
                    "transition-colors hover:bg-accent hover:text-accent-foreground",
                    "cursor-pointer",
                  )}
                  onClick={() => sendMessage({ text: suggestion })}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
