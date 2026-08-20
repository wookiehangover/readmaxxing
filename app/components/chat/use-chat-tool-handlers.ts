import { useCallback } from "react";
import type { UIMessage } from "@ai-sdk/react";
import type { JSONContent } from "@tiptap/react";
import { BookService } from "~/lib/stores/book-store";
import { useWorkspace } from "~/lib/context/workspace-context";
import { appendHighlightReferenceToNotebook } from "~/lib/annotations/append-highlight-to-notebook";
import { normalizeCfiRange } from "~/lib/chat/highlight-tools";
import { useAppStore } from "~/lib/themis/provider";
import {
  addHighlightRequested,
  cacheNotebookRequested,
} from "~/lib/themis/annotations/annotations-slice";
import { getToolInfo } from "./chat-utils";

interface UseChatToolHandlersOptions {
  bookId: string;
  bookFormat?: string;
  bookDataRef: React.RefObject<ArrayBuffer | null>;
  /**
   * Populated by useStreamingAppend with toolCallIds whose content was already
   * inserted into the live editor and their pre-preview content. onFinish uses
   * this to avoid duplicates and roll back failed optimistic previews.
   */
  streamedToolCallIdRef?: React.MutableRefObject<Map<string, JSONContent>>;
}

export function useChatToolHandlers({
  bookId,
  bookFormat,
  bookDataRef,
  streamedToolCallIdRef,
}: UseChatToolHandlersOptions) {
  const store = useAppStore();
  const {
    navigateInCluster,
    applyTempHighlightForBook,
    notebookCallbackMap,
    notebookEditorCallbackMap,
  } = useWorkspace();

  const cacheNotebookSnapshot = useCallback(
    (targetBookId: string, content: JSONContent, updatedAt: number): void => {
      store.dispatch(
        cacheNotebookRequested(
          { bookId: targetBookId, content, updatedAt },
          () => {
            queueMicrotask(() => {
              window.dispatchEvent(
                new CustomEvent("sync:entity-updated", { detail: { entity: "notebook" } }),
              );
            });
          },
          console.error,
        ),
      );
    },
    [store],
  );

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
              bookId?: string;
              appended?: boolean;
              text?: string;
              appendedNodes?: JSONContent[];
              updatedContent?: JSONContent;
              updatedAt?: number;
            }
          | undefined;
        const toolCallId = (part as any).toolCallId as string | undefined;

        // Always consume the streaming-preview marker for this toolCallId so
        // the Map doesn't grow unbounded across messages — even when the
        // server output indicates nothing was appended.
        const previewSnapshot = toolCallId
          ? streamedToolCallIdRef?.current.get(toolCallId)
          : undefined;
        const streamingPreviewed = previewSnapshot !== undefined;
        if (toolCallId) streamedToolCallIdRef?.current.delete(toolCallId);

        // Route to the book named in the tool output (multi-book chat). Falls
        // back to the bound (primary) bookId for back-compat when absent.
        const targetBookId = output?.bookId ?? bookId;
        if (!output || !targetBookId) continue;

        const editorCbs = notebookEditorCallbackMap.current.get(targetBookId);
        const authoritativeSnapshot =
          output.updatedContent && typeof output.updatedAt === "number"
            ? { content: output.updatedContent, updatedAt: output.updatedAt }
            : null;

        if (!output.appended) {
          // The streamed preview already mutated the open editor. Restore the
          // authoritative server snapshot when available, otherwise roll back
          // to the content captured before the preview began.
          if (authoritativeSnapshot) {
            editorCbs?.setContent(authoritativeSnapshot.content);
            editorCbs?.seedLastContent(authoritativeSnapshot.content);
            cacheNotebookSnapshot(
              targetBookId,
              authoritativeSnapshot.content,
              authoritativeSnapshot.updatedAt,
            );
          } else if (previewSnapshot) {
            editorCbs?.setContent(previewSnapshot);
          }
          continue;
        }

        const appendedNodes = Array.isArray(output.appendedNodes) ? output.appendedNodes : [];
        if (appendedNodes.length === 0) continue;

        // Editor update: if the streaming preview already inserted these nodes
        // during input-streaming, skip — re-applying would duplicate.
        if (!streamingPreviewed && editorCbs) {
          editorCbs.appendContent(appendedNodes);
        }

        // Write-through to IndexedDB is independent of editor state — even if
        // the editor isn't open we still want IDB to reflect the new notes.
        if (authoritativeSnapshot) {
          editorCbs?.seedLastContent(authoritativeSnapshot.content);
          cacheNotebookSnapshot(
            targetBookId,
            authoritativeSnapshot.content,
            authoritativeSnapshot.updatedAt,
          );
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
              bookId?: string;
              executed?: boolean;
              updatedContent?: JSONContent;
              updatedAt?: number;
              error?: string;
            }
          | undefined;
        // edit_notes runs server-side against the primary notebook today, but
        // route via the echoed bookId when present, falling back to the bound
        // (primary) bookId for back-compat.
        const targetBookId = output?.bookId ?? bookId;
        if (!output?.executed || !output.updatedContent || !targetBookId) continue;

        const updatedContent = output.updatedContent;
        const editorCbs = notebookEditorCallbackMap.current.get(targetBookId);
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
        cacheNotebookSnapshot(targetBookId, updatedContent, nextUpdatedAt);
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
              bookId?: string;
              created?: boolean;
              unsupported?: string;
              highlight?: {
                id: string;
                bookId: string;
                text: string;
                note?: string | null;
                color?: string;
                cfiRange?: string | null;
                createdAt: number;
                textAnchor: { chapterIndex: number; snippet: string; offset?: number };
              };
            }
          | undefined;
        const highlightText = typeof info?.input?.text === "string" ? info.input.text : undefined;
        // Route to the book named in the tool output (multi-book chat). Falls
        // back to the bound (primary) bookId for back-compat when absent.
        const targetBookId = output?.bookId ?? bookId;
        if (!highlightText || !targetBookId) continue;

        // Resolve the target book's file data + format. For the primary book we
        // reuse the already-loaded bookDataRef/bookFormat; for any other selected
        // book we load its ArrayBuffer on demand so CFI resolution targets the
        // correct reader. Format is taken from the server's `unsupported: "pdf"`
        // signal when present, else the bound primary format.
        const isPrimaryTarget = targetBookId === bookId;
        const targetFormat =
          output?.unsupported === "pdf" ? "pdf" : isPrimaryTarget ? bookFormat : undefined;

        // Server-path: if the tool executed server-side and returned a highlight
        // row with a text-anchor, resolve its CFI inside the iframe and update
        // the local record. Only the epub path is supported server-side; PDF
        // still uses the client-side fallback below.
        const serverHighlight = output?.created ? output.highlight : undefined;

        // Search for the text in the book to get a location, then persist the highlight
        (async () => {
          try {
            const data = isPrimaryTarget
              ? bookDataRef.current
              : await BookService.getBookData(targetBookId);
            if (!data) return;

            if (targetFormat === "pdf") {
              // PDF path: search for text and navigate to page
              const pdfjs = await import("pdfjs-dist");
              const { searchPdf } = await import("~/lib/pdf/pdf-search");
              const workerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);
              pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.href;
              const dataCopy = new Uint8Array(data).slice();
              const loadingTask = pdfjs.getDocument({ data: dataCopy });
              const doc = await loadingTask.promise;
              try {
                const results = await searchPdf(doc, highlightText);
                if (results.length > 0) {
                  const cfiRange = `page:${results[0].page}`;
                  const highlight = {
                    id: crypto.randomUUID(),
                    bookId: targetBookId,
                    cfiRange,
                    text: highlightText,
                    color: "rgba(255, 213, 79, 0.4)",
                    createdAt: Date.now(),
                  };
                  await new Promise<void>((resolve, reject) => {
                    store.dispatch(
                      addHighlightRequested(
                        highlight,
                        () => resolve(),
                        (error) => reject(new Error(error)),
                      ),
                    );
                  });
                  // Don't navigate when AI creates highlights - preserves reading position
                  // User can navigate to highlights via the notebook panel

                  // Append highlight to notebook (same as epub path)
                  const attrs = {
                    highlightId: highlight.id,
                    cfiRange: highlight.cfiRange,
                    text: highlight.text,
                  };
                  const appendFn = notebookCallbackMap.current.get(targetBookId);
                  if (appendFn) {
                    appendFn(attrs);
                  } else {
                    appendHighlightReferenceToNotebook(targetBookId, attrs).catch(console.error);
                  }
                } else {
                  console.warn(
                    "create_highlight (PDF): no search results for:",
                    highlightText.slice(0, 60),
                  );
                }
              } finally {
                await loadingTask.destroy().catch(() => {});
              }
            } else {
              // Epub path
              let cfiRange = normalizeCfiRange(serverHighlight?.cfiRange) ?? "";
              if (!cfiRange) {
                const { fuzzySearchEpubForCfi } = await import("~/lib/epub/epub-search");
                // Prefer the server's text-anchor snippet when present — the
                // server already located the best chapter, so searching for the
                // snippet first improves the odds of a clean match.
                const snippet = serverHighlight?.textAnchor.snippet ?? highlightText;
                let results = await fuzzySearchEpubForCfi(data.slice(0), snippet);
                if (results.length === 0 && snippet !== highlightText) {
                  results = await fuzzySearchEpubForCfi(data.slice(0), highlightText);
                }
                cfiRange = normalizeCfiRange(results[0]?.cfi) ?? "";
              }

              if (!cfiRange) {
                console.warn("create_highlight: no CFI resolved for:", highlightText.slice(0, 60));
                return;
              }

              const highlight = {
                id: serverHighlight?.id ?? crypto.randomUUID(),
                bookId: targetBookId,
                cfiRange,
                text: highlightText,
                color: serverHighlight?.color ?? "rgba(255, 213, 79, 0.4)",
                createdAt: serverHighlight?.createdAt ?? Date.now(),
                ...(serverHighlight?.textAnchor ? { textAnchor: serverHighlight.textAnchor } : {}),
                ...(serverHighlight?.note ? { note: serverHighlight.note } : {}),
              };

              await new Promise<void>((resolve, reject) => {
                store.dispatch(
                  addHighlightRequested(
                    highlight,
                    () => resolve(),
                    (error) => reject(new Error(error)),
                  ),
                );
              });

              // Don't navigate when AI creates highlights - preserves reading position
              // User can navigate to highlights via the notebook panel

              const attrs = {
                highlightId: highlight.id,
                cfiRange: highlight.cfiRange,
                text: highlight.text,
              };
              const appendFn = notebookCallbackMap.current.get(targetBookId);
              if (appendFn) {
                appendFn(attrs);
              } else {
                appendHighlightReferenceToNotebook(targetBookId, attrs).catch(console.error);
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
      cacheNotebookSnapshot,
      navigateInCluster,
      applyTempHighlightForBook,
      notebookCallbackMap,
      notebookEditorCallbackMap,
      streamedToolCallIdRef,
      store,
    ],
  );

  return { onToolCall, onFinish };
}
