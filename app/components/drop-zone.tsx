import { useState, useCallback, useEffect, type DragEvent } from "react";
import { Effect } from "effect";
import { parseEpubEffect } from "~/lib/epub-service";
import { BookService, type Book } from "~/lib/book-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { cn } from "~/lib/utils";

interface DropZoneProps {
  onBookAdded?: (book: Book) => void;
  children?: React.ReactNode;
}

export function DropZone({ onBookAdded, children }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);

  useEffect(() => {
    setIsDragging(dragCounter > 0);
  }, [dragCounter]);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter((c) => c + 1);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter((c) => c - 1);
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragCounter(0);
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files).filter((f) => f.name.endsWith(".epub"));

      if (files.length === 0) return;

      setIsProcessing(true);

      try {
        for (const file of files) {
          const arrayBuffer = await file.arrayBuffer();
          const metadata = await AppRuntime.runPromise(parseEpubEffect(arrayBuffer));

          const book: Book = {
            id: crypto.randomUUID(),
            title: metadata.title,
            author: metadata.author,
            coverImage: metadata.coverImage,
            data: arrayBuffer,
          };

          await AppRuntime.runPromise(BookService.pipe(Effect.andThen((s) => s.saveBook(book))));
          onBookAdded?.(book);
        }
      } catch (error) {
        console.error("Failed to process epub:", error);
      } finally {
        setIsProcessing(false);
      }
    },
    [onBookAdded],
  );

  return (
    <div
      className="relative min-h-screen"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}

      {isDragging && (
        <div
          className={cn(
            "fixed inset-0 z-50 flex items-center justify-center",
            "bg-primary/10 backdrop-blur-sm",
            "border-2 border-dashed border-primary",
          )}
        >
          <div className="rounded-lg bg-card p-8 text-center shadow-lg">
            <p className="text-lg font-medium text-card-foreground">Drop .epub files here</p>
            <p className="mt-1 text-sm text-muted-foreground">Release to add to your library</p>
          </div>
        </div>
      )}

      {isProcessing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="rounded-lg bg-card p-8 text-center shadow-lg">
            <p className="text-lg font-medium text-card-foreground">Processing…</p>
            <p className="mt-1 text-sm text-muted-foreground">Parsing epub metadata</p>
          </div>
        </div>
      )}
    </div>
  );
}
