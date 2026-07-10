# EPUB Successor Architecture

## Purpose and boundaries

This package is a browser-first, TypeScript EPUB 2/3 engine for reflowable books. It owns container parsing, publication modeling, safe content preparation, navigation, locators, and decorations. It does not own application UI, persistence, sync, DRM, PDF rendering, or a local HTTP server.

The first release targets a defensible EPUB subset rather than claiming full EPUB 3 Reading System conformance. The browser is the final layout authority; the engine coordinates it and records stable semantic positions.

## Package map

Arrows point from a consumer to a dependency. The required main-chain direction is strict:

```text
navigator
    ↓
content-pipeline
    ↓
resource-loader
    ↓
epub-parser
    ↓
publication-model

locations ──────→ NavigatorContracts ←────── decorations
pretext-layout ─→ PretextContracts (advisory only; no main-chain imports)
```

Equivalently: `publication-model ← epub-parser ← resource-loader ← content-pipeline ← navigator`.

### `publication-model`

Pure, immutable domain types and validation-independent helpers:

- `Publication`, `Link`, `Metadata`, `TocEntry`, `Rendition`, and reading-order records.
- `Locator`, `LocatorLocations`, `LocatorText`, and `LocatorRange`.
- Media-type and direction primitives.
- No browser, ZIP, parser, or rendering dependencies.

### `epub-parser`

Turns trusted byte reads into a validated publication model:

- Parses `META-INF/container.xml`, OPF 2/3, EPUB 3 navigation documents, and EPUB 2 NCX.
- Resolves manifest/spine/guide/TOC references without fetching or rendering content.
- Normalizes EPUB 2 and EPUB 3 differences into `Publication`.
- Reports typed diagnostics instead of silently repairing ambiguous structure.

### `resource-loader`

Owns acquisition, path resolution, caching, and lifetime of package resources:

- Opens an EPUB ZIP from `Blob`, `File`, `ArrayBuffer`, or an injected byte source.
- Validates OCF requirements and rejects unsafe archive paths or limits.
- Exposes normalized package-relative resource reads.
- Creates and reference-counts short-lived blob URLs for sanitized section dependencies.
- Never exposes arbitrary network fetching to publication content.

The loader imports parser entry points because opening a resource produces a parsed `PublicationHandle`. Parsing itself only receives a restricted read interface, keeping ZIP mechanics out of the parser.

### `content-pipeline`

Transforms a spine resource into a mountable, inert document:

1. Decode and parse XHTML/HTML.
2. Remove active content and unsafe elements/attributes.
3. Resolve internal references against the package path.
4. Materialize allowed images, fonts, styles, and media as loader-managed blob URLs.
5. Rewrite CSS URLs recursively within explicit depth and size limits.
6. Inject CSP and host styles, serialize, and return a section lease.

The pipeline is the only layer allowed to turn untrusted publication markup into iframe content.

### `navigator`

Owns the browser presentation lifecycle:

- Mounts one section lease in a sandboxed iframe.
- Applies scroll, single-page, or spread pagination.
- Serializes display, resize, and preference changes through a state machine.
- Emits relocations only after layout settles.
- Implements `NavigatorContracts`, the narrow surface used by locators and decorations.

### `locations`

Depends only on `NavigatorContracts` and publication-model types. It converts among DOM ranges, EPUB CFIs, progression values, and package locators. It cannot load resources or mutate layout.

### `decorations`

Depends only on `NavigatorContracts` and publication-model types. It resolves locator ranges and renders transient highlights or annotations. It cannot navigate or acquire resources.

### `pretext-layout`

An optional advisory subsystem behind `PretextContracts`. It may estimate section extent, likely page count, and prefetch priority from text and style features. It is isolated from the main chain and cannot create authoritative locators, relocations, page boundaries, or geometry. The navigator may consume a predictor through dependency injection; no core module imports a concrete predictor.

## Key contracts

`PublicationHandle` combines an immutable `Publication` with capability-scoped operations:

- `readResource(href, signal)` returns bytes and media type.
- `prepareSection(href, policy, signal)` returns a `SectionLease`.
- `close()` aborts work and revokes all owned URLs.

`SectionLease` owns the serialized document URL and all dependency leases created for it. It is explicitly disposed after iframe unload. Releasing twice is harmless.

`NavigatorContracts` exposes only layout facts needed by sibling subsystems:

- current publication and locator;
- resolve locator to a DOM `Range`;
- create locator from a DOM `Range` or viewport point;
- read the active content document and viewport transform while ready;
- subscribe to settled relocation and section-unload events.

Contracts use `AbortSignal`, typed result/error values, and explicit disposal. They do not expose internal caches, DOM mutation hooks, or the ZIP reader.

## Publication and locator models

`Publication` is immutable and contains normalized metadata, `readingOrder`, non-spine `resources`, hierarchical `toc`/landmarks, rendition hints, and safe diagnostics. Every `Link.href` is package-relative and fragment-preserving; it is never a blob URL. EPUB 2 guide/NCX and EPUB 3 navigation/package differences are normalized at the parser boundary rather than leaking into consumers.

`Locator` identifies one reading position or range with:

- required normalized package `href` and optional media type/title;
- strongest available semantic anchor: CFI and/or range selector;
- optional fragment, deterministic text position, resource progression, and total progression;
- bounded `before`/`highlight`/`after` text for same-resource recovery when caller privacy policy permits.

Resolution tries exact CFI/range, then text quote, selector/fragment, and progression. It reports confidence and never silently crosses to another spine item. Page numbers and pixels are session-local layout facts, not durable locator fields.

## Navigation state machine

```text
idle ──open──→ opening ──validated──→ ready
ready ──display──→ preparing ──lease──→ mounting ──load──→ settling ──stable──→ ready
ready ──resize/preferences──→ settling
any live state ──fatal error──→ failed
any live state ──close──→ disposing ──released──→ closed
```

Rules:

1. Commands are serialized; every command receives a monotonically increasing operation ID.
2. A newer display command aborts the older command. Aborted work cannot emit relocation.
3. Iframe load is not layout completion. Completion requires fonts ready (or timed out), two stable animation frames, and unchanged viewport metrics.
4. A relocation contains the settled locator and the operation ID that produced it.
5. Leaving `mounting`, `settling`, or `ready` unloads the old iframe before releasing its section lease.
6. `close()` is idempotent and terminal.

## Layout-settling algorithm

Each mount, resize, or preference change runs against the current operation ID:

1. Capture the strongest semantic locator for the visible position and mark layout dirty.
2. Wait for iframe `load`; install bounded `ResizeObserver`, font, and permitted media-load listeners.
3. Apply host flow/preferences, restore the semantic target, and wait for `document.fonts.ready` with a timeout.
4. On each animation frame sample viewport size, document scroll extent, writing mode/direction, column geometry, and the dirty generation.
5. Require two consecutive identical samples with no intervening resize/resource event. Restart the count whenever the generation changes.
6. At a hard deadline, continue with the latest sample and emit a timeout diagnostic rather than hanging.
7. Measure the final DOM target, correct any predicted/placeholder extent, create the relocation, and emit only if the operation ID is still current.
8. A late font or media change schedules another settle pass that preserves the semantic locator before publishing a corrective relocation.

Prediction integrates only as **predict → mount → measure → correct**. Predicted extent may reserve space or prioritize resources before step 2; it cannot skip settling or replace the measured relocation.

## Resource and blob URL lifecycle

Ownership is hierarchical:

```text
PublicationHandle
  └─ SectionLease
       ├─ document blob URL
       └─ resource URL leases (CSS, images, fonts, media)
```

- ZIP entries remain bytes until requested.
- A prepared section acquires every rewritten dependency before serialization.
- Duplicate dependency requests share one URL and increment its reference count.
- The navigator loads the document URL, waits for load, and then measures.
- On replacement, the iframe is detached first. The lease is released in a queued microtask so the browser cannot race an in-flight subresource read.
- A URL is revoked when its count reaches zero. `PublicationHandle.close()` revokes every remaining URL and clears byte caches.
- Abort paths release partially acquired leases in reverse order.

No blob URL is persisted, logged as a stable identifier, or placed in a locator. Locators retain package-relative `href` values.

## Sandboxed iframe strategy

Prepared sections are loaded from package-owned blob URLs into an iframe with `sandbox="allow-same-origin"`. No `allow-scripts`, forms, popups, downloads, modals, pointer lock, or top-navigation capability is granted.

`allow-same-origin` is deliberate: blob URLs inherit the creator origin, and the host must inspect the content DOM to measure layout, build ranges, and paint decorations. The dangerous combination is `allow-same-origin` plus `allow-scripts`; publication scripts are removed and sandbox script execution is not enabled.

Defense in depth:

- Sanitize before serialization, including SVG and MathML subtrees.
- Reject or rewrite all URL-bearing attributes and CSS `url()` values.
- Inject a restrictive meta CSP: `default-src 'none'`; allow only package-owned `blob:` resources for required media classes and inline author styles; keep scripts, connections, objects, frames, forms, and base URLs disabled.
- Remove `<base>`, `<script>`, event handlers, refresh directives, forms, embedded frames, plugins, and active navigation schemes.
- Intercept safe internal links in the parent and route them through navigator commands.
- Treat malformed content, resource-limit violations, and sanitizer uncertainty as errors, not as reasons to loosen the sandbox.

See [Security Model](./SECURITY.md) and [ADR-0002](./ADR/0002-iframe-per-section.md).

## Pagination and layout

The engine supports three policies over the same sanitized document:

- **Scrolled:** normal block flow, vertical or horizontal according to writing mode.
- **Paginated:** CSS multi-column layout sized to one viewport.
- **Spread:** the same column model with two visible columns when viewport and publication preferences allow.

The navigator applies user preferences through host styles, waits for final browser layout, then measures `scrollWidth`, `scrollHeight`, writing mode, direction, and column progression. Browser geometry is authoritative. Pre-layout estimates may reserve space or prioritize work but are discarded when measured values arrive.

Fixed-layout EPUB, guaranteed vertical-writing pagination, mixed-layout switching, scripted content, and synthetic spread fidelity are not first-release promises.

## Error and cancellation model

Errors are tagged by layer (`ContainerError`, `PackageError`, `ResourceError`, `ContentPolicyError`, `NavigationError`, `LocatorError`). Public operations preserve the causal error and package `href` but never include publication bytes or full markup.

Every I/O or layout operation accepts cancellation. Cancellation is not reported as a fatal publication error. Cleanup is mandatory on success, failure, and abort.

## Sources

- [EPUB 3.3](https://www.w3.org/TR/epub-33/)
- [EPUB 3.3 Reading Systems](https://www.w3.org/TR/epub-rs-33/)
- [EPUB 3 Overview](https://www.w3.org/TR/epub-overview-33/)
- [MDN: ](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox)`<iframe>`[ sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox)
- [MDN: ](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static)`URL.revokeObjectURL()`
- [Readium Architecture](https://readium.org/architecture/)
- [Readium Web README](https://github.com/readium/web)
- [Foliate JS README](https://github.com/johnfactotum/foliate-js)
