# ADR-0001: Browser layout is authoritative

- Status: Accepted
- Date: 2026-07-10

## Context

EPUB reflow is HTML/CSS layout. Page boundaries and range geometry depend on the active browser's shaping engine, loaded fonts and images, viewport, writing mode, CSS cascade, zoom, and accessibility settings. A pre-layout model can estimate size but cannot reproduce all browser behavior or the DOM users interact with.

The engine needs deterministic navigation semantics without promising identical pixels across Chromium, Firefox, and WebKit.

## Decision

The mounted browser document is the sole authority for final extent, page boundaries, selection geometry, hit testing, and relocation.

The navigator will:

1. prepare and mount sanitized content;
2. apply the selected scroll/page/spread policy and preferences;
3. wait for fonts or timeout, then observe at least two stable animation frames;
4. measure the actual document and derive the semantic relocation;
5. emit only the settled result.

Persisted positions use package `href` plus semantic locators such as CFI, range selectors, text quote, and progression. Pixel coordinates and page numbers are session-local facts.

An optional predictor may estimate extent and prefetch priority, but its result is always corrected by measured layout and cannot create locators.

## Consequences

Positive:

- Selection, decorations, accessibility semantics, and navigation agree with what the user sees.
- The engine delegates complex CSS and text shaping to maintained browser engines.
- Layout differences are measurable and testable rather than hidden behind false precision.

Negative:

- Layout-dependent operations require an iframe mount and asynchronous settling.
- Browser engines can produce different page counts and edge-case fragmentation.
- Font/image readiness and resize need corrective relocation logic.

## Alternatives rejected

- **Custom layout engine:** duplicates a large, changing web platform and would diverge from the interactive DOM.
- **Precomputed page map:** invalid after viewport, font, preference, or browser changes.
- **One canonical headless-browser layout:** cannot describe the geometry in a different user's browser and adds a server dependency.

## Validation

Cross-browser tests assert stable semantic `href`, selected text, and bounded progression after display, resize, and preference changes. They do not require equal page counts or identical pixels.

## References

- [MDN: CSS multi-column layout](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_multicol_layout)
- [EPUB 3.3 Reading Systems](https://www.w3.org/TR/epub-rs-33/)
