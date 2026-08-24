# `@readmaxxing/epub-successor`

Browser-first TypeScript library for parsing and rendering reflowable EPUB 2/3 publications. Private workspace package used by the readmaxxing app as the replacement for epub.js.

The browser is the layout authority. The engine opens the archive, sanitizes content, mounts one spine section at a time in a publication-script-free sandboxed iframe, and derives navigation, locators, and decorations from measured DOM geometry.

## Features

- EPUB 2 and EPUB 3 package parsing (`container.xml` → OPF → nav/NCX)
- ZIP resource loading with path traversal rejection and decompression limits
- Content sanitization: scripts, event handlers, and unsafe URLs removed before mount
- Scrolled and CSS multi-column paginated flows (single or double spread)
- LTR and RTL reading direction
- EPUB CFI plus composite locators (text quote / progression fallbacks)
- Highlight decorations via CSS Custom Highlight API with overlay fallback
- Explicit disposal of blob URLs and section leases
- Optional Pretext-style measurement experiment (advisory only; not layout authority)

## Non-goals

- Full EPUB 3.3 Reading System conformance
- Fixed-layout EPUB, media overlays, DRM, or multiple renditions
- Scripted publication content
- Remote/network resources inside books
- epub.js API compatibility

See [Support Matrix](./docs/SUPPORT_MATRIX.md) for the full supported / experimental / deferred / rejected map.

## Install

Workspace dependency (this monorepo):

```json
{
  "dependencies": {
    "@readmaxxing/epub-successor": "workspace:*"
  }
}
```

```ts
import {
  openZipResourceProvider,
  openPublication,
  createNavigator,
  createDecorationLayer,
} from "@readmaxxing/epub-successor";
```

Exports resolve to TypeScript source (`./src/index.ts`). The app Vite config consumes the package directly; there is no separate build step for the package today.

## Quick start

```ts
import {
  openZipResourceProvider,
  openPublication,
  createNavigator,
} from "@readmaxxing/epub-successor";

const file = /* File | Blob | ArrayBuffer */ input;
const provider = await openZipResourceProvider(file);
const { publication, diagnostics } = await openPublication(provider);

if (!publication) {
  throw new Error(diagnostics.map((d) => d.message).join("; ") || "Invalid EPUB");
}

const container = document.getElementById("reader")!;
const navigator = createNavigator(publication, {
  container,
  flow: "paginated",
  preferences: { theme: "light", fontSize: 100 },
  security: { resourceProvider: provider },
});

navigator.addEventListener("relocation", (event) => {
  const { href, spineIndex, localProgression, totalProgression } = event.detail;
  // Persist a composite locator (CFI + href), not page numbers or pixels.
});

await navigator.display({ spineIndex: 0 });
await navigator.next();
await navigator.previous();

// Always destroy when the reader unmounts.
navigator.destroy();
provider.close();
```

### Preferences

```ts
await navigator.setPreferences({
  flow: "scrolled", // or "paginated"
  spread: "double", // "single" | "double" (paginated)
  theme: "dark", // "light" | "dark" | "sepia"
  fontFamily: "Georgia, serif",
  fontSize: 112, // percent
  lineHeight: 1.5,
  margins: 24, // px
  // Or inject host CSS for full control over colors/typography:
  preferenceCss: "body { font-size: 18px !important; }",
});
```

### Locators and decorations

`createDecorationLayer` attaches to a mounted content document for one section:

```ts
import {
  createDecorationLayer,
  locatorFromRange,
  resolveLocator,
} from "@readmaxxing/epub-successor";

const document = navigator.contentDocument!;
const link = publication.readingOrder[relocation.spineIndex];
const section = {
  href: relocation.href,
  spineIndex: relocation.spineIndex,
  spineLength: publication.readingOrder.length,
  mediaType: link?.mediaType,
  title: link?.title,
};

const decorations = createDecorationLayer({ document, section });

// Selection → durable locator (CFI + text quote).
const stop = decorations.on("selection-changed", ({ locator, text }) => {
  if (locator) saveBookmark(locator, text);
});

// Restore a stored locator as a highlight.
decorations.add({
  id: "hl-1",
  locator: storedLocator,
  style: { variant: "highlight", color: "rgba(255, 226, 74, 0.45)" },
});

// Re-create the layer when the active section changes; destroy the old one.
stop();
decorations.destroy();
```

Prefer package-relative `href` + CFI/text anchors for persistence. Blob URLs and page indexes are session-local and must not be stored.

## Package layout

```text
packages/epub-successor/
  src/
    publication-model/   # Immutable Publication, Locator, path helpers
    epub-parser/         # container, OPF, nav, NCX, openPublication
    resource-loader/     # ZIP provider, blob URL leases, CSS URL rewrite
    content-pipeline/    # Sanitize + assemble mountable section documents
    navigator/           # iframe mount, scroll/paginate, preferences, settle
    locations/           # CFI generate/parse/resolve, composite locators
    decorations/         # Highlights and selection events
    pretext-layout/      # Optional advisory measurement experiment
    index.ts             # Public exports
  demo/                  # Local harness (Vite)
  e2e/                   # Playwright package suite
  fixtures/              # Generated + checked-in EPUB fixtures
  docs/                  # Architecture, security, support matrix, ADRs
```

Dependency direction (consumer → dependency):

```text
navigator → content-pipeline → resource-loader → epub-parser → publication-model
locations / decorations → navigator contracts only
pretext-layout → isolated; never authoritative for layout or locators
```

## Scripts

Run from the package directory or via `pnpm --filter @readmaxxing/epub-successor`:

| Command             | Description                                |
| ------------------- | ------------------------------------------ |
| pnpm demo           | Vite demo at /demo/ with fixture selector  |
| pnpm e2e            | Playwright tests for this package          |
| pnpm fixtures:build | Rebuild fixture .epub files from fixtures/ |

From the monorepo root:

```bash
pnpm typecheck
pnpm vitest run packages/epub-successor
pnpm --filter @readmaxxing/epub-successor e2e
pnpm --filter @readmaxxing/epub-successor demo
```

## Security model (summary)

EPUB bytes are untrusted. Default policy:

1. Bounded ZIP inflate; reject traversal, bombs, and unsafe paths.
2. Sanitize markup/CSS before any iframe load; strip scripts and active content.
3. Mount with `sandbox="allow-same-origin allow-scripts"`; `allow-scripts` is required by current Safari for trusted host-installed callbacks, not publication code.
4. Inject a restrictive CSP (`default-src 'none'`, no network, `script-src 'none'`).
5. Rewrite package resources to short-lived blob URLs owned by section leases.
6. Close/destroy revokes every remaining blob URL.

Full threat model: [docs/SECURITY.md](./docs/SECURITY.md).

## Documentation

| Document               | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| docs/ARCHITECTURE.md   | Module boundaries, state machine, resource lifecycle |
| docs/SECURITY.md       | Trust boundaries, threats, content policy            |
| docs/SUPPORT_MATRIX.md | Feature × browser support matrix                     |
| docs/ADR/              | Accepted architecture decisions                      |

## App integration

The readmaxxing app wires this package through:

- `app/hooks/use-epub-lifecycle.ts` — open, navigate, preferences, positions
- `app/lib/epub/successor-reader-adapter.ts` — app-facing adapters (TOC, CFI display, positions)
- `app/lib/epub/epub-service.ts` — import-time metadata/cover extraction
- `app/hooks/use-highlights.ts` — decorations layer

App-level architecture: [docs/architecture.md](../../docs/architecture.md).

## License

Private package. Not published to npm.
