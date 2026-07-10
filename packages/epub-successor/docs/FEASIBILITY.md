# Feasibility and Delivery Plan

## Verdict

**A secure, useful browser EPUB engine for common reflowable EPUB 2/3 books is feasible. A ground-up, fully conforming replacement for every EPUB 3.3 Reading System behavior is not a credible first-release commitment.**

The project should proceed as an incremental successor focused on:

- bounded EPUB ZIP access;
- normalized EPUB 2/3 publication and locator models;
- scriptless, sandboxed reflowable content;
- browser-authoritative scroll, page, and spread navigation;
- CFI/range-based locations and decorations;
- deterministic disposal, diagnostics, and cross-browser validation.

It should not initially claim complete EPUB 3.3 Reading System conformance. Fixed layout, media overlays, scripted content, remote resources, DRM, multiple renditions, and the long tail of internationalized CSS fragmentation materially expand both scope and security exposure.

## Why the browser must be the layout authority

EPUB reflow is HTML/CSS layout. Final line breaks and geometry depend on browser shaping, fonts, writing mode, viewport, zoom, accessibility settings, CSS cascade, image decoding, column fragmentation, and engine-specific behavior. A parallel layout engine would need to duplicate a large, moving web platform and would still disagree with the DOM users can select and assistive technology can inspect.

Therefore:

1. Navigation waits for mounted browser content to settle.
2. Relocations and decorations derive from the actual DOM and `Range` geometry.
3. Stable locations use semantic anchors (package `href`, CFI/range selectors, text quote) rather than page numbers or pixels.
4. Predictions may improve perceived speed but never decide the final page, selection, or locator.

CSS multi-column layout is suitable for pagination orchestration, not a cross-browser promise of identical pixels. The navigator measures each settled browser and preserves semantic reading position across reflow.

## The role of pre-layout prediction

An optional “pretext” subsystem is feasible if its contract remains advisory and isolated.

Appropriate uses:

- estimate whether a section is small, medium, or large;
- reserve approximate scroll extent to reduce scrollbar jumps;
- prioritize adjacent-section prefetch and cache warming;
- report an approximate page-count interval while the section is not mounted;
- choose an initial mount window or incremental locations budget;
- identify likely outlier content for earlier preparation.

Inappropriate uses:

- emitting authoritative page counts or page boundaries;
- creating persisted locators or CFIs;
- deciding the visible relocation after display;
- computing selection/highlight rectangles or hit targets;
- replacing accessibility-tree or DOM-order inspection;
- overriding measured layout because a prediction had high confidence.

The integration loop is always **predict → mount → measure → correct**. If correction is frequent or visually disruptive, the predictor is disabled without affecting correctness.

## Comparison with existing engines

### epub.js

Useful lessons to retain:

- Clear book/rendition/section concepts and broad proof that client-side EPUB is practical.
- EPUB CFI navigation, hook points, rendition events, pagination, and continuous-flow use cases.
- Lazy section loading and a substantial ecosystem of real publisher content.

What not to copy:

- A compatibility-driven mutable object graph and event/hook behavior as the core contract.
- Implicit resource URL ownership or cleanup.
- Security choices inherited from older browser assumptions, including optional scripted content without this project's fail-closed policy.
- API compatibility as a goal; the successor should expose immutable models, cancellation, and explicit disposal.

### Foliate JS

Useful lessons to retain:

- Modern ESM modules, small composable interfaces, section `load`/`unload`, and browser-native rendering.
- Practical CFI/range handling and measurement-based pagination.
- A useful separation between publication formats and the view layer.

What not to copy:

- Multi-format breadth before EPUB contracts are stable.
- Web Component or application UI coupling as the package API.
- Any reliance on current implementation quirks as a specification substitute.
- An experimental project's compatibility or security envelope without independent tests.

### Readium Web and Readium architecture

Useful lessons to retain:

- Publication, link, locator, navigator, preference, and decoration vocabulary.
- Separation of parsing/fetching, publication models, navigation, and application UI.
- Explicit locator semantics suitable for persistence and interoperation.
- A conformance-minded approach and reusable test publications.

What not to copy:

- A server/client architecture or HTTP publication service when local blob-backed loading suffices.
- The full Readium toolkit, manifest conversion pipeline, DRM integration, or UI surface.
- Experimental Readium Web APIs as stable contracts.
- Scope that conflicts with a small, local-first browser package.

The successor is intentionally closer to Readium's conceptual boundaries, Foliate's browser-native modularity, and epub.js's proven reader use cases than to any project's implementation.

## Main feasibility risks

The hard parts are not ZIP parsing alone. They are the interaction among hostile content, browser layout, locator recovery, and asynchronous lifecycle:

- Safe CSS/resource rewriting needs an AST and strict graph limits.
- Same-origin DOM access is needed for measurement, so script prevention must be defense in depth.
- CFI and text-range stability requires careful filtering of engine-injected nodes.
- Browser column geometry diverges around fragmentation and writing modes.
- Font and image loading can invalidate “settled” layout after initial paint.
- Cancellation must not leak URLs, iframes, listeners, or stale relocation events.

All are tractable for the proposed subset with fixtures and explicit contracts. They become less tractable if fixed layout, scripting, remote resources, or full conformance are pulled into the MVP.

## Milestone plan

### M0 — contracts and threat boundaries

Deliverables: package skeleton, documentation, domain type drafts, error taxonomy, and fixture plan.

Acceptance criteria:

- Module imports can enforce `publication-model ← epub-parser ← resource-loader ← content-pipeline ← navigator`.
- Locations and decorations depend only on navigator contracts; pretext has no main-chain import.
- The supported/unsupported feature matrix and default content policy are reviewed.
- Public contracts include cancellation and disposal.
- At least one minimal valid EPUB 2 and EPUB 3 fixture is identified.

### M1 — bounded open and publication model

Deliverables: ZIP source, safe path resolver, OCF/container/OPF/nav/NCX parsing, immutable publication model.

Acceptance criteria:

- Minimal EPUB 2 and EPUB 3 fixtures open to equivalent normalized models.
- Traversal, duplicate paths, entity declarations, encrypted entries, and archive limits fail with typed errors.
- Valid fixtures pass EPUBCheck; intentionally invalid fixtures have explicit expected diagnostics.
- Open work is abortable and close releases all byte caches.

### M2 — inert content pipeline

Deliverables: XHTML/HTML sanitizer, CSS AST rewrite, dependency graph, CSP injection, blob URL registry, section leases.

Acceptance criteria:

- Allowed package styles, fonts, and images render without network access.
- Scripts, event handlers, active SVG/MathML, forms, plugins, nested frames, external URLs, and unsafe schemes are blocked.
- CSS import cycles and resource limits terminate predictably.
- Every success, error, and abort test returns the URL registry to zero after release.

### M3 — browser-authoritative navigator

Deliverables: one-iframe section mounting, state machine, scroll/page/spread policies, settling and relocation events.

Acceptance criteria:

- Chromium, Firefox, and WebKit navigate within and across sections in scroll and paginated modes.
- Rapid displays are last-command-wins and emit no stale relocation.
- Resize and preference changes preserve a recoverable semantic position.
- Iframe sandbox and CSP match the security model.
- Repeated section churn leaves one active iframe and no released URLs.

### M4 — locators and decorations

Deliverables: supported CFI subset, range locators, text-quote recovery, generated reading positions, highlight/overlay rendering.

Acceptance criteria:

- Range → locator → range round trips preserve selected text in all supported browsers.
- Locations contain package paths and semantic anchors, never blob URLs or pixels.
- Decorations survive reflow and are removed on group deletion or section unload.
- Custom Highlight and overlay paths pass the same behavioral suite.
- Unsupported CFI syntax fails or falls back with a diagnostic.

### M5 — compatibility hardening and optional prediction

Deliverables: publisher corpus, RTL/vertical-writing investigation, performance budgets, leak tests, optional pretext prototype.

Acceptance criteria:

- Compatibility claims are backed by cross-browser fixtures and a published known-limitations list.
- No unbounded growth over 100 mixed navigation/preference operations.
- Security corpus generates no publication-initiated network request.
- Pretext is accepted only if it improves a measured latency/visual-stability metric and never changes settled locators.
- Release review confirms the product does not claim unsupported Reading System conformance.

## Risk register

| Risk                                                    | Likelihood | Impact   | Mitigation / evidence gate                                                                                   |
| ------------------------------------------------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| Sanitizer or URL-rewrite bypass executes active content | Medium     | Critical | Default-deny namespaces, scriptless sandbox, CSP, hostile corpus, security review before release             |
| ZIP/decompression denial of service                     | Medium     | High     | Actual-byte accounting, entry/ratio/size limits, lazy inflation, fuzzing                                     |
| Same-origin iframe expands host exposure                | Medium     | High     | Never grant scripts; keep host secrets out of globals; consider separate-origin renderer as future hardening |
| CSS parser/rewrite complexity exceeds schedule          | High       | High     | Adopt a reviewed AST dependency; limit supported CSS graph; no regex rewriting                               |
| CFI coverage is insufficient for real books             | Medium     | High     | Specify subset, collect corpus, preserve text quote/progression fallbacks, avoid full-conformance claim      |
| Layout varies across browser engines                    | High       | Medium   | Semantic assertions, per-browser measurement, bounded compatibility promises                                 |
| Fonts/images cause late relocation jumps                | High       | Medium   | Font/image readiness gates, timeout diagnostics, corrective reflow preserving locator                        |
| Blob URLs leak under abort/churn                        | Medium     | High     | Lease ownership, instrumented registry, deterministic zero-count tests                                       |
| Accessibility regresses inside iframe                   | Medium     | High     | Keyboard/screen-reader/zoom suite; preserve semantic DOM; avoid text-node wrappers                           |
| Optional pretext becomes a second layout engine         | Medium     | Medium   | Isolated contract, advisory-only type surface, measurable opt-in acceptance gate                             |
| Full-conformance expectations expand MVP                | High       | High     | Feature matrix and milestone gates; separate roadmap and conformance traceability project                    |
| Upstream browser behavior changes                       | Medium     | Medium   | Latest-two-version policy, Playwright matrix, WPT-linked regression fixtures                                 |

## Go/no-go gates

Proceed from prototype to product integration only if M2 proves scriptless rendering with deterministic URL cleanup and M3 proves stable semantic relocation in all three browser engines. Stop or redesign if same-origin content cannot be constrained under the documented policy, if layout correction routinely loses reading position, or if required publisher content needs scripts/remote resources.

Full conformance is a separate go/no-go decision after M5, with a normative requirement traceability matrix and accessibility audit.

## Sources

- [EPUB 3.3](https://www.w3.org/TR/epub-33/)
- [EPUB 3.3 Reading Systems](https://www.w3.org/TR/epub-rs-33/)
- [epub.js README](https://github.com/futurepress/epub.js)
- [Foliate JS README](https://github.com/johnfactotum/foliate-js)
- [Readium Web README](https://github.com/readium/web)
- [Readium Architecture](https://readium.org/architecture/)
- [MDN: CSS multi-column layout](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_multicol_layout)
- [MDN: iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox)
- [MDN: CSS Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API)
