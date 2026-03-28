import { useEffect, useRef, type KeyboardEvent } from "react";
import { Search, ChevronUp, ChevronDown, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

interface SearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  resultCount: number;
  currentIndex: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export function SearchBar({
  query,
  onQueryChange,
  resultCount,
  currentIndex,
  onNext,
  onPrev,
  onClose,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        onPrev();
      } else {
        onNext();
      }
    }
  }

  const hasResults = resultCount > 0;
  const hasQuery = query.length > 0;

  return (
    <div className="flex items-center gap-1.5 border-b bg-background px-2 h-10">
      <Search className="size-4 shrink-0 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search in book…"
        className="h-7 flex-1 border-none bg-transparent px-1 shadow-none focus-visible:border-transparent focus-visible:ring-0 focus-visible:ring-transparent"
      />
      {hasQuery && (
        <span
          className={cn("shrink-0 text-xs tabular-nums text-muted-foreground", {
            "text-destructive": !hasResults,
          })}
        >
          {hasResults ? `${currentIndex + 1} of ${resultCount}` : "No results"}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onPrev}
        disabled={!hasResults}
        title="Previous result (Shift+Enter)"
      >
        <ChevronUp data-icon="inline-start" />
        <span className="sr-only">Previous result</span>
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onNext}
        disabled={!hasResults}
        title="Next result (Enter)"
      >
        <ChevronDown data-icon="inline-start" />
        <span className="sr-only">Next result</span>
      </Button>
      <Button variant="ghost" size="icon-xs" onClick={onClose} title="Close search (Escape)">
        <X data-icon="inline-start" />
        <span className="sr-only">Close search</span>
      </Button>
    </div>
  );
}
