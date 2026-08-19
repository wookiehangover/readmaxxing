import { useEffect, useCallback, useRef, useState } from "react";
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
import type { JSONContent } from "@tiptap/react";
import { tiptapJsonToMarkdown } from "~/lib/editor/tiptap-to-markdown";
import type { HighlightReferenceAttrs } from "~/lib/editor/tiptap-highlight-node";
import { useWorkspace } from "~/lib/context/workspace-context";
import { downloadNotebookMarkdown } from "~/lib/editor/export-notebook-markdown";
import { cn } from "~/lib/utils";
import { useAppStore } from "~/lib/themis/provider";
import {
  hydrateAnnotationsRequested,
  updateNotebookRequested,
} from "~/lib/themis/annotations/annotations-slice";

const NOTES_EMPTY_PLACEHOLDER = "If you're not writing, you're not reading";

interface WorkspaceNotebookProps {
  bookId: string;
  bookTitle?: string;
  chromeless?: boolean;
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
  chromeless = false,
  onNavigateToCfi,
  onDeleteHighlight,
  onRegisterAppendHighlight,
  onUnregisterAppendHighlight,
}: WorkspaceNotebookProps) {
  const editorRef = useRef<TiptapEditorHandle | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const { notebookEditorCallbackMap, notebookContentChangeMap } = useWorkspace();
  const store = useAppStore();
  const book = store.booksSelectors.selectBookById.useValue(bookId);
  const notebook = store.annotationsSelectors.selectNotebookByBookId.useValue(bookId);
  const loaded = store.annotationsSelectors.selectAnnotationsLoaded.useValue(bookId);
  const notebookSyncVersion = useSyncListener(["notebook"]);

  const displayTitle = book?.title ?? bookTitle;
  const displayAuthor = book?.author;

  // Track the last known serialized content to detect actual changes from sync
  const lastContentRef = useRef<string | null>(null);
  // Flag to suppress handleUpdate saves when content is set from a sync pull
  const fromSyncRef = useRef(false);
  // Track the latest unsaved content so it can be flushed on unmount.
  const pendingContentRef = useRef<JSONContent | null>(null);
  const bookIdRef = useRef(bookId);
  bookIdRef.current = bookId;
  const content = notebook?.content;

  useEffect(() => {
    store.dispatch(hydrateAnnotationsRequested(bookId));
  }, [bookId, notebookSyncVersion, store]);

  // Reconcile authoritative collection changes into the mounted editor.
  useEffect(() => {
    if (!content) return;
    const newContentStr = JSON.stringify(content);
    if (lastContentRef.current === null) {
      lastContentRef.current = newContentStr;
      return;
    }
    if (pendingContentRef.current || newContentStr === lastContentRef.current) return;
    lastContentRef.current = newContentStr;
    if (!editorRef.current) return;
    fromSyncRef.current = true;
    editorRef.current.setContent(content);
    fromSyncRef.current = false;
  }, [content]);

  const flushSave = useCallback(() => {
    const pendingContent = pendingContentRef.current;
    if (!pendingContent) return;
    pendingContentRef.current = null;
    const currentBookId = bookIdRef.current;
    store.dispatch(
      updateNotebookRequested(currentBookId, pendingContent, true, undefined, (error) =>
        console.error("Failed to flush notebook save:", error),
      ),
    );
  }, [store]);

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
      store.dispatch(
        updateNotebookRequested(
          bookId,
          newContent,
          false,
          () => {
            if (pendingContentRef.current === newContent) pendingContentRef.current = null;
            lastContentRef.current = JSON.stringify(newContent);
          },
          (error) => console.error("Failed to save notebook:", error),
        ),
      );
    },
    [bookId, notebookContentChangeMap, store],
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
    downloadNotebookMarkdown(content, bookTitle);
  }, [content, bookTitle]);

  const handleNavigateToCfi = useCallback(
    (cfi: string) => {
      onNavigateToCfi?.(cfi);
    },
    [onNavigateToCfi],
  );

  return (
    <div className={cn("flex h-full flex-col", { "bg-card": !chromeless })}>
      {!chromeless && (
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
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className={cn("h-full", { "pr-6": chromeless })}>
          {loaded && (
            <TiptapEditor
              ref={editorRef}
              content={content}
              compact={chromeless}
              placeholder={chromeless ? NOTES_EMPTY_PLACEHOLDER : undefined}
              onUpdate={handleUpdate}
              onNavigateToHighlight={handleNavigateToCfi}
              onDeleteHighlight={onDeleteHighlight}
              onReady={() => setEditorReady(true)}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
