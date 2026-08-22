import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useRemappedBookId } from "../use-remapped-book-id";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function BookIdProbe({ bookId }: { bookId: string }) {
  const effectiveBookId = useRemappedBookId(bookId);
  return <output data-book-id={effectiveBookId} />;
}

describe("useRemappedBookId", () => {
  it("updates an open chat from a remapped local id to the canonical id", () => {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() => root?.render(<BookIdProbe bookId="local-book" />));
    expect(container.querySelector("output")?.dataset.bookId).toBe("local-book");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("sync:entity-updated", {
          detail: {
            entity: "book",
            bookIdRemap: { fromId: "local-book", toId: "canonical-book" },
          },
        }),
      );
    });

    expect(container.querySelector("output")?.dataset.bookId).toBe("canonical-book");
  });
});
