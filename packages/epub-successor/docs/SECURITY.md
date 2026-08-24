# Security Model

## Security objective

An EPUB is an untrusted archive containing markup, CSS, fonts, images, media, and potentially scripts. Opening a book must not grant its content ambient application-origin capabilities, network access, storage access, top-level navigation, or an unbounded share of CPU and memory.

The design reduces risk; it does not make same-origin browser DOM access intrinsically safe. The host application must keep sensitive DOM and secrets out of reachable globals and must maintain a restrictive application CSP.

## Trust boundaries

```text
untrusted EPUB bytes
  → bounded ZIP reader
  → non-resolving XML/HTML parser
  → validated publication model
  → sanitizer and URL rewriter
  → blob URL registry
  → sandboxed, publication-script-free iframe
  → narrow NavigatorContracts
  → trusted host application
```

The publication model is structurally trusted but still contains untrusted strings. Only content emitted by the pipeline may enter the iframe. The iframe DOM remains tainted input when copied into application UI.

## Threats and mitigations

### Archive attacks

Threats include ZIP bombs, extreme compression ratios, duplicate names, encrypted entries, overlapping entries, malformed central directories, and many-small-file exhaustion.

Controls:

- Configurable hard limits for compressed bytes, total inflated bytes, per-entry inflated bytes, entry count, nesting/rewrite depth, and compression ratio.
- Reject encrypted or unsupported compression methods.
- Reject duplicate normalized paths, inconsistent central-directory/local-header metadata, and entries whose declared sizes exceed limits.
- Inflate lazily and abortably; never expand the whole archive on open.
- Count actual emitted bytes while inflating rather than trusting headers.
- Fail closed before content reaches a parser.

### Path traversal and confused resolution

Threats include `../`, absolute paths, backslashes, encoded separators, NUL bytes, query-based aliases, drive prefixes, and URL schemes disguised as package paths.

Controls:

- Parse references as URLs only after classifying their scheme.
- Percent-decode path segments exactly once for validation; reject encoded `/`, `\`, NUL, or traversal segments.
- Normalize separators to `/`, remove dot segments, and require the result to remain inside the package root.
- Preserve fragments separately; exclude query strings from archive entry identity.
- Reject duplicate archive entries after Unicode and path normalization.
- Allow only resolved manifest/package resources; no arbitrary filesystem or network reads.

### XML entity expansion and parser hazards

Threats include external entities, DTD fetches, entity-expansion bombs, oversized attributes, pathological depth, and namespace confusion.

Controls:

- Reject `DOCTYPE` and entity declarations before XML parsing.
- Use browser `DOMParser` only on bounded strings and reject `parsererror` output.
- Apply byte, node-count, depth, attribute-count, and text-size limits.
- Compare namespace URI and local name, not prefix spelling.
- Never use an XML implementation configured to resolve external entities.

Browser `DOMParser` does not provide a full secure-parser policy surface, so pre-scan and resource bounds are mandatory rather than relying on implementation behavior alone.

### Active content and script execution

Threats include script elements, event attributes, `javascript:` URLs, SVG animation/links, MathML links, meta refresh, forms, plugins, nested frames, and script-capable data documents.

Controls:

- Default-deny element/attribute sanitizer with namespace-aware SVG and MathML policies.
- Remove scripts, event handlers, forms, `<base>`, meta refresh, `object`, `embed`, iframe/frame, portals, and active SVG constructs.
- Drop `srcdoc`, `ping`, `autofocus`, `contenteditable`, and navigation-related attributes not required for reading.
- Grant `allow-scripts` only so current Safari can execute trusted host-installed callbacks; never use it to enable publication-authored code.
- Inject CSP that sets `default-src 'none'`, `font-src blob: 'self'`, `script-src 'none'`, `connect-src 'none'`, `object-src 'none'`, `frame-src 'none'`, `base-uri 'none'`, and `form-action 'none'`.
- Treat scripted EPUB content as unsupported, never partially enabled.

### CSS and external-resource attacks

Threats include remote tracking pixels, font exfiltration, `@import`, recursive imports, `url()` escapes, browser-extension schemes, oversized stylesheets, expensive selectors, and deceptive overlays.

Controls:

- Block all external schemes (`http`, `https`, `ftp`, `file`, extension schemes) by default.
- Rewrite allowed package-relative CSS resources to registry-owned blob URLs.
- Recursively process `@import` with cycle detection, maximum depth, total CSS bytes, and resource-count limits.
- Reject `javascript:`, unapproved `data:`, and unknown schemes in every URL-bearing CSS property.
- Strip behaviors and binding mechanisms; cap stylesheet/rule/selector complexity where the parser exposes it.
- Inject host override styles after author styles for viewport containment, visibility, selection, and accessibility.
- Keep `connect-src 'none'` and resource directives restricted to `blob:`; `font-src` additionally allows `'self'` only for host-provided reader fonts.

The pipeline must use a CSS parser/AST, not regular expressions, for URL rewriting and import discovery.

### Same-origin iframe exposure

`sandbox="allow-same-origin allow-scripts"` is required for host measurement and selection and for trusted host-installed callbacks in current Safari. Publication-authored scripts remain removed by sanitization and blocked by `script-src 'none'`, so an EPUB cannot directly execute code to access the parent under the supported policy. Residual risks include browser vulnerabilities, sanitizer or CSP bypasses, script-capable subresources, and trusted host code accidentally evaluating book-derived strings. Because same-origin plus scripts would let any successful script-policy bypass reach the parent, the sanitizer and CSP are both release-blocking controls rather than optional defense in depth.

Controls:

- Never inject or evaluate publication-derived script, and never relax `script-src 'none'` while the frame has both `allow-same-origin` and `allow-scripts`.
- Use generated blob URLs rather than `srcdoc` so the prepared artifact has a discrete lifecycle.
- Keep parent-installed callbacks closed over the minimum host state; never expose host secrets or evaluate publication-derived code.
- Keep all interactions in parent-owned event listeners and convert link clicks into validated navigator commands.
- Sanitize again when copying publication text or metadata into a different HTML sink.
- Run hostile-content regression tests in every supported browser.

For deployments with a stronger isolation requirement, a separately originated renderer is a future option, but it changes locator and decoration architecture and is not the first-release design.

### Blob URL leakage and lifetime

Blob URLs are bearer-like references within their storage partition. Leaking or retaining them extends access and memory lifetime.

Controls:

- Keep URLs internal to `SectionLease`; public locators always use package paths.
- Reference-count URLs by normalized resource key.
- Unload iframe, queue a microtask, then revoke URLs.
- Revoke partial acquisitions on error/abort and all residual URLs on publication close.
- Never write blob URLs to logs, analytics, persistence, error messages, or clipboard.
- Test leak-free repeated navigation with an instrumented URL registry.

### Denial of service after parsing

Threats include enormous DOMs, font bombs, decompression-heavy images, huge dimensions, pathological layout, mutation loops, and repeated navigation churn.

Controls:

- Content byte/node/depth limits and media metadata checks before mounting.
- Time budgets around parsing, sanitizing, font readiness, and layout settling.
- Abort superseded navigation and release its allocations.
- Bound caches by bytes and entries with least-recently-used eviction.
- Limit generated location work per task and yield to the event loop.
- Surface a typed resource-limit error with the offending package path.

## Default content policy

| Capability                       | Default                                              |
| -------------------------------- | ---------------------------------------------------- |
| Publication JavaScript           | Blocked                                              |
| Forms and submission             | Blocked                                              |
| Nested browsing contexts/plugins | Blocked                                              |
| External network resources       | Blocked                                              |
| Package images/styles/fonts      | Allowed after validation and blob rewrite            |
| Package audio/video              | Optional, user-initiated, blob-rewritten             |
| Inline styles                    | Allowed after CSS processing                         |
| SVG/MathML                       | Allowed through namespace-specific sanitizer         |
| `data:` URLs                     | Blocked except explicitly bounded safe image formats |
| Internal hyperlinks              | Parent-intercepted and navigator-resolved            |

Policies may become stricter. Enabling scripts or arbitrary external resources is outside the public policy API.

## Known browser limitations

- A CSP delivered by injected `<meta http-equiv>` is weaker than a response header: some directives are unavailable in meta delivery, and the element must precede all author-controlled resource-bearing content. Sanitization and CSP remain the primary script controls; sandboxing still blocks every capability token not explicitly granted.
- `sandbox="allow-same-origin allow-scripts"` deliberately keeps the prepared blob document accessible to the parent and lets WebKit run parent-installed callbacks. An opaque-origin iframe would isolate more strongly but would prevent the DOM measurement and range contracts. Any future publication scripting requires a separately originated renderer; it must not reuse this same-origin frame.
- Blob URLs inherit the creator origin and are partitioned with the creator's storage key. Revocation prevents future use but browsers may retain already-decoded resource data until internal caches or documents release it.
- CSS layout, SVG/MathML parsing, image/font decoding, CSP enforcement details, and iframe focus differ across Chromium, Firefox, and WebKit. Browser bugs remain in the trusted computing base.
- CSP and URL rewriting block network exfiltration but cannot place a strict CPU bound on every pathological CSS layout. DOM/stylesheet limits, timeouts, cancellation, and an iframe kill path are still required.
- The CSS Custom Highlight API is not treated as a security boundary and may vary by engine; decorations need a non-mutating overlay fallback.
- Browser privacy/storage behavior can change. The supported browser matrix and hostile corpus must run against every release target rather than assuming one engine's behavior.

## Security invariants

1. No unvalidated archive path reaches ZIP lookup.
2. No unprocessed publication markup reaches a browsing context.
3. No publication-originated script executes.
4. No publication-triggered network request is required for ordinary reading.
5. Every created blob URL has one registry owner and a deterministic revoke path.
6. Resource and complexity limits are checked against actual work, not only declarations.
7. Security diagnostics do not echo hostile markup or opaque resource URLs.

## Verification and response

- Maintain malicious fixtures for traversal, entity expansion, sanitizer bypasses, CSS imports, network beacons, SVG/MathML active content, archive bombs, and blob leaks.
- Record outbound requests during end-to-end tests and require zero book-initiated requests.
- Run parser and path-normalization fuzz/property tests.
- Track sanitizer and ZIP dependency advisories and pin reviewed upgrades.
- Treat a demonstrated content-policy bypass as a release blocker. Publish a patched version and add the exact sample to the regression corpus.

## Sources

- [EPUB 3.3 Security and Privacy](https://www.w3.org/TR/epub-33/#sec-security-privacy)
- [EPUB 3.3 Reading Systems: Security and Privacy](https://www.w3.org/TR/epub-rs-33/#security-privacy)
- [OWASP XML External Entity Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html)
- [OWASP Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal)
- [OWASP HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html)
- [MDN: iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox)
- [MDN: Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP)
- [MDN: Blob URLs](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob)
