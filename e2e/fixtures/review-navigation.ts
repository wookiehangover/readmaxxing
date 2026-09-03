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
import {
  openReviewBook,
  reviewCacheLoaded,
  reviewCheckpointEntered,
  reviewLocalSourcesObserved,
  setReviewsEnabled,
} from "~/lib/themis/reviews/reviews-slice";

/** Runs in a native browser: no hand-authored boundaries or DOM Range mocks. */
export async function exerciseSpineStart(mode: "single" | "double" | "scrolled") {
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
      ' \n<h1 id="first">FIRST CHAPTER</h1><p>First body.</p><h1 id="second">SECOND CHAPTER</h1><p>Second body.</p>',
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
    policy.destroy();
    rendition.destroy();
    nav.destroy();
    store.dispose();
    provider.close();
    container.remove();
  }
}
