import { useCallback } from "react";
import { Button } from "~/components/ui/button";
import { SendHorizonal, Loader2 } from "lucide-react";
import { cn } from "~/lib/utils";

export function ChatInput({
  textareaRef,
  inputRef,
  isLoading,
  onSubmit,
  onStop,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  inputRef: React.MutableRefObject<string>;
  isLoading: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onStop: () => void;
}) {
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const form = e.currentTarget.form;
      form?.requestSubmit();
    }
  }, []);

  return (
    <form onSubmit={onSubmit} className="px-4 py-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          className={cn(
            "flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm",
            "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "field-sizing-content max-h-[6lh] min-h-10",
          )}
          placeholder="Ask about this book…"
          onChange={(e) => {
            inputRef.current = e.target.value;
          }}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          rows={1}
        />
        {isLoading ? (
          <Button type="button" variant="ghost" size="icon" onClick={onStop} title="Stop">
            <Loader2 className="size-4 animate-spin" />
            <span className="sr-only">Stop</span>
          </Button>
        ) : (
          <Button type="submit" size="icon" title="Send">
            <SendHorizonal className="size-4" />
            <span className="sr-only">Send</span>
          </Button>
        )}
      </div>
    </form>
  );
}
