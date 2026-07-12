import { useEffect } from "react";
import { useAuth } from "~/lib/context/auth-context";
import { ensureBookChaptersUploaded } from "~/lib/sync/book-chapter-uploads";

/** Migrates stale chapter indexes as soon as authenticated books are opened or restored. */
export function useOpenBookChapterUploads(openBookIds: ReadonlySet<string>): void {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) return;
    for (const bookId of openBookIds) {
      void ensureBookChaptersUploaded(bookId).catch((error) => {
        console.error("Failed to upload chapters for open book:", error);
      });
    }
  }, [isAuthenticated, openBookIds]);
}
