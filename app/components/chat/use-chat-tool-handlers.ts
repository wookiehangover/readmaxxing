import { useCallback } from "react";
import type { UIMessage } from "@ai-sdk/react";
import { Effect } from "effect";
import { AnnotationService } from "~/lib/annotations-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { useWorkspace } from "~/lib/workspace-context";
import { getToolInfo } from "./chat-utils";

interface UseChatToolHandlersOptions {
  bookId: string;
  bookDataRef: React.RefObject<ArrayBuffer | null>;
  persistMessages: () => void;
  setNotebookMarkdown: React.Dispatch<React.SetStateAction<string>>;
}

export function useChatToolHandlers({
  bookId,
  bookDataRef,
  persistMessages,
  setNotebookMarkdown,
}: UseChatToolHandlersOptions) {
  const { waitForNavForBook, applyTempHighlightForBook, notebookCallbackMap } = useWorkspace();

  const onFinish = useCallback(
    (event: { message: UIMessage }) => {
      // Persist after assistant finishes
      persistMessages();

      const msg = event.message;

      // Handle append_to_notes tool calls
      const appendParts = (msg.parts ?? []).filter((p: any) => {
        const info = getToolInfo(p);
        return info && info.toolName === "append_to_notes" && info.state === "output-available";
      });

      for (const part of appendParts) {
        const info = getToolInfo(part);
        const text = typeof info?.input?.text === "string" ? info.input.text : undefined;
        if (!text || !bookId) continue;

        const newNodes = text
          .split("\n")
          .filter(Boolean)
          .map((line: string) => ({
            type: "paragraph" as const,
            content: [{ type: "text" as const, text: line }],
          }));

        AppRuntime.runPromise(
          Effect.gen(function* () {
            const svc = yield* AnnotationService;
            const notebook = yield* svc.getNotebook(bookId);
            const existingContent = notebook?.content?.content ?? [];
            const updatedContent = {
              type: "doc" as const,
              content: [...existingContent, ...newNodes],
            };
            yield* svc.saveNotebook({
              bookId,
              content: updatedContent,
              updatedAt: Date.now(),
            });
          }),
        )
          .then(() => {
            setNotebookMarkdown((prev) => prev + "\n" + text);
          })
          .catch(console.error);
      }

      // Handle create_highlight tool calls
      const highlightParts = (msg.parts ?? []).filter((p: any) => {
        const info = getToolInfo(p);
        return info && info.toolName === "create_highlight" && info.state === "output-available";
      });

      for (const part of highlightParts) {
        const info = getToolInfo(part);
        const highlightText = typeof info?.input?.text === "string" ? info.input.text : undefined;
        if (!highlightText || !bookId) continue;

        const data = bookDataRef.current;
        if (!data) continue;

        // Search for the text in the book to get a CFI, then persist the highlight
        (async () => {
          try {
            const ePub = (await import("epubjs")).default;
            const { fuzzySearchBookForCfi } = await import("~/lib/epub-search");
            const tempBook = ePub(data.slice(0));
            try {
              const results = await fuzzySearchBookForCfi(tempBook, highlightText);
              if (results.length === 0) {
                console.warn(
                  "create_highlight: no search results for:",
                  highlightText.slice(0, 60),
                );
                return;
              }

              const cfiRange = results[0].cfi;
              const highlight = {
                id: crypto.randomUUID(),
                bookId,
                cfiRange,
                text: highlightText,
                color: "rgba(255, 213, 79, 0.4)",
                createdAt: Date.now(),
              };

              // Persist highlight to IndexedDB
              await AppRuntime.runPromise(
                Effect.gen(function* () {
                  const svc = yield* AnnotationService;
                  yield* svc.saveHighlight(highlight);
                }),
              );

              // Navigate to the highlight and show temp highlight in the reader
              const navigate = await waitForNavForBook(bookId);
              if (navigate) {
                navigate(cfiRange);
              }
              applyTempHighlightForBook(bookId, cfiRange);

              // Add HighlightReference to the notebook
              const appendFn = notebookCallbackMap.current.get(bookId);
              if (appendFn) {
                appendFn({
                  highlightId: highlight.id,
                  cfiRange: highlight.cfiRange,
                  text: highlight.text,
                });
              } else {
                // Notebook panel not open — append directly via AnnotationService
                AppRuntime.runPromise(
                  Effect.gen(function* () {
                    const svc = yield* AnnotationService;
                    const notebook = yield* svc.getNotebook(bookId);
                    const existingContent = notebook?.content?.content ?? [];
                    const highlightNode = {
                      type: "highlightReference" as const,
                      attrs: {
                        highlightId: highlight.id,
                        cfiRange: highlight.cfiRange,
                        text: highlight.text,
                      },
                    };
                    const updatedContent = {
                      type: "doc" as const,
                      content: [...existingContent, highlightNode],
                    };
                    yield* svc.saveNotebook({
                      bookId,
                      content: updatedContent,
                      updatedAt: Date.now(),
                    });
                  }),
                ).catch(console.error);
              }
            } finally {
              tempBook.destroy();
            }
          } catch (err) {
            console.warn("Failed to create highlight from AI tool:", err);
          }
        })();
      }
    },
    [
      bookId,
      bookDataRef,
      persistMessages,
      setNotebookMarkdown,
      waitForNavForBook,
      applyTempHighlightForBook,
      notebookCallbackMap,
    ],
  );

  return { onFinish };
}
