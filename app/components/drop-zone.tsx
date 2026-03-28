import { useState, useCallback, useEffect, type DragEvent } from "react";
import { Effect } from "effect";
import { parseEpubEffect } from "~/lib/epub-service";
import { BookService, type BookMeta } from "~/lib/book-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { cn } from "~/lib/utils";

interface DropZoneProps {
  onBookAdded?: (book: BookMeta) => void;
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
    // Only activate for file drags from the OS, not internal DOM drags (e.g. dockview tabs)
    if (e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
      e.stopPropagation();
      setDragCounter((c) => c + 1);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    if (e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
      e.stopPropagation();
      setDragCounter((c) => c - 1);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      // Only handle file drops, not internal DOM drags (e.g. dockview tabs)
      if (!e.dataTransfer?.types.includes("Files")) return;

      e.preventDefault();
      e.stopPropagation();
      setDragCounter(0);
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files).filter((f) => f.name.endsWith(".epub"));

      if (files.length === 0) return;

      setIsProcessing(true);

      const processFiles = Effect.gen(function* () {
        for (const file of files) {
          const arrayBuffer = yield* Effect.promise(() => file.arrayBuffer());
          const metadata = yield* parseEpubEffect(arrayBuffer);

          const book: BookMeta = {
            id: crypto.randomUUID(),
            title: metadata.title,
            author: metadata.author,
            coverImage: metadata.coverImage,
          };

          yield* BookService.pipe(Effect.andThen((s) => s.saveBook(book, arrayBuffer)));
          onBookAdded?.(book);
        }
      }).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            console.error("Failed to process epub:", error);
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            setIsProcessing(false);
          }),
        ),
      );

      await AppRuntime.runPromise(processFiles);
    },
    [onBookAdded],
  );

  return (
    <div
      className="relative min-h-dvh"
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
