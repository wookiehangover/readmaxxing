import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { X, BookMarked, Download } from "lucide-react";
import { TiptapEditor } from "~/components/tiptap-editor";
import {
  getNotebook,
  saveNotebook,
  getHighlightsByBook,
  type Highlight,
} from "~/lib/annotations-store";
import type { HighlightReferenceAttrs } from "~/lib/tiptap-highlight-node";
import type { JSONContent } from "@tiptap/react";
import { tiptapJsonToMarkdown } from "~/lib/tiptap-to-markdown";

interface AnnotationsPanelProps {
  bookId: string;
  bookTitle?: string;
  isOpen: boolean;
  onClose: () => void;
  onNavigateToCfi: (cfi: string) => void;
}

export function AnnotationsPanel({
  bookId,
  bookTitle,
  isOpen,
  onClose,
  onNavigateToCfi,
}: AnnotationsPanelProps) {
  const [content, setContent] = useState<JSONContent | undefined>(undefined);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showHighlights, setShowHighlights] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<any>(null);

  // Load notebook and highlights on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [notebook, bookHighlights] = await Promise.all([
        getNotebook(bookId),
        getHighlightsByBook(bookId),
      ]);
      if (cancelled) return;
      if (notebook?.content) {
        setContent(notebook.content);
      }
      setHighlights(bookHighlights);
      setLoaded(true);
    }
    load();
    return () => { cancelled = true; };
  }, [bookId]);

  // Refresh highlights list when a highlight is deleted or changed
  useEffect(() => {
    const handler = async () => {
      const bookHighlights = await getHighlightsByBook(bookId);
      setHighlights(bookHighlights);
    };
    window.addEventListener("highlights-changed", handler);
    return () => window.removeEventListener("highlights-changed", handler);
  }, [bookId]);

  // Debounced save
  const handleUpdate = useCallback(
    (newContent: JSONContent) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveNotebook({
          bookId,
          content: newContent,
          updatedAt: Date.now(),
        });
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
    const filename = bookTitle
      ? `${bookTitle}-annotations.md`
      : "annotations.md";
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [content, bookTitle]);

  const handleInsertHighlight = useCallback(
    (highlight: Highlight) => {
      const attrs: HighlightReferenceAttrs = {
        highlightId: highlight.id,
        cfiRange: highlight.cfiRange,
        text: highlight.text,
      };
      // Find the editor instance and insert
      const editorEl = document.querySelector(".tiptap-editor .tiptap");
      if (editorEl) {
        // Use the custom event pattern
        window.dispatchEvent(
          new CustomEvent("insert-highlight-reference", { detail: attrs }),
        );
      }
      setShowHighlights(false);
    },
    [],
  );

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
              {highlights.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setShowHighlights(!showHighlights)}
                  title="Insert highlight reference"
                >
                  <BookMarked className="size-3.5" />
                </Button>
              )}
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

          {showHighlights && highlights.length > 0 && (
            <div className="border-b">
              <div className="px-4 py-2 text-xs font-medium text-muted-foreground">
                Click a highlight to insert it
              </div>
              <div className="max-h-[200px] overflow-y-auto">
                {highlights.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => handleInsertHighlight(h)}
                    className="w-full border-b border-border/50 px-4 py-2 text-left text-xs transition-colors last:border-b-0 hover:bg-muted"
                  >
                    <span
                      className="mr-1.5 inline-block size-2 rounded-full"
                      style={{ backgroundColor: h.color }}
                    />
                    <span className="line-clamp-2 italic">"{h.text}"</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <ScrollArea className="flex-1">
            {loaded && (
              <TiptapEditor
                content={content}
                onUpdate={handleUpdate}
                onNavigateToHighlight={onNavigateToCfi}
              />
            )}
          </ScrollArea>
        </>
      )}
    </div>
  );
}

