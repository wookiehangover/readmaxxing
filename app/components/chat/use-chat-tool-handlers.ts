import { useCallback } from "react";
import type { UIMessage } from "@ai-sdk/react";
import type { JSONContent } from "@tiptap/react";
import { Effect } from "effect";
import { AnnotationService } from "~/lib/stores/annotations-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { useWorkspace } from "~/lib/context/workspace-context";
import { getToolInfo } from "./chat-utils";

interface UseChatToolHandlersOptions {
  bookId: string;
  bookFormat?: string;
  bookDataRef: React.RefObject<ArrayBuffer | null>;
  /**
   * Populated by useStreamingAppend with toolCallIds whose content was already
   * inserted into the live editor via the input-streaming preview. onFinish
   * uses this to avoid double-appending the authoritative server output.
   */
  streamedToolCallIdRef?: React.MutableRefObject<Set<string>>;
}

export function useChatToolHandlers({
  bookId,
  bookFormat,
  bookDataRef,
  streamedToolCallIdRef,
}: UseChatToolHandlersOptions) {
  const {
    waitForNavForBook,
    applyTempHighlightForBook,
    notebookCallbackMap,
    notebookEditorCallbackMap,
  } = useWorkspace();

  // onToolCall fires as soon as each tool call has its input parsed. All
  // notebook tools (append_to_notes, edit_notes) now run on the server; their
  // outputs are consumed in onFinish from the tool-output parts. This hook
  // remains a no-op placeholder for potential future client-side tools.
  const onToolCall = useCallback(
    async (_event: { toolCall: { toolName: string; input: unknown } }) => {
      // No client-side tool execution today.
    },
    [],
  );

  const onFinish = useCallback(
    (event: { message: UIMessage }) => {
      const msg = event.message;

      // Handle append_to_notes: the server parsed the markdown, persisted the
      // updated notebook to Postgres, and returned the appended Tiptap nodes
      // along with the full `updatedContent` and server `updatedAt`. We:
      //   1. Apply the authoritative nodes to the live editor (if open and not
      //      already previewed via input-streaming).
      //   2. Mirror the full `updatedContent` to IndexedDB via `cacheNotebook`
      //      so other UI (book-details, notebook preview) sees the new notes
      //      immediately, without waiting for the next sync pull.
      //   3. Dispatch `sync:entity-updated` {notebook} so `useSyncListener`
      //      consumers re-fetch from IDB.
      // We seed the open editor's lastContentRef before dispatching so the
      // workspace-notebook listener treats the event as a no-op — preventing
      // an unnecessary `setContent` that would reset cursor position.
      const appendNotesParts = (msg.parts ?? []).filter((p: any) => {
        const info = getToolInfo(p);
        return info && info.toolName === "append_to_notes" && info.state === "output-available";
      });
      for (const part of appendNotesParts) {
        const info = getToolInfo(part);
        const output = info?.output as
          | {
              appended?: boolean;
              text?: string;
              appendedNodes?: JSONContent[];
              updatedContent?: JSONContent;
              updatedAt?: number;
            }
          | undefined;
        const toolCallId = (part as any).toolCallId as string | undefined;

        // Always consume the streaming-preview marker for this toolCallId so
        // the Set doesn't grow unbounded across messages — even when the
        // server output indicates nothing was appended.
        const streamingPreviewed =
          !!toolCallId && !!streamedToolCallIdRef?.current.delete(toolCallId);

        if (!output?.appended || !bookId) continue;
        const appendedNodes = Array.isArray(output.appendedNodes) ? output.appendedNodes : [];
        if (appendedNodes.length === 0) continue;

        const editorCbs = notebookEditorCallbackMap.current.get(bookId);

        // Editor update: if the streaming preview already inserted these nodes
        // during input-streaming, skip — re-applying would duplicate.
        if (!streamingPreviewed && editorCbs) {
          editorCbs.appendContent(appendedNodes);
        }

        // Write-through to IndexedDB is independent of editor state — even if
        // the editor isn't open we still want IDB to reflect the new notes.
        if (output.updatedContent && typeof output.updatedAt === "number") {
          const nextContent = output.updatedContent;
          const nextUpdatedAt = output.updatedAt;
          editorCbs?.seedLastContent(nextContent);
          AppRuntime.runPromise(
            AnnotationService.pipe(
              Effect.andThen((svc) =>
                svc.cacheNotebook({
                  bookId,
                  content: nextContent,
                  updatedAt: nextUpdatedAt,
                }),
              ),
            ),
          )
            .then(() => {
              queueMicrotask(() => {
                window.dispatchEvent(
                  new CustomEvent("sync:entity-updated", { detail: { entity: "notebook" } }),
                );
              });
            })
            .catch(console.error);
        }
      }

      // Handle edit_notes: server ran the SDK code and returned updatedContent.
      // Apply to the live editor if open; mirror to IndexedDB so the local
      // cache matches server truth without waiting for sync pull; dispatch
      // `sync:entity-updated` {notebook} for other UI listeners.
      const editNotesParts = (msg.parts ?? []).filter((p: any) => {
        const info = getToolInfo(p);
        return info && info.toolName === "edit_notes" && info.state === "output-available";
      });
      for (const part of editNotesParts) {
        const info = getToolInfo(part);
        const output = info?.output as
          | {
              executed?: boolean;
              updatedContent?: JSONContent;
              updatedAt?: number;
              error?: string;
            }
          | undefined;
        if (!output?.executed || !output.updatedContent || !bookId) continue;

        const updatedContent = output.updatedContent;
        const editorCbs = notebookEditorCallbackMap.current.get(bookId);
        if (editorCbs) {
          editorCbs.setContent(updatedContent);
          editorCbs.seedLastContent(updatedContent);
        }

        // The server is authoritative for the LWW timestamp. If it omitted
        // updatedAt on an executed:true response, treat that as an invalid
        // server response and SKIP the cache write + sync event — falling
        // back to Date.now() would fabricate a freshness the server row
        // doesn't actually have, defeating LWW on future pulls.
        if (typeof output.updatedAt !== "number") {
          console.warn(
            "edit_notes: server returned executed:true without updatedAt; skipping cache write",
          );
          continue;
        }
        const nextUpdatedAt = output.updatedAt;

        // Use cacheNotebook (not saveNotebook) because the server has already
        // persisted this notebook state. saveNotebook would recordChange and
        // echo the same value back to the server on the next sync push.
        AppRuntime.runPromise(
          AnnotationService.pipe(
            Effect.andThen((svc) =>
              svc.cacheNotebook({
                bookId,
                content: updatedContent,
                updatedAt: nextUpdatedAt,
              }),
            ),
          ),
        )
          .then(() => {
            queueMicrotask(() => {
              window.dispatchEvent(
                new CustomEvent("sync:entity-updated", { detail: { entity: "notebook" } }),
              );
            });
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
        const output = info?.output as
          | {
              created?: boolean;
              highlight?: {
                id: string;
                bookId: string;
                text: string;
                note?: string | null;
                color?: string;
                createdAt: number;
                textAnchor: { chapterIndex: number; snippet: string; offset?: number };
              };
            }
          | undefined;
        const highlightText = typeof info?.input?.text === "string" ? info.input.text : undefined;
        if (!highlightText || !bookId) continue;

        const data = bookDataRef.current;
        if (!data) continue;

        // Server-path: if the tool executed server-side and returned a highlight
        // row with a text-anchor, resolve its CFI inside the iframe and update
        // the local record. Only the epub path is supported server-side; PDF
        // still uses the client-side fallback below.
        const serverHighlight = output?.created ? output.highlight : undefined;

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
                // Prefer the server's text-anchor snippet when present — the
                // server already located the best chapter, so searching for the
                // snippet first improves the odds of a clean match.
                const snippet = serverHighlight?.textAnchor.snippet ?? highlightText;
                let results = await fuzzySearchBookForCfi(tempBook, snippet);
                if (results.length === 0 && snippet !== highlightText) {
                  results = await fuzzySearchBookForCfi(tempBook, highlightText);
                }

                const cfiRange = results[0]?.cfi ?? "";
                const highlight = {
                  id: serverHighlight?.id ?? crypto.randomUUID(),
                  bookId,
                  cfiRange,
                  text: highlightText,
                  color: serverHighlight?.color ?? "rgba(255, 213, 79, 0.4)",
                  createdAt: serverHighlight?.createdAt ?? Date.now(),
                  ...(serverHighlight?.textAnchor
                    ? { textAnchor: serverHighlight.textAnchor }
                    : {}),
                  ...(serverHighlight?.note ? { note: serverHighlight.note } : {}),
                };

                if (cfiRange === "") {
                  console.warn(
                    "create_highlight: no CFI resolved for:",
                    highlightText.slice(0, 60),
                  );
                }

                await AppRuntime.runPromise(
                  Effect.gen(function* () {
                    const svc = yield* AnnotationService;
                    yield* svc.saveHighlight(highlight);
                  }),
                );

                if (cfiRange !== "") {
                  const navigate = await waitForNavForBook(bookId);
                  if (navigate) navigate(cfiRange);
                  applyTempHighlightForBook(bookId, cfiRange);
                }

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
      notebookEditorCallbackMap,
      streamedToolCallIdRef,
    ],
  );

  return { onToolCall, onFinish };
}
