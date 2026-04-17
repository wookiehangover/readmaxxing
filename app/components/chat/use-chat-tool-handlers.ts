import { useCallback } from "react";
import type { UIMessage } from "@ai-sdk/react";
import { Effect } from "effect";
import { AnnotationService } from "~/lib/stores/annotations-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { useWorkspace } from "~/lib/context/workspace-context";
import { getToolInfo } from "./chat-utils";
import { markdownToTiptapJson } from "~/lib/editor/markdown-to-tiptap";
import { createNotebookSDK } from "~/lib/editor/notebook-sdk";
import { tiptapJsonToMarkdown } from "~/lib/editor/tiptap-to-markdown";

interface UseChatToolHandlersOptions {
  bookId: string;
  bookFormat?: string;
  bookDataRef: React.RefObject<ArrayBuffer | null>;
  setNotebookMarkdown: React.Dispatch<React.SetStateAction<string>>;
  /** Set by useStreamingAppend when streaming already inserted append_to_notes content */
  streamedToolCallIdRef?: React.MutableRefObject<string | null>;
}

export function useChatToolHandlers({
  bookId,
  bookFormat,
  bookDataRef,
  setNotebookMarkdown,
  streamedToolCallIdRef,
}: UseChatToolHandlersOptions) {
  const {
    waitForNavForBook,
    applyTempHighlightForBook,
    notebookCallbackMap,
    notebookEditorCallbackMap,
  } = useWorkspace();

  // onToolCall fires as soon as each tool call completes, while the response is still streaming.
  // We handle append_to_notes and edit_notes here for immediate notebook updates.
  const onToolCall = useCallback(
    async ({ toolCall }: { toolCall: { toolName: string; input: unknown } }) => {
      const args = toolCall.input as Record<string, unknown> | undefined;
      if (toolCall.toolName === "append_to_notes") {
        const text = typeof args?.text === "string" ? args.text : undefined;
        if (!text || !bookId) return;

        const toolCallId = (toolCall as any).toolCallId as string | undefined;

        const parsed = markdownToTiptapJson(text);
        const newNodes = parsed.content ?? [];

        // If streaming already inserted this content via replaceContentFrom,
        // skip the editor append but still persist to IndexedDB below.
        const alreadyStreamed =
          streamedToolCallIdRef?.current &&
          toolCallId &&
          streamedToolCallIdRef.current === toolCallId;

        if (alreadyStreamed) {
          streamedToolCallIdRef.current = null;
        }

        // Push through live editor if notebook panel is open and content wasn't already streamed
        const editorCallbacks = notebookEditorCallbackMap.current.get(bookId);
        if (editorCallbacks && !alreadyStreamed) {
          editorCallbacks.appendContent(newNodes);
        }

        // Always persist to IndexedDB immediately so content survives panel close/unmount
        await AppRuntime.runPromise(
          Effect.gen(function* () {
            const svc = yield* AnnotationService;
            // If the editor is open, read the authoritative content from it
            const editorCbs = notebookEditorCallbackMap.current.get(bookId);
            if (editorCbs) {
              const currentContent = editorCbs.getContent();
              yield* svc.saveNotebook({
                bookId,
                content: currentContent,
                updatedAt: Date.now(),
              });
            } else {
              // Editor not open — merge with existing IndexedDB content
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
            }
          }),
        ).catch(console.error);

        // Only update notebookMarkdown manually when the editor is NOT open.
        // When the editor IS open, its onUpdate fires after appendContent /
        // replaceContentFrom and syncs notebookMarkdown via
        // notebookContentChangeMap — calling setNotebookMarkdown here too
        // would duplicate the appended text.
        if (!editorCallbacks) {
          setNotebookMarkdown((prev) => prev + "\n" + text);
        }
        return;
      }

      if (toolCall.toolName === "edit_notes") {
        const code = typeof args?.code === "string" ? args.code : undefined;
        if (!code || !bookId) {
          return { executed: false, error: "missing code or bookId" };
        }

        try {
          // Prefer live editor content over IndexedDB to avoid stale reads
          const editorCallbacks = notebookEditorCallbackMap.current.get(bookId);
          let currentContent: import("@tiptap/react").JSONContent;
          if (editorCallbacks) {
            currentContent = editorCallbacks.getContent();
          } else {
            const notebook = await AppRuntime.runPromise(
              Effect.gen(function* () {
                const svc = yield* AnnotationService;
                return yield* svc.getNotebook(bookId);
              }),
            );
            currentContent = notebook?.content ?? {
              type: "doc" as const,
              content: [],
            };
          }

          // Create SDK and execute AI code in sandbox
          const { sdk, getResult, destroy } = createNotebookSDK(currentContent);
          try {
            const fn = new Function("notebook", code);
            fn(sdk);

            const resultJson = getResult();

            // Push to live editor if open
            const editorCbs = notebookEditorCallbackMap.current.get(bookId);
            if (editorCbs) {
              editorCbs.setContent(resultJson);
            }

            // Always save to IndexedDB for persistence
            await AppRuntime.runPromise(
              Effect.gen(function* () {
                const svc = yield* AnnotationService;
                yield* svc.saveNotebook({
                  bookId,
                  content: resultJson,
                  updatedAt: Date.now(),
                });
              }),
            );

            // Update the markdown state for the chat context
            const newMarkdown = tiptapJsonToMarkdown(resultJson);
            setNotebookMarkdown(newMarkdown);
          } finally {
            destroy();
          }
          return { executed: true };
        } catch (err) {
          console.error("edit_notes: failed to execute AI code:", err);
          const errMsg = err instanceof Error ? err.message : String(err);
          return { executed: false, error: errMsg };
        }
      }
    },
    [bookId, setNotebookMarkdown, notebookEditorCallbackMap],
  );

  const onFinish = useCallback(
    (event: { message: UIMessage }) => {
      const msg = event.message;

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

        // Search for the text in the book to get a location, then persist the highlight
        (async () => {
          try {
            if (bookFormat === "pdf") {
              // PDF path: search for text and navigate to page
              const pdfjs = await import("pdfjs-dist");
              const { searchPdf } = await import("~/lib/pdf/pdf-search");
              const workerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);
              pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.href;
              const dataCopy = new Uint8Array(data).slice();
              const doc = await pdfjs.getDocument({ data: dataCopy }).promise;
              try {
                const results = await searchPdf(doc, highlightText);
                if (results.length > 0) {
                  const cfiRange = `page:${results[0].page}`;
                  const highlight = {
                    id: crypto.randomUUID(),
                    bookId,
                    cfiRange,
                    text: highlightText,
                    color: "rgba(255, 213, 79, 0.4)",
                    createdAt: Date.now(),
                  };
                  await AppRuntime.runPromise(
                    Effect.gen(function* () {
                      const svc = yield* AnnotationService;
                      yield* svc.saveHighlight(highlight);
                    }),
                  );
                  const navigate = await waitForNavForBook(bookId);
                  if (navigate) navigate(cfiRange);

                  // Append highlight to notebook (same as epub path)
                  const appendFn = notebookCallbackMap.current.get(bookId);
                  if (appendFn) {
                    appendFn({
                      highlightId: highlight.id,
                      cfiRange: highlight.cfiRange,
                      text: highlight.text,
                    });
                  } else {
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
                } else {
                  console.warn(
                    "create_highlight (PDF): no search results for:",
                    highlightText.slice(0, 60),
                  );
                }
              } finally {
                await doc.destroy();
              }
            } else {
              // Epub path
              const ePub = (await import("epubjs")).default;
              const { fuzzySearchBookForCfi } = await import("~/lib/epub/epub-search");
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

                await AppRuntime.runPromise(
                  Effect.gen(function* () {
                    const svc = yield* AnnotationService;
                    yield* svc.saveHighlight(highlight);
                  }),
                );

                const navigate = await waitForNavForBook(bookId);
                if (navigate) navigate(cfiRange);
                applyTempHighlightForBook(bookId, cfiRange);

                const appendFn = notebookCallbackMap.current.get(bookId);
                if (appendFn) {
                  appendFn({
                    highlightId: highlight.id,
                    cfiRange: highlight.cfiRange,
                    text: highlight.text,
                  });
                } else {
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
            }
          } catch (err) {
            console.warn("Failed to create highlight from AI tool:", err);
          }
        })();
      }
    },
    [
      bookId,
      bookFormat,
      bookDataRef,
      waitForNavForBook,
      applyTempHighlightForBook,
      notebookCallbackMap,
    ],
  );

  return { onToolCall, onFinish };
}
