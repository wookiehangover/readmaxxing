import { useEffect } from "react";
import { useWorkspace } from "~/lib/context/workspace-context";

export function useReadingLocation(
  bookId: string,
  chapterLabel: string | null,
  currentPage: number | null,
  totalPages: number | null,
) {
  const { setReadingLocation } = useWorkspace();

  useEffect(() => {
    setReadingLocation(bookId, { chapterLabel, currentPage, totalPages });
  }, [bookId, chapterLabel, currentPage, setReadingLocation, totalPages]);
}
