import { useEffect, useRef, useState } from "react";

/** Keep cover images and 3D surfaces alive only near the shelf's scroll viewport. */
export function useBookshelfVisibility(layout: string) {
  const stackRef = useRef<HTMLOListElement>(null);
  const [visibleIds, setVisibleIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    setVisibleIds(new Set());
    const observer = new IntersectionObserver(
      (entries) => {
        setVisibleIds((current) => {
          const next = new Set(current);
          for (const entry of entries) {
            const id = entry.target.getAttribute("data-book-id");
            if (!id) continue;
            if (entry.isIntersecting) next.add(id);
            else next.delete(id);
          }
          return next;
        });
      },
      { root: stack.closest(".bookshelf"), rootMargin: "400px 0px" },
    );
    // Observe stable rows, not the faces transformed during selection.
    for (const row of stack.children) observer.observe(row);
    return () => observer.disconnect();
  }, [layout]);

  return { stackRef, visibleIds };
}
