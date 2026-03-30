import { useEffect, useCallback, useRef } from "react";
import { Effect } from "effect";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { X, Download } from "lucide-react";
import { TiptapEditor, type TiptapEditorHandle } from "~/components/tiptap-editor";
import { AnnotationService } from "~/lib/annotations-store";
import { AppRuntime } from "~/lib/effect-runtime";
import type { JSONContent } from "@tiptap/react";
import { tiptapJsonToMarkdown } from "~/lib/tiptap-to-markdown";
import { useEffectQuery } from "~/lib/use-effect-query";

interface AnnotationsPanelProps {
  bookId: string;
  bookTitle?: string;
  isOpen: boolean;
  onClose: () => void;
  onNavigateToCfi: (cfi: string) => void;
  onDeleteHighlight?: (highlightId: string, cfiRange: string) => void;
  editorRef: React.RefObject<TiptapEditorHandle | null>;
}

export function AnnotationsPanel({
  bookId,
  bookTitle,
  isOpen,
  onClose,
  onNavigateToCfi,
  onDeleteHighlight,
  editorRef,
}: AnnotationsPanelProps) {
  const { data: notebook, isLoading } = useEffectQuery(
    () => AnnotationService.pipe(Effect.andThen((svc) => svc.getNotebook(bookId))),
    [bookId],
  );
  const content = notebook?.content;
  const loaded = !isLoading;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced save
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

  // Cleanup save timer
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

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

  return (
    <div
      className={`flex h-full shrink-0 flex-col border-l bg-card transition-all duration-300 ease-in-out ${
        isOpen ? "w-[380px]" : "w-0 overflow-hidden border-l-0"
      }`}
    >
      {isOpen && (
        <>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Notebook</h2>
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
              <Button variant="ghost" size="icon-xs" onClick={onClose}>
                <X className="size-3.5" />
              </Button>
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            {loaded && (
              <TiptapEditor
                ref={editorRef}
                content={content}
                onUpdate={handleUpdate}
                onNavigateToHighlight={onNavigateToCfi}
                onDeleteHighlight={onDeleteHighlight}
              />
            )}
          </ScrollArea>
        </>
      )}
    </div>
  );
}
