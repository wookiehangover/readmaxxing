# ADR-0002: One sanitized sandboxed iframe per active section

- Status: Accepted
- Date: 2026-07-10
- Amended: 2026-07-17 for current Safari host-callback compatibility

## Context

Publication content is untrusted HTML/CSS/SVG/MathML. It must not share the host document's cascade or directly navigate, submit, open windows, download, or execute scripts. The host still needs DOM access for browser-authoritative measurement, range locators, selection, and decorations.

Rendering all spine items together increases DOM/memory cost, broadens the active attack surface, and complicates resource lifetimes.

## Decision

The navigator mounts exactly one active spine section in an iframe loaded from a prepared blob URL. The iframe uses `sandbox="allow-same-origin allow-scripts"` and omits all other capability tokens. Current Safari requires `allow-scripts` to execute trusted keyboard, selection, decoration, and animation callbacks installed by the parent.

Before mounting, the content pipeline sanitizes the document, rewrites allowed package resources, and injects a restrictive CSP. The parent owns link listeners, navigation, measurement, and decoration behavior. Section replacement follows prepare → mount/load → settle → unload old frame → release old lease.

`allow-same-origin` is required because blob URLs inherit the creator origin and parent DOM access is part of the navigator contract. Publication-authored execution remains prohibited: sanitization removes scripts, handlers, and active URLs, and CSP enforces `script-src 'none'`. Combining same-origin and scripts increases the impact of a sanitizer/CSP bypass, so both controls and hostile-content browser tests are mandatory security boundaries.

## Consequences

Positive:

- Publication styles are isolated from host layout.
- Only one section's DOM and resource graph remain active.
- DOM ranges and geometry stay directly accessible to trusted parent code.
- Section leases map cleanly to iframe lifetime.

Negative:

- Same-origin access plus the Safari callback token leaves a larger residual impact if sanitizer and CSP script prevention both fail.
- Cross-section continuous scrolling requires orchestration or a future bounded window design.
- iframe loading, focus, and accessibility require explicit tests in every browser.

## Alternatives rejected

- **Render into host shadow DOM:** CSS isolation is incomplete for several document behaviors and the attack surface shares the host realm.
- **Opaque-origin sandbox without `allow-same-origin`:** prevents parent DOM measurement and range/decorations contracts.
- **All spine items in one iframe:** increases memory, URL lifetimes, and layout churn.
- **Publication scripting in this frame:** conflicts with the default threat model and materially weakens same-origin isolation; the token is reserved for trusted host callbacks.

## Validation

Security tests inspect sandbox tokens and CSP, attempt every blocked capability, and fail on publication-initiated network requests. Lifecycle tests require one active iframe and zero section URLs after close.

## References

- [MDN: iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox)
- [MDN: Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP)
