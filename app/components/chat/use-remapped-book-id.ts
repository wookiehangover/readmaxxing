import { useState } from "react";
import { useSyncListener } from "~/hooks/use-sync-listener";

interface RemappedBookIdState {
  sourceBookId: string;
  effectiveBookId: string;
}

export function useRemappedBookId(bookId: string): string {
  const [state, setState] = useState<RemappedBookIdState>({
    sourceBookId: bookId,
    effectiveBookId: bookId,
  });

  useSyncListener(["book"], ({ bookIdRemap }) => {
    if (!bookIdRemap) return;
    setState((current) => {
      const effectiveBookId = current.sourceBookId === bookId ? current.effectiveBookId : bookId;
      if (effectiveBookId !== bookIdRemap.fromId) return current;
      return { sourceBookId: bookId, effectiveBookId: bookIdRemap.toId };
    });
  });

  return state.sourceBookId === bookId ? state.effectiveBookId : bookId;
}
