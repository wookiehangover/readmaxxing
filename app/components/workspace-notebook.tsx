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
import { useWorkspace, type NotebookEditorCallbacks } from "~/lib/context/workspace-context";
import { downloadNotebookMarkdown } from "~/lib/editor/export-notebook-markdown";
import { cn } from "~/lib/utils";
import { useAppStore } from "~/lib/themis/provider";
import {
  hydrateAnnotationsRequested,
  updateNotebookRequested,
} from "~/lib/themis/annotations/annotations-slice";

const NOTES_EMPTY_PLACEHOLDER = "If you're not writing, you're not reading";
const EMPTY_NOTEBOOK: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

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
  onUnregisterAppendHighlight?: (
    bookId: string,
    fn: (attrs: HighlightReferenceAttrs) => void,
  ) => void;
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
  // Each object is a save generation owned by the book that produced it.
  const pendingSaveRef = useRef<{ bookId: string; content: JSONContent } | null>(null);
  const mountedRef = useRef(true);
  const content = notebook?.content;

  useEffect(() => {
    store.dispatch(hydrateAnnotationsRequested(bookId));
  }, [bookId, notebookSyncVersion, store]);

  // Reconcile authoritative collection changes into the mounted editor.
  useEffect(() => {
    if (!editorReady || !editorRef.current) return;
    const nextContent = content ?? EMPTY_NOTEBOOK;
    const newContentStr = JSON.stringify(nextContent);
    if (pendingSaveRef.current || newContentStr === lastContentRef.current) return;
    lastContentRef.current = newContentStr;
    fromSyncRef.current = true;
    editorRef.current.setContent(nextContent);
    fromSyncRef.current = false;
  }, [content, editorReady]);

  const flushSave = useCallback(() => {
    const pendingSave = pendingSaveRef.current;
    if (!pendingSave) return;
    pendingSaveRef.current = null;
    store.dispatch(
      updateNotebookRequested(pendingSave.bookId, pendingSave.content, true, undefined, (error) =>
        console.error("Failed to flush notebook save:", error),
      ),
    );
  }, [store]);

  const handleUpdate = useCallback(
    (newContent: JSONContent) => {
      // Skip saving when content was set from a sync pull (not a user edit)
      // Tiptap also emits an update while configuring its initial editable state.
      if (!editorReady || !mountedRef.current || fromSyncRef.current) return;

      // Notify chat panel of content changes so read_notes sees current content
      const changeCallback = notebookContentChangeMap.current.get(bookId);
      if (changeCallback) {
        const markdown = tiptapJsonToMarkdown(newContent);
        changeCallback(markdown);
      }

      // Track pending content for flush-on-unmount
      const pendingSave = { bookId, content: newContent };
      pendingSaveRef.current = pendingSave;
      store.dispatch(
        updateNotebookRequested(
          bookId,
          newContent,
          false,
          () => {
            if (!mountedRef.current || pendingSaveRef.current !== pendingSave) return;
            pendingSaveRef.current = null;
            lastContentRef.current = JSON.stringify(newContent);
          },
          (error) => console.error("Failed to save notebook:", error),
        ),
      );
    },
    [bookId, editorReady, notebookContentChangeMap, store],
  );

  // Flush any pending debounced save on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      flushSave();
    };
  }, [flushSave]);

  // Register the appendHighlightReference callback so the workspace can push highlights here
  useEffect(() => {
    if (!editorReady) return;
    let registered = true;
    const appendFn = (attrs: HighlightReferenceAttrs) => {
      if (registered) editorRef.current?.appendHighlightReference(attrs);
    };
    onRegisterAppendHighlight?.(bookId, appendFn);
    return () => {
      registered = false;
      onUnregisterAppendHighlight?.(bookId, appendFn);
    };
  }, [bookId, editorReady, onRegisterAppendHighlight, onUnregisterAppendHighlight]);

  // Register editor callbacks for live-sync from chat tool handlers.
  // Only register once the Tiptap editor is ready so that tool handlers
  // fall back to IndexedDB during the loading window instead of silently
  // dropping content via the not-yet-functional imperative ref.
  useEffect(() => {
    if (!editorReady) return;
    const isCurrent = () => notebookEditorCallbackMap.current.get(bookId) === callbacks;
    const callbacks: NotebookEditorCallbacks = {
      appendContent: (nodes) => {
        if (isCurrent()) editorRef.current?.appendContent(nodes);
      },
      setContent: (content) => {
        if (isCurrent()) editorRef.current?.setContent(content);
      },
      getContent: () => {
        return (
          (isCurrent() ? editorRef.current?.getContent() : undefined) ?? {
            type: "doc",
            content: [],
          }
        );
      },
      getTopLevelNodeCount: () => {
        return (isCurrent() ? editorRef.current?.getTopLevelNodeCount() : undefined) ?? 0;
      },
      replaceContentFrom: (fromIndex, nodes) => {
        if (isCurrent()) editorRef.current?.replaceContentFrom(fromIndex, nodes);
      },
      seedLastContent: (newContent) => {
        if (isCurrent()) lastContentRef.current = JSON.stringify(newContent);
      },
    };
    notebookEditorCallbackMap.current.set(bookId, callbacks);
    return () => {
      if (isCurrent()) notebookEditorCallbackMap.current.delete(bookId);
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

      <ScrollArea className="min-h-0 flex-1" hideScrollbar={chromeless}>
        <div className={cn("h-full", { "pr-6 pl-6 md:pl-0": chromeless })}>
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
