# EPUB Support Matrix

## Compatibility claim

The initial engine is intended to render common, reflowable EPUB 2 and EPUB 3 publications safely in current Chromium, Firefox, and WebKit browsers. It is not initially an EPUB 3.3 conforming Reading System and must not be marketed as one until the relevant conformance requirements and test suites pass.

Status vocabulary:

- **Supported (S):** a release-blocking capability with fixtures and cross-browser tests.
- **Experimental (X):** available for evaluation, with a documented fallback and no compatibility promise.
- **Deferred (D):** intentionally outside the MVP; input is preserved or diagnosed where practical.
- **Rejected (R):** prohibited by product or security policy rather than merely unimplemented.

Browser columns describe the package commitment on current engines, not the engine vendor's theoretical API support. “Supported” requires semantic behavior in the package's Playwright project for that browser.

## EPUB features × browser matrix

| Feature                                 | Package | Chromium | Firefox | WebKit | Scope / limitation                                          |
| --------------------------------------- | ------- | -------- | ------- | ------ | ----------------------------------------------------------- |
| OCF ZIP, `container.xml`                | S       | S        | S       | S      | Bounded archive processing; default rootfile                |
| OPF 2.0.1 package/model                 | S       | S        | S       | S      | Manifest, spine, core metadata, guide                       |
| OPF 3.x package/model                   | S       | S        | S       | S      | Manifest, spine, core metadata, rendition hints             |
| EPUB 3 navigation document              | S       | S        | S       | S      | TOC, landmarks, page list                                   |
| EPUB 2 NCX                              | S       | S        | S       | S      | Hierarchical TOC and page targets                           |
| Reflowable XHTML/HTML                   | S       | S        | S       | S      | Sanitized, scriptless content only                          |
| Internal links/fragments                | S       | S        | S       | S      | Parent-intercepted navigator commands                       |
| PNG, JPEG, GIF, WebP                    | S       | S        | S       | S      | Browser decoding under byte/dimension limits                |
| Sanitized SVG                           | X       | X        | X       | X      | Static subset; active content removed                       |
| MathML                                  | X       | X        | X       | X      | Native rendering varies; scriptless sanitized subset        |
| Author CSS and embedded fonts           | S       | S        | S       | S      | AST URL rewrite, resource limits, host overrides            |
| Scrolled reflow                         | S       | S        | S       | S      | One active section at a time                                |
| CSS-column pagination                   | S       | S        | S       | S      | Semantic parity; page breaks/counts may differ              |
| Synthetic two-page spread               | S       | S        | S       | S      | Reflowable content; viewport dependent                      |
| Horizontal LTR/RTL writing              | S       | S        | S       | S      | Direction-aware column progression                          |
| Vertical writing                        | X       | X        | X       | X      | Scrolled first; pagination fidelity not promised            |
| EPUB CFI navigation                     | S       | S        | S       | S      | Documented subset plus locator fallbacks                    |
| Range decorations                       | S       | S        | S       | S      | Custom Highlight when usable; overlay fallback              |
| Media overlays                          | D       | D        | D       | D      | No playback contract in MVP                                 |
| Fixed-layout EPUB                       | D       | D        | D       | D      | Detected and reported, never treated as reflowable          |
| Multiple renditions                     | D       | D        | D       | D      | Default rootfile only                                       |
| Advanced CFI temporal/spatial terms     | D       | D        | D       | D      | Typed diagnostic and fallback when possible                 |
| Collections/dictionaries/indexes UX     | D       | D        | D       | D      | Metadata may be preserved; no specialized behavior          |
| Scripted content                        | R       | R        | R       | R      | Removed by sanitizer and blocked by `script-src 'none'`     |
| Forms, popups, downloads, nested frames | R       | R        | R       | R      | Removed and blocked by sandbox/CSP                          |
| External/remote publication resources   | R       | R        | R       | R      | No publication-initiated network requests                   |
| Arbitrary `javascript:` / `data:` URLs  | R       | R        | R       | R      | Unsafe schemes rejected; bounded raster exception by policy |
| DRM/encrypted commercial content        | R       | R        | R       | R      | Outside package scope                                       |

## EPUB CFI subset

The first stable CFI implementation supports:

- Package and content-document paths to manifest/spine targets.
- Even element steps and odd text-node steps.
- ID assertions for recovery.
- Character offsets in normalized text nodes.
- Range CFIs with a common path and start/end components.
- Escaping rules required by EPUB CFI syntax.

Temporal, spatial, and side-bias parameters; extensive text-location assertions; indirection through embedded documents; and every malformed-CFI recovery behavior are deferred unless required by the validation corpus. Unsupported syntax returns a typed diagnostic and falls back to text quote, fragment, or progression when available.

## CSS and layout limitations

The browser, not the engine, implements CSS. Fidelity therefore varies with browser support, font availability, and the sanitization policy.

- Host preference styles intentionally override some author typography and viewport rules.
- Page boundaries are dynamic and change with viewport, font metrics, zoom, and preferences.
- CSS columns differ at edge cases involving fragmentation, floats, ruby, footnotes, tables, and very large unbreakable content.
- WebKit, Chromium, and Firefox can report different geometry for the same document; tests assert semantic position and bounded page behavior rather than identical pixels.
- `position: fixed`, viewport-covering overlays, extreme `z-index`, and interaction-blocking author rules are neutralized.
- Unsupported or unsafe CSS is dropped with diagnostics where practical.

Pre-layout prediction does not increase the compatibility level of any feature. Only measured browser output determines navigation.

## Browser support policy

The supported matrix is the latest two stable major versions, at release time, of:

- Chrome/Chromium desktop.
- Firefox desktop.
- Safari desktop.
- Safari on iOS/iPadOS.

Edge follows the Chromium result unless a platform-specific issue is known. Mobile Chrome is smoke-tested for viewport and memory behavior. Older embedded WebViews are unsupported unless adopted by a consuming application and added to CI.

Required platform APIs have feature-detected fallbacks:

- `URL.createObjectURL`, sandboxed iframes, `DOMParser`, `Range`, `TreeWalker`, and CSS columns are baseline requirements.
- CSS Custom Highlight API is preferred; an overlay fallback provides decorations.
- `document.fonts.ready` may time out; layout settles with a diagnostic and reflows on a later font event.
- `ResizeObserver` may be supplemented by explicit host resize calls.

## Parsing tolerance

The engine distinguishes safe recovery from ambiguity:

- Missing optional metadata, unknown properties, and non-linear spine entries produce diagnostics and deterministic behavior.
- Missing package documents, unresolved required spine references, unsafe paths, and malformed structures that change resource identity are fatal.
- XHTML that fails XML parsing may be reparsed as HTML only under an explicit compatibility option. The diagnostic records the downgrade.
- Media-type sniffing is limited and cannot override an unsafe or executable resource classification.

## Comparison-informed scope

This design borrows concepts, not compatibility claims:

- Readium provides a useful publication/locator/navigator vocabulary and a strong modularity model.
- Readium Web demonstrates active browser-focused development but remains explicitly experimental in its own README.
- Foliate JS demonstrates a small, practical web component reader and highlights the value of ESM, modular formats, and content isolation.
- epub.js demonstrates broad ecosystem demand for browser EPUB rendering, CFI navigation, hooks, pagination, and continuous flow; it is a comparison baseline, not an oracle for security or conformance.

Any behavior difference must be decided against the EPUB specification, security policy, and project fixtures rather than copied implicitly.

## Deferred conformance work

Before claiming EPUB 3.3 Reading System conformance:

1. Map every applicable normative reading-system requirement to an automated test or documented manual procedure.
2. Run the official EPUB 3 tests where accessible and publish results.
3. Complete accessibility testing across keyboard, screen reader, zoom, contrast, and reading order.
4. Define handling for required content types, fallbacks, media overlays, fixed layout, and internationalization expectations.
5. Resolve browser-specific failures or narrow the public conformance claim.

## Sources

- [EPUB 3.3](https://www.w3.org/TR/epub-33/)
- [EPUB 3.3 Reading Systems](https://www.w3.org/TR/epub-rs-33/)
- [EPUB 3 Multiple-Rendition Publications 1.1](https://www.w3.org/TR/epub-multi-rend-11/)
- [EPUB Canonical Fragment Identifiers 1.1](https://www.w3.org/TR/epub-cfi-11/)
- [EPUBCheck](https://github.com/w3c/epubcheck)
- [Readium Web](https://github.com/readium/web)
- [Foliate JS](https://github.com/johnfactotum/foliate-js)
- [epub.js](https://github.com/futurepress/epub.js)
