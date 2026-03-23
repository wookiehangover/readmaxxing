import { useEffect, useCallback, useRef } from "react";
import { Effect } from "effect";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Download } from "lucide-react";
import { TiptapEditor, type TiptapEditorHandle } from "~/components/tiptap-editor";
import { AnnotationService } from "~/lib/annotations-store";
import { AppRuntime } from "~/lib/effect-runtime";
import type { JSONContent } from "@tiptap/react";
import { tiptapJsonToMarkdown } from "~/lib/tiptap-to-markdown";
import { useEffectQuery } from "~/lib/use-effect-query";
import type { HighlightReferenceAttrs } from "~/lib/tiptap-highlight-node";

interface WorkspaceNotebookProps {
  bookId: string;
  bookTitle?: string;
  onNavigateToCfi?: (cfi: string) => void;
  onRegisterAppendHighlight?: (bookId: string, fn: (attrs: HighlightReferenceAttrs) => void) => void;
  onUnregisterAppendHighlight?: (bookId: string) => void;
}

export function WorkspaceNotebook({
  bookId,
  bookTitle,
  onNavigateToCfi,
  onRegisterAppendHighlight,
  onUnregisterAppendHighlight,
}: WorkspaceNotebookProps) {
  const editorRef = useRef<TiptapEditorHandle | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: notebook, isLoading } = useEffectQuery(
    () => AnnotationService.pipe(Effect.andThen((svc) => svc.getNotebook(bookId))),
    [bookId],
  );
  const content = notebook?.content;
  const loaded = !isLoading;

  const handleUpdate = useCallback(
    (newContent: JSONContent) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
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
    [bookId],
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

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
        <h2 className="truncate text-sm font-semibold">
          {bookTitle ? `${bookTitle} — Notebook` : "Notebook"}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleExportMarkdown}
            title="Export as Markdown"
            disabled={!content}
          >
            <Download className="size-3.5" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {loaded && (
          <TiptapEditor
            ref={editorRef}
            content={content}
            onUpdate={handleUpdate}
            onNavigateToHighlight={handleNavigateToCfi}
          />
        )}
      </ScrollArea>
    </div>
  );
}

