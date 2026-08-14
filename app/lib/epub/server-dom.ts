import { Window } from "happy-dom";

const DOM_GLOBAL_NAMES = [
  "window",
  "document",
  "DOMParser",
  "Document",
  "DocumentFragment",
  "Node",
  "NodeFilter",
  "Element",
  "HTMLElement",
  "Text",
  "Range",
] as const;

let serverWindow: Window | undefined;

/** Installs the happy-dom globals required by EPUB parsing and CFI generation. */
export function ensureEpubServerDom(): Window {
  if (serverWindow) return serverWindow;

  const window = new Window();
  const globalObject = globalThis as Record<string, unknown>;
  for (const name of DOM_GLOBAL_NAMES) {
    Object.defineProperty(globalObject, name, {
      configurable: true,
      writable: true,
      value: window[name],
    });
  }
  serverWindow = window;
  return window;
}

/** Parses spine XHTML and makes it the active document used by happy-dom Range instances. */
export function parseEpubServerDocument(source: string): Document {
  const window = ensureEpubServerDom();
  const document = new window.DOMParser().parseFromString(source, "application/xhtml+xml");
  (window as unknown as { document: typeof document }).document = document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: document,
  });
  return document as unknown as Document;
}

/** Runs EPUB work after lazily installing a reusable happy-dom environment. */
export function withEpubServerDom<Result>(run: () => Result): Result {
  ensureEpubServerDom();
  return run();
}
