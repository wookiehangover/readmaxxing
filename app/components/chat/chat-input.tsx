import { useCallback, useRef } from "react";
import { Button } from "~/components/ui/button";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentTitle,
} from "~/components/ui/attachment";
import { Loader2, X, ForwardIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import type { ChatIntent } from "./chat-intent";

const HIGHLIGHT_PILL_PREVIEW_WORDS = 5;

export function ChatInput({
  textareaRef,
  inputRef,
  isLoading,
  onSubmit,
  onStop,
  highlightPill,
  onClearHighlightPill,
  bookTitle,
  onInteraction,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  inputRef: React.MutableRefObject<string>;
  isLoading: boolean;
  bookTitle: string;
  onSubmit: (e: React.FormEvent) => void;
  onStop: () => void;
  highlightPill?: { text: string; pageLabel: string };
  onClearHighlightPill?: () => void;
  onInteraction?: (intent: ChatIntent) => void;
}) {
  const highlightText = highlightPill?.text?.trim();
  const highlightPreview = highlightText
    ? (() => {
        const words = highlightText.split(/\s+/);
        const truncated =
          words.length > HIGHLIGHT_PILL_PREVIEW_WORDS
            ? `${words.slice(0, HIGHLIGHT_PILL_PREVIEW_WORDS).join(" ")}…`
            : highlightText;
        return highlightPill?.pageLabel ? `${highlightPill.pageLabel}: ${truncated}` : truncated;
      })()
    : null;

  // When gated, we passively open the onboarding dialog once on the first
  // focus/click so the user sees the CTA, then let subsequent focus and typing
  // flow through untouched. Submit always re-opens with the current text.
  const passiveOpenGuardRef = useRef(false);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const form = e.currentTarget.form;
      form?.requestSubmit();
    }
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      if (onInteraction) {
        e.preventDefault();
        const currentValue = textareaRef.current?.value ?? inputRef.current;
        onInteraction({ type: "typed", text: currentValue });
        return;
      }
      if (highlightText) {
        const userMessage = inputRef.current.trim() || "What does this mean?";
        const quotedText = highlightText
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n");
        inputRef.current = `${quotedText}\n\n${userMessage}`;
      }

      onSubmit(e);

      if (highlightText) {
        onClearHighlightPill?.();
      }
    },
    [highlightText, inputRef, onClearHighlightPill, onInteraction, onSubmit, textareaRef],
  );

  return (
    <form onSubmit={handleSubmit} className="px-4 py-3">
      {highlightPreview ? (
        <div className="mb-2 flex">
          <Attachment size="xs" className="max-w-[200px] rounded-full border-0 bg-muted">
            <AttachmentContent>
              <AttachmentTitle className="font-normal text-muted-foreground">
                {highlightPreview}
              </AttachmentTitle>
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction
                type="button"
                className="rounded-full"
                onClick={onClearHighlightPill}
                title="Remove highlighted text"
              >
                <X />
                <span className="sr-only">Remove highlighted text</span>
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          className={cn(
            "flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm",
            "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "field-sizing-content max-h-[6lh] min-h-10",
          )}
          placeholder={`Ask about ${bookTitle}...`}
          onPointerDown={(e) => {
            if (onInteraction && !passiveOpenGuardRef.current) e.preventDefault();
          }}
          onClick={() => {
            if (!onInteraction || passiveOpenGuardRef.current) return;
            passiveOpenGuardRef.current = true;
            onInteraction({ type: "none" });
          }}
          onFocus={() => {
            if (!onInteraction || passiveOpenGuardRef.current) return;
            passiveOpenGuardRef.current = true;
            onInteraction({ type: "none" });
          }}
          onChange={(e) => {
            inputRef.current = e.target.value;
          }}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          rows={1}
        />
        <div className="pb-1">
          {isLoading ? (
            <Button type="button" variant="ghost" size="icon" onClick={onStop} title="Stop">
              <Loader2 className="size-4 animate-spin" />
              <span className="sr-only">Stop</span>
            </Button>
          ) : (
            <Button type="submit" variant="outline" size="icon" title="Send">
              <ForwardIcon className="size-4" />
              <span className="sr-only">Send</span>
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
