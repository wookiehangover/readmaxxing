import { useCallback } from "react";
import type { UIMessage } from "@ai-sdk/react";
import type { JSONContent } from "@tiptap/react";
import { BookService } from "~/lib/stores/book-store";
import { useWorkspace } from "~/lib/context/workspace-context";
import { normalizeCfiRange } from "~/lib/chat/highlight-tools";
import { useAppStore } from "~/lib/themis/provider";
import {
  addHighlightRequested,
  appendHighlightToNotebookRequested,
  cacheNotebookRequested,
} from "~/lib/themis/annotations/annotations-slice";
import { getToolInfo } from "./chat-utils";

interface UseChatToolHandlersOptions {
  bookId: string;
  bookFormat?: string;
  bookDataRef: React.RefObject<ArrayBuffer | null>;
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

  const onToolCall = useCallback(
    async (_event: { toolCall: { toolName: string; input: unknown } }) => {},
    [],
  );

  const onFinish = useCallback(
    (event: { message: UIMessage }) => {
      const msg = event.message;

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

        const previewSnapshot = toolCallId
          ? streamedToolCallIdRef?.current.get(toolCallId)
          : undefined;
        const streamingPreviewed = previewSnapshot !== undefined;
        if (toolCallId) streamedToolCallIdRef?.current.delete(toolCallId);

        const targetBookId = output?.bookId ?? bookId;
        if (!output || !targetBookId) continue;

        const editorCbs = notebookEditorCallbackMap.current.get(targetBookId);
        const authoritativeSnapshot =
          output.updatedContent && typeof output.updatedAt === "number"
            ? { content: output.updatedContent, updatedAt: output.updatedAt }
            : null;

        if (!output.appended) {
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

        if (!streamingPreviewed && editorCbs) {
          editorCbs.appendContent(appendedNodes);
        }

        if (authoritativeSnapshot) {
          editorCbs?.seedLastContent(authoritativeSnapshot.content);
          cacheNotebookSnapshot(
            targetBookId,
            authoritativeSnapshot.content,
            authoritativeSnapshot.updatedAt,
          );
        }
      }

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
        const targetBookId = output?.bookId ?? bookId;
        if (!output?.executed || !output.updatedContent || !targetBookId) continue;

        const updatedContent = output.updatedContent;
        const editorCbs = notebookEditorCallbackMap.current.get(targetBookId);
        if (editorCbs) {
          editorCbs.setContent(updatedContent);
          editorCbs.seedLastContent(updatedContent);
        }

        if (typeof output.updatedAt !== "number") {
          console.warn(
            "edit_notes: server returned executed:true without updatedAt; skipping cache write",
          );
          continue;
        }
        const nextUpdatedAt = output.updatedAt;

        cacheNotebookSnapshot(targetBookId, updatedContent, nextUpdatedAt);
      }

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
        const targetBookId = output?.bookId ?? bookId;
        if (!highlightText || !targetBookId) continue;

        const isPrimaryTarget = targetBookId === bookId;
        const targetFormat =
          output?.unsupported === "pdf" ? "pdf" : isPrimaryTarget ? bookFormat : undefined;

        const serverHighlight = output?.created ? output.highlight : undefined;

        (async () => {
          try {
            const data = isPrimaryTarget
              ? bookDataRef.current
              : await BookService.getBookData(targetBookId);
            if (!data) return;

            if (targetFormat === "pdf") {
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

                  const attrs = {
                    highlightId: highlight.id,
                    cfiRange: highlight.cfiRange,
                    text: highlight.text,
                  };
                  const appendFn = notebookCallbackMap.current.get(targetBookId);
                  if (appendFn) {
                    appendFn(attrs);
                  } else {
                    store.dispatch(
                      appendHighlightToNotebookRequested(
                        targetBookId,
                        attrs,
                        undefined,
                        console.error,
                      ),
                    );
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
              let cfiRange = normalizeCfiRange(serverHighlight?.cfiRange) ?? "";
              if (!cfiRange) {
                const { fuzzySearchEpubForCfi } = await import("~/lib/epub/epub-search");
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

              const attrs = {
                highlightId: highlight.id,
                cfiRange: highlight.cfiRange,
                text: highlight.text,
              };
              const appendFn = notebookCallbackMap.current.get(targetBookId);
              if (appendFn) {
                appendFn(attrs);
              } else {
                store.dispatch(
                  appendHighlightToNotebookRequested(targetBookId, attrs, undefined, console.error),
                );
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
