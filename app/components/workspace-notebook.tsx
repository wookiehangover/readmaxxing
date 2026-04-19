import { useEffect, useCallback, useRef, useState } from "react";
import { Effect } from "effect";
import { useSyncListener } from "~/hooks/use-sync-listener";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Download, Ellipsis, FileText } from "lucide-react";
import { Link } from "react-router";
import { TiptapEditor, type TiptapEditorHandle } from "~/components/tiptap-editor";
import { AnnotationService } from "~/lib/stores/annotations-store";
import { BookService } from "~/lib/stores/book-store";
import { AppRuntime } from "~/lib/effect-runtime";
import type { JSONContent } from "@tiptap/react";
import { tiptapJsonToMarkdown } from "~/lib/editor/tiptap-to-markdown";
import { useEffectQuery } from "~/hooks/use-effect-query";
import type { HighlightReferenceAttrs } from "~/lib/editor/tiptap-highlight-node";
import { useWorkspace } from "~/lib/context/workspace-context";

interface WorkspaceNotebookProps {
  bookId: string;
  bookTitle?: string;
  onNavigateToCfi?: (cfi: string) => void | Promise<void>;
  onDeleteHighlight?: (highlightId: string, cfiRange: string) => void;
  onRegisterAppendHighlight?: (
    bookId: string,
    fn: (attrs: HighlightReferenceAttrs) => void,
  ) => void;
  onUnregisterAppendHighlight?: (bookId: string) => void;
}

export function WorkspaceNotebook({
  bookId,
  bookTitle,
  onNavigateToCfi,
  onDeleteHighlight,
  onRegisterAppendHighlight,
  onUnregisterAppendHighlight,
}: WorkspaceNotebookProps) {
  const editorRef = useRef<TiptapEditorHandle | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const { notebookEditorCallbackMap, notebookContentChangeMap } = useWorkspace();

  const { data: book } = useEffectQuery(
    () =>
      BookService.pipe(
        Effect.andThen((s) => s.getBook(bookId)),
        Effect.catchAll(() => Effect.succeed(null)),
      ),
    [bookId],
  );

  const displayTitle = book?.title ?? bookTitle;
  const displayAuthor = book?.author;

  // Track the last known serialized content to detect actual changes from sync
  const lastContentRef = useRef<string | null>(null);
  // Flag to suppress handleUpdate saves when content is set from a sync pull
  const fromSyncRef = useRef(false);

  const { data: notebook, isLoading } = useEffectQuery(
    () => AnnotationService.pipe(Effect.andThen((svc) => svc.getNotebook(bookId))),
    [bookId],
  );
  const content = notebook?.content;
  const loaded = !isLoading;

  // Seed lastContentRef when notebook first loads
  useEffect(() => {
    if (content) {
      lastContentRef.current = JSON.stringify(content);
    }
  }, [content]);

  // On sync pull, compare pulled content with current — only update editor if different
  const notebookSyncVersion = useSyncListener(["notebook"]);
  useEffect(() => {
    if (notebookSyncVersion === 0) return;
    // Skip if user has pending local edits
    if (pendingContentRef.current) return;

    (async () => {
      try {
        const nb = await AppRuntime.runPromise(
          AnnotationService.pipe(Effect.andThen((svc) => svc.getNotebook(bookId))),
        );
        if (!nb?.content) return;

        const newContentStr = JSON.stringify(nb.content);
        if (newContentStr === lastContentRef.current) return; // No change, skip

        lastContentRef.current = newContentStr;

        // Update editor in-place if available, avoiding a full remount
        if (editorRef.current) {
          fromSyncRef.current = true;
          editorRef.current.setContent(nb.content);
          fromSyncRef.current = false;
        }
      } catch (err) {
        console.error("Failed to check notebook sync:", err);
      }
    })();
  }, [bookId, notebookSyncVersion]);

  // Track the latest unsaved content so we can flush on unmount
  const pendingContentRef = useRef<JSONContent | null>(null);
  const bookIdRef = useRef(bookId);
  bookIdRef.current = bookId;

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pendingContent = pendingContentRef.current;
    if (!pendingContent) return;
    pendingContentRef.current = null;
    const currentBookId = bookIdRef.current;
    const program = Effect.gen(function* () {
      const svc = yield* AnnotationService;
      yield* svc.saveNotebook({
        bookId: currentBookId,
        content: pendingContent,
        updatedAt: Date.now(),
      });
    });
    AppRuntime.runPromise(program).catch((err) =>
      console.error("Failed to flush notebook save:", err),
    );
  }, []);

  const handleUpdate = useCallback(
    (newContent: JSONContent) => {
      // Skip saving when content was set from a sync pull (not a user edit)
      if (fromSyncRef.current) return;

      // Notify chat panel of content changes so read_notes sees current content
      const changeCallback = notebookContentChangeMap.current.get(bookId);
      if (changeCallback) {
        const markdown = tiptapJsonToMarkdown(newContent);
        changeCallback(markdown);
      }

      // Track pending content for flush-on-unmount
      pendingContentRef.current = newContent;

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        pendingContentRef.current = null;
        // Update lastContentRef so future sync pulls can compare accurately
        lastContentRef.current = JSON.stringify(newContent);
        const program = Effect.gen(function* () {
          const svc = yield* AnnotationService;
          yield* svc.saveNotebook({
            bookId,
            content: newContent,
            updatedAt: Date.now(),
          });
        });
        AppRuntime.runPromise(program).catch((err) =>
          console.error("Failed to save notebook:", err),
        );
      }, 1000);
    },
    [bookId, notebookContentChangeMap],
  );

  // Flush any pending debounced save on unmount
  useEffect(() => {
    return () => {
      flushSave();
    };
  }, [flushSave]);

  // Register the appendHighlightReference callback so the workspace can push highlights here
  useEffect(() => {
    const appendFn = (attrs: HighlightReferenceAttrs) => {
      editorRef.current?.appendHighlightReference(attrs);
    };
    onRegisterAppendHighlight?.(bookId, appendFn);
    return () => {
      onUnregisterAppendHighlight?.(bookId);
    };
  }, [bookId, onRegisterAppendHighlight, onUnregisterAppendHighlight]);

  // Register editor callbacks for live-sync from chat tool handlers.
  // Only register once the Tiptap editor is ready so that tool handlers
  // fall back to IndexedDB during the loading window instead of silently
  // dropping content via the not-yet-functional imperative ref.
  useEffect(() => {
    if (!editorReady) return;
    notebookEditorCallbackMap.current.set(bookId, {
      appendContent: (nodes) => {
        editorRef.current?.appendContent(nodes);
      },
      setContent: (content) => {
        editorRef.current?.setContent(content);
      },
      getContent: () => {
        return editorRef.current?.getContent() ?? { type: "doc", content: [] };
      },
      getTopLevelNodeCount: () => {
        return editorRef.current?.getTopLevelNodeCount() ?? 0;
      },
      replaceContentFrom: (fromIndex, nodes) => {
        editorRef.current?.replaceContentFrom(fromIndex, nodes);
      },
      seedLastContent: (newContent) => {
        lastContentRef.current = JSON.stringify(newContent);
      },
    });
    return () => {
      notebookEditorCallbackMap.current.delete(bookId);
    };
  }, [bookId, editorReady, notebookEditorCallbackMap]);

  const handleExportMarkdown = useCallback(() => {
    if (!content) return;
    const markdown = tiptapJsonToMarkdown(content);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const filename = bookTitle ? `${bookTitle}-annotations.md` : "annotations.md";
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [content, bookTitle]);

  const handleNavigateToCfi = useCallback(
    (cfi: string) => {
      onNavigateToCfi?.(cfi);
    },
    [onNavigateToCfi],
  );

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{displayTitle ?? "Notebook"}</h2>
          {displayAuthor && (
            <p className="truncate text-xs text-muted-foreground">{displayAuthor}</p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" />}>
            <Ellipsis className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem render={<Link to={`/books/${bookId}/details`} />}>
              <FileText className="size-4" />
              Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportMarkdown} disabled={!content}>
              <Download className="size-4" />
              Export as Markdown
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {loaded && (
          <TiptapEditor
            ref={editorRef}
            content={content}
            onUpdate={handleUpdate}
            onNavigateToHighlight={handleNavigateToCfi}
            onDeleteHighlight={onDeleteHighlight}
            onReady={() => setEditorReady(true)}
          />
        )}
      </ScrollArea>
    </div>
  );
}
