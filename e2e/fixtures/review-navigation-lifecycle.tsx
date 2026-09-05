import { useRef } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { AppStoreProvider, useAppStore } from "~/lib/themis/provider";
import type { AppStore } from "~/lib/themis/store";
import { useEpubLifecycle } from "~/hooks/use-epub-lifecycle";
import { openReviewBook } from "~/lib/themis/reviews/reviews-slice";

/** Real parent-provider/child-hook cleanup order, including a live book switch. */
export async function exerciseReviewTeardown() {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  let store: AppStore | undefined;
  function Reader({ bookId }: { bookId: string }) {
    store = useAppStore();
    useEpubLifecycle({
      bookId,
      reviewContext: true,
      // No mounted engine is needed to exercise review ownership teardown.
      containerRef: useRef(null),
      readerLayout: "single",
      fontFamily: "serif",
      fontSize: 100,
      fontWeight: 400,
      lineHeight: 1.5,
      textAlign: "left",
      theme: "light",
      persistPosition: false,
      loadAndApplyHighlights: async () => {},
      registerSelectionHandler: () => {},
    });
    return null;
  }
  const render = (bookId?: string) => {
    flushSync(() =>
      root.render(
        <AppStoreProvider>{bookId ? <Reader bookId={bookId} /> : null}</AppStoreProvider>,
      ),
    );
  };
  render("first");
  for (let i = 0; i < 100 && store?.state.reviews.bookId !== "first"; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  if (!store) throw new Error("Reader did not mount");
  const opened = store.state.reviews.bookId === "first";
  render("second");
  const switched = store.state.reviews.bookId === "second";
  render();
  const closed = store.state.reviews.bookId === null;
  render("third");
  store.dispatch(openReviewBook("new-owner", "different-reader"));
  render();
  const newerOwnerRetained = store.state.reviews.bookId === "new-owner";
  render("last");
  // Parent passive cleanup disposes Store before the child's passive cleanup.
  root.unmount();
  host.remove();
  return { opened, switched, closed, newerOwnerRetained };
}
