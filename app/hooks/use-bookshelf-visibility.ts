import { useEffect, useRef, useState } from "react";

/** Keep cover images and 3D surfaces alive only near the shelf's scroll viewport. */
export function useBookshelfVisibility(layout: string) {
  const stackRef = useRef<HTMLOListElement>(null);
  const initialized = useRef(false);
  const [visibility, setVisibility] = useState(() => ({
    visibleIds: new Set<string>(),
    entranceIds: new Set<string>(),
  }));

  useEffect(() => {
    const stack = stackRef.current;
    if (!stack || stack.children.length === 0) return;
    setVisibility({ visibleIds: new Set(), entranceIds: new Set() });
    const observer = new IntersectionObserver(
      (entries) => {
        const initialDelivery = !initialized.current;
        initialized.current = true;
        setVisibility((current) => {
          const visibleIds = new Set(current.visibleIds);
          const entranceIds = new Set(current.entranceIds);
          for (const entry of entries) {
            const id = entry.target.getAttribute("data-book-id");
            if (!id) continue;
            if (entry.isIntersecting) {
              visibleIds.add(id);
              if (initialDelivery) entranceIds.add(id);
            } else {
              visibleIds.delete(id);
              // Leaving the viewport also retires an unfinished entrance animation.
              entranceIds.delete(id);
            }
          }
          return { visibleIds, entranceIds };
        });
      },
      { root: stack.closest(".bookshelf"), rootMargin: "400px 0px" },
    );
    // Observe stable rows, not the faces transformed during selection.
    for (const row of stack.children) observer.observe(row);
    return () => observer.disconnect();
  }, [layout]);

  return { stackRef, ...visibility };
}
