import { strToU8, zipSync } from "fflate";
import {
  createNavigator,
  openPublication,
  openZipResourceProvider,
} from "@readmaxxing/epub-successor";
import { loadReviewNavigationSource } from "~/lib/epub/review-navigation-source";
import { ReviewNavigation } from "~/lib/epub/review-navigation";
import { SuccessorRenditionAdapter } from "~/lib/epub/successor-reader-adapter";
import { createAppStore } from "~/lib/themis/store";
import { authSessionResolved } from "~/lib/themis/auth-session/auth-session-slice";
import { emptyReviewCache } from "~/lib/themis/reviews/reviews-records";
import { createReviewsSaga } from "~/lib/themis/reviews/sagas/reviews-saga";
import {
  openReviewBook,
  reviewCacheLoaded,
  reviewCheckpointEntered,
  reviewLocalSourcesObserved,
  setReviewsEnabled,
} from "~/lib/themis/reviews/reviews-slice";

/** Runs in a native browser: no hand-authored boundaries or DOM Range mocks. */
async function createReviewNavigationFixture(mode: "single" | "double" | "scrolled") {
  const xhtml = (body: string) =>
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Whitespace fixture</title></head><body>${body}</body></html>`;
  const files = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml":
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "EPUB/book.opf":
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">whitespace</dc:identifier><dc:title>Whitespace</dc:title><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>',
    "EPUB/nav.xhtml": xhtml(
      '<nav epub:type="toc"><ol><li><a href="one.xhtml#first">First</a></li><li><a href="one.xhtml#second">Second</a></li></ol></nav>',
    ),
    "EPUB/one.xhtml": xhtml(
      ' \n<h1 id="first">FIRST CHAPTER</h1><p>First body.</p><h1 id="second">SECOND CHAPTER</h1>' +
        Array.from(
          { length: 20 },
          (_, i) =>
            `<p id="second-${i}">${"Second body with enough detail to span many pages. ".repeat(15)}</p>`,
        ).join(""),
    ),
    "EPUB/two.xhtml": xhtml(" \n<p>Second chapter continuation.</p>"),
  };
  const data = Uint8Array.from(
    zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)]))),
  ).buffer;
  const provider = await openZipResourceProvider(data);
  const { publication } = await openPublication(provider);
  if (!publication) throw new Error("Could not open whitespace fixture EPUB");
  const source = await loadReviewNavigationSource(data, publication, provider);
  const store = createAppStore();
  store.init();
  store.dispatch(authSessionResolved({ id: "fixture-user", displayName: null }));
  store.dispatch(openReviewBook("fixture", "fixture-reader"));
  store.dispatch(
    reviewCacheLoaded(store.state.reviews.generation, emptyReviewCache("fixture-user", "fixture")),
  );
  store.dispatch(setReviewsEnabled("fixture", true));
  store.dispatch(
    reviewLocalSourcesObserved(
      "fixture-reader",
      Object.fromEntries(source.units.map((unit) => [unit.boundary.key, unit.fingerprint])),
    ),
  );
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;inset:0;width:1000px;height:500px";
  document.body.append(container);
  const policy = new ReviewNavigation(store, "fixture", "fixture-reader", source, () => mode);
  const nav = createNavigator(publication, {
    container,
    preferences: {
      flow: mode === "scrolled" ? "scrolled" : "paginated",
      spread: mode === "double" ? "double" : "single",
      pageTurnAnimation: "none",
    },
    security: { resourceProvider: provider },
    navigationPolicy: policy,
  });
  const rendition = new SuccessorRenditionAdapter(publication, nav);
  policy.rendition = rendition;
  const cleanup = () => {
    policy.destroy();
    rendition.destroy();
    nav.destroy();
    store.dispose();
    provider.close();
    container.remove();
  };
  return { source, store, nav, rendition, policy, cleanup };
}

export async function exerciseSpineStart(mode: "single" | "double" | "scrolled") {
  const { source, store, nav, rendition, policy, cleanup } =
    await createReviewNavigationFixture(mode);
  try {
    const first = source.units[0]!;
    const second = source.units[1]!;
    await nav.display(policy.initialTarget({ spineIndex: 0 }));
    const coldStart =
      nav.currentContentRange?.key === first.boundary.key &&
      !nav.contentDocument!.body.innerText.includes("SECOND CHAPTER");
    await rendition.display("EPUB/one.xhtml#second");
    await rendition.display("EPUB/one.xhtml");
    const bareToc = nav.currentContentRange?.key === first.boundary.key;
    await nav.display(policy.fallbackTarget({ spineIndex: 0, cfi: "invalid" }));
    const fallback = nav.currentContentRange?.key === first.boundary.key;
    await rendition.display("EPUB/one.xhtml#second");
    store.dispatch(reviewCheckpointEntered("fixture", second.chapterIndex, second.boundary, null));
    const lockedSpineStart = policy.resolve({ spineIndex: 0 }) === false;
    await nav.display({ spineIndex: 0 });
    const stillSecond =
      nav.currentContentRange?.key === second.boundary.key &&
      !nav.contentDocument!.body.innerText.includes("FIRST CHAPTER");
    await nav.display({ spineIndex: 1 });
    const continuation = nav.currentContentRange?.key === second.boundary.key;
    // A newly constructed bridge uses the retained checkpoint on refresh.
    const reloaded = new ReviewNavigation(store, "fixture", "fixture-reader", source, () => mode);
    const restored = reloaded.initialTarget({ spineIndex: 0 });
    await nav.display(restored);
    const reload =
      nav.currentContentRange?.key === second.boundary.key && restored.fragment === "second";
    reloaded.destroy();
    return {
      firstStart: first.boundary.start,
      coldStart,
      bareToc,
      fallback,
      lockedSpineStart,
      stillSecond,
      continuation,
      reload,
    };
  } finally {
    cleanup();
  }
}

export async function exerciseContinuation(
  mode: "single" | "double" | "scrolled",
  method: "buttons" | "gesture",
) {
  const { source, store, nav, rendition, policy, cleanup } =
    await createReviewNavigationFixture(mode);
  store.runSaga(createReviewsSaga(store));
  const waitFor = async (predicate: () => boolean) => {
    for (let i = 0; i < 100 && !predicate(); i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
  };
  const turn = async (direction: "next" | "previous") => {
    if (method === "buttons") await (direction === "next" ? nav.next() : nav.previous());
    else if (mode === "scrolled") {
      nav.contentDocument!.defaultView!.dispatchEvent(
        new WheelEvent("wheel", { deltaY: direction === "next" ? 100 : -100 }),
      );
    } else {
      nav.beginInteractivePageTurn(direction);
      nav.updateInteractivePageTurn(direction === "next" ? -800 : 800);
      await nav.endInteractivePageTurn(true);
    }
  };
  try {
    const second = source.units[1]!;
    await rendition.display("EPUB/one.xhtml#second");
    nav.restoreProgression(1);
    await turn("next");
    await waitFor(() => nav.currentRelocation?.spineIndex === 1);
    const forward = nav.currentRelocation?.spineIndex === 1;
    // The continuation fits on one page: its next turn records the real return
    // locator through the existing saga, then page back clears only visibility.
    await nav.next();
    await waitFor(() => store.reviewsSelectors.selectReviewVisible.select(store.state, "fixture"));
    await policy.backToChapter();
    nav.restoreProgression(0);
    await turn("previous");
    await waitFor(() => nav.currentRelocation?.spineIndex === 0);
    // Let native scroll/relocation callbacks run too: programmatic arrival at
    // the end must not immediately bounce forward to the continuation again.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const backSpine = nav.currentRelocation?.spineIndex;
    const sameChapter = nav.currentContentRange?.key === second.boundary.key;
    const doc = nav.contentDocument!;
    const last = doc.getElementById("second-19")?.getBoundingClientRect();
    const atPriorEnd =
      !!last &&
      last.bottom > 0 &&
      last.top < doc.documentElement.clientHeight &&
      last.right > 0 &&
      last.left < doc.documentElement.clientWidth;
    const firstHidden = !doc.body.innerText.includes("FIRST CHAPTER");
    const locked = store.reviewsSelectors.selectReviewLocked.select(store.state, "fixture");
    // At the first fragment's start, another back turn must not enter First.
    nav.restoreProgression(0);
    await nav.previous();
    const earlierBlocked =
      nav.currentContentRange?.key === second.boundary.key &&
      nav.currentRelocation?.spineIndex === 0;
    return {
      forward,
      backSpine,
      sameChapter,
      atPriorEnd,
      firstHidden,
      locked,
      earlierBlocked,
      endGeometry: {
        last: last?.toJSON(),
        width: doc.documentElement.clientWidth,
        height: doc.documentElement.clientHeight,
      },
    };
  } finally {
    cleanup();
  }
}
